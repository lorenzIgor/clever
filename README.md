# Clever — guia de instalação (Windows, macOS, Linux Ubuntu 24.04)

Este guia é para instalar e rodar o sistema **do zero**, sem precisar entender
de programação. Escolha a seção do seu sistema operacional e siga **na ordem**.

Para o que cada arquivo faz e como o sistema funciona por dentro, veja o
`CLAUDE.md`. Aqui o foco é só **instalar e ligar**.

---

## O que você vai instalar

São 4 programas + este projeto. Todos são gratuitos.

| Programa  | Para quê serve                                  |
|-----------|-------------------------------------------------|
| Node.js   | roda o proxy e abre as janelas do Chrome        |
| Python    | é o programa principal que liga tudo (`run.py`) |
| Caddy     | cuida da parte de segurança (HTTPS) das páginas |
| Chrome    | o navegador onde os anúncios aparecem           |

> ⚠️ **Não use o navegador Brave** — ele bloqueia os anúncios da Clever.

---

# 🪟 Windows

## Passo 1 — Instalar os programas com winget

Abra o **Prompt de Comando** (menu Iniciar → digite `cmd` → Enter) e cole as
quatro linhas abaixo, **uma de cada vez**, apertando Enter entre elas. Se ele
perguntar algo, responda `S` ou `Y` e aperte Enter.

```
winget install -e --id OpenJS.NodeJS
winget install -e --id Python.Python.3.11
winget install CaddyServer.Caddy
winget install Google.Chrome
```

> Se o comando `winget` não for reconhecido, atualize a **"App Installer"** pela
> Microsoft Store e tente de novo. Em Windows muito antigos (10 sem atualização)
> pode ser necessário instalar o winget pelo GitHub:
> https://github.com/microsoft/winget-cli

## Passo 2 — Reiniciar o computador

Depois de instalar tudo, **reinicie o Windows**. Isso garante que `node`,
`python` e `caddy` passem a ser reconhecidos pelo sistema.

## Passo 3 — Preparar o projeto (só uma vez)

1. Coloque a pasta do projeto (`clever`) em um lugar fácil, por exemplo na
   **Área de Trabalho**.
2. Abra a pasta `clever`.
3. Na barra de endereço da janela da pasta, clique, apague tudo, digite `cmd` e
   aperte **Enter**. Isso abre o Prompt de Comando **já dentro da pasta certa**.
4. Cole a linha abaixo e aperte **Enter**:

   ```
   npm install
   ```

5. Espere terminar (pode demorar alguns minutos — baixa o Chrome de teste do
   Puppeteer). Quando o cursor voltar a piscar, está pronto. Pode fechar.

> Esse passo só precisa ser feito **uma vez**.

## Passo 4 — Rodar com o watchdog

O **watchdog** liga o sistema e religa sozinho se algo travar ou cair.

### 4.1 — Abrir o PowerShell como Administrador

1. Abra o menu Iniciar e digite `powershell`.
2. Clique com o **botão direito** em **"Windows PowerShell"**.
3. Escolha **"Executar como administrador"** e confirme.

### 4.2 — Entrar na pasta do projeto

Digite `cd `, **arraste a pasta `clever`** para dentro da janela e aperte Enter.
Exemplo:

```
cd C:\Users\SeuNome\Desktop\clever
```

### 4.3 — Ligar o watchdog

```
.\watchdog.ps1
```

> **Se aparecer um erro vermelho**, rode o comando correspondente **uma vez** e
> tente o `.\watchdog.ps1` de novo:
>
> - **"execução de scripts foi desabilitada"**:
>   ```
>   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
>   ```
> - **"não está assinado digitalmente"** (acontece quando o projeto foi baixado
>   como ZIP do GitHub — o Windows marca os arquivos como vindos da internet):
>   ```
>   Get-ChildItem -Recurse | Unblock-File
>   ```

Pronto — em alguns segundos, **janelas do Chrome vão abrir sozinhas**.

---

# 🍎 macOS

## Passo 1 — Instalar o Homebrew (se ainda não tiver)

