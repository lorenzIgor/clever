#!/usr/bin/env python3
"""run.py - orquestrador cross-platform do harness Clever (macOS / Windows / Linux).

Num comando:
  1. garante os dominios no arquivo hosts do SO (IPv4 + IPv6)
  2. (re)gera o Caddyfile a partir de domains.json
  3. limpa o cache de DNS
  4. sobe o proxy.js   (injeta a tag Clever, porta 8787)
  5. sobe o caddy      (TLS na porta 443 -> proxy)
  6. sobe o ua-rotate.js (abre as janelas e roda a rotacao)

Ctrl+C derruba tudo na ordem (fecha o Chrome, para o caddy, encerra o proxy).

PRECISA de privilegios de administrador (editar o hosts + abrir a porta 443):
  macOS / Linux:  sudo python3 run.py
  Windows:        abra o Terminal/PowerShell COMO ADMINISTRADOR e:  python run.py

Argumentos extras sao repassados ao ua-rotate.js. Ex.:
  sudo python3 run.py static     # janelas nao recarregam (testar clique)
  sudo python3 run.py win        # rotaciona so os perfis de UA "win*"
"""

import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
OS = platform.system()                 # 'Darwin' | 'Windows' | 'Linux'
IS_WIN = OS == 'Windows'

DOMAINS_FILE = os.path.join(ROOT, 'domains.json')
CADDYFILE = os.path.join(ROOT, 'Caddyfile')
HOSTS_PATH = (os.path.join(os.environ.get('SystemRoot', r'C:\Windows'),
                           'System32', 'drivers', 'etc', 'hosts')
              if IS_WIN else '/etc/hosts')
PROXY_PORT = 8787

