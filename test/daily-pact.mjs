// 每日契约 / 每日阅读提醒回归（node test/daily-pact.mjs）
// 覆盖：① streak / 今日分钟纯函数 ② 源码接线（SW / 法律文案 / 版本 / 插件）
//       ③ 浏览器内卡片渲染 + 通知权限/通道/排程/取消/测试通知 + 无插件降级
import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('www');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pact = await import(new URL('../www/js/daily-pact.js', import.meta.url));

let passed = 0, failed = 0;
const fails = [];
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); console.log('  ✗ ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))); }
}

// ---------------- ① 纯函数 ----------------
console.log('\n① 连续天数 / 今日时长');
const D = (y, m, d) => new Date(y, m - 1, d);
const mk = (day, checkin, mins) => ({ checkin, byBook: { a: mins * 60000 } });
check('今日已打卡：连续天数含今天', pact.currentStreak({
  '2026-11-25': mk('x', true, 12), '2026-11-24': mk('x', true, 12), '2026-11-23': mk('x', false, 5),
}, D(2026, 11, 25)) === 2);
check('今日未打卡：从昨天往前数，不误伤当天', pact.currentStreak({
  '2026-11-25': mk('x', false, 3), '2026-11-24': mk('x', true, 12), '2026-11-23': mk('x', true, 12), '2026-11-22': mk('x', false, 1),
}, D(2026, 11, 25)) === 2);
check('完全无打卡返回 0', pact.currentStreak({}, D(2026, 11, 25)) === 0);
check('空统计 / 空 byBook 今日分钟为 0', pact.todayMinutes({}, D(2026, 11, 25)) === 0);
check('今日分钟按 byBook 求和并向下取整', pact.todayMinutes({
  '2026-11-25': { byBook: { a: 600000, b: 300000, c: 59999 } },
}, D(2026, 11, 25)) === 15);
check('无效数字不产生 NaN', pact.todayMinutes({ '2026-11-25': { byBook: { a: 'x', b: null } } }, D(2026, 11, 25)) === 0);
check('时间解析：合法 / 越界 / 缺秒均正确处理', !!pact.parseTime('21:00') && !!pact.parseTime('7:05') && !pact.parseTime('24:00') && !pact.parseTime('12:60') && !pact.parseTime('abc'));
check('过点时间顺延到明天', pact.nextAt({ h: 21, min: 0 }, new Date(2026, 10, 25, 22, 0, 0)).getDate() === 26);
check('未到点时间保持今天', pact.nextAt({ h: 23, min: 0 }, new Date(2026, 10, 25, 20, 0, 0)).getDate() === 25);

// ---------------- ② 源码接线 ----------------
console.log('\n② 源码接线 / 缓存 / 法律口径');
const app = read('js/app.js');
const sw = read('sw.js');
const store = read('js/store.js');
const html = read('index.html');
const docsLegal = fs.readFileSync(path.join('docs', 'legal.html'), 'utf8');
const siteLegal = fs.readFileSync(path.join('site', 'legal.html'), 'utf8');
const gate = read('js/release-gate.js');
const privacy = read('js/privacy-consent.js');
const gradle = fs.readFileSync(path.join('android', 'app', 'build.gradle'), 'utf8');
const assets = (sw.match(/const ASSETS = \[([\s\S]*?)\];/) || [])[1] || '';
const reuse = (sw.match(/const REUSE = \[([\s\S]*?)\]\.concat\(VENDOR\)/) || [])[1] || '';
const cv = Number((sw.match(/const CACHE = 'inkreader-v(\d+)'/) || [])[1]);
const pv = Number((sw.match(/const PREV_CACHE = 'inkreader-v(\d+)'/) || [])[1]);
check('SW CACHE≥v29 且 PREV 为上一代', cv >= 29 && pv === cv - 1, { cv, pv });
check('新文件 daily-pact.js / daily-pact.css 在 ASSETS 且不在 REUSE', assets.includes('js/daily-pact.js') && assets.includes('css/daily-pact.css') && !reuse.includes('js/daily-pact') && !reuse.includes('css/daily-pact'));
const reuseCode = reuse.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
check('变更的 store.js 已从 REUSE 摘出（仍在 ASSETS）', assets.includes('js/store.js') && !reuseCode.includes('js/store.js'));
check('app.js 静态 import 并挂载 mountDailyPact', /import \{ mountDailyPact \}/.test(app) && /createDailyPactLayer\(\)/.test(app) && /window\.__INK_PACT/.test(app));
check('index.html 有契约 slot 与独立样式', /id="daily-pact-slot"/.test(html) && /css\/daily-pact\.css/.test(html));
check('设置页有提醒开关 / 时间 / 测试入口', /id="set-reminder"/.test(html) && /id="set-reminder-time"/.test(html) && /id="set-reminder-test"/.test(html));
check('store.js 默认提醒关闭、时间 21:00 / 12:30', /reminderEnabled: false/.test(store) && /reminderTime: '21:00'/.test(store) && /reminderSecondTime: '12:30'/.test(store));
check('五份法律文案口径一致：均含本地提醒说明', /本地阅读提醒/.test(app) && /本地阅读提醒/.test(docsLegal) && /本地阅读提醒/.test(siteLegal));
check('三份权限说明均声明 POST_NOTIFICATIONS', /POST_NOTIFICATIONS/.test(app) && /POST_NOTIFICATIONS/.test(docsLegal) && /POST_NOTIFICATIONS/.test(siteLegal));
check('送审注入说明补充纯本机通知', /纯本机系统通知/.test(gate));
check('隐私政策版本已 +1', /POLICY_VERSION = '2'/.test(privacy));
check('版本升级到 40 / 1.5.5', /versionCode 40/.test(gradle) && /versionName "1\.5\.5"/.test(gradle));
check('法律文案无「第三方 API Key / 遥测」肯定式残留', !/支持配置第三方 API Key/.test(app + docsLegal + siteLegal) && !/进行遥测上报/.test(app + docsLegal + siteLegal));

