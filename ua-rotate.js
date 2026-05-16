'use strict';
// ua-rotate.js — abre N janelas do Chrome (uma por slot do grid das telas).
//
// Cada janela percorre os domínios em ordem ALEATÓRIA (embaralha a lista e vai
// recarregando para o próximo a cada 5-10s; ao terminar, reembaralha). A cada
// reload troca também o perfil de User-Agent (round-robin, com offset por
// janela). Cada janela é supervisionada: se o Chrome travar ou cair, ela é
// relançada sozinha. Roda até Ctrl+C — ou SIGINT vindo do run.py.
//
// A troca de agente é no navegador porque os requests para a Clever
// (scripts.cleverwebserver.com, beacon Pixel.gif) saem direto do navegador. O
// agente é lido em 3 lugares e os 3 são alinhados por setUserAgent(ua, metadata):
// header HTTP `User-Agent`, Client Hints (`Sec-CH-UA*`) e `navigator.userAgentData`.
//
// Normalmente é iniciado pelo run.py. Direto: node ua-rotate.js [opções]
//   - "static": carrega um domínio por janela e NÃO recarrega — para testar
//               o clique com calma, sem a página trocar embaixo de você.
//   - qualquer outra palavra: filtro de perfil de UA (ex.: "win").
//
// Ajustes por env var (com padrões): RELOAD_MIN_S=5  RELOAD_MAX_S=10

const puppeteer = require('puppeteer');

const RELOAD_MIN = Number(process.env.RELOAD_MIN_S || 5);
const RELOAD_MAX = Number(process.env.RELOAD_MAX_S || 10);

// argumentos da linha de comando
const ARGS = process.argv.slice(2);
const STATIC = ARGS.includes('static');
const PROFILE_ARG = ARGS.find((a) => a !== 'static');

// --- TELAS -------------------------------------------------------------------
// Distribuição das janelas entre as telas. `x`/`y` é a origem da tela no espaço
// global do SO: a tela principal começa em (0,0); telas estendidas ficam ao
// lado conforme o arranjo nas configurações de vídeo (macOS: Ajustes > Telas;
// Windows: Configurações > Sistema > Tela). Tela à esquerda da principal usa
// `x` negativo; acima, `y` negativo. `cols` = colunas do grid; `count` =
// quantas janelas vão nessa tela.
//
// ATENÇÃO: cada janela é um Chrome inteiro. ~6 janelas é o limite seguro de um
// MacBook 14" — acima disso a CPU/memória esgotam e até trocar o User-Agent dá
// timeout. Numa máquina mais potente dá para subir os `count`; ajuste estes
// valores para o SEU monitor/arranjo e observe o terminal.
const DISPLAYS = [
  { name: 'MacBook 14"', x: 0,    y: 0, w: 1512, h: 982,  cols: 2, count: 4 },
  { name: 'iPad 12.9"',  x: 1512, y: 0, w: 1366, h: 1024, cols: 2, count: 2 },
];
const WINDOW_COUNT = DISPLAYS.reduce((s, d) => s + d.count, 0);

// Domínios alvo — fonte única em domains.json. O run.py lê o mesmo arquivo
// para o hosts e para gerar o Caddyfile.
const DOMAINS = require('./domains.json');

// Brand "greasado" que o Chrome injeta nos Client Hints.
const GREASE = { brand: 'Not)A;Brand', version: '99', full: '99.0.0.0' };

