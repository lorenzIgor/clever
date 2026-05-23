# AWS user-data — Clever Chrome Fleet

Script de inicialização para o Launch Template das spot instances que rodam
a frota do `ua-rotate.js` na AWS. Sobe Ubuntu + Chrome + Caddy + ua-rotate em
qualquer instance type e calcula sozinho o número de janelas, o grid e a
resolução do Xvfb a partir do total de vCPUs.

Use este conteúdo como **User data** do Launch Template (EC2 → Launch
Templates → Advanced details → User data). Roda como root no primeiro boot.

## O que ele faz

- Dimensiona `/dev/shm` por tamanho da máquina (8/16/32 GiB) e cria
  `/dev/shm/puppeteer_chrome_profiles` — onde o `ua-rotate.js` grava o
  `userDataDir` de cada janela quando detecta Linux+root.
- Ajusta ulimits (`nofile=1048576`) e sysctls de rede (`somaxconn`,
  `ip_local_port_range`, `tcp_tw_reuse`, etc.) para suportar centenas de
  Chromes abrindo dezenas de conexões cada.
- Instala Xvfb + fluxbox + x11vnc, Node LTS, Google Chrome estável e Caddy.
- Calcula `COUNT`/`COLS`/`ROWS`/`RES_W`/`RES_H` a partir de `nproc` com
  multiplicador adaptativo (overhead fixo do stack dilui em máquinas grandes,
  calibrado em testes reais — `c5.2xlarge`=8, `c7i.8xlarge`=48). Snap em
  resoluções padrão até 10K. Salva tudo em `/etc/clever.env`.
- Sobe `xvfb`, `fluxbox`, `x11vnc` (porta 5900, `localhost` only) e
  `clever-rotate` como serviços do systemd. O `clever-rotate` chama
  `run.py` com as flags `-w/-h/-cols/-count -scale 1 -platform all -device all`.
- Clona `https://github.com/lorenzIgor/clever.git` em `/opt/clever` e roda
  `npm install`. Se o `git clone` falhar, a máquina sobe sem o serviço (não
  trava o boot).

## Calibração das janelas (fórmula adaptativa)

| vCPUs    | Multiplicador | Janelas resultantes |
| -------- | ------------- | ------------------- |
| ≤ 4      | × 0.80        | 3                   |
| ≤ 8      | × 1.00        | 8                   |
| ≤ 16     | × 1.25        | 20                  |
| ≤ 32     | × 1.50        | 48                  |
| ≤ 48     | × 1.60        | 76                  |
| ≤ 64     | × 1.65        | 105                 |
| > 64     | × 1.75        | até 200 (clamp)     |

Calibrado em testes reais: `c5.2xlarge` (8 vCPU) com 12 janelas saturou
(load 41), `c7i.8xlarge` (32 vCPU) com 60 janelas apertou (load 83). Os
valores acima são o limite estável.

## Debug pós-boot

```bash
cat /etc/clever.env                       # config calculada
sudo systemctl status clever-rotate       # estado do serviço
sudo journalctl -u clever-rotate -f       # log do ua-rotate ao vivo
sudo tail -f /var/log/user-data.log       # log do user-data deste boot
htop                                      # CPU/mem
df -h /dev/shm                            # tmpfs (Chrome profiles)
sudo ls /dev/shm/puppeteer_chrome_profiles/
```

VNC: a porta 5900 abre só em `localhost`. Para ver a tela, fazer port-forward
SSH: `ssh -L 5900:localhost:5900 ubuntu@<ip>` e apontar o cliente VNC para
`localhost:5900`.

## Script

