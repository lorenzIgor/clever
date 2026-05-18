'use strict';
// ua-rotate.js — abre N janelas do Chrome (uma por slot do grid das telas).
//
// Cada janela RELANÇA um Chrome novo a cada 5-10s, num domínio aleatório
// (embaralha a lista e consome um por ciclo; ao terminar, reembaralha): a cada
// ciclo o navegador sobe limpo, sem estado do anterior. A cada relançamento
// troca também o perfil de User-Agent (round-robin, com offset por janela). Se
// o Chrome travar ou cair, o ciclo só reinicia antes. Roda até Ctrl+C — ou
// SIGINT vindo do run.py.
//
// A troca de agente é no navegador porque os requests para a Clever
// (scripts.cleverwebserver.com, beacon Pixel.gif) saem direto do navegador. O
// agente é lido em 3 lugares e os 3 são alinhados por setUserAgent(ua, metadata):
// header HTTP `User-Agent`, Client Hints (`Sec-CH-UA*`) e `navigator.userAgentData`.
//
// Normalmente é iniciado pelo run.py. Direto: node ua-rotate.js [opções]
//   static                      carrega 1 domínio por janela e NÃO recarrega
//                                (para testar o clique com calma).
//   -w <px> -h <px>             resolução NATIVA da tela (padrão 3840x2160).
//   -cols <n>                   colunas do grid de janelas (padrão 4).
//   -count <n>                  quantas janelas abrir (padrão 16).
//   -scale <f>                  zoom global do Chrome (padrão 0.5 = 50%).
//   -platform win|mac|all       filtra o SO dos perfis DESKTOP (padrão all).
//   -device desktop|mobile|all  classes de dispositivo a entregar (padrão desktop).
//   -device_mode random|N:M     proporção desktop:mobile p/ -device all
//                                (padrão random = 50:50; ex.: 60:40).
// Sem flags = comportamento padrão das constantes abaixo (desktop, 4K, 16 janelas).
//
// Ajustes por env var (com padrões): RELOAD_MIN_S=5  RELOAD_MAX_S=10

const puppeteer = require('puppeteer');

const RELOAD_MIN = Number(process.env.RELOAD_MIN_S || 5);
const RELOAD_MAX = Number(process.env.RELOAD_MAX_S || 10);

// --- argumentos da linha de comando -----------------------------------------
// Veja o cabeçalho do arquivo para a lista de flags. Flags ausentes caem nos
// padrões; o run.py e o watchdog.ps1 repassam tal e qual o que recebem p/ cá.
const ARGS = process.argv.slice(2);
const STATIC = ARGS.includes('static');

