// 效果演示：用与 APK 完全相同的 www 前端代码，渲染「选中文字即朗读」的真实界面并截图。
// 生成：demo-1-reader.png（打开书） / demo-2-selected.png（选中文字+工具条） / demo-3-speaking.png（朗读条）
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
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
const P1 = '清晨的雾气还没有散去，阳光透过层层叠叠的枝叶，在地面上洒下斑驳的光影。';
const P2 = '这一句是要被单独朗读的选中文字，红杉树下，风穿过林间，树叶轻轻摇曳。';
const BOOK = '红杉树下 · 朗读演示';
const files = {
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${BOOK}</dc:title><dc:creator>红杉阅读</dc:creator></metadata><manifest><item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  'OEBPS/Text/chapter1.xhtml': `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>第一章　林间的清晨</h1><p>${P1}</p><p>${P2}</p><p>他沿着小径慢慢走着，呼吸着带着松脂香气的空气，这里的一切都那么安静。</p><p>高大的红杉树直插云霄，树干粗壮，树皮呈深褐色，布满岁月的纹路。</p><p>走了一段路，前方出现一片开阔的空地，空地上长满了野花，在微风中轻轻摇曳。</p><p>时间在这里仿佛放慢了脚步，没有闹钟的催促，没有消息的打扰。</p></body></html>`,
};
const zipInput = {};
for (const [k, v] of Object.entries(files)) zipInput[k] = fflate.strToU8(v);
const tmpEpub = path.join(os.tmpdir(), 'inkreader-demo.epub');
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
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 412, height: 892, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  try { const s = JSON.parse(localStorage.getItem('inkreader:settings') || '{}'); s.pageFlip = false; localStorage.setItem('inkreader:settings', JSON.stringify(s)); } catch (e) {}
  try { sessionStorage.setItem('sw-reloaded', '1'); } catch (e) {}
  window.__ttsCalls = [];
  window.InkTools = {
    speak(text, rate) { window.__ttsCalls.push({ text, rate }); },
    stopSpeak() { window.__ttsStops = (window.__ttsStops || 0) + 1; },
  };
});

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__INK_INIT_DONE === true, { timeout: 15000 });
  const input = await page.$('#file-epub');
  await input.uploadFile(tmpEpub);
  await page.waitForFunction(() => document.querySelectorAll('.book-card').length >= 1, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('.book-card').click());
  await page.waitForFunction(() => { const r = document.querySelector('#reader'); return r && !r.classList.contains('hidden'); }, { timeout: 15000 });
  // 关掉首次阅读的新手引导蒙层（pro.js 的 #pro-guide-ok），避免遮挡正文
  await page.evaluate(() => { const ok = document.querySelector('#pro-guide-ok'); if (ok) ok.click(); });
  await wait(500);
  await page.screenshot({ path: path.join(OUT, 'demo-1-reader.png') });
  console.log('saved demo-1-reader.png');

  // 选中 P2
  const ok = await page.evaluate((t) => {
    const root = document.querySelector('#page');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const i = n.nodeValue.indexOf(t);
      if (i >= 0) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, P2);
  await wait(400);
  await page.screenshot({ path: path.join(OUT, 'demo-2-selected.png') });
  console.log('saved demo-2-selected.png  (selected=' + ok + ')');

  await page.evaluate(() => document.querySelector('#sel-speak').click());
  await wait(500);
  await page.screenshot({ path: path.join(OUT, 'demo-3-speaking.png') });
  const state = await page.evaluate(() => ({
    calls: window.__ttsCalls.slice(),
    bar: !document.querySelector('#plus-ttsbar').classList.contains('hidden'),
    barText: (document.querySelector('#plus-tts-state') || {}).textContent || '',
  }));
  console.log('saved demo-3-speaking.png');
  console.log('TTS state: ' + JSON.stringify(state));
} catch (e) {
  console.error('DEMO ERROR:', e && e.stack || e);
} finally {
  await browser.close();
  server.close();
}
