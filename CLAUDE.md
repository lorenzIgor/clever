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
  Genérico: atende qualquer domínio pelo header `Host`. Resolve o IP real com
  `dns.resolve4` (ignora `/etc/hosts`, evita loop), remove
  `content-security-policy`/`strict-transport-security`/`x-frame-options`. A div
  Clever entra como primeiro nó dentro do `<body>` (`BODY_OPEN_RE`), flutuante
  (`position:fixed`, 0,0, z-index máximo); o loader vai no fim do `<body>`.
- **`domains.json`** — fonte única da lista de domínios alvo. O `run.py` e o
  `ua-rotate.js` leem deste arquivo; é o único lugar para editar a lista.
- **`Caddyfile`** — site (TLS interno) + `reverse_proxy` para o proxy.
  **Gerado pelo `run.py`** a partir de `domains.json` — não editar à mão.
- **`index.html`** — página de teste standalone (legado, dos primeiros testes).
  Não é usada no modo proxy, onde o Caddy repassa tudo.
- **`ua-rotate.js`** — abre `WINDOW_COUNT` janelas do Chrome (Puppeteer), uma
  por slot do grid de `DISPLAYS`. Cada janela percorre os domínios
  (`domains.json`) em ordem aleatória, recarregando para o próximo a cada 5-10s
  (`RELOAD_MIN_S`/`RELOAD_MAX_S`); a cada reload troca o perfil de User-Agent
  (round-robin, `PROFILES`), alinhando header `User-Agent` + Client Hints
  (`Sec-CH-UA*`) + `navigator.userAgentData` via `setUserAgent(ua, metadata)`.
  Cada janela é supervisionada: se o Chrome travar/cair, é relançada sozinha.
  `package.json` + `puppeteer.config.cjs` (usa o Chrome instalado).
- **`run.py`** — orquestrador cross-platform (Python, só stdlib; macOS/Windows/
  Linux). Num comando: garante os domínios no arquivo hosts, gera o `Caddyfile`,
  limpa o DNS, sobe `proxy.js` + `caddy` + `ua-rotate.js` e derruba tudo na
  ordem no Ctrl+C. Precisa rodar elevado (`sudo` / Administrador).

## Como rodar

Pré-requisitos: `node`, `caddy` e `python3` no PATH, e `npm install` uma vez.
O `run.py` precisa de privilégios de administrador (editar o arquivo hosts e
abrir a porta 443).

```bash
# macOS / Linux
sudo python3 run.py
sudo python3 run.py static     # janelas não recarregam (para testar clique)
sudo python3 run.py win        # filtra os perfis de UA por "win"
```

```powershell
# Windows — abrir o Terminal/PowerShell COMO ADMINISTRADOR
python run.py
```

O `run.py` faz tudo: arquivo hosts, gera o `Caddyfile`, flush de DNS, sobe
`proxy.js` + `caddy` + `ua-rotate.js`. Ctrl+C derruba tudo na ordem. O terminal
do proxy loga cada request e a linha `[html] ... injetado=true`; o
`ua-rotate.js` loga `[janela N] domínio · perfil` a cada reload.

Ajustes: env `RELOAD_MIN_S`/`RELOAD_MAX_S` (padrão 5/10s) e a const `DISPLAYS`
no `ua-rotate.js` (telas: origem/tamanho/colunas/quantas janelas).

## Domínios alvo

A lista vive **só em `domains.json`**. Para mudar os domínios, edite esse
arquivo e rode o `run.py` de novo — ele atualiza o arquivo hosts e regera o
`Caddyfile`; o `ua-rotate.js` lê o `domains.json` direto. O `proxy.js` é
genérico (resolve qualquer host) e injeta a div no início do `<body>` — não
precisa de ajuste por site.

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
- **Renderizar ≠ contabilizar.** A contagem no dashboard Clever depende de:
  domínio registrado na conta Clever, viewability (banner visível, aba focada
  ~1s contínuo) e um delay de processamento no primeiro acesso.
- **Cada janela do `ua-rotate.js` é um Chrome inteiro — ~6 é o teto.** Num
  MacBook 14", acima de ~6 janelas a CPU/memória esgotam e até trocar o
  User-Agent (`Network.setUserAgentOverride`) começa a dar timeout, e as janelas
  vão "parando". As janelas são supervisionadas (relançam sozinhas se o Chrome
  travar/cair), mas isso não cria capacidade — se a máquina satura, relançar só
  piora. Para mais janelas: outra máquina, ou subir `RELOAD_MIN_S`/`MAX_S`.
