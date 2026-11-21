// 水杉 Pro —— 翻页编排层 + 视线回扫状态机 端到端回归（真实 Chrome + 纯逻辑注入）
// 不依赖真机摄像头：用 SimulatedSource 注入视线 y，把「闭环」跑完整：
// 串行化 / 冷却 / 撤销 / 预告取消 / 暂停门控 / 回扫识别 / 防连翻 / 校准 / 释放。
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('www');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream',
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

const browser = await puppeteer.launch({
  executablePath: (process.env.INK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'),
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 892 });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e && e.message ? e.message : e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/favicon/i.test(t) || /favicon\.ico/i.test((m.location() || {}).url || '')) return;
  errors.push('CONSOLE: ' + t);
});
page.on('dialog', async (d) => { try { await d.dismiss(); } catch (e) {} });
// 跳过首次引导与 SW 接管刷新，避免干扰逻辑断言
await page.evaluateOnNewDocument(() => {
  try {
    sessionStorage.setItem('sw-reloaded', '1');
    localStorage.setItem('inkreader:pro-guide-v1', '1');
  } catch (e) {}
});

const results = [];
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));

  const ui = await page.evaluate(() => ({
    init: !!window.__INK_INIT_DONE,
    proReady: !!window.__INK_PRO,
    bar: !!document.getElementById('pro-bar'),
    chip: !!document.getElementById('pro-chip'),
    loc: !!document.getElementById('topbar-loc'),
    panel: !!document.getElementById('pro-panel'),
    css: Array.from(document.styleSheets).some((s) => (s.href || '').includes('pro.css')),
  }));
  results.push({ name: 'Pro 层挂载（进度条 / chip / 面板 / CSS / 无阻断）', pass: ui.init && ui.proReady && ui.bar && ui.chip && ui.panel && ui.css, extra: ui });

  const logic = await page.evaluate(async () => {
    const out = [];
    const check = (name, cond, extra) => out.push({ name, pass: !!cond, extra });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const { createTurnController } = await import('/js/turn.js');
    const { createGazeEngine } = await import('/js/gaze.js');

    // ---- 1. 翻页编排层：串行化 / 冷却 / 撤销 ----
    let pos = { ci: 0, pi: 0 }, running = 0, maxConcurrent = 0, performed = 0;
    const turn = createTurnController({
      perform: async (dir) => {
        running++; maxConcurrent = Math.max(maxConcurrent, running);
        await sleep(14); // 模拟 PDF 异步渲染，若未串行就会并发写 DOM
        pos = { ci: 0, pi: pos.pi + (dir === 'next' ? 1 : -1) };
        performed++; running--;
      },
      getPosition: () => ({ ...pos }),
      restore: async (p) => { pos = { ...p }; },
      canTurn: () => true,
      cooldownMs: 0,
    });
    await Promise.all([
      turn.request('next', 'manual'), turn.request('next', 'manual'),
      turn.request('next', 'gaze'), turn.request('next', 'timed'),
    ]);
    check('串行化：任何时刻只有一个翻页在跑', maxConcurrent === 1, { maxConcurrent });
    check('四次请求全部执行且无丢失', performed === 4, { performed, pi: pos.pi });
    await turn.undo();
    check('撤销回到刚才那一页', pos.pi === 3, { pi: pos.pi });

    // ---- 2. 预告可取消 ----
    turn.setBeforeTurn(async () => false);
    await turn.request('next', 'timed');
    check('预告被取消时不翻页', pos.pi === 3, { pi: pos.pi });
    turn.setBeforeTurn(null);

    // ---- 3. 暂停只挡自动来源，手动永远可用 ----
    turn.pause('面板已打开');
    await turn.request('next', 'timed');
    check('暂停时自动翻页被挡下', pos.pi === 3, { pi: pos.pi });
    await turn.request('next', 'manual');
    check('暂停时手动翻页仍可响应', pos.pi === 4, { pi: pos.pi });
    turn.resume();

    // ---- 4. 视线回扫状态机（模拟源，无需摄像头） ----
    let signals = 0;
    const phases = [];
    const cfg = {
      gazeEngine: 'sim', gazeSensitivity: 3, gazeDwellMs: 60,
      gazeCooldownMs: 1500, gazeSampleMs: 10, autoConfirmMs: 0,
    };
    const gaze = createGazeEngine({
      onSignal: () => { signals++; },
      onStatus: (s) => { phases.push(s.phase); },
      getConfig: () => cfg,
    });
    const started = await gaze.start();
    check('模拟视线引擎启动成功', started.ok && gaze.isSimulated(), started);

    gaze.simulate(0.95); // 视线在页底
    await sleep(320);
    check('仅「看到页底」不翻页（挡住低头/看图片误触）', signals === 0, { signals, phases });

    gaze.simulate(0.08); // 回扫到页首
    await sleep(300);
    check('回扫动作触发恰好一次翻页', signals === 1, { signals, phases });

    gaze.simulate(0.95); await sleep(120);
    gaze.simulate(0.08); await sleep(160);
    check('冷却期内重复回扫不连翻', signals === 1, { signals });

    check('校准流程可启动', gaze.calibrate() === true);
    gaze.pause('测试暂停');
    check('暂停后状态可查询', gaze.getPhase() === 'paused', { phase: gaze.getPhase() });
    await gaze.resume();
    check('恢复后回到追踪', gaze.getPhase() === 'tracking', { phase: gaze.getPhase() });
    gaze.stop();
    check('停止后不再运行（摄像头/帧循环已释放）', !gaze.isRunning());

    return out;
  });
  results.push(...logic);

  // ---- 右上角位置标签：已改为顶栏内嵌 #topbar-loc，悬浮 #pro-loc 整套移除 ----
  const proJs = fs.readFileSync(path.join(ROOT, 'js/pro.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const proCss = fs.readFileSync(path.join(ROOT, 'css/pro.css'), 'utf8');
  const styleCss = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const reuse = sw.split('const REUSE = [')[1] || '';
  const reuseEnd = reuse.indexOf(']');
  const reuseBody = reuse.slice(0, reuseEnd > 0 ? reuseEnd : reuse.length);
  // 旧悬浮层必须彻底消失（DOM 节点 / refresh 逻辑 / 样式），杜绝压正文大标题
  results.push({ name: 'pro.js 已移除 #pro-loc 节点', pass: !/id="pro-loc"/.test(proJs) });
  results.push({ name: 'pro.js refresh 不再读取/写入 p.loc', pass: !/p\.loc/.test(proJs) && !/pro-loc/.test(proJs) });
  results.push({ name: 'pro.css 已移除 #pro-loc 悬浮样式', pass: !/#pro-loc/.test(proCss) });
  results.push({ name: 'app.js getProgress 不再提供 loc 字段', pass: !/loc:\s*chapterLabel\(ci\)/.test(appJs) });
  // 新顶栏内嵌方案
  const tlPos = indexHtml.indexOf('id="topbar-loc"');
  const chPos = indexHtml.indexOf('id="chapter-title"');
  const tocPos = indexHtml.indexOf('id="btn-toc-top"');
  results.push({ name: 'index.html 顶栏内含 #topbar-loc（章节 Label 与目录按钮之间）', pass: tlPos > chPos && tlPos < tocPos });
  const updateFn = (appJs.match(/function updateProgress\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  results.push({ name: 'app.js updateProgress 写入 #topbar-loc 页码', pass: /\$\('topbar-loc'\)/.test(updateFn) && /topbarLoc\.textContent/.test(updateFn) && /pi \+ 1/.test(updateFn) });
  results.push({ name: 'style.css .topbar-loc 为布局流内 flex 子项（无 fixed 悬浮）', pass: /\.topbar-loc\s*\{[^}]*flex:\s*0 0 auto/.test(styleCss) && !/\.topbar-loc\s*\{[^}]*position:\s*fixed/.test(styleCss) });
  // 新方案：顶栏常驻（flex 流内）不遮正文；沉浸态只隐藏返回/目录按钮，顶栏与位置信息都在
  results.push({ name: 'style.css 顶栏为 flex 流内常驻元素（position:relative，非 absolute 覆盖正文）', pass: /\.topbar\s*\{[^}]*flex:\s*0 0 auto[^}]*position:\s*relative/.test(styleCss) });
  results.push({ name: 'index.html 返回/目录按钮带 topbar-chrome class（沉浸态可单独隐藏）', pass: (indexHtml.match(/class="icon-btn topbar-chrome"/g) || []).length === 2 });
  results.push({ name: 'style.css 沉浸态只隐藏底栏与返回/目录按钮，顶栏保留（位置一直可见）', pass: /#reader\.hide-chrome \.bottombar\s*\{\s*display:\s*none/.test(styleCss) && /#reader\.hide-chrome \.topbar-chrome\s*\{\s*display:\s*none/.test(styleCss) && !/#reader\.hide-chrome \.topbar\s*,\s*\n?#reader\.hide-chrome \.bottombar\s*\{\s*display:\s*none/.test(styleCss) });
  const swVer = Number((sw.match(/const CACHE = 'inkreader-v(\d+)'/) || [])[1]);
  results.push({ name: 'SW≥v28 且 css/style.css、css/pro.css 均已从 REUSE 摘出', pass: swVer >= 28 && !/'css\/style\.css'/.test(reuseBody) && !/'css\/pro\.css'/.test(reuseBody), extra: { swVer } });
  const locDom = await page.evaluate(() => {
    const el = document.getElementById('topbar-loc');
    const old = document.getElementById('pro-loc');
    const bar = document.getElementById('topbar');
    return {
      present: !!el, oldGone: !old,
      inTopbar: !!(el && bar && bar.contains(el)),
      text: el ? el.textContent : '',
    };
  });
  results.push({ name: '运行中 #topbar-loc 在顶栏内，且悬浮 #pro-loc 不存在', pass: locDom.present && locDom.inTopbar && locDom.oldGone, extra: locDom });

  // 运行时：沉浸态顶栏与位置常驻、按钮隐藏、正文在顶栏下方（不遮挡）
  const chrome = await page.evaluate(() => {
    const reader = document.getElementById('reader');
    const bar = document.getElementById('topbar');
    const loc = document.getElementById('topbar-loc');
    const page = document.getElementById('page');
    if (!reader || !bar) return { ok: false };
    reader.classList.add('hide-chrome');
    const barVisible = getComputedStyle(bar).display !== 'none';
    const backHidden = getComputedStyle(document.getElementById('btn-back')).display === 'none';
    const locVisible = !!loc && getComputedStyle(loc).display !== 'none';
    const barRect = bar.getBoundingClientRect();
    // 顶栏占据布局流：其底部应 > 0，且正文 viewport 起点在顶栏之下
    const vpTop = page ? page.closest('.page-viewport').getBoundingClientRect().top : -1;
    reader.classList.remove('hide-chrome');
    return {
      barVisible, backHidden, locVisible,
      barBottom: Math.round(barRect.bottom), vpTop: Math.round(vpTop),
      ok: barVisible && backHidden && locVisible && vpTop >= barRect.bottom - 2,
    };
  });
  results.push({ name: '运行时沉浸态：顶栏与位置常驻、返回按钮隐藏、正文在顶栏下方不遮挡', pass: chrome.ok, extra: chrome });
} catch (e) {
  results.push({ name: '测试执行', pass: false, extra: String(e && e.message ? e.message : e) });
}

let pass = 0;
for (const r of results) {
  console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.pass ? '' : '  ' + JSON.stringify(r.extra)}`);
  if (r.pass) pass++;
}
console.log(`\n${pass}/${results.length} 通过，页面错误 ${errors.length} 条`);
if (errors.length) console.log(errors.slice(0, 8).join('\n'));
await browser.close();
server.close();
process.exit(pass === results.length && errors.length === 0 ? 0 : 1);
