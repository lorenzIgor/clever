#requires -RunAsAdministrator
<#
watchdog.ps1 - relanca o run.py automaticamente se ele cair.

O run.py ja encerra sozinho de forma limpa quando um filho (proxy/caddy/
ua-rotate) morre: detecta o processo morto, retorna e o shutdown() derruba
tudo na ordem. Este script so percebe que o run.py terminou e o sobe de novo.

USO (abra o Terminal/PowerShell COMO ADMINISTRADOR):
    .\watchdog.ps1
    .\watchdog.ps1 static
    .\watchdog.ps1 -platform win
    .\watchdog.ps1 -device all -device_mode 60:40
    .\watchdog.ps1 -w 1920 -h 1080 -cols 4 -count 16 -scale 0.5

Todos os argumentos sao repassados ao run.py, que os repassa ao ua-rotate.js
(veja o cabecalho do ua-rotate.js para a lista de flags).

Ctrl+C encerra o watchdog (e o run.py junto). Apos cada saida do run.py ha
uma janela de RESTART_DELAY segundos -- da pra cancelar com Ctrl+C ali tambem.
#>

# 'Continue': um erro nao-terminante nunca derruba o watchdog -- a funcao dele
# e justamente NAO morrer. (Trocar para 'Stop' faria, p.ex., o stderr de um
# comando nativo virar erro terminante e abortar o loop.)
$ErrorActionPreference = 'Continue'
Set-Location -Path $PSScriptRoot

$RESTART_DELAY = 5   # segundos de espera antes de relancar

# acha o interpretador python
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Host 'ERRO: python nao encontrado no PATH' -ForegroundColor Red; exit 1 }

$run = 0
while ($true) {
    $run++
    Write-Host ''
    Write-Host "=== [watchdog] execucao #$run -- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" -ForegroundColor Cyan

    & $py 'run.py' @args
    $code = $LASTEXITCODE

    Write-Host ''
    Write-Host "=== [watchdog] run.py saiu (codigo $code) ===" -ForegroundColor Yellow

    # Mata um caddy orfao que possa ter ficado segurando a porta 443. No caso
    # normal o run.py ja rodou o shutdown() e parou o caddy -- ai este 'stop'
    # so emite um aviso. Rodamos via 'cmd /c' com a redirecao do PROPRIO cmd:
    # assim o PowerShell nunca ve o stderr do caddy e nao gera NativeCommandError
    # (que, com ErrorActionPreference='Stop', derrubaria o watchdog).
    cmd /c "caddy stop >nul 2>nul"

    Write-Host "[watchdog] relancando em $RESTART_DELAY s -- Ctrl+C agora para encerrar de vez" -ForegroundColor Yellow
    Start-Sleep -Seconds $RESTART_DELAY
}