// ---------------- ③ 浏览器行为 ----------------
console.log('\n③ 浏览器内契约卡片与通知排程');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
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
const BASE = `http://localhost:${server.address().port}/?skipPrivacy=1`;
const browser = await puppeteer.launch({
  executablePath: (process.env.INK_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'),
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 412, height: 892 });
  page.on('pageerror', (e) => errors.push(String(e)));
  // 注入 mock 原生插件：所有调用记到 window.__calls，便于逐条断言
  await page.evaluateOnNewDocument(() => {
    window.__calls = [];
    window.Capacitor = {
      Plugins: {
        LocalNotifications: {
          checkPermissions: async () => ({ display: 'prompt' }),
          requestPermissions: async () => { window.__calls.push(['request']); return { display: 'granted' }; },
          createChannel: async (o) => { window.__calls.push(['channel', o]); },
          cancel: async (o) => { window.__calls.push(['cancel', o]); },
          schedule: async (o) => { window.__calls.push(['schedule', o]); },
          addListener: (name, cb) => { window.__tapListener = cb; },
        },
      },
    };
    try {
      localStorage.setItem('inkreader:stats', JSON.stringify({
        [new Date().toISOString().slice(0, 10)]: { checkin: false, byBook: { a: 3 * 60000 } },
      }));
    } catch (e) {}
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__INK_PACT, { timeout: 10000 });

  check('书架今日契约卡片已渲染', await page.$('.pact-card') !== null);
  const head = await page.$eval('.pact-top strong', (n) => n.textContent);
  check('未打卡时提示「别断在今天」', /别断在今天|今天还没读/.test(head), { head });
  const cnt = await page.$eval('[data-pact="count"]', (n) => n.textContent);
  check('今日进度读取现有统计（3/10 分）', /3\/10/.test(cnt), { cnt });
  check('无致命页面错误', errors.length === 0, errors.slice(0, 3));

  await page.click('[data-view="settings"]');
  await page.waitForSelector('#set-reminder');
  check('提醒设置区默认收起时间字段', await page.$eval('#reminder-fields', (n) => n.classList.contains('hidden')));
  await page.click('#set-reminder');
  await wait(250);
  const calls = await page.evaluate(() => window.__calls);
  check('开启时申请通知权限', calls.some((c) => c[0] === 'request'));
  check('开启时创建本机通知通道', calls.some((c) => c[0] === 'channel' && c[1].id === 'inkreader-daily-pact'));
  const scheduled = calls.filter((c) => c[0] === 'schedule').pop();
  check('主提醒按 21:00 排程且为每日重复', scheduled && scheduled[1].notifications[0].id === 2101 && scheduled[1].notifications[0].schedule.repeats === true && scheduled[1].notifications[0].schedule.every === 'day', scheduled && scheduled[1].notifications[0]);
  check('通知文案不含书籍内容且提示点击续读', scheduled && /点这条直接接着读/.test(scheduled[1].notifications[0].body));
  check('时间字段随开关展开', !(await page.$eval('#reminder-fields', (n) => n.classList.contains('hidden'))));

  await page.click('#set-reminder-second');
  await wait(200);
  const two = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'schedule').pop());
  check('午间补一次后同时排程两条固定 ID', two && two[1].notifications.length === 2 && two[1].notifications.some((n) => n.id === 2102), two && two[1].notifications.map((n) => n.id));

  const doneOk = await page.evaluate(() => window.__INK_PACT.notifyDone());
  await wait(150);
  const doneCall = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'schedule').pop());
  check('打卡正反馈通知可发出（ID 2104）', doneOk && doneCall && doneCall[1].notifications[0].id === 2104 && /读够|连续/.test(doneCall[1].notifications[0].body), { doneOk, call: doneCall && doneCall[1].notifications[0] });

  await page.click('#set-reminder-test');
  await wait(200);
  const testCall = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'schedule').pop());
  check('测试通知可立即发出（ID 2103）', testCall && testCall[1].notifications[0].id === 2103);

  await page.click('#set-reminder');
  await wait(200);
  const cancelled = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'cancel').pop());
  check('关闭时清掉两条排程', cancelled && cancelled[1].notifications.length === 2 && cancelled[1].notifications.some((n) => n.id === 2101));

  // 无插件降级：新页面不注入 Capacitor，卡片仍可用且不会抛错
  const page2 = await ctx.newPage();
  const errors2 = [];
  page2.on('pageerror', (e) => errors2.push(String(e)));
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction(() => !!window.__INK_PACT, { timeout: 10000 });
  check('无插件环境卡片仍渲染', await page2.$('.pact-card') !== null);
  check('无插件环境无致命错误', errors2.length === 0, errors2.slice(0, 3));
  const sub2 = await page2.$eval('[data-pact="sub"]', (n) => n.textContent);
  check('无插件环境明确提示降级', /没有系统通知/.test(sub2), { sub2 });
} finally {
  await browser.close();
  server.close();
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed) { console.log('失败项：\n  - ' + fails.join('\n  - ')); process.exit(1); }
