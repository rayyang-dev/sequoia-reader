// 统一工具面板效果演示：真实前端渲染截图。
// 生成 demo-hub-1-chip.png（收拢后的「工具」入口）/ demo-hub-2-panel.png（面板+分类）/ demo-hub-3-display.png（显示分类）
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fflate = require('../www/js/vendor/fflate.js');
const ROOT = path.resolve('www'); const OUT = path.resolve('.');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const CH = '第一章 清晨的林间。' + '这是正文段落，用来撑出多页内容以便演示工具面板。红杉树下的光影安静而绵长，适合分页阅读。'.repeat(8);
const files = {
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>工具面板演示</dc:title><dc:creator>红杉阅读</dc:creator></metadata><manifest><item id="c1" href="Text/c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  'OEBPS/Text/c1.xhtml': `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章　清晨的林间</h1><p>${CH}</p></body></html>`,
};
const zipInput = {}; for (const [k, v] of Object.entries(files)) zipInput[k] = fflate.strToU8(v);
const tmpEpub = path.join(os.tmpdir(), 'inkreader-demo-hub.epub');
fs.writeFileSync(tmpEpub, Buffer.from(fflate.zipSync(zipInput, { level: 0 })));
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const browser = await puppeteer.launch({ executablePath: (process.env.INK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 412, height: 892, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  try { const s = JSON.parse(localStorage.getItem('inkreader:settings') || '{}'); s.pageFlip = false; localStorage.setItem('inkreader:settings', JSON.stringify(s)); sessionStorage.setItem('sw-reloaded', '1'); localStorage.setItem('inkreader:pro-guide-v1', '1'); } catch (e) {}
  window.InkTools = { ttsStatus() { return 1; }, speak() {}, stopSpeak() {} };
});
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__INK_INIT_DONE === true, { timeout: 15000 });
  const input = await page.$('#file-epub'); await input.uploadFile(tmpEpub);
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length >= 1, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.book-card').click());
  await page.waitForFunction(() => { const r = document.querySelector('#reader'); return r && !r.classList.contains('hidden'); }, { timeout: 15000 });
  await page.evaluate(() => { const ok = document.querySelector('#pro-guide-ok'); if (ok) ok.click(); });
  await wait(500);
  // 唤出控制条，露出 chip
  await page.evaluate(() => { const r = document.getElementById('reader'); r.classList.remove('hide-chrome'); const pr = document.getElementById('pro-root'); if (pr) pr.classList.add('pro-chrome'); });
  await wait(200);
  await page.screenshot({ path: path.join(OUT, 'demo-hub-1-chip.png') });
  console.log('saved demo-hub-1-chip.png');

  await page.evaluate(() => document.getElementById('hub-entry').click());
  await wait(250);
  await page.screenshot({ path: path.join(OUT, 'demo-hub-2-panel.png') });
  console.log('saved demo-hub-2-panel.png');

  await page.evaluate(() => { const t = Array.from(document.querySelectorAll('.hub-tab')).find((b) => b.dataset.tab === 'display'); if (t) t.click(); });
  await wait(200);
  await page.screenshot({ path: path.join(OUT, 'demo-hub-3-display.png') });
  console.log('saved demo-hub-3-display.png');
} catch (e) { console.error('DEMO ERROR:', e && e.stack || e); }
finally { await browser.close(); server.close(); }