// valor que segue uma flag (ex.: flagValue('-cols') em "-cols 4" -> "4").
function flagValue(name) {
  const i = ARGS.indexOf(name);
  return i >= 0 && i + 1 < ARGS.length ? ARGS[i + 1] : null;
}
// flag numérica positiva, com fallback para o padrão se ausente/inválida.
function numFlag(name, def) {
  const v = flagValue(name);
  if (v == null) return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// --- ESCALA / ZOOM -----------------------------------------------------------
// SCALE vai para o Chrome em --force-device-scale-factor: é o "zoom" de TUDO
// (UI do Chrome + conteúdo da página). Menor = tudo renderiza menor, então cabe
// mais janela na tela.   1 = 100%   0.5 = 50% (metade do tamanho)
// O Chrome posiciona/dimensiona janelas em pixels LÓGICOS (DIPs); com SCALE
// forçado, a área lógica da tela = resolução NATIVA / SCALE. Por isso DISPLAYS
// declara a resolução nativa e o slotFor divide por SCALE — o grid continua
// certo em qualquer zoom.
const SCALE = numFlag('-scale', 0.5);  // padrão 0.5; a flag -scale sobrepõe

// --- TELAS -------------------------------------------------------------------
// Distribuição das janelas entre as telas. `x`/`y` é a origem da tela no espaço
// lógico (DIP) do SO: a tela principal começa em (0,0); telas estendidas ficam
// ao lado conforme o arranjo nas configurações de vídeo (macOS: Ajustes > Telas;
// Windows: Configurações > Sistema > Tela). Tela à esquerda da principal usa
// `x` negativo; acima, `y` negativo. `wNative`/`hNative` = resolução NATIVA da
// tela em pixels (ex.: 4K = 3840x2160). `cols` = colunas do grid; `count` =
// quantas janelas vão nessa tela.
//
// ATENÇÃO: cada janela é um Chrome inteiro — baixar o SCALE faz mais janelas
// CABEREM na tela, mas NÃO reduz o custo: cada janela continua um processo
// inteiro. ~6 janelas é o limite de um MacBook 14"; numa máquina potente dá
// para subir o `count`, mas aos poucos, observando CPU/memória no terminal.
// DISPLAYS_DEFAULT é a configuração padrão (edite aqui para multi-monitor).
// Se QUALQUER flag de tela (-w/-h/-cols/-count) for passada, ela é ignorada e
// o grid passa a ser UMA tela montada a partir das flags — as flags ausentes
// caem nos padrões 4K abaixo.
const DISPLAYS_DEFAULT = [
  { name: '4K 32"', x: 0, y: 0, wNative: 3840, hNative: 2160, cols: 4, count: 16 },
];
const HAS_DISPLAY_FLAGS = ['-w', '-h', '-cols', '-count'].some((f) => ARGS.includes(f));
const DISPLAYS = HAS_DISPLAY_FLAGS
  ? [{
      name: 'tela (flags)', x: 0, y: 0,
      wNative: numFlag('-w', 3840),
      hNative: numFlag('-h', 2160),
      cols: numFlag('-cols', 4),
      count: numFlag('-count', 16),
    }]
  : DISPLAYS_DEFAULT;
const WINDOW_COUNT = DISPLAYS.reduce((s, d) => s + d.count, 0);

// Domínios alvo — fonte única em domains.json. O run.py lê o mesmo arquivo
// para o hosts e para gerar o Caddyfile.
const DOMAINS = require('./domains.json');

// --- PROXIES (IP de saída por janela) ----------------------------------------
// Pool de proxies residenciais: cada janela usa PROXIES[windowIndex % len] —
// ou seja, UM IP POR JANELA, fazendo cada janela parecer um usuário distinto.
// Lista vazia = sem proxy (o Chrome sai pelo IP da máquina).
//
// Formato de cada item:
//   { server: 'host:porta', username: 'user', password: 'senha' }
// username/password são opcionais (proxy sem autenticação omite os dois).
// server aceita prefixo de esquema: 'http://host:porta' ou 'socks5://host:porta'
// (sem prefixo o Chrome assume HTTP).
// TODO: preencher com os endpoints do provedor de proxy residencial brasileiro.
//   Ex.: { server: 'br.provedor.com:8000', username: 'user', password: 'senha' }
// Lista vazia = sem proxy (o Chrome sai pelo IP da máquina).
const PROXIES = [];

// Os domínios alvo estão no arquivo hosts apontando para o Caddy local. Eles
// PRECISAM sair do proxy (--proxy-bypass-list): senão o Chrome mandaria esses
// hosts pelo proxy, que resolveria o IP público real e serviria o site REAL
// SEM a injeção da tag Clever. Só o resto (Clever, CDNs) vai pelo proxy.
const PROXY_BYPASS = DOMAINS.join(';');

// monta os args de proxy do Chrome para uma janela (vazio = sem proxy).
function proxyArgs(proxy) {
  if (!proxy || !proxy.server) return [];
  return [
    `--proxy-server=${proxy.server}`,
    `--proxy-bypass-list=${PROXY_BYPASS}`,
  ];
}

// Brand "greasado" que o Chrome injeta nos Client Hints.
const GREASE = { brand: 'Not)A;Brand', version: '99', full: '99.0.0.0' };

// Listas de brand dos Client Hints (iguais para desktop e mobile).
function brandList(major) {
  return [
    { brand: GREASE.brand, version: GREASE.version },
    { brand: 'Chromium', version: String(major) },
    { brand: 'Google Chrome', version: String(major) },
  ];
}
function fullBrandList(full) {
  return [
    { brand: GREASE.brand, version: GREASE.full },
    { brand: 'Chromium', version: full },
    { brand: 'Google Chrome', version: full },
  ];
}

// Perfil DESKTOP: Chrome no Windows/macOS. device='desktop', os='win'|'mac'.
function chromeProfile({ id, label, osToken, platform, platformVersion, architecture, major, full }) {
  return {
    id,
    label,
    device: 'desktop',
    os: platform === 'Windows' ? 'win' : 'mac',
    viewport: null,                 // desktop: viewport segue o tamanho da janela
    ua: `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) `
      + `Chrome/${major}.0.0.0 Safari/537.36`,
    metadata: {
      brands: brandList(major),
      fullVersionList: fullBrandList(full),
      fullVersion: full,
      platform,
      platformVersion,
      architecture,
      model: '',
      mobile: false,
      bitness: '64',
      wow64: false,
    },
  };
}

// Perfil MOBILE: Chrome no Android. device='mobile'. O `viewport` é aplicado
// com page.setViewport (isMobile+hasTouch) para o site renderizar em layout
// mobile e a Clever receber sinais de dispositivo móvel (UA + Client Hints +
// dimensões da tela). O UA traz "Mobile Safari" como o Chrome real no Android.
function mobileProfile({ id, label, osToken, platformVersion, model, major, full, width, height, dpr }) {
  return {
    id,
    label,
    device: 'mobile',
    os: 'android',
    viewport: { width, height, deviceScaleFactor: dpr, isMobile: true, hasTouch: true },
    ua: `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) `
      + `Chrome/${major}.0.0.0 Mobile Safari/537.36`,
    metadata: {
      brands: brandList(major),
      fullVersionList: fullBrandList(full),
      fullVersion: full,
      platform: 'Android',
      platformVersion,
      architecture: '',             // Android: arquitetura/bitness vão vazias
      model,
      mobile: true,
      bitness: '',
      wow64: false,
    },
  };
}

// Lista de perfis: Chrome desktop (Windows/macOS) e Chrome mobile (Android).
// A seleção por ciclo respeita as flags -device / -device_mode / -platform.
const PROFILES = [
  chromeProfile({
    id: 'win11-138', label: 'Windows 11 · Chrome 138',
    osToken: 'Windows NT 10.0; Win64; x64',
    platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86',
    major: 138, full: '138.0.7204.97',
  }),
  chromeProfile({
    id: 'win10-137', label: 'Windows 10 · Chrome 137',
    osToken: 'Windows NT 10.0; Win64; x64',
    platform: 'Windows', platformVersion: '10.0.0', architecture: 'x86',
    major: 137, full: '137.0.7151.104',
  }),
  chromeProfile({
    id: 'mac-138', label: 'macOS (Apple Silicon) · Chrome 138',
    osToken: 'Macintosh; Intel Mac OS X 10_15_7',
    platform: 'macOS', platformVersion: '15.3.0', architecture: 'arm',
    major: 138, full: '138.0.7204.97',
  }),
  chromeProfile({
    id: 'mac-136', label: 'macOS (Intel) · Chrome 136',
    osToken: 'Macintosh; Intel Mac OS X 10_15_7',
    platform: 'macOS', platformVersion: '14.5.0', architecture: 'x86',
    major: 136, full: '136.0.7103.114',
  }),
  mobileProfile({
    id: 'android14-138', label: 'Android 14 · Pixel 8 · Chrome 138',
    osToken: 'Linux; Android 14; Pixel 8',
    platformVersion: '14.0.0', model: 'Pixel 8',
    major: 138, full: '138.0.7204.97',
    width: 412, height: 915, dpr: 2.625,
  }),
  mobileProfile({
    id: 'android13-137', label: 'Android 13 · Galaxy S22 · Chrome 137',
    osToken: 'Linux; Android 13; SM-S901B',
    platformVersion: '13.0.0', model: 'SM-S901B',
    major: 137, full: '137.0.7151.104',
    width: 360, height: 780, dpr: 3,
  }),
];

// --- posição da janela no grid das telas ------------------------------------
function slotFor(windowIndex) {
  let i = windowIndex;
  for (const d of DISPLAYS) {
    if (i < d.count) {
      // área lógica (DIP) = resolução nativa / SCALE — é nela que o Chrome
      // posiciona e dimensiona as janelas.
      const logW = d.wNative / SCALE;
      const logH = d.hNative / SCALE;
      const rows = Math.ceil(d.count / d.cols);
      const winW = Math.floor(logW / d.cols);
      const winH = Math.floor(logH / rows);
      const col = i % d.cols;
      const row = Math.floor(i / d.cols);
      return { x: d.x + col * winW, y: d.y + row * winH, w: winW, h: winH };
    }
    i -= d.count;
  }
  const d = DISPLAYS[0];
  return { x: d.x, y: d.y, w: 480, h: 360 };
}

// --- utilitários -------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- seleção de perfis: classe de dispositivo e plataforma ------------------
const DESKTOP_PROFILES = PROFILES.filter((p) => p.device === 'desktop');
const MOBILE_PROFILES = PROFILES.filter((p) => p.device === 'mobile');

// -device: que classes entregar. Padrão 'desktop' (comportamento original).
const DEVICE = (() => {
  const v = (flagValue('-device') || 'desktop').toLowerCase();
  if (['desktop', 'mobile', 'all'].includes(v)) return v;
  console.warn(`-device "${v}" inválido — usando desktop. Opções: desktop, mobile, all`);
  return 'desktop';
})();

// -platform: filtra o SO dos perfis DESKTOP (mobile não é afetado).
function desktopPool(arg) {
  const a = (arg || 'all').toLowerCase();
  if (a === 'all') return DESKTOP_PROFILES;
  const m = DESKTOP_PROFILES.filter((p) => p.os === a);
  if (m.length) return m;
  console.warn(`-platform "${arg}" não casa nada — usando todos os desktop. `
    + 'Opções: win, mac, all');
  return DESKTOP_PROFILES;
}

// -device_mode: probabilidade de um ciclo ser DESKTOP (só vale com -device all).
// 'random' = 0.5; 'N:M' = N/(N+M)  (ex.: '60:40' -> 0.6 desktop / 0.4 mobile).
function desktopProb(arg) {
  if (!arg || arg.toLowerCase() === 'random') return 0.5;
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(arg);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a + b > 0) return a / (a + b);
  }
  console.warn(`-device_mode "${arg}" inválido — usando random (50:50)`);
  return 0.5;
}

