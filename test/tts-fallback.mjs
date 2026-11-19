// TTS 健壮性回归：原生引擎不可用时不再卡死，回退 Web Speech 并给可操作引导。
// 运行：node test/tts-fallback.mjs
// 覆盖：Java 桥加 ttsStatus / 失败 shutdown 置不可用 / 回调 Web；JS nativeTts 感知状态2回退 /
//       __inkTtsUnavailable 切 Web Speech / 无可用引擎时给可操作提示 / 无 JS 报错。
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fflate = require('../www/js/vendor/fflate.js');
const ROOT = path.resolve('www');
const JAVA = path.resolve('android/app/src/main/java/com/rayyang/metasequoia/MainActivity.java');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
const SPEAK_TEXT = '这一句在原生引擎不可用时应该改由网页语音朗读';
const BOOK = 'TTS 回退测试';
const files = {
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${BOOK}</dc:title><dc:creator>regression</dc:creator></metadata><manifest><item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  'OEBPS/Text/chapter1.xhtml': `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第一章</h1><p>${SPEAK_TEXT}。前面补一段普通正文让分页稳定，不含任何测试关键字，也不影响朗读回退判定。</p></body></html>`,
};
const zipInput = {};
for (const [k, v] of Object.entries(files)) zipInput[k] = fflate.strToU8(v);
const tmpEpub = path.join(os.tmpdir(), 'inkreader-tts-fallback.epub');
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

// ---- Java 源码级断言 ----
const java = fs.readFileSync(JAVA, 'utf8');
step('Java: 桥暴露 ttsStatus()', /int ttsStatus\(\)/.test(java));
step('Java: 初始化失败时 shutdown 并置 ttsState=2', /tts\.shutdown\(\)[\s\S]{0,120}tts = null; ttsReady = false; ttsState = 2/.test(java));
step('Java: 缺中文语音包(LANG_MISSING_DATA)也置不可用', /LANG_MISSING_DATA[\s\S]{0,400}ttsState = 2/.test(java));
step('Java: 失败回调 Web 的 __inkTtsUnavailable', /window\.__inkTtsUnavailable && window\.__inkTtsUnavailable\(\)/.test(java));
step('Java: 移除旧的「本机语音引擎不可用」卡死提示', !/本机语音引擎不可用/.test(java));

// ---- JS 源码级断言 ----
const plus = fs.readFileSync(path.join(ROOT, 'js/plus.js'), 'utf8');
step('JS: nativeTts() 检查 ttsStatus()===2 视为不可用',
  plus.includes('b.ttsStatus') && plus.includes('=== 2') && /nativeTts\(\)[\s\S]{0,300}return null/.test(plus));
step('JS: 定义 __inkTtsUnavailable 回退', /window\.__inkTtsUnavailable = \(\) =>/.test(plus));
step('JS: 回退时用 Web Speech 读当前文本', /window\.__inkTtsUnavailable[\s\S]{0,400}new SpeechSynthesisUtterance\(text\)/.test(plus));
step('JS: 提示为可操作引导（去系统设置装语音包）', /文字转语音.*安装中文语音包/.test(plus));
step('JS: speakText 记录 ttsCurrentText 供回退', /ttsCurrentText = clean/.test(plus));

// ---- 运行时断言：模拟原生桥状态2 + Web Speech 可用 ----
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 412, height: 892 });
await page.evaluateOnNewDocument(() => {
  try {
    const s = JSON.parse(localStorage.getItem('inkreader:settings') || '{}');
    s.pageFlip = false; localStorage.setItem('inkreader:settings', JSON.stringify(s));
    sessionStorage.setItem('sw-reloaded', '1');
  } catch (e) {}
  // 模拟一个「桥存在但引擎不可用」的原生环境
  window.__ttsCalls = [];
  window.__ttsToasts = [];
  window.InkTools = {
    ttsStatus() { return 2; },
    speak(text, rate) { window.__ttsCalls.push({ via: 'native', text, rate }); },
    stopSpeak() {},
  };
  // 桩 Web Speech，记录被朗读的文本
  window.__webSpeaks = [];
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text; this.lang = ''; this.rate = 1;
  };
  // speechSynthesis 在 Chrome 里是只读 getter，必须 defineProperty 才能替换
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak(u) { window.__webSpeaks.push(u.text); },
      cancel() {},
      paused: false, resume() {}, pause() {},
    },
  });
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

  // 选中朗读：原生状态2 → 应直接走 Web Speech，不调原生 speak
  const sel = await page.evaluate((t) => {
    const root = document.querySelector('#page');
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(t);
      if (i >= 0) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + t.length);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, SPEAK_TEXT);
  await wait(160);
  await page.evaluate(() => document.querySelector('#sel-speak').click());
  await wait(220);
  const state1 = await page.evaluate(() => ({
    native: window.__ttsCalls.slice(),
    web: window.__webSpeaks.slice(),
    bar: !document.querySelector('#plus-ttsbar').classList.contains('hidden'),
  }));
  step('运行时: 选中成功且工具条朗读可点', sel);
  step('运行时: 原生状态2时不调原生 speak', state1.native.length === 0, state1.native);
  step('运行时: 回退到 Web Speech 且读的是选中文字', state1.web.length === 1 && state1.web[0] === SPEAK_TEXT, state1.web);
  step('运行时: 朗读条仍显示', state1.bar === true, { bar: state1.bar });

  // 模拟原生异步回调 unavailable（会走 __inkTtsUnavailable 分支）
  await page.evaluate(() => { window.__webSpeaks.length = 0; window.__inkTtsUnavailable && window.__inkTtsUnavailable(); });
  await wait(180);
  const state2 = await page.evaluate(() => ({ web: window.__webSpeaks.slice() }));
  step('运行时: __inkTtsUnavailable 用 ttsCurrentText 切 Web Speech', state2.web.length === 1 && state2.web[0] === SPEAK_TEXT, state2.web);

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
