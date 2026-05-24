# Clever — harness de teste de tag de adserver

## Objetivo

Testar localmente a tag do adserver **Clever Core** (`cleverwebserver.com`, zona
`103461`, loader `83697330594d1e8aade23cc07e4bd4a9.js`) em sites que a Clever
**bloqueia/atribui por domínio**.

A Clever decide servir/atribuir o anúncio olhando o hostname da página que
carrega a tag — via header `Referer`/`Origin` e checagem client-side
(`window.location.hostname`). Este projeto faz a máquina local servir o site
alvo **no próprio domínio autorizado**, com a tag Clever injetada, para que o
ambiente de teste seja indistinguível do site real do ponto de vista da Clever.

Status: integração validada — banner renderiza, beacon de impressão (`Pixel.gif`)
retorna 200 e o dashboard da Clever contabiliza.

## Como funciona (arquitetura)

```
navegador --https--> Caddy (:443, TLS) --http--> proxy.js (:8787) --https--> site REAL
                                                       |
                                              injeta a tag Clever no HTML
```

1. O **arquivo hosts** do SO (`/etc/hosts` no macOS/Linux,
   `C:\Windows\System32\drivers\etc\hosts` no Windows) aponta os domínios alvo
   para `127.0.0.1` **e** `::1`.
2. **Caddy** termina o TLS com um cert da sua CA interna (`tls internal`,
   confiável localmente) e repassa tudo para o proxy Node.
3. **proxy.js** busca o site **real** (resolve o IP verdadeiro via DNS),
   descomprime o HTML, injeta a tag Clever e devolve. Recursos de outros
   hosts (CDNs) o navegador busca direto — só os domínios alvo passam pelo proxy.

## Arquivos

- **`proxy.js`** — proxy reverso de injeção (Node, sem dependências externas).
  Genérico: atende qualquer domínio pelo header `Host`. Resolve o IP real via
  DNS-over-HTTPS (Cloudflare, porta 443; fallback `dns.resolve4`) — ignora o
  `/etc/hosts`, evita loop —, remove
  `content-security-policy`/`strict-transport-security`/`x-frame-options`. A div
  Clever entra como primeiro nó dentro do `<body>` (`BODY_OPEN_RE`), flutuante
  (`position:fixed`, 0,0, z-index máximo); o loader vai no fim do `<body>`.
- **`domains.json`** — fonte única da lista de domínios alvo. Formato: objeto
  JSON `{"dominio": [peso, ctr]}`. `peso` é o valor relativo do sorteio por
  ciclo (o `ua-rotate.js` normaliza pela soma — `0..1`, `0..100`, tanto faz);
  peso `0` pausa o domínio sem removê-lo. `ctr` é a taxa de clique em
  **percentual, por impressão** (`0.1` = 0,1% = 1 clique a cada 1000 anúncios
  renderizados); `0` = nunca clica. **Os valores são REFERÊNCIA** — o
  `ua-rotate.js` aplica um fator multiplicativo em ±10% por dia (UTC) sobre
  peso e CTR (fatores independentes), determinístico por (data, domínio,
  kind) via hash; restart no mesmo dia ou várias instâncias paralelas batem
  igual. Constante `VARIATION` no `ua-rotate.js` controla a amplitude. Na
  virada do dia UTC o timer recalcula e o novo valor passa a valer no
  próximo ciclo de cada janela. **Determinístico e global por domínio** —
  o `ua-rotate.js` mantém um contador único por domínio (`globalCounts`)
  somado por TODAS as janelas; ao bater `round(100/ctr)`, a primeira janela
  disponível tenta o clique (mutex `clickingNow` evita duplicata). Reset só
  em clique bem-sucedido — se a janela falhar, a próxima impressão em
  qualquer janela retoma. O `run.py` lê só as chaves (para o hosts e o
  Caddyfile); o `ua-rotate.js` lê tudo.