const DESKTOP_PROB = desktopProb(flagValue('-device_mode'));

// Pools efetivos por classe: vazios quando a classe não é usada, para o banner
// e a seleção refletirem exatamente o que vai ao ar.
const POOLS = {
  desktop: DEVICE === 'mobile' ? [] : desktopPool(flagValue('-platform')),
  mobile: DEVICE === 'desktop' ? [] : MOBILE_PROFILES,
};

// roda uma promise com teto de tempo. page.setUserAgent não tem timeout
// próprio: se o renderer estiver travado, a chamada CDP ficaria pendurada por
// minutos. Aqui ela falha rápido e a janela é relançada.
function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} travou (${ms}ms)`)), ms);
  });
  promise.catch(() => {}); // evita unhandledRejection se o guard vencer
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// --- loop de uma janela (auto-recuperável) ----------------------------------
const browsers = new Set();
let stopping = false;

async function closeAll() {
  const bs = [...browsers];
  browsers.clear();
  await Promise.all(bs.map((b) => b.close().catch(() => {})));
}

function launchAt(slot, proxy) {
  return puppeteer.launch({
    headless: false,
    channel: 'chrome',          // usa o Chrome instalado
    acceptInsecureCerts: true,  // aceita o cert da CA interna do Caddy
    defaultViewport: null,
    protocolTimeout: 60000,     // chamadas CDP não penduram por minutos
    ignoreDefaultArgs: ['--enable-automation'], // tira a infobar de automação
    args: [
      '--disable-blink-features=AutomationControlled',
      `--force-device-scale-factor=${SCALE}`,  // "zoom" global (UI + página)
      '--high-dpi-support=1',
      `--window-position=${slot.x},${slot.y}`,
      `--window-size=${slot.w},${slot.h}`,
      ...proxyArgs(proxy),
    ],
  });
}

// erros que indicam Chrome/aba mortos ou travados — exigem relançar a janela.
const DEAD_RE = /Target closed|Session closed|detached|crash|disconnected|travou|Connection closed|Protocol error/i;

// Supervisiona uma janela: a cada ciclo lança um Chrome NOVO num domínio
// aleatório, espera 5-10s e fecha — em seguida relança do zero. Cada ciclo é
// um navegador "limpo", sem estado do anterior. Crash/travamento só encurta o
// ciclo (o relançamento já é o comportamento normal).
async function runWindow(windowIndex) {
  const slot = slotFor(windowIndex);
  // um IP por janela: PROXIES[windowIndex % len]. Sem proxies -> null.
  const proxy = PROXIES.length ? PROXIES[windowIndex % PROXIES.length] : null;
  const via = proxy ? `  ·  ${proxy.server}` : '';
  const tag = `janela ${windowIndex + 1}`;
  // round-robin de UA independente por classe; cada janela começa num offset.
  let uaDesktop = windowIndex;
  let uaMobile = windowIndex;
  let queue = [];

  while (!stopping) {
    if (queue.length === 0) queue = shuffled(DOMAINS);
    const domain = queue.shift();

    // classe do ciclo: -device fixa desktop/mobile; 'all' sorteia conforme
    // -device_mode. Se a classe sorteada não tiver pool, cai na outra.
    let cls = DEVICE === 'all'
      ? (Math.random() < DESKTOP_PROB ? 'desktop' : 'mobile')
      : DEVICE;
    if (cls === 'desktop' && !POOLS.desktop.length) cls = 'mobile';
    if (cls === 'mobile' && !POOLS.mobile.length) cls = 'desktop';
    const profile = cls === 'mobile'
      ? POOLS.mobile[uaMobile++ % POOLS.mobile.length]
      : POOLS.desktop[uaDesktop++ % POOLS.desktop.length];

    let browser = null;
    let alive = false;
    let crashed = false;
    try {
      browser = await launchAt(slot, proxy);
      browsers.add(browser);
      alive = true;
      browser.on('disconnected', () => { alive = false; });

      const page = (await browser.pages())[0] || (await browser.newPage());
      // proxy com autenticação: o --proxy-server do Chrome não aceita
      // user:senha embutidos; o Puppeteer responde ao desafio 407.
      if (proxy && proxy.username) {
        await page.authenticate({ username: proxy.username, password: proxy.password });
      }
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      // Aceita diálogos JS — inclusive o "beforeunload" que sites de notícia/
      // anúncio registram, que poderia travar o fechamento da janela.
      page.on('dialog', (dialog) => { dialog.accept().catch(() => {}); });

      // setUserAgent ANTES do goto: alinha header + Client Hints + userAgentData.
      await withTimeout(page.setUserAgent(profile.ua, profile.metadata), 20000, 'setUserAgent');
      // mobile: emula viewport/touch/DPR — o site renderiza em layout mobile.
      if (profile.viewport) {
        await withTimeout(page.setViewport(profile.viewport), 20000, 'setViewport');
      }
      await page.goto(`https://${domain}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
      console.log(`[${tag}] ${domain}  ·  ${profile.id} (${profile.device})${via}`);

      if (STATIC) {
        // modo clique: fica parado nesse domínio até o Ctrl+C.
        while (!stopping && alive) await sleep(1000);
      } else {
        // mantém a janela 5-10s (passos de 1s p/ reagir rápido ao Ctrl+C) e
        // então o finally a fecha; o while externo relança um Chrome novo.
        const secs = randInt(RELOAD_MIN, RELOAD_MAX);
        for (let t = 0; t < secs && !stopping && alive; t++) await sleep(1000);
      }
      // 'alive' só é falso aqui se o Chrome caiu durante o ciclo (o
      // disconnected do nosso próprio close() no finally vem depois deste ponto).
      if (!alive) crashed = true;
    } catch (e) {
      console.warn(`[${tag}] ${domain}: ${e.message}`);
      crashed = DEAD_RE.test(e.message); // travou/morreu -> backoff antes de relançar
    } finally {
      if (browser) {
        browsers.delete(browser);
        await browser.close().catch(() => {});
      }
    }
    if (stopping || STATIC) break;
    // backoff curto só depois de crash/travamento, para não martelar.
    if (crashed) for (let t = 0; t < 3 && !stopping; t++) await sleep(1000);
  }
}

