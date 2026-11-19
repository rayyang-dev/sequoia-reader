// 「选中文字即朗读」（R-059）端到端回归：内存合成 EPUB，注入 mock 原生 TTS 桥记录朗读文本。
// 运行：node test/speak-selection.mjs
// 覆盖：工具条朗读按钮存在 -> 选中一段后点朗读 -> 传入的正是选中文字(非整页)
//       -> 原生桥优先 -> 读完不自动翻页 -> 朗读条显示/停止 -> 无 JS 报错
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fflate = require('../www/js/vendor/fflate.js');
const ROOT = path.resolve('www');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

const SPEAK_TEXT = '这一句是要被单独朗读的选中文字';
const OTHER_TEXT = '这一句是同页的另一段不该被朗读的文字';
const BOOK_TITLE = '选中朗读测试样本';
const files = {
  'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${BOOK_TITLE}</dc:title><dc:creator>regression</dc:creator></metadata>
<manifest><item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/></spine>
</package>`,
  'OEBPS/Text/chapter1.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>第一章</h1>
<p>${OTHER_TEXT}。中间填充一段普通正文让分页器稳定工作，这段文字长到不会把整章压成单字页面，也不包含任何测试关键字。${SPEAK_TEXT}。结尾再补一点普通文字确保选区能落在第一页上。</p>
</body></html>`,
};
const zipInput = {};
for (const [k, v] of Object.entries(files)) zipInput[k] = fflate.strToU8(v);
const tmpEpub = path.join(os.tmpdir(), 'inkreader-speak-selection.epub');
fs.writeFileSync(tmpEpub, Buffer.from(fflate.zipSync(zipInput, { level: 0 })));

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
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [], results = [];
const step = (name, pass, detail) => results.push({ name, pass: !!pass, detail });

// ---- 源码级接线检查 ----
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const plus = fs.readFileSync(path.join(ROOT, 'js/plus.js'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
step('index.html 选中工具条含朗读按钮', /id="sel-speak"/.test(idx));
step('app.js 绑定 sel-speak 并调 speakSelection',
  /\$\('sel-speak'\)\.addEventListener/.test(app) && /plus\.speakSelection/.test(app));
step('plus.js 暴露 speakSelection 且 autoNext=false',
  /speakSelection:\s*\(text\)\s*=>\s*speakText\(text,\s*\{\s*autoNext:\s*false\s*\}\)/.test(plus));
step('plus.js speakText 复用原生桥与 Web Speech',
  /nt\.speak\(clean, rate\)/.test(plus) && /new SpeechSynthesisUtterance\(clean\)/.test(plus));
// 通用断言：SW 缓存不低于引入本功能的 v24，后续正常递增不误报
{
  const cv = Number((sw.match(/const CACHE = 'inkreader-v(\d+)'/) || [])[1]);
  const curTag = (sw.match(/const CACHE = '(inkreader-v\d+)'/) || [])[1] || '';
  const reuseTail = sw.split('const REUSE')[1] || '';
  step('SW 缓存≥v24 且当前版本不在 REUSE', Number(cv) >= 24 && !!curTag && !reuseTail.includes("'" + curTag + "'"), { cv, curTag });
}

const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 412, height: 892 });
await page.evaluateOnNewDocument(() => {
  try {
    const s = JSON.parse(localStorage.getItem('inkreader:settings') || '{}');
    s.pageFlip = false;
    localStorage.setItem('inkreader:settings', JSON.stringify(s));
  } catch (e) {}
  try { sessionStorage.setItem('sw-reloaded', '1'); } catch (e) {}
  // mock 原生 TTS 桥：记录每次 speak 的文本与速率，避免真机语音依赖；同时把本页标志设为开
  window.__ttsCalls = [];
  window.InkTools = {
    speak(text, rate) { window.__ttsCalls.push({ text, rate }); },
    stopSpeak() { window.__ttsStops = (window.__ttsStops || 0) + 1; },
  };
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

async function selectText(text) {
  const ok = await page.evaluate((t) => {
    const root = document.querySelector('#page');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.indexOf(t);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + t.length);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, text);
  await wait(160);
  return ok;
}

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__INK_INIT_DONE === true, { timeout: 15000 });
  const input = await page.$('#file-epub');
  await input.uploadFile(tmpEpub);
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length >= 1, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.book-card').click());
  await page.waitForFunction(() => {
    const r = document.querySelector('#reader');
    return r && !r.classList.contains('hidden');
  }, { timeout: 15000 });

  const selOk = await selectText(SPEAK_TEXT);
  const barState = await page.evaluate(() => ({
    visible: !document.querySelector('#sel-bar').classList.contains('hidden'),
    speak: !!document.querySelector('#sel-speak'),
  }));
  step('选中文字后工具条显示且有朗读按钮', selOk && barState.visible && barState.speak, barState);

  await page.evaluate(() => document.querySelector('#sel-speak').click());
  await wait(220);

  const afterSpeak = await page.evaluate(() => ({
    calls: window.__ttsCalls.slice(),
    barVisible: !document.querySelector('#plus-ttsbar').classList.contains('hidden'),
    pageText: (document.querySelector('#page') || {}).innerText || '',
  }));
  const spoken = afterSpeak.calls.map((c) => c.text);
  step('点朗读后原生桥被调用', afterSpeak.calls.length === 1, afterSpeak.calls);
  step('朗读的是选中文字而非整页',
    spoken.length === 1 && spoken[0] === SPEAK_TEXT && !spoken[0].includes(OTHER_TEXT), spoken);
  step('朗读条显示（朗读中状态）', afterSpeak.barVisible === true, { barVisible: afterSpeak.barVisible });

  // 触发原生桥的完成回调：选中朗读不应自动翻页（无 ctx.requestTurn 副作用），应 stop
  const beforePage = await page.evaluate(() => (document.querySelector('#chapter-title') || {}).textContent || '');
  await page.evaluate(() => { if (typeof window.__inkTtsOnEnd === 'function') window.__inkTtsOnEnd(); });
  await wait(200);
  const afterEnd = await page.evaluate(() => ({
    stops: window.__ttsStops || 0,
    barHidden: document.querySelector('#plus-ttsbar').classList.contains('hidden'),
    calls: window.__ttsCalls.length,
    pageText: (document.querySelector('#page') || {}).innerText || '',
  }));
  step('读完即停：调用 stopSpeak 且朗读条收起', afterEnd.stops >= 1 && afterEnd.barHidden, afterEnd);
  step('读完不自动续读下一页/不重复朗读', afterEnd.calls === 1, { calls: afterEnd.calls });

  step('无 JS 运行时报错', errors.length === 0, errors);
} catch (e) {
  step('测试执行未抛异常', false, String(e && e.stack || e));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  ' + JSON.stringify(r.detail)}`);
}
console.log(`\n结果：${results.length - failed.length} passed / ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