- **`Caddyfile`** — site (TLS interno) + `reverse_proxy` para o proxy.
  **Gerado pelo `run.py`** a partir de `domains.json` — não editar à mão.
- **`index.html`** — página de teste standalone (legado, dos primeiros testes).
  Não é usada no modo proxy, onde o Caddy repassa tudo.
- **`ua-rotate.js`** — abre `WINDOW_COUNT` janelas do Chrome (Puppeteer), uma
  por slot do grid de `DISPLAYS`. Cada janela **relança um Chrome novo a cada
  5-10s** (`RELOAD_MIN_S`/`RELOAD_MAX_S`) num domínio sorteado por peso de
  `domains.json` (`pickDomain()`, proporcional ao valor do peso). Em paralelo
  ao ciclo, `waitForAd()` espera o iframe do anúncio aparecer dentro de
  `.clever-core-ads` (até ~4s); cada renderização soma 1 no contador GLOBAL
  por domínio (`globalCounts`, no `handleImpression`) — todas as janelas
  contribuem para o mesmo contador. Ao bater `round(100/CTR%)`, a primeira
  janela disponível tenta `clickAt()` (`page.mouse.click` em desktop,
  `page.touchscreen.tap` em mobile); mutex `clickingNow` evita dois cliques
  simultâneos. Reset (`count -= threshold`, preserva excedente) só em clique
  bem-sucedido — se a janela falhar, a próxima impressão em qualquer janela
  retoma a tentativa. Linha `[stats]` periódica (5s) mostra `dom=n/threshold
  (%)` para cada domínio com CTR > 0. A cada ciclo o navegador sobe limpo,
  sem estado do anterior
  (não é `reload` da mesma aba, é fechar e reabrir). A cada relançamento troca o
  perfil de User-Agent (round-robin, `PROFILES`), alinhando header `User-Agent`
  + Client Hints (`Sec-CH-UA*`) + `navigator.userAgentData` via
  `setUserAgent(ua, metadata)`. Os perfis incluem **desktop** (Chrome no
  Windows/macOS) e **mobile** (Chrome no Android, com `page.setViewport`
  `isMobile`/`hasTouch` para o site renderizar em layout mobile); cada ciclo
  sorteia a classe conforme as flags `-device`/`-device_mode`. Se o Chrome
  travar/cair, o ciclo só reinicia antes. Aceita flags de tela
  (`-w -h -cols -count -scale`) e de agente (`-platform -device -device_mode`)
  — sem flags, usa os padrões das constantes do arquivo. `package.json` +
  `puppeteer.config.cjs` (usa o Chrome instalado).
- **`run.py`** — orquestrador cross-platform (Python, só stdlib; macOS/Windows/
  Linux). Num comando: garante os domínios no arquivo hosts, gera o `Caddyfile`,
  limpa o DNS, sobe `proxy.js` + `caddy` + `ua-rotate.js` e derruba tudo na
  ordem no Ctrl+C. Precisa rodar elevado (`sudo` / Administrador).
- **`watchdog.sh`** — watchdog do `run.py` no macOS e Linux (bash, só roda
  como root). Equivalente POSIX do `watchdog.ps1`. Mesma lógica: loop infinito
  rodando `python3 run.py`, religa se cair; Ctrl+C encerra junto. Repassa os
  argumentos para o `run.py`. Precisa `chmod +x` uma vez.
- **`aws-user-data.md`** — script de **User data** do Launch Template das spot
  instances na AWS (Ubuntu). Sobe Chrome + Caddy + ua-rotate como serviços do
  systemd, dimensiona `/dev/shm`, ajusta ulimits/sysctls de rede e calcula
  sozinho `COUNT`/`COLS`/`RES_W`/`RES_H` a partir de `nproc` (fórmula
  adaptativa calibrada em testes reais). Cria `/dev/shm/puppeteer_chrome_profiles`,
  que o `ua-rotate.js` usa como `userDataDir` por janela quando detecta
  Linux+root. Salva a config em `/etc/clever.env`. Copiar/colar no campo
  *User data* do Launch Template (não vai pra dentro da instância — fica no LT).