# Cada filho roda no seu proprio grupo de processos, para o Ctrl+C do terminal
# nao mata-los direto -- quem derruba e o shutdown(), na ordem certa.
SPAWN_KW = ({'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if IS_WIN
            else {'start_new_session': True})

procs = []  # lista de (nome, Popen)


def fail(msg):
    print('ERRO: ' + msg)
    sys.exit(1)


def is_elevated():
    """Roda como root (POSIX) ou como Administrador (Windows)?"""
    if IS_WIN:
        try:
            import ctypes
            return ctypes.windll.shell32.IsUserAnAdmin() != 0
        except Exception:
            return False
    return os.geteuid() == 0


def load_domains():
    try:
        with open(DOMAINS_FILE, encoding='utf-8') as f:
            domains = json.load(f)
    except Exception as e:
        fail('nao consegui ler %s: %s' % (DOMAINS_FILE, e))
    if not isinstance(domains, list) or not domains:
        fail('%s deve ser uma lista de dominios nao vazia' % DOMAINS_FILE)
    return domains


def ensure_hosts(domains):
    """Garante 127.0.0.1 e ::1 para cada dominio no arquivo hosts do SO.
    Precisa do IPv6 (::1): sem ele o navegador resolve o AAAA real e fura o proxy."""
    try:
        with open(HOSTS_PATH, encoding='utf-8', errors='replace') as f:
            content = f.read()
    except Exception as e:
        fail('nao consegui ler %s: %s' % (HOSTS_PATH, e))

    have = set()
    for line in content.splitlines():
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        parts = s.split()
        for host in parts[1:]:
            have.add((parts[0], host))

    missing = [(ip, d) for d in domains for ip in ('127.0.0.1', '::1')
               if (ip, d) not in have]
    if not missing:
        print('==> hosts: os %d dominios ja estao em %s'
              % (len(domains), HOSTS_PATH))
        return
    try:
        with open(HOSTS_PATH, 'a', encoding='utf-8') as f:
            if content and not content.endswith('\n'):
                f.write('\n')
            for ip, d in missing:
                f.write('%s %s\n' % (ip, d))
    except Exception as e:
        fail('nao consegui escrever em %s: %s' % (HOSTS_PATH, e))
    print('==> hosts: %d entradas adicionadas em %s' % (len(missing), HOSTS_PATH))


def write_caddyfile(domains):
    """Gera o Caddyfile a partir da lista de dominios (fonte: domains.json)."""
    block = ',\n'.join(domains) + ' {\n'
    content = (
        '# GERADO por run.py a partir de domains.json -- nao edite a mao.\n'
        '{\n'
        '\tlog {\n'
        '\t\tlevel ERROR\n'
        '\t}\n'
        '}\n'
        '\n'
        + block +
        '\ttls internal\n'
        '\treverse_proxy 127.0.0.1:' + str(PROXY_PORT) + '\n'
        '}\n'
    )
    with open(CADDYFILE, 'w', encoding='utf-8') as f:
        f.write(content)
    print('==> Caddyfile gerado (%d dominios)' % len(domains))


def flush_dns():
    print('==> limpando o cache de DNS')
    if IS_WIN:
        subprocess.run(['ipconfig', '/flushdns'],
                       stdout=subprocess.DEVNULL, check=False)
    elif OS == 'Darwin':
        subprocess.run(['dscacheutil', '-flushcache'], check=False)
        subprocess.run(['killall', '-HUP', 'mDNSResponder'], check=False)
    else:  # Linux: varia entre distros -- tenta o systemd-resolved e ignora
        subprocess.run(['resolvectl', 'flush-caches'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=False)


def spawn(name, cmd):
    print('==> iniciando %s' % name)
    p = subprocess.Popen(cmd, cwd=ROOT, **SPAWN_KW)
    procs.append((name, p))
    return p


def signal_shutdown(p):
    """Sinaliza um filho para encerrar com calma (cross-platform)."""
    if IS_WIN:
        os.kill(p.pid, signal.CTRL_BREAK_EVENT)  # Node recebe como 'SIGBREAK'
    else:
        p.send_signal(signal.SIGINT)


def shutdown(caddy_bin):
    if not procs:
        return
    print('\n==> encerrando...')
    # 1. ua-rotate: sinaliza e da tempo de fechar as janelas do Chrome
    for name, p in procs:
        if name == 'ua-rotate' and p.poll() is None:
            try:
                signal_shutdown(p)
            except Exception:
                pass
            try:
                p.wait(timeout=12)
            except subprocess.TimeoutExpired:
                pass
    # 2. caddy: para via subcomando dedicado
    if caddy_bin:
        subprocess.run([caddy_bin, 'stop'], cwd=ROOT, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    # 3. termina o que sobrou
    for name, p in procs:
        if p.poll() is None:
            try:
                p.terminate()
            except Exception:
                pass
    for name, p in procs:
        try:
            p.wait(timeout=8)
        except subprocess.TimeoutExpired:
            try:
                p.kill()
            except Exception:
                pass
    procs.clear()
    print('==> tudo encerrado.')


def main():
    print('=== Clever - orquestrador (%s) ===' % OS)

    if not is_elevated():
        print('Este script precisa de privilegios de administrador'
              ' (editar o hosts e abrir a porta 443).')
        if IS_WIN:
            print('  Abra o Terminal/PowerShell COMO ADMINISTRADOR e rode:'
                  '  python run.py')
        else:
            print('  Rode com sudo:  sudo python3 run.py')
        sys.exit(1)

    node = shutil.which('node')
    caddy = shutil.which('caddy')
    if not node:
        fail('node nao encontrado no PATH - instale o Node.js (nodejs.org).')
    if not caddy:
        hint = ('winget install CaddyServer.Caddy' if IS_WIN else
                'brew install caddy' if OS == 'Darwin' else
                'veja https://caddyserver.com/docs/install')
        fail('caddy nao encontrado no PATH - instale com: %s' % hint)
    if not os.path.isdir(os.path.join(ROOT, 'node_modules', 'puppeteer')):
        fail('dependencias nao instaladas - rode primeiro:  npm install')

    domains = load_domains()
    ensure_hosts(domains)
    write_caddyfile(domains)
    flush_dns()

    proxy = spawn('proxy', [node, 'proxy.js'])
    time.sleep(1.5)
    if proxy.poll() is not None:
        fail('proxy.js nao subiu.')

    caddy_proc = spawn('caddy', [caddy, 'run'])
    time.sleep(3)
    if caddy_proc.poll() is not None:
        fail('caddy nao subiu (porta 443 ocupada? rodando como admin?).')

    spawn('ua-rotate', [node, 'ua-rotate.js'] + sys.argv[1:])

    print('\n=== tudo no ar. Ctrl+C para parar. ===\n')
    while True:
        for name, p in procs:
            if p.poll() is not None:
                print("\n==> '%s' terminou (codigo %s)." % (name, p.returncode))
                return
        time.sleep(1)


if __name__ == '__main__':
    caddy_bin = shutil.which('caddy')
    try:
        main()
    except KeyboardInterrupt:
        pass
    finally:
        shutdown(caddy_bin)
