// 统一工具面板 hub 回归：一个带文字的「工具」入口 + 分类面板（目录/书签/显示/朗读/翻页/统计）。
// 运行：node test/hub.mjs
// 覆盖：入口出现且原图标收拢 / 面板开合 / 六个分类渲染 / 跳章 / 排版设置 / 朗读调用 / SW v26+新资源在 ASSETS 不在 REUSE。
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fflate = require('../www/js/vendor/fflate.js');
const ROOT = path.resolve('www');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const CH1 = '第一章 清晨的林间。' + '这是第一章的正文段落，用来撑出多页内容以便测试目录与页码显示。'.repeat(6);
const CH2 = '第二章 午后的光影。' + '这是第二章的正文段落，验证跳章功能是否正确切换章节。'.repeat(6);
const BOOK = '工具面板测试';
const files = {
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${BOOK}</dc:title><dc:creator>regression</dc:creator></metadata><manifest><item id="c1" href="Text/c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="Text/c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
  'OEBPS/Text/c1.xhtml': `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章 清晨的林间</h1><p>${CH1}</p></body></html>`,
  'OEBPS/Text/c2.xhtml': `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章 午后的光影</h1><p>${CH2}</p></body></html>`,
};
const zipInput = {};
for (const [k, v] of Object.entries(files)) zipInput[k] = fflate.strToU8(v);
const tmpEpub = path.join(os.tmpdir(), 'inkreader-hub.epub');
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
const results = [];
const step = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
const errors = [];

// ---- 源码级 ----
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const assets = (sw.match(/const ASSETS = \[([\s\S]*?)\];/) || [])[1] || '';
const reuse = (sw.match(/const REUSE = \[([\s\S]*?)\]\.concat/) || [])[1] || '';
const cv = Number((sw.match(/const CACHE = 'inkreader-v(\d+)'/) || [])[1]);
step('SW≥v26', cv >= 26, { cv });
step('hub.css/hub.js 在 ASSETS', assets.includes("css/hub.css") && assets.includes("js/hub.js"));
step('hub.js 不在 REUSE', !reuse.includes("js/hub.js"));
step('app.js import mountHub 并暴露 __INK_HUB', /import \{ mountHub \}/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')) && /window\.__INK_HUB/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')));

const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 412, height: 892 });
await page.evaluateOnNewDocument(() => {
  try {
    const s = JSON.parse(localStorage.getItem('inkreader:settings') || '{}');
    s.pageFlip = false; localStorage.setItem('inkreader:settings', JSON.stringify(s));
    sessionStorage.setItem('sw-reloaded', '1'); localStorage.setItem('inkreader:pro-guide-v1', '1');
  } catch (e) {}
  window.__ttsCalls = [];
  window.InkTools = {
    ttsStatus() { return 1; },
    speak(t, r) { window.__ttsCalls.push(t); },
    stopSpeak() {},
  };
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push('CONSOLE: ' + m.text()); });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__INK_INIT_DONE === true, { timeout: 15000 });
  const input = await page.$('#file-epub');
  await input.uploadFile(tmpEpub);
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length >= 1, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.book-card').click());
  await page.waitForFunction(() => { const r = document.querySelector('#reader'); return r && !r.classList.contains('hidden'); }, { timeout: 15000 });
  await page.evaluate(() => { const ok = document.querySelector('#pro-guide-ok'); if (ok) ok.click(); });
  await wait(400);

  const entry = await page.evaluate(() => {
    const e = document.getElementById('hub-entry');
    const aa = document.getElementById('pro-aa');
    const nx = document.getElementById('nx-chip-open');
    return {
      entry: !!e,
      entryText: e ? e.textContent.trim() : '',
      aaHidden: aa ? aa.classList.contains('hub-swallowed') : null,
      nxHidden: nx ? nx.classList.contains('hub-swallowed') : null,
      panel: !!document.getElementById('hub-panel'),
    };
  });
  step('统一入口「工具」按钮出现', entry.entry && /工具/.test(entry.entryText), entry);
  step('原图标入口(Aa/能力中心✦)被收拢', entry.aaHidden === true && entry.nxHidden === true, entry);
  step('统一面板 DOM 存在', entry.panel);

  // 打开面板，检查六个分类
  await page.evaluate(() => document.getElementById('hub-entry').click());
  await wait(200);
  const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('.hub-tab')).map((b) => b.textContent.trim()));
  step('六个文字分类齐全', ['目录', '书签', '显示', '朗读', '翻页', '统计'].every((t) => tabs.some((x) => x.includes(t))), tabs);
  const opened = await page.evaluate(() => document.getElementById('hub-root').classList.contains('hub-on'));
  step('点入口面板打开', opened);

  // 目录分类：两章可点
  const tocItems = await page.evaluate(() => document.querySelectorAll('#hub-panel .hub-body .hub-item').length);
  step('目录分类渲染章节', tocItems >= 2, { tocItems });
  // 跳到第二章
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#hub-panel .hub-body .hub-item'));
    const second = items.find((b) => b.textContent.includes('第二章'));
    if (second) second.click();
  });
  await wait(400);
  const afterJump = await page.evaluate(() => ({
    title: (document.getElementById('chapter-title') || {}).textContent || '',
    panelOff: !document.getElementById('hub-root').classList.contains('hub-on'),
  }));
  step('点目录跳章并自动关面板', afterJump.title.includes('第二章') && afterJump.panelOff, afterJump);

  // 显示分类：字号步进器生效
  await page.evaluate(() => { document.getElementById('hub-entry').click(); });
  await wait(150);
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.hub-tab')).find((b) => b.dataset.tab === 'display');
    if (t) t.click();
  });
  await wait(150);
  const fsBefore = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--r-font-size').trim());
  await page.evaluate(() => {
    const steps = document.querySelectorAll('#hub-panel .hub-stepper button');
    if (steps[1]) steps[1].click(); // 字号 ＋
  });
  await wait(150);
  const fsAfter = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--r-font-size').trim());
  step('显示分类字号步进器生效', fsBefore !== fsAfter, { fsBefore, fsAfter });

  // 朗读分类：播放本页调原生桥 speak
  await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('.hub-tab')).find((b) => b.dataset.tab === 'read');
    if (t) t.click();
  });
  await wait(150);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#hub-panel button')).find((x) => x.textContent.includes('播放本页'));
    if (b) b.click();
  });
  await wait(200);
  const spoke = await page.evaluate(() => window.__ttsCalls.slice());
  step('朗读分类「播放本页」调用 TTS', spoke.length >= 1, spoke);

  step('无 JS 运行时报错', errors.length === 0, errors);
} catch (e) {
  step('测试执行未抛异常', false, String(e && e.stack || e));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  ' + JSON.stringify(r.detail)}`);
console.log(`\n结果：${results.length - failed.length} passed / ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