- **`watchdog.ps1`** — watchdog do `run.py` no Windows (PowerShell, só roda
  elevado). Loop infinito: roda `python run.py`, espera ele sair e o relança.
  Funciona porque o `run.py` já encerra sozinho de forma limpa quando um filho
  cai (detecta o processo morto, retorna e o `shutdown()` derruba tudo na
  ordem). Antes de relançar dá `caddy stop` para liberar a porta 443 de um
  caddy órfão. Ctrl+C encerra o watchdog junto com o `run.py`; há ainda uma
  janela de 5s (`RESTART_DELAY`) após cada saída para cancelar com Ctrl+C, para
  não confundir parada intencional com crash. Argumentos são repassados ao
  `run.py`. Não usar Serviço do Windows aqui: serviço roda na sessão 0, sem
  desktop, e as janelas do Chrome do `ua-rotate.js` não apareceriam.

## Como rodar

Pré-requisitos: `node`, `caddy` e `python3` no PATH, e `npm install` uma vez.
O `run.py` precisa de privilégios de administrador (editar o arquivo hosts e
abrir a porta 443).

```bash
# macOS / Linux (Ubuntu 24.04)
sudo python3 run.py
sudo ./watchdog.sh                                  # relança sozinho se cair
sudo python3 run.py static                          # janelas não recarregam (testar clique)
sudo python3 run.py -platform linux                 # só perfis de UA Linux
sudo python3 run.py -device all -device_mode 60:40  # entrega desktop+mobile, 60/40
sudo python3 run.py -w 1920 -h 1080 -cols 4 -count 16 -scale 0.5  # ajusta o grid da tela
```

> No Ubuntu 24.04 o pacote `caddy` do apt sobe um serviço que prende a porta
> 443. Desligue com `sudo systemctl disable --now caddy` (o `run.py` sobe seu
> próprio Caddy). Em servidor sem desktop, use `xvfb-run`.

```powershell
# Windows — abrir o Terminal/PowerShell COMO ADMINISTRADOR
python run.py
python run.py -device all -device_mode 60:40   # entrega desktop+mobile, 60/40
.\watchdog.ps1            # roda o run.py e o relança sozinho se cair
.\watchdog.ps1 -w 1920 -h 1080 -cols 4 -count 16 -scale 0.5   # flags repassadas ao run.py
```

O `run.py` faz tudo: arquivo hosts, gera o `Caddyfile`, flush de DNS, sobe
`proxy.js` + `caddy` + `ua-rotate.js`. Ctrl+C derruba tudo na ordem. O terminal
do proxy loga cada request e a linha `[html] ... injetado=true`; o
`ua-rotate.js` loga `[janela N] domínio · perfil` a cada relançamento.

Ajustes via flags de linha de comando (repassadas pelo `run.py`/`watchdog.ps1`
ao `ua-rotate.js`):

- **Tela:** `-w <px>` / `-h <px>` (resolução nativa), `-cols <n>`, `-count <n>`
  (janelas), `-scale <f>` (zoom global). Passar qualquer flag de tela monta uma
  tela única a partir delas; sem flags, usa `DISPLAYS_DEFAULT`.
- **Agente:** `-platform win|mac|linux|all` (SO dos perfis desktop), `-device
  desktop|mobile|all` (classes a entregar), `-device_mode random|N:M` (proporção
  desktop:mobile quando `-device all`, ex.: `60:40`).

Sem flags, o padrão é o do `ua-rotate.js` (desktop, 4K, 16 janelas). Também: env
`RELOAD_MIN_S`/`RELOAD_MAX_S` (padrão 5/10s) e, para multi-monitor, a const
`DISPLAYS_DEFAULT` no `ua-rotate.js`.

## Domínios alvo

