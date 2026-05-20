#!/usr/bin/env bash
# watchdog.sh — relança o run.py automaticamente se ele cair (macOS / Linux).
#
# Equivalente POSIX do watchdog.ps1. O run.py já encerra sozinho de forma limpa
# quando um filho (proxy/caddy/ua-rotate) morre; este script só percebe que o
# run.py terminou e o sobe de novo.
#
# Precisa de root (mesmas razões do run.py: editar /etc/hosts e abrir a 443).
#
# USO:
#   sudo ./watchdog.sh
#   sudo ./watchdog.sh static                       # repassado ao run.py -> ua-rotate.js
#   sudo ./watchdog.sh -platform linux
#   sudo ./watchdog.sh -device all -device_mode 60:40
#   sudo ./watchdog.sh -w 1920 -h 1080 -cols 4 -count 16 -scale 0.5
#
# Todos os argumentos sao repassados ao run.py, que os repassa ao ua-rotate.js
# (veja o cabecalho do ua-rotate.js para a lista de flags).
#
# Ctrl+C encerra o watchdog (e o run.py junto). Apos cada saida do run.py ha
# uma janela de RESTART_DELAY segundos -- da pra cancelar com Ctrl+C ali tambem.

set -u
cd "$(dirname "$0")"

RESTART_DELAY=5

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERRO: rode com sudo (precisa de root para editar /etc/hosts e abrir a porta 443)"
  echo "  sudo ./watchdog.sh $*"
  exit 1
fi

# Escolhe o python disponivel.
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "ERRO: python3 nao encontrado no PATH"
  exit 1
fi

# Ctrl+C: encerra o filho atual e sai do loop. -- usamos um flag para o while.
stop=0
trap 'echo; echo "[watchdog] Ctrl+C -- encerrando"; stop=1; kill -INT 0 2>/dev/null || true' INT TERM

run=0
while [[ "$stop" -eq 0 ]]; do
  run=$((run + 1))
  echo
  echo "=== [watchdog] execucao #$run -- $(date '+%Y-%m-%d %H:%M:%S') ==="

  "$PY" run.py "$@"
  code=$?

  [[ "$stop" -eq 1 ]] && break

  echo
  echo "=== [watchdog] run.py saiu (codigo $code) ==="

  # Mata um caddy orfao que possa ter ficado segurando a porta 443. No caso
  # normal o run.py ja rodou o shutdown() e parou o caddy; aqui so emite aviso.
  caddy stop >/dev/null 2>&1 || true

  echo "[watchdog] relancando em ${RESTART_DELAY}s -- Ctrl+C agora para encerrar de vez"
  sleep "$RESTART_DELAY"
done