function chromeProfile({ id, label, osToken, platform, platformVersion, architecture, major, full }) {
  return {
    id,
    label,
    ua: `Mozilla/5.0 (${osToken}) AppleWebKit/537.36 (KHTML, like Gecko) `
      + `Chrome/${major}.0.0.0 Safari/537.36`,
    metadata: {
      brands: [
        { brand: GREASE.brand, version: GREASE.version },
        { brand: 'Chromium', version: String(major) },
        { brand: 'Google Chrome', version: String(major) },
      ],
      fullVersionList: [
        { brand: GREASE.brand, version: GREASE.full },
        { brand: 'Chromium', version: full },
        { brand: 'Google Chrome', version: full },
      ],
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

// Lista de perfis: sempre Chrome, variando SO e versão.
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
];

// --- posição da janela no grid das telas ------------------------------------
function slotFor(windowIndex) {
  let i = windowIndex;
  for (const d of DISPLAYS) {
    if (i < d.count) {
      const rows = Math.ceil(d.count / d.cols);
      const winW = Math.floor(d.w / d.cols);
      const winH = Math.floor(d.h / rows);
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

function selectProfiles(arg) {
  if (!arg) return PROFILES;
  const m = PROFILES.filter((p) => p.id === arg || p.id.startsWith(arg));
  if (m.length) return m;
  console.warn(`Nenhum perfil casa com "${arg}" — usando todos. `
    + `Opções: ${PROFILES.map((p) => p.id).join(', ')}`);
  return PROFILES;
}

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

function launchAt(slot) {
  return puppeteer.launch({
    headless: false,
    channel: 'chrome',          // usa o Chrome instalado
    acceptInsecureCerts: true,  // aceita o cert da CA interna do Caddy
    defaultViewport: null,
    protocolTimeout: 60000,     // chamadas CDP não penduram por minutos
    ignoreDefaultArgs: ['--enable-automation'], // tira a infobar de automação
    args: [
      '--disable-blink-features=AutomationControlled',
      `--window-position=${slot.x},${slot.y}`,
      `--window-size=${slot.w},${slot.h}`,
    ],
  });
}

// erros que indicam Chrome/aba mortos ou travados — exigem relançar a janela.
const DEAD_RE = /Target closed|Session closed|detached|crash|disconnected|travou|Connection closed|Protocol error/i;

// Supervisiona uma janela: navega em loop e, se o Chrome travar ou cair
// (renderer crash, falta de memória etc.), relança a janela e continua.
async function runWindow(windowIndex, profiles) {
  const slot = slotFor(windowIndex);
  const tag = `janela ${windowIndex + 1}`;
  let uaIdx = windowIndex % profiles.length; // cada janela começa num UA diferente
  let queue = [];

  while (!stopping) {
    let browser = null;
    let alive = false;
    try {
      browser = await launchAt(slot);
      browsers.add(browser);
      alive = true;
      browser.on('disconnected', () => { alive = false; });

      const page = (await browser.pages())[0] || (await browser.newPage());
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      // Aceita diálogos JS — inclusive o "beforeunload" que sites de notícia/
      // anúncio registram. Sem tratar, o Puppeteer descarta o beforeunload, o
      // que CANCELA a navegação e a janela não recarrega.
      page.on('dialog', (dialog) => { dialog.accept().catch(() => {}); });

      while (!stopping && alive) {
        if (queue.length === 0) queue = shuffled(DOMAINS);
        const domain = queue.shift();
        const profile = profiles[uaIdx % profiles.length];
        uaIdx++;
        try {
          // setUserAgent ANTES do goto: alinha header + Client Hints + userAgentData.
          await withTimeout(page.setUserAgent(profile.ua, profile.metadata), 20000, 'setUserAgent');
          await page.goto(`https://${domain}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
          console.log(`[${tag}] ${domain}  ·  ${profile.id}`);
        } catch (e) {
          if (stopping || !alive) break;
          console.warn(`[${tag}] ${domain}: ${e.message}`);
          if (DEAD_RE.test(e.message)) break; // Chrome morreu/travou -> relança
        }
        if (STATIC) {
          // modo clique: fica parado nesse domínio até o Ctrl+C.
          while (!stopping && alive) await sleep(1000);
          break;
        }
        // espera 5-10s em passos de 1s para reagir rápido ao Ctrl+C.
        const secs = randInt(RELOAD_MIN, RELOAD_MAX);
        for (let t = 0; t < secs && !stopping && alive; t++) await sleep(1000);
      }
    } catch (e) {
      console.warn(`[${tag}] falha: ${e.message}`);
    } finally {
      if (browser) {
        browsers.delete(browser);
        await browser.close().catch(() => {});
      }
    }
    if (stopping || STATIC) break;
    console.warn(`[${tag}] relançando...`);
    for (let t = 0; t < 3 && !stopping; t++) await sleep(1000);
  }
}

async function main() {
  const profiles = selectProfiles(PROFILE_ARG);
  console.log(`ua-rotate: ${WINDOW_COUNT} janelas · ${DOMAINS.length} domínios`
    + (STATIC ? ' · modo STATIC (sem reload — para testar clique)'
              : ` · reload ${RELOAD_MIN}-${RELOAD_MAX}s, ordem aleatória`)
    + ` · UA round-robin (${profiles.length} perfis)`);
  console.log('Telas: ' + DISPLAYS.map((d) => `${d.name} ${d.count}j`).join(' · '));

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
      runWindow(i, profiles).catch((e) => console.error(`janela ${i + 1}: ${e.message}`)))
  );
  await closeAll();
}

main().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