async function main() {
  const deviceDesc = DEVICE === 'all'
    ? `desktop+mobile ${Math.round(DESKTOP_PROB * 100)}:${Math.round((1 - DESKTOP_PROB) * 100)}`
    : DEVICE;
  console.log(`ua-rotate: ${WINDOW_COUNT} janelas · ${DOMAINS.length} domínios`
    + (STATIC ? ' · modo STATIC (sem reload — para testar clique)'
              : ` · reload ${RELOAD_MIN}-${RELOAD_MAX}s, ordem aleatória`));
  console.log('Telas: ' + DISPLAYS.map((d) => `${d.name} ${d.count}j`).join(' · ')
    + ` · zoom ${Math.round(SCALE * 100)}%`);
  console.log(`Agentes: ${deviceDesc}`
    + ` · desktop=[${POOLS.desktop.map((p) => p.id).join(', ') || '—'}]`
    + ` · mobile=[${POOLS.mobile.map((p) => p.id).join(', ') || '—'}]`);
  console.log(PROXIES.length
    ? `Proxies: ${PROXIES.length} (1 IP por janela, round-robin) · `
      + PROXIES.map((p) => p.server).join(', ')
    : 'Proxies: nenhum (Chrome sai pelo IP da máquina)');

  const shutdown = async () => {
    if (stopping) process.exit(1); // segundo sinal: sai na marra
    stopping = true;
    console.log('\nParando — fechando janelas...');
    await closeAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown); // Ctrl+C em qualquer SO
  // run.py sinaliza o encerramento: SIGBREAK no Windows, SIGTERM no resto.
  process.on(process.platform === 'win32' ? 'SIGBREAK' : 'SIGTERM', shutdown);

  await Promise.all(
    Array.from({ length: WINDOW_COUNT }, (_, i) =>
      runWindow(i).catch((e) => console.error(`janela ${i + 1}: ${e.message}`)))
  );
  await closeAll();
}

main().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