No **Terminal** (Aplicativos → Utilitários → Terminal), cole:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Siga as instruções na tela. Ao final, ele costuma pedir para rodar duas linhas
extras de `eval "$(/opt/homebrew/bin/brew shellenv)"` — copie e cole-as.

## Passo 2 — Instalar os programas

```
brew install node python@3.12 caddy
brew install --cask google-chrome
```

## Passo 3 — Preparar o projeto (só uma vez)

```
cd ~/Desktop/clever        # ajuste para onde estiver a pasta
npm install
```

## Passo 4 — Rodar com o watchdog

```
chmod +x watchdog.sh       # só na primeira vez, para deixar executável
sudo ./watchdog.sh
```

(Vai pedir a senha do seu usuário do macOS. Use a mesma do login.)

---

# 🐧 Linux (Ubuntu 24.04)

## Passo 1 — Atualizar o sistema

```
sudo apt update && sudo apt upgrade -y
```

## Passo 2 — Instalar Node.js (LTS, via NodeSource)

```
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

## Passo 3 — Python (já vem no Ubuntu 24.04; só garante)

```
sudo apt install -y python3 python3-pip
```

## Passo 4 — Instalar o Caddy (repositório oficial)

```
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

> O Caddy do apt do Ubuntu sobe um **serviço** que pode prender a porta 443.
> Desligue-o (o `run.py` sobe seu próprio Caddy):
>
> ```
> sudo systemctl disable --now caddy
> ```

## Passo 5 — Instalar o Google Chrome

```
wget -qO- https://dl.google.com/linux/linux_signing_key.pub \
  | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
  | sudo tee /etc/apt/sources.list.d/google-chrome.list
sudo apt update
sudo apt install -y google-chrome-stable
```

## Passo 6 — Preparar o projeto (só uma vez)

```
cd ~/Desktop/clever        # ajuste para onde estiver a pasta
npm install
```

## Passo 7 — Rodar com o watchdog

```
chmod +x watchdog.sh       # só na primeira vez, para deixar executável
sudo ./watchdog.sh
```

> Em ambiente sem servidor gráfico (servidor headless puro), o Chrome em modo
> janela não tem onde aparecer — use uma sessão com desktop (GNOME, KDE, etc.)
> ou um Xvfb + xvfb-run. O `ua-rotate.js` foi feito assumindo que há tela.

---

## Como parar (qualquer OS)

Clique na janela do terminal e aperte **Ctrl + C**. Isso encerra o watchdog e
fecha tudo na ordem (Chrome → Caddy → proxy).

---

## Variações — todos os parâmetros

Todas as opções abaixo são repassadas pelo watchdog → `run.py` → `ua-rotate.js`.
Sem nenhuma opção, o sistema usa os padrões da tabela.

### Resumo (referência rápida)

| Parâmetro             | O que faz                                                                 | Valores aceitos                       | Padrão               |
|-----------------------|---------------------------------------------------------------------------|---------------------------------------|----------------------|
| `static`              | janelas **não** recarregam — fica parado num domínio por janela           | (palavra solta, sem valor)            | desligado            |
| `-w <px>`             | resolução **nativa** da tela em pixels (largura)                          | inteiro > 0                           | `3840`               |
| `-h <px>`             | resolução **nativa** da tela em pixels (altura)                           | inteiro > 0                           | `2160`               |
| `-cols <n>`           | colunas do grid de janelas                                                | inteiro > 0                           | `4`                  |
| `-count <n>`          | quantas janelas abrir no total                                            | inteiro > 0 (recomendado ≤ 6 por CPU) | `16`                 |
| `-scale <f>`          | zoom global do Chrome (`--force-device-scale-factor`)                     | número > 0 (ex.: `0.5`, `1`, `1.25`)  | `0.5`                |
| `-platform <os>`      | SO dos perfis **desktop** a entregar na rotação de UA                     | `win`, `mac`, `linux`, `all`          | `all`                |
| `-device <classe>`    | classes de dispositivo a entregar                                         | `desktop`, `mobile`, `all`            | `desktop`            |
| `-device_mode <m>`    | proporção desktop:mobile quando `-device all`                             | `random` ou `N:M` (ex.: `60:40`)      | `random` (= `50:50`) |

