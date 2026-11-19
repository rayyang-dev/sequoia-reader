// 效果演示：右上角常驻「章节 + 页码」标签，真实前端代码渲染并截图。
// 生成：demo-loc-1-top.png（控制条显示，标签在顶栏下方）/ demo-loc-2-immersive.png（沉浸态，标签上移）
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fflate = require('../www/js/vendor/fflate.js');
const ROOT = path.resolve('www');
const OUT = path.resolve('.');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const paras = Array.from({ length: 14 }, (_, i) => `<p>这是第 ${i + 1} 段正文，用来把第一章撑成多页，从而验证右上角位置标签里的页码会随翻页变化。本章讲的是林间清晨的光影与红杉树的年轮，文字安静而绵长，适合分页阅读与落位校验。</p>`).join('');
const files = {
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>位置标签演示</dc:title><dc:creator>红杉阅读</dc:creator></metadata><manifest><item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  'OEBPS/Text/chapter1.xhtml': `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 林间清晨</title></head><body><h1>第一章　林间的清晨</h1>${paras}</body></html>`,
};
const zipInput = {};
for (const [k, v] of Object.entries(files)) zipInput[k] = fflate.strToU8(v);
const tmpEpub = path.join(os.tmpdir(), 'inkreader-demo-loc.epub');
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
const browser = await puppeteer.launch({ executablePath: (process.env.INK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 412, height: 892, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  try { const s = JSON.parse(localStorage.getItem('inkreader:settings') || '{}'); s.pageFlip = false; localStorage.setItem('inkreader:settings', JSON.stringify(s)); } catch (e) {}
  try { sessionStorage.setItem('sw-reloaded', '1'); localStorage.setItem('inkreader:pro-guide-v1', '1'); } catch (e) {}
});
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__INK_INIT_DONE === true, { timeout: 15000 });
  const input = await page.$('#file-epub');
  await input.uploadFile(tmpEpub);
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length >= 1, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.book-card').click());
  await page.waitForFunction(() => { const r = document.querySelector('#reader'); return r && !r.classList.contains('hidden'); }, { timeout: 15000 });
  await page.evaluate(() => { const ok = document.querySelector('#pro-guide-ok'); if (ok) ok.click(); });
  await wait(600);
  const loc1 = await page.evaluate(() => { const el = document.getElementById('pro-loc'); return { text: el && el.textContent, hidden: el && el.classList.contains('pro-hidden'), top: el && getComputedStyle(el).top }; });
  await page.screenshot({ path: path.join(OUT, 'demo-loc-1-top.png') });
  console.log('saved demo-loc-1-top.png  loc=' + JSON.stringify(loc1));

  // 翻到下一页，验证页码变化
  await page.evaluate(() => document.querySelector('#btn-next') && document.querySelector('#btn-next').click());
  await wait(600);
  const loc2 = await page.evaluate(() => { const el = document.getElementById('pro-loc'); return { text: el && el.textContent, hidden: el && el.classList.contains('pro-hidden') }; });
  console.log('after next page loc=' + JSON.stringify(loc2));

  // 进入沉浸态（隐藏控制条），验证标签上移仍可见
  await page.evaluate(() => document.querySelector('#reader').classList.add('hide-chrome'));
  await page.evaluate(() => document.getElementById('pro-root') && document.getElementById('pro-root').classList.remove('pro-chrome'));
  await wait(300);
  const loc3 = await page.evaluate(() => { const el = document.getElementById('pro-loc'); return { text: el && el.textContent, top: el && getComputedStyle(el).top, display: el && getComputedStyle(el).display }; });
  await page.screenshot({ path: path.join(OUT, 'demo-loc-2-immersive.png') });
  console.log('saved demo-loc-2-immersive.png  loc=' + JSON.stringify(loc3));
} catch (e) { console.error('DEMO ERROR:', e && e.stack || e); }
finally { await browser.close(); server.close(); }
