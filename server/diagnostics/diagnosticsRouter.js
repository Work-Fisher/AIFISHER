import express from 'express';
import { redactSensitive } from '../security/redaction.js';

const PRODUCT_NAME = 'AIFISHER 画布';

function normalizePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

async function runCheck(check, fallback = { status: 'unavailable' }) {
  try {
    const result = await check();
    return result && typeof result === 'object' ? redactSensitive(result) : fallback;
  } catch {
    return { status: 'error' };
  }
}

function summarizeProviders(getProviderStatus) {
  try {
    const providers = getProviderStatus() || {};
    const values = Object.values(providers).filter(
      (provider) => provider && typeof provider === 'object',
    );
    return {
      status: 'ready',
      configured: values.filter((provider) => provider.configured === true).length,
      total: values.length,
    };
  } catch {
    return { status: 'error', configured: 0, total: 0 };
  }
}

function isHealthy(check) {
  return check?.status === 'ready';
}

export async function buildDiagnosticsHealth(options = {}) {
  const ports = options.getPorts?.() || {};
  // The desktop backend listens only on a private named pipe and has no TCP port to report.
  const backend = ports.backend === null
    ? { status: 'ready', host: 'named-pipe' }
    : { status: 'ready', host: 'loopback', port: normalizePort(ports.backend, 3001) };

  const [ffmpeg, database, library] = await Promise.all([
    runCheck(options.checkFfmpeg || (async () => ({ status: 'unavailable' }))),
    runCheck(options.checkDatabase || (async () => ({ status: 'unavailable' }))),
    runCheck(options.checkDirectory || (async () => ({ status: 'unavailable' }))),
  ]);
  const providers = summarizeProviders(options.getProviderStatus || (() => ({})));
  const checks = {
    backend,
    ffmpeg,
    database,
    library,
    providers,
  };

  return {
    ok: [checks.backend, ffmpeg, database, library, providers].every(isHealthy),
    product: PRODUCT_NAME,
    version: String(options.version || 'unknown'),
    localOnly: true,
    generatedAt: new Date().toISOString(),
    checks,
  };
}

function diagnosticsPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${PRODUCT_NAME} · 本机健康检查</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,"Microsoft YaHei",system-ui,sans-serif;background:#080909;color:#f4f4f5}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 12% 0%,#162421 0,transparent 36%),#080909}
    main{width:min(940px,calc(100% - 36px));margin:0 auto;padding:56px 0 80px}header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:30px}
    .eyebrow{color:#62e6d0;font-size:12px;letter-spacing:.18em;text-transform:uppercase}.title{font-size:clamp(30px,5vw,52px);margin:8px 0 6px}.muted{color:#94969c;margin:0;line-height:1.6}
    button,a{border:1px solid #343638;border-radius:10px;background:#151617;color:#f4f4f5;padding:11px 15px;text-decoration:none;font:inherit;cursor:pointer}button:hover,a:hover{border-color:#62e6d0}
    .actions{display:flex;gap:10px;flex-wrap:wrap}.summary{border:1px solid #242627;border-radius:18px;background:#0e1010;padding:20px;margin-bottom:16px}.summary strong{font-size:20px}.ok{color:#62e6d0}.bad{color:#fb7185}
    #checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}.card{border:1px solid #242627;border-radius:14px;background:#0e1010;padding:17px}.card h2{font-size:14px;margin:0 0 14px;color:#b9bbc0}.row{display:flex;justify-content:space-between;gap:16px;font-size:13px;color:#8f9298}.value{color:#f4f4f5;text-align:right}.error{padding:18px;border:1px solid #58242f;background:#210f14;border-radius:14px;color:#fda4af}
    @media(max-width:620px){header{align-items:flex-start;flex-direction:column}main{padding-top:34px}}
  </style>
</head>
<body><main>
  <header><div><div class="eyebrow">LOCAL DIAGNOSTICS</div><h1 class="title">${PRODUCT_NAME} · 本机健康检查</h1><p class="muted">只显示可安全分享的本机状态，不包含 API Key、绝对路径或账号信息。</p></div><div class="actions"><button id="refresh" type="button">重新检查</button><a href="/api/diagnostics/export" download>导出诊断包</a></div></header>
  <section id="summary" class="summary">正在检查本机服务…</section><section id="checks"></section>
</main><script>
const names={backend:'后端服务',ffmpeg:'FFmpeg',database:'项目数据库',library:'素材目录',providers:'AI 服务配置'};
const labels={status:'状态',host:'主机范围',port:'端口',version:'版本',schemaVersion:'结构版本',writable:'可写',configured:'已配置',total:'总数'};
function render(data){const summary=document.querySelector('#summary');summary.innerHTML='<strong class="'+(data.ok?'ok':'bad')+'">'+(data.ok?'运行正常':'发现需要处理的项目')+'</strong><p class="muted">版本 '+data.version+' · 仅限本机访问 · '+new Date(data.generatedAt).toLocaleString()+'</p>';const root=document.querySelector('#checks');root.replaceChildren();for(const [key,value] of Object.entries(data.checks)){const card=document.createElement('article');card.className='card';const title=document.createElement('h2');title.textContent=names[key]||key;card.append(title);for(const [field,fieldValue] of Object.entries(value)){const row=document.createElement('div');row.className='row';const left=document.createElement('span');left.textContent=labels[field]||field;const right=document.createElement('span');right.className='value';right.textContent=String(fieldValue);row.append(left,right);card.append(row)}root.append(card)}}
async function load(){document.querySelector('#refresh').disabled=true;try{const response=await fetch('/api/diagnostics/health',{cache:'no-store'});if(!response.ok)throw new Error();render(await response.json())}catch{document.querySelector('#summary').innerHTML='<div class="error">无法读取诊断状态，请确认 AIFISHER 画布后端正在运行。</div>'}finally{document.querySelector('#refresh').disabled=false}}
document.querySelector('#refresh').addEventListener('click',load);load();
  </script></body></html>`;
}

export function createDiagnosticsRouter(options = {}) {
  const router = express.Router();

  router.get('/api/diagnostics/health', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await buildDiagnosticsHealth(options));
  });

  router.get('/api/diagnostics/export', async (_req, res) => {
    const health = await buildDiagnosticsHealth(options);
    const recentLogs = await runCheck(
      async () => options.readRecentLogs?.() || [],
      [],
    );
    const payload = redactSensitive({
      ...health,
      recentLogs: Array.isArray(recentLogs) ? recentLogs : [],
    });
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="aifisher-diagnostics-${date}.json"`,
    );
    res.send(`${JSON.stringify(payload, null, 2)}\n`);
  });

  router.get('/diagnostics', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    res.type('html').send(diagnosticsPage());
  });

  return router;
}