> ⚠️ Passar **qualquer** flag de tela (`-w`/`-h`/`-cols`/`-count`) monta uma
> tela única a partir delas (as ausentes caem no padrão da tabela). Sem nenhuma
> flag de tela, vale o `DISPLAYS_DEFAULT` do `ua-rotate.js` (útil para
> multi-monitor — edite a const direto no arquivo nesse caso).

### 1) Modo `static` — testar o clique

Carrega um domínio por janela e **não recarrega**. Bom para clicar no anúncio
sem a página trocar embaixo do mouse.

```powershell
# Windows
.\watchdog.ps1 static
```

```bash
# macOS / Linux
sudo ./watchdog.sh static
```

### 2) Tela: `-w`, `-h`, `-cols`, `-count`, `-scale`

- `-w` / `-h`: a **resolução nativa** do seu monitor em pixels (não a lógica).
  Ex.: monitor 4K 32" → `-w 3840 -h 2160`; monitor 2K 27" → `-w 2560 -h 1440`.
- `-cols`: número de colunas do grid (linhas são calculadas a partir de
  `count / cols`).
- `-count`: total de janelas que vão abrir.
- `-scale`: zoom global do Chrome. `0.5` deixa tudo em metade do tamanho
  (cabem mais janelas no mesmo monitor); `1` = 100% (janelas maiores).

```powershell
# Windows — 16 janelas num grid 4×4 numa tela 4K (zoom 50%, padrão)
.\watchdog.ps1 -w 3840 -h 2160 -cols 4 -count 16 -scale 0.5

# Windows — 4 janelas grandes num grid 2×2 numa tela QHD 3200×1800
.\watchdog.ps1 -w 3200 -h 1800 -cols 2 -count 4 -scale 1

# Windows — 9 janelas 3×3 numa tela 1080p, zoom de tela cheia (100%)
.\watchdog.ps1 -w 1920 -h 1080 -cols 3 -count 9 -scale 1
```

```bash
# macOS / Linux — 6 janelas 3×2 numa tela 4K, zoom 50%
sudo ./watchdog.sh -w 3840 -h 2160 -cols 3 -count 6 -scale 0.5
```

### 3) Agente desktop: `-platform`

Filtra o SO dos perfis de Chrome **desktop** que entram na rotação de UA.
A escolha **não** depende de em qual SO você está rodando — você pode rodar no
Windows e entregar UAs de Linux, por exemplo.

```powershell
.\watchdog.ps1 -platform win        # só Chrome Windows  (win11-138, win10-137)
.\watchdog.ps1 -platform mac        # só Chrome macOS    (mac-138, mac-136)
.\watchdog.ps1 -platform linux      # só Chrome Linux    (linux-138)
.\watchdog.ps1 -platform all        # todos misturados   (padrão)
```

### 4) Classe de dispositivo: `-device` e `-device_mode`

`-device` define se a entrega é desktop, mobile ou as duas. Quando `-device all`,
`-device_mode` controla a proporção.

```powershell
.\watchdog.ps1 -device desktop                          # só desktop (padrão)
.\watchdog.ps1 -device mobile                           # só mobile (Android Pixel/Galaxy)
.\watchdog.ps1 -device all                              # mistura 50/50 (random)
.\watchdog.ps1 -device all -device_mode 60:40           # 60% desktop, 40% mobile
.\watchdog.ps1 -device all -device_mode 80:20           # 80% desktop, 20% mobile
.\watchdog.ps1 -device all -device_mode random          # explicitamente 50/50
```

> 📱 **Mobile é emulação**, não janela física: a janela continua no slot do
> grid, mas o `page.setViewport` com `isMobile`/`hasTouch` faz o site renderizar
> em layout mobile. A Clever recebe os sinais de dispositivo móvel pelo UA
> Android + Client Hints (`mobile: true`).