A lista vive **só em `domains.json`**, no formato `{"dominio": peso}`. O peso
controla a frequência com que o `ua-rotate.js` visita cada domínio (sorteio
ponderado por ciclo); todos com peso `1` = uniforme. Para mudar os domínios
ou os pesos, edite esse arquivo e rode o `run.py` de novo — ele atualiza o
arquivo hosts e regera o `Caddyfile`; o `ua-rotate.js` lê o `domains.json`
direto. O `proxy.js` é genérico (resolve qualquer host) e injeta a div no
início do `<body>` — não precisa de ajuste por site.

Domínios atrás de proteção anti-bot forte (ex.: Cloudflare) podem não funcionar:
o proxy busca o site server-side e o Cloudflare bloqueia o fingerprint do Node.
Foi o caso do `whoscored.com`, removido da lista.

## Gotchas aprendidos (importante)

- **O arquivo hosts precisa de IPv4 E IPv6.** Se mapear só `127.0.0.1`, o
  domínio ainda tem registro AAAA real e o navegador (Chrome prefere IPv6)
  conecta no site verdadeiro, furando o proxy. Mapear também `::1`. O `run.py`
  cuida disso (`/etc/hosts` no macOS/Linux, `C:\Windows\System32\drivers\etc\
  hosts` no Windows).
- **Brave bloqueia `scripts.cleverwebserver.com`** via Brave Shields antes da
  requisição sair. Testar no Chrome ou Firefox (ou desligar o Shields).
- **Sites SPA (React/Next.js) podem apagar a div injetada** na hidratação. O
  `CLEVER_SCRIPT` injeta um guardião com `MutationObserver` que recria a div
  `.clever-core-ads` sempre que ela some e re-injeta o loader Clever (limite
  `MAX_INJECTIONS`, padrão 6) para o anúncio voltar a renderizar. Re-injetar
  pode disparar o beacon mais de uma vez — aceitável em teste.
- **`dns.resolve4`, não `dns.lookup`.** `lookup` consulta o `/etc/hosts` e
  cairia em loop (domínio → 127.0.0.1 → Caddy → proxy → ...).
- **DNS da máquina instável → `502 Falha de DNS` no navegador.** O `dns.resolve4`
  (c-ares) depende do DNS do SO e faz consulta crua na porta 53 — que muitas
  redes bloqueiam ou apontam para um resolvedor local inexistente (`queryA
  ECONNREFUSED`). Por isso o `proxy.js` resolve o IP do site via **DNS-over-HTTPS**
  (Cloudflare `https://1.1.1.1/dns-query`, porta 443): não depende do DNS da
  máquina nem da porta 53. Se o DoH falhar, cai no `dns.resolve4` — que usa os
  servidores da env `DNS_SERVERS` (padrão `1.1.1.1,1.0.0.1,8.8.8.8`; vazia = DNS
  do SO).
- **Renderizar ≠ contabilizar.** A contagem no dashboard Clever depende de:
  domínio registrado na conta Clever, viewability (banner visível, aba focada
  ~1s contínuo) e um delay de processamento no primeiro acesso.
- **Cada janela do `ua-rotate.js` é um Chrome inteiro — ~6 é o teto.** Num
  MacBook 14", acima de ~6 janelas a CPU/memória esgotam e até trocar o
  User-Agent (`Network.setUserAgentOverride`) começa a dar timeout, e as janelas
  vão "parando". As janelas são supervisionadas (relançam sozinhas se o Chrome
  travar/cair), mas isso não cria capacidade — se a máquina satura, relançar só
  piora. Para mais janelas: outra máquina, ou subir `RELOAD_MIN_S`/`MAX_S`.
- **Mobile é emulação, não janela física.** A janela continua ocupando o slot
  do grid no tamanho normal; o `page.setViewport` com `isMobile`/`hasTouch` faz
  a página renderizar em largura mobile *dentro* da janela. A Clever recebe os
  sinais de dispositivo móvel pelo UA Android + Client Hints (`mobile: true`) +
  dimensões do viewport — é o que decide a entrega mobile, não o tamanho da
  janela do SO.
