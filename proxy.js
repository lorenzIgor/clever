'use strict';
// Proxy reverso de teste: busca o site REAL de cada domínio alvo e injeta
// a tag Clever Core na resposta HTML. O Caddy fica na frente terminando o TLS.
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const zlib = require('zlib');

const PORT = 8787;
const DEFAULT_HOST = 'games.op.gg'; // fallback se a request não trouxer Host

// A div alvo do banner Clever (entra como primeiro nó dentro do <body>).
// Flutuante (position:fixed) em 0,0 e com z-index máximo (2147483647 = maior
// int de 32 bits) para ficar acima de todo o conteúdo do site.
const CLEVER_DIV = '<div class="clever-core-ads" '
  + 'style="position:fixed;top:0;left:0;z-index:2147483647"></div>';

// O loader Clever Core + guardião. O guardião usa um MutationObserver que
// recria a div .clever-core-ads sempre que ela some (SPAs React/Next.js apagam
// a div estática na hidratação) e re-injeta o loader para o anúncio voltar a
// renderizar — limitado a MAX_INJECTIONS para não entrar em laço.
const CLEVER_SCRIPT = `
<!-- ===== Clever Core + guardião injetados pelo proxy de teste ===== -->
<script data-cfasync="false" type="text/javascript" id="clever-core-guard">
(function (document, window) {
  var CLASS = "clever-core-ads";
  var STYLE = "position:fixed;top:0;left:0;z-index:2147483647";
  var MAX_INJECTIONS = 6;
  var injections = 0;

  // garante a div; retorna true se precisou (re)criá-la.
  function ensureDiv() {
    if (document.querySelector("." + CLASS)) return false;
    var el = document.createElement("div");
    el.className = CLASS;
    el.setAttribute("style", STYLE);
    (document.body || document.documentElement).appendChild(el);
    return true;
  }

  // injeta o loader Clever Core (igual a tag original do usuario).
  function injectLoader() {
    if (injections >= MAX_INJECTIONS) return;
    injections++;
    var a, c = document.createElement("script"), f = window.frameElement;
    c.id = "CleverCoreLoader103461";
    c.src = "https://scripts.cleverwebserver.com/83697330594d1e8aade23cc07e4bd4a9.js";
    c.async = !0;
    c.type = "text/javascript";
    c.setAttribute("data-target", window.name || (f && f.getAttribute("id")));
    c.setAttribute("data-callback", "put-your-callback-function-here");
    c.setAttribute("data-callback-url-click", "put-your-click-macro-here");
    c.setAttribute("data-callback-url-view", "put-your-view-macro-here");
    try { a = parent.document.getElementsByTagName("script")[0] || document.getElementsByTagName("script")[0]; }
    catch (e) { a = !1; }
    a || (a = document.getElementsByTagName("head")[0] || document.getElementsByTagName("body")[0]);
    a.parentNode.insertBefore(c, a);
  }

  // 1a carga: garante a div e injeta o loader.
  ensureDiv();
  injectLoader();

  // guardião: se a div sumir (hidratação do React), recria e re-injeta o loader.
  var observer = new MutationObserver(function () {
    if (ensureDiv()) injectLoader();
  });
  if (document.body) observer.observe(document.body, { childList: true });
})(document, window);
</script>
`;

// Casa a tag de abertura do <body> (com ou sem atributos).
const BODY_OPEN_RE = /(<body\b[^>]*>)/i;

function injectHtml(html) {
  // 1. coloca a div do Clever como primeiro nó dentro do <body>
  if (BODY_OPEN_RE.test(html)) {
    html = html.replace(BODY_OPEN_RE, function (m) { return m + CLEVER_DIV; });
  } else {
    html = CLEVER_DIV + html;
  }
  // 2. o loader + guardião vão no fim do body (a div estática ja existe no DOM)
  html = html.includes('</body>')
    ? html.replace('</body>', function () { return CLEVER_SCRIPT + '</body>'; })
    : html + CLEVER_SCRIPT;
  return html;
}

// dns.resolve4 consulta o DNS de verdade e IGNORA o /etc/hosts,
// entao nao cai no loop (dominio -> 127.0.0.1 -> Caddy).
const ipCache = new Map();
async function realIp(host) {
  if (ipCache.has(host)) return ipCache.get(host);
  const ips = await dns.resolve4(host);
  ipCache.set(host, ips[0]);
  return ips[0];
}

function decompress(buf, enc) {
  try {
    if (enc === 'gzip') return zlib.gunzipSync(buf);
    if (enc === 'br') return zlib.brotliDecompressSync(buf);
    if (enc === 'deflate') return zlib.inflateSync(buf);
  } catch (e) {
    return null; // falhou: deixa o chamador usar o corpo original
  }
  return buf;
}

const server = http.createServer(async (req, res) => {
  const host = (req.headers.host || DEFAULT_HOST).split(':')[0];

  let ip;
  try {
    ip = await realIp(host);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Falha de DNS para ' + host + ': ' + e.message);
    return;
  }

  const upstream = https.request({
    host: ip,
    servername: host,
    port: 443,
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host, 'accept-encoding': 'gzip' },
    rejectUnauthorized: false,
  }, (up) => {
    const chunks = [];
    up.on('data', (d) => chunks.push(d));
    up.on('end', () => {
      let body = Buffer.concat(chunks);
      const headers = { ...up.headers };
      const ct = (headers['content-type'] || '').toLowerCase();

      // remove headers que bloqueariam a tag ou quebrariam o tamanho
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      delete headers['strict-transport-security'];
      delete headers['x-frame-options'];
      delete headers['content-length'];
      delete headers['transfer-encoding'];
      delete headers['connection'];

      const isHtml = ct.includes('text/html') || ct.includes('xhtml');
      let injected = false;
      if (isHtml) {
        const enc = headers['content-encoding'];
        const decoded = decompress(body, enc);
        if (decoded) {
          delete headers['content-encoding'];
          const original = decoded.toString('utf8');
          const out = injectHtml(original);
          body = Buffer.from(out, 'utf8');
          injected = out.length !== original.length;
          console.log(`   [html] enc=${enc || 'none'}`
            + ` </body>=${original.includes('</body>')}`
            + ` <body>=${BODY_OPEN_RE.test(original)}`
            + ` injetado=${injected}`);
        } else {
          console.log(`   [html] FALHA ao descomprimir (enc=${enc}) -- injecao pulada`);
        }
      }

      headers['content-length'] = body.length;
      res.writeHead(up.statusCode, headers);
      res.end(body);
      console.log(`${req.method} ${host}${req.url} -> ${up.statusCode} ${ct || '-'}`);
    });
  });

  // sem timeout, um upstream que trava deixa o socket pendurado para sempre;
  // ao longo do tempo isso vaza conexoes e o proxy degrada.
  upstream.setTimeout(25000, () => {
    upstream.destroy(new Error('timeout no upstream'));
  });

  upstream.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Erro no upstream: ' + e.message);
    } else {
      res.end();
    }
  });

  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Proxy de injecao rodando em http://127.0.0.1:${PORT}`);
});