### 5) Variáveis de ambiente

Não são flags — são variáveis de ambiente passadas antes do comando.

| Variável         | O que faz                                              | Padrão                 |
|------------------|--------------------------------------------------------|------------------------|
| `RELOAD_MIN_S`   | tempo mínimo (segundos) em cada domínio antes do reload | `5`                    |
| `RELOAD_MAX_S`   | tempo máximo (segundos) em cada domínio antes do reload | `10`                   |
| `DNS_SERVERS`    | DNS de fallback do proxy (CSV) — vazio = DNS do SO     | `1.1.1.1,1.0.0.1,8.8.8.8` |

```powershell
# Windows — ciclos mais longos (15-30 s por domínio)
$env:RELOAD_MIN_S=15; $env:RELOAD_MAX_S=30; .\watchdog.ps1
```

```bash
# macOS / Linux
sudo RELOAD_MIN_S=15 RELOAD_MAX_S=30 ./watchdog.sh

# Forçar um DNS específico no proxy
sudo DNS_SERVERS="9.9.9.9,149.112.112.112" ./watchdog.sh
```

### 6) Exemplos combinando tudo

```powershell
# Windows — 4 janelas 2×2 numa tela 3200×1800, zoom 50%, só UAs Linux,
# mistura desktop e mobile 60/40.
.\watchdog.ps1 -w 3200 -h 1800 -cols 2 -count 4 -scale 0.5 `
    -platform linux -device all -device_mode 60:40
```

```powershell
# Windows — só mobile, 4 janelas, ciclos longos (testar entrega mobile)
$env:RELOAD_MIN_S=20; $env:RELOAD_MAX_S=30
.\watchdog.ps1 -count 4 -cols 2 -device mobile
```

```bash
# Linux — 6 janelas 3×2 numa 4K, zoom 70%, UAs Windows+macOS, só desktop.
sudo ./watchdog.sh -w 3840 -h 2160 -cols 3 -count 6 -scale 0.7 -platform all
```

```bash
# macOS — modo clique (static) com 2 janelas grandes lado-a-lado numa 5K
sudo ./watchdog.sh static -w 5120 -h 2880 -cols 2 -count 2 -scale 1
```

---

## Se algo der errado

| Problema                                              | O que fazer                                                                                                            |
|-------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `python não é reconhecido` (Windows)                  | Reabra o Prompt depois do `winget install Python.Python.3.11`. Se persistir, reinicie o computador.                    |
| `node não encontrado`                                 | Reinstale o Node (`winget install -e --id OpenJS.NodeJS` / `brew install node` / `apt install nodejs`) e reabra o terminal. |
| `caddy não encontrado`                                | Refaça o passo de instalação do Caddy para o seu OS.                                                                   |
| `dependências não instaladas`                         | Você pulou o `npm install`. Rode-o dentro da pasta do projeto.                                                         |
| `porta 443 ocupada` / `caddy não subiu`               | Confirme que está rodando como Administrador (Windows) ou com `sudo` (macOS/Linux). No Linux, desligue o serviço do Caddy: `sudo systemctl disable --now caddy`. |
| Erro "scripts desabilitados" (Windows)                | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`                                                                  |
| Erro "não está assinado digitalmente" (Windows)       | `Get-ChildItem -Recurse \| Unblock-File`                                                                               |
| `watchdog.sh: permission denied` (macOS/Linux)        | Rode `chmod +x watchdog.sh` uma vez.                                                                                   |
| Chrome com `502 Falha de DNS`                         | O proxy já tenta DNS-over-HTTPS (Cloudflare). Se persistir, troque o DNS do sistema para `1.1.1.1`.                    |
| Os anúncios não aparecem                              | Confirme que está usando o **Chrome** (não Brave).                                                                     |

Se o watchdog mostrar mensagens amarelas dizendo que o `run.py` saiu e está
**relançando** — isso é normal. Só se preocupe se ele ficar relançando sem
parar e nenhuma janela do Chrome abrir.