```bash
#!/bin/bash
# ===========================================================================
# Clever Chrome Fleet - User Data (v5 - fórmula adaptativa calibrada)
# Sobe Ubuntu + Chrome + Caddy + ua-rotate em qualquer instance type AWS.
# Calcula automaticamente: vCPUs -> janelas -> grid -> resolução Xvfb.
#
# Mudanças vs v4:
# - Fórmula de janelas adaptativa por tamanho (overhead fixo dilui em máquinas grandes)
# - Cria /dev/shm/puppeteer_chrome_profiles automaticamente
# - Calibração baseada em testes reais (c7i.8xlarge=48, c5.2xlarge=8)
# ===========================================================================

set -e
exec > >(tee /var/log/user-data.log) 2>&1

echo "=== User-data iniciando em $(date) ==="
TOKEN=$(curl -s -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
INSTANCE_TYPE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-type)
echo "=== Instance type: $INSTANCE_TYPE ==="

# ===== SISTEMA: shared memory + ulimits =====
# Chrome usa /dev/shm intensamente. Escala com COUNT.
VCPUS=$(nproc)
if [ "$VCPUS" -le 8 ]; then
    SHM_SIZE="8G"
elif [ "$VCPUS" -le 32 ]; then
    SHM_SIZE="16G"
else
    SHM_SIZE="32G"
fi
mount -o remount,size=${SHM_SIZE} /dev/shm
echo "tmpfs /dev/shm tmpfs defaults,size=${SHM_SIZE} 0 0" >> /etc/fstab
echo "=== /dev/shm: ${SHM_SIZE} ==="

# Cria diretório pra Chrome profiles em RAM disk (referenciado pelo ua-rotate.js)
mkdir -p /dev/shm/puppeteer_chrome_profiles
chmod 1777 /dev/shm/puppeteer_chrome_profiles
echo "=== /dev/shm/puppeteer_chrome_profiles criado ==="

cat >> /etc/security/limits.conf <<'LIMITS'
* hard nofile 1048576
* soft nofile 1048576
root hard nofile 1048576
root soft nofile 1048576
LIMITS
echo "fs.file-max = 2097152" >> /etc/sysctl.conf
sysctl -p

# Mais ajustes de kernel pra workloads com muito network connection.
# Importante quando 100+ Chromes abrem dezenas de conexões cada.
cat >> /etc/sysctl.conf <<'NETSYS'
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 10000 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
NETSYS
sysctl -p

# ===== DEPENDÊNCIAS DO SISTEMA =====
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
    xvfb fluxbox x11vnc \
    python3 python3-pip \
    git curl wget gnupg bc \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 \
    libasound2t64 libxss1 libxtst6 libxcomposite1 libxdamage1 \
    libxrandr2 libpangocairo-1.0-0 libgtk-3-0 libdrm2 mesa-utils \
    fonts-liberation fonts-noto-cjk \
    debian-keyring debian-archive-keyring apt-transport-https

# ===== NODE.JS LTS =====
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt-get install -y nodejs

# ===== GOOGLE CHROME =====
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
apt-get update
apt-get install -y google-chrome-stable

# ===== CADDY =====
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
systemctl disable --now caddy

# ===== AUTO-DETECT: vCPUs -> janelas -> grid -> resolução =====
# Fórmula adaptativa baseada em testes reais:
# - Overhead fixo do stack (Xvfb + node + fluxbox + caddy + proxy) = ~1.5 cores
# - Quanto menor a máquina, maior o peso relativo do overhead
# - Máquinas grandes diluem o overhead → suportam mais janelas por vCPU
#
# Calibração empírica (com /dev/shm pra Chrome profiles):
#   c5.2xlarge (8 vCPU)   → 12 janelas SATUROU (load 41)  → reduzir pra 8
#   c7i.8xlarge (32 vCPU) → 60 janelas APERTOU (load 83)  → reduzir pra 48
#
# Nova tabela:
#   4 vCPU  → MULT 0.8  → 3 janelas
#   8 vCPU  → MULT 1.0  → 8 janelas   (era 12, saturava)
#  16 vCPU  → MULT 1.25 → 20 janelas  (era 24, equilibra)
#  32 vCPU  → MULT 1.5  → 48 janelas  (era 48 mantém, era 60 saturava)
#  48 vCPU  → MULT 1.6  → 76 janelas
#  64 vCPU  → MULT 1.65 → 105 janelas
#  96+ vCPU → MULT 1.75 → 168 janelas

if   [ "$VCPUS" -le 4 ];  then MULT_NUM=8;   MULT_DEN=10   # × 0.80
elif [ "$VCPUS" -le 8 ];  then MULT_NUM=10;  MULT_DEN=10   # × 1.00
elif [ "$VCPUS" -le 16 ]; then MULT_NUM=125; MULT_DEN=100  # × 1.25
elif [ "$VCPUS" -le 32 ]; then MULT_NUM=15;  MULT_DEN=10   # × 1.50
elif [ "$VCPUS" -le 48 ]; then MULT_NUM=16;  MULT_DEN=10   # × 1.60
elif [ "$VCPUS" -le 64 ]; then MULT_NUM=165; MULT_DEN=100  # × 1.65
else                            MULT_NUM=175; MULT_DEN=100 # × 1.75
fi

COUNT=$((VCPUS * MULT_NUM / MULT_DEN))
[ "$COUNT" -lt 3 ] && COUNT=3
[ "$COUNT" -gt 200 ] && COUNT=200

# Grid 16:9 com viés horizontal pra telas wide
COLS=$(echo "sqrt($COUNT * 178 / 100) + 0.5" | bc -l | cut -d. -f1)
[ "$COLS" -lt 2 ] && COLS=2

# Calcula rows (necessário pra dimensionar resolução)
ROWS=$(echo "($COUNT + $COLS - 1) / $COLS" | bc)

# Resolução adaptativa: cada janela ≥ 480×360px (Chrome desktop legível)
# Target: janela ≈ 600×500px confortável
MIN_WIN_W=600
MIN_WIN_H=500

CALC_W=$((COLS * MIN_WIN_W))
CALC_H=$((ROWS * MIN_WIN_H))

# Snap pra resoluções "padrão" que ajudam VNC e Chrome a ficarem felizes
if [ $CALC_W -le 1920 ] && [ $CALC_H -le 1080 ]; then
    RES_W=1920; RES_H=1080       # Full HD (pra ≤8 janelas)
elif [ $CALC_W -le 2560 ] && [ $CALC_H -le 1440 ]; then
    RES_W=2560; RES_H=1440       # QHD
elif [ $CALC_W -le 3840 ] && [ $CALC_H -le 2160 ]; then
    RES_W=3840; RES_H=2160       # 4K UHD
elif [ $CALC_W -le 5120 ] && [ $CALC_H -le 2880 ]; then
    RES_W=5120; RES_H=2880       # 5K
elif [ $CALC_W -le 6400 ] && [ $CALC_H -le 3600 ]; then
    RES_W=6400; RES_H=3600       # 6.4K
elif [ $CALC_W -le 7680 ] && [ $CALC_H -le 4320 ]; then
    RES_W=7680; RES_H=4320       # 8K UHD
else
    RES_W=9600; RES_H=5400       # 10K (pra COUNT até 200)
fi

# Salva config calculada
cat > /etc/clever.env <<ENV
INSTANCE_TYPE=$INSTANCE_TYPE
VCPUS=$VCPUS
SHM_SIZE=$SHM_SIZE
COUNT=$COUNT
COLS=$COLS
ROWS=$ROWS
RES_W=$RES_W
RES_H=$RES_H
WIN_W=$((RES_W / COLS))
WIN_H=$((RES_H / ROWS))
MULT=$(echo "scale=2; $MULT_NUM / $MULT_DEN" | bc)
ENV
echo "=== Config: $INSTANCE_TYPE ($VCPUS vCPUs) -> $COUNT janelas em grid ${COLS}x${ROWS} a ${RES_W}x${RES_H} (janela: $((RES_W/COLS))x$((RES_H/ROWS))) ==="

# ===== XVFB =====
cat > /etc/systemd/system/xvfb.service <<XVFB
[Unit]
Description=Xvfb virtual display
After=network.target

[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 ${RES_W}x${RES_H}x24 -ac +extension RANDR +extension GLX +extension RENDER
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
XVFB
systemctl enable --now xvfb

# ===== FLUXBOX =====
cat > /etc/systemd/system/fluxbox.service <<'FLUXBOX'
[Unit]
Description=Fluxbox window manager
After=xvfb.service
Requires=xvfb.service

[Service]
Environment=DISPLAY=:99
ExecStart=/usr/bin/fluxbox
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
FLUXBOX
systemctl enable --now fluxbox

# ===== x11vnc =====
cat > /etc/systemd/system/x11vnc.service <<'X11VNC'
[Unit]
Description=x11vnc VNC server attached to Xvfb :99
After=xvfb.service fluxbox.service
Requires=xvfb.service

[Service]
Type=simple
Environment=DISPLAY=:99
ExecStart=/usr/bin/x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -localhost -o /var/log/x11vnc.log
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
X11VNC
systemctl enable --now x11vnc

# ===== CLONE DO REPO =====
set +e
cd /opt
git clone https://github.com/lorenzIgor/clever.git clever
CLONE_RC=$?
set -e

if [ $CLONE_RC -ne 0 ]; then
    echo "=== ERRO: git clone falhou (rc=$CLONE_RC). Máquina vai subir sem clever-rotate. ==="
    echo "=== User-data parou em $(date) ==="
    exit 0
fi

chown -R ubuntu:ubuntu /opt/clever
cd /opt/clever
npm install

# ===== SERVICE DO ua-rotate =====
cat > /etc/systemd/system/clever-rotate.service <<CLEVER
[Unit]
Description=Clever ua-rotate browser fleet
After=xvfb.service fluxbox.service network-online.target
Requires=xvfb.service fluxbox.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clever
Environment=DISPLAY=:99
Environment=RELOAD_MIN_S=5
Environment=RELOAD_MAX_S=10
ExecStart=/usr/bin/python3 /opt/clever/run.py -w ${RES_W} -h ${RES_H} -cols ${COLS} -count ${COUNT} -scale 1 -platform all -device all
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
# Limites generosos pro processo
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
CLEVER

systemctl daemon-reload
systemctl enable --now clever-rotate

echo "=== User-data concluído em $(date) ==="
echo ""
echo "=== Config aplicada ==="
cat /etc/clever.env
echo ""
echo "=== Debug ==="
echo "  cat /etc/clever.env"
echo "  sudo systemctl status clever-rotate"
echo "  sudo journalctl -u clever-rotate -f"
echo "  htop"
echo "  df -h /dev/shm"
echo "  sudo ls /dev/shm/puppeteer_chrome_profiles/"
```
