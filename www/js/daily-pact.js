/**
 * 每日契约（daily-pact）—— 红杉阅读的「别断在今天」反诱惑层。
 *
 * 它做三件事：
 *   1) 书架顶部常驻「今日契约」卡片：连续打卡天数 + 今日进度 + 一键回到上次读的书；
 *   2) 用 Capacitor 本地通知在固定时间发系统级提醒（纯本机，AlarmManager，不联网）；
 *   3) 通知点击后落一个本机标记，App 打开时直接续读，把「想起要读」到「真的在读」的摩擦压到一次点击。
 *
 * 零污染 / 可回退：
 *   - 独立 ESM 文件 + 独立 CSS，只有 app.js 里一行 import、一行挂载、几行 ctx 接线；
 *   - 删掉 import、挂载调用与 index.html 的 slot / CSS link 即完全恢复旧版；
 *   - 无插件（浏览器 / PWA / 插件未安装）、权限被拒一律静默降级，卡片与打卡逻辑照常可用。
 *   - 原生能力只走 window.Capacitor.Plugins.LocalNotifications，绝不裸导入 @capacitor/*。
 */
const PREFIX = 'inkreader:pact:';
const K_TAP = PREFIX + 'tap';           // 通知点击标记（{ at, id }）
const CHANNEL_ID = 'inkreader-daily-pact';
const MAIN_ID = 2101;                   // 固定 ID：每次重排都是覆盖，不会堆叠重复提醒
const SECOND_ID = 2102;
const IMPORTANCE_HIGH = 4;

let ctx = null;
let plugin = null;
let channelReady = false;
let timer = null;
let lastSignature = '';

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}
function getPlugin() {
  if (plugin) return plugin;
  try {
    const cap = window.Capacitor;
    plugin = (cap && cap.Plugins && cap.Plugins.LocalNotifications) || null;
  } catch (e) { plugin = null; }
  return plugin;
}

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function shiftDay(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** 今日累计分钟（从已有的 inkreader:stats 读，不新造一套数据） */
export function todayMinutes(stats, now) {
  const day = stats && stats[dateKey(now || new Date())];
  if (!day || !day.byBook) return 0;
  let ms = 0;
  for (const id in day.byBook) ms += Number(day.byBook[id]) || 0;
  return Math.floor(ms / 60000);
}

/** 连续打卡天数：今天没打卡时从昨天往前数，避免「今天还没结束就断了」的误伤 */
export function currentStreak(stats, now) {
  const ref = now || new Date();
  const todayDone = !!(stats && stats[dateKey(ref)] && stats[dateKey(ref)].checkin);
  let cursor = todayDone ? ref : shiftDay(ref, -1);
  let n = 0;
  for (let i = 0; i < 3660; i++) {
    const day = stats && stats[dateKey(cursor)];
    if (!day || !day.checkin) break;
    n++;
    cursor = shiftDay(cursor, -1);
  }
  return n;
}

function fill(el, id, text) {
  if (!el) return;
  const node = el.querySelector(`[data-pact="${id}"]`);
  if (node) node.textContent = text;
}

function renderCard() {
  const slot = document.getElementById('daily-pact-slot');
  if (!slot || !ctx) return;
  const settings = ctx.getSettings();
  const now = new Date();
  const stats = ctx.getStats() || {};
  const goal = Math.max(1, Number(settings.checkinGoalMin) || 10);
  const mins = todayMinutes(stats, now);
  const streak = currentStreak(stats, now);
  const done = mins >= goal;
  const pct = Math.min(100, Math.round((mins / goal) * 100));
  const enabled = !!settings.reminderEnabled;
  const available = !!getPlugin();

  const signature = [goal, mins, streak, done, enabled, available, settings.reminderTime, settings.reminderSecondEnabled, settings.reminderSecondTime].join('|');
  if (signature === lastSignature) return;
  lastSignature = signature;

  const head = done
    ? `今日已读 ${mins} 分钟 · 连续 ${streak} 天 ✓`
    : streak > 0
      ? `连续 ${streak} 天 · 别断在今天`
      : `今天还没读 · ${goal} 分钟就算赢`;
  const sub = done
    ? '已经达标了，想再多读一会儿也随时可以。'
    : available
      ? (enabled
        ? `每日提醒 ${settings.reminderTime}${settings.reminderSecondEnabled ? ` / ${settings.reminderSecondTime}` : ''} · 点通知直接续读`
        : '开启提醒后，到点会有系统通知叫你（纯本机，不联网）')
      : '当前环境没有系统通知，卡片进度照常可用';

  slot.innerHTML = `
    <div class="pact-card${done ? ' pact-done' : ''}" role="group" aria-label="今日阅读契约">
      <div class="pact-top">
        <strong data-pact="head"></strong>
        <span class="pact-count" data-pact="count"></span>
      </div>
      <div class="pact-track"><i class="pact-fill" style="width:${pct}%"></i></div>
      <p class="pact-sub" data-pact="sub"></p>
      <div class="pact-actions">
        <button type="button" class="pact-primary" data-pact-act="read">${done ? '继续读一会儿 →' : `读 ${goal} 分钟 →`}</button>
        <button type="button" class="pact-secondary" data-pact-act="settings">${enabled ? '改提醒' : '开启提醒'}</button>
      </div>
    </div>`;
  fill(slot, 'head', head);
  fill(slot, 'count', `${mins}/${goal} 分`);
  fill(slot, 'sub', sub);
  slot.querySelector('[data-pact-act="read"]').addEventListener('click', async () => {
    const id = await ctx.pickBook();
    if (!id) { ctx.showToast('先导入一本书，再来打卡吧'); return; }
    await ctx.openBook(id);
    ctx.showToast(done ? '继续读，随时可以退出' : '专注读一会儿，刷手机的事等读完再说');
  });
  slot.querySelector('[data-pact-act="settings"]').addEventListener('click', () => {
    ctx.showView('settings');
    const anchor = document.getElementById('settings-group-reminder');
    if (anchor) setTimeout(() => anchor.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  });
}

async function ensureChannel() {
  const api = getPlugin();
  if (!api || channelReady) return channelReady;
  try {
    await api.createChannel({
      id: CHANNEL_ID,
      name: '每日阅读提醒',
      description: '按你设定的时间提醒翻开书，纯本机触发，不联网',
      importance: IMPORTANCE_HIGH,
      vibration: true,
    });
    channelReady = true;
  } catch (e) { channelReady = false; }
  return channelReady;
}

/** 申请通知权限；被拒返回 false，调用方只提示一次，不反复骚扰 */
export async function prepare() {
  const api = getPlugin();
  if (!api) return false;
  try {
    let state = await api.checkPermissions();
    if (state && state.display === 'granted') return await ensureChannel();
    if (state && state.display === 'denied') return false;
    state = await api.requestPermissions();
    if (!state || state.display !== 'granted') return false;
    return await ensureChannel();
  } catch (e) { return false; }
}

export function parseTime(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, min };
}

export function nextAt(t, now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), t.h, t.min, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** 重排提醒：固定 ID 覆盖，不会因重复调用堆积；关闭时一次性清掉两条 */
export async function reschedule() {
  const api = getPlugin();
  if (!api) return false;
  const settings = ctx ? ctx.getSettings() : {};
  const jobs = [];
  try {
    await api.cancel({ notifications: [{ id: MAIN_ID }, { id: SECOND_ID }] });
    if (!settings.reminderEnabled) return true;
    if (!(await prepare())) return false;
    const now = new Date();
    const slots = [
      { id: MAIN_ID, time: settings.reminderTime },
      { id: SECOND_ID, time: settings.reminderSecondEnabled ? settings.reminderSecondTime : null },
    ];
    const notifications = [];
    for (const slot of slots) {
      const t = parseTime(slot.time);
      if (!slot.time || !t) continue;
      notifications.push({
        id: slot.id,
        title: '红杉阅读 · 今天读了吗？',
        body: '10 分钟就够，别断在今天。点这条直接接着读 →',
        channelId: CHANNEL_ID,
        autoCancel: true,
        schedule: { at: nextAt(t, now), repeats: true, every: 'day', allowWhileIdle: true },
        extra: { source: 'daily-pact', id: slot.id },
      });
    }
    if (!notifications.length) return true;
    try {
      await api.schedule({ notifications });
    } catch (e) {
      // 个别 ROM 不接受 repeats + allowWhileIdle 组合，降级为不带 allowWhileIdle 再试一次
      notifications.forEach((n) => { delete n.schedule.allowWhileIdle; });
      await api.schedule({ notifications });
    }
    return true;
  } catch (e) { return false; }
}

/**
 * 打卡达成时的正反馈通知（闭环的最后一环）：提醒 → 点开续读 → 读完确认。
 * 只在用户主动开启了每日提醒时发，每天最多一次（由 store 的 justCheckedIn 保证）。
 */
export async function notifyDone() {
  const api = getPlugin();
  const s = ctx ? ctx.getSettings() : null;
  if (!api || !s || !s.reminderEnabled) return false;
  if (!(await prepare())) return false;
  const stats = ctx.getStats() || {};
  const streak = currentStreak(stats);
  try {
    await api.schedule({
      notifications: [{
        id: 2104,
        title: '红杉阅读 · 今日打卡完成 ✓',
        body: streak > 0 ? `连续 ${streak} 天接上了，接下来做什么你自己说了算。` : '今天读够了，想再读一会儿也随时可以。',
        channelId: CHANNEL_ID,
        autoCancel: true,
        schedule: { at: new Date(Date.now() + 1000) },
        extra: { source: 'daily-pact', done: true },
      }],
    });
    return true;
  } catch (e) { return false; }
}

/** 立即发一条测试通知，方便用户/回归确认权限与通道都通了 */
export async function testNotification() {
  const api = getPlugin();
  if (!api) return false;
  if (!(await prepare())) return false;
  try {
    await api.schedule({
      notifications: [{
        id: 2103,
        title: '红杉阅读 · 提醒测试',
        body: '收到这条就说明每日提醒能正常弹出来了。',
        channelId: CHANNEL_ID,
        autoCancel: true,
        schedule: { at: new Date(Date.now() + 1000) },
        extra: { source: 'daily-pact', test: true },
      }],
    });
    return true;
  } catch (e) { return false; }
}

function consumeTap() {
  const tap = lsGet(K_TAP, null);
  if (!tap || !tap.at || Date.now() - tap.at > 5 * 60 * 1000) return;
  lsSet(K_TAP, null);
  // 冷启动时正文模块可能还没准备好，延迟一拍再打开，避免 openBook 与 init 竞态
  setTimeout(async () => {
    try {
      const id = await ctx.pickBook();
      if (id) { await ctx.openBook(id); ctx.showToast('接着上次的位置读吧'); }
    } catch (e) {}
  }, 300);
}

function bindSettingsUI() {
  const toggle = document.getElementById('set-reminder');
  const time = document.getElementById('set-reminder-time');
  const secondToggle = document.getElementById('set-reminder-second');
  const secondTime = document.getElementById('set-reminder-second-time');
  const testBtn = document.getElementById('set-reminder-test');
  if (!toggle || !time) return;

  function sync() {
    const s = ctx.getSettings();
    toggle.checked = !!s.reminderEnabled;
    time.value = s.reminderTime || '21:00';
    if (secondToggle) secondToggle.checked = !!s.reminderSecondEnabled;
    if (secondTime) secondTime.value = s.reminderSecondTime || '12:30';
    const box = document.getElementById('reminder-fields');
    if (box) box.classList.toggle('hidden', !s.reminderEnabled);
  }
  sync();

  toggle.addEventListener('change', async () => {
    const on = toggle.checked;
    if (on && !getPlugin()) {
      toggle.checked = false;
      ctx.showToast('当前环境不支持系统通知（需在 App 内使用）');
      return;
    }
    if (on && !(await prepare())) {
      toggle.checked = false;
      ctx.showToast('没有拿到通知权限，请在系统设置里允许通知');
      return;
    }
    ctx.setSettings({ reminderEnabled: on });
    await reschedule();
    sync(); lastSignature = ''; renderCard();
    ctx.showToast(on ? '每日提醒已开启' : '每日提醒已关闭');
  });
  time.addEventListener('change', async () => {
    if (!parseTime(time.value)) { ctx.showToast('时间格式应为 21:00'); sync(); return; }
    ctx.setSettings({ reminderTime: time.value });
    await reschedule(); lastSignature = ''; renderCard();
  });
  if (secondToggle) secondToggle.addEventListener('change', async () => {
    ctx.setSettings({ reminderSecondEnabled: secondToggle.checked });
    await reschedule(); sync(); lastSignature = ''; renderCard();
  });
  if (secondTime) secondTime.addEventListener('change', async () => {
    if (!parseTime(secondTime.value)) { ctx.showToast('时间格式应为 12:30'); sync(); return; }
    ctx.setSettings({ reminderSecondTime: secondTime.value });
    await reschedule(); lastSignature = ''; renderCard();
  });
  if (testBtn) testBtn.addEventListener('click', async () => {
    const ok = await testNotification();
    ctx.showToast(ok ? '测试通知已发出，1 秒后弹出' : '发送失败，请检查系统通知权限');
  });
}

/** 由 app.js 在 init 中调用一次；所有依赖通过 ctx 注入，不反向 import app.js */
export function mountDailyPact(injected) {
  ctx = injected;
  bindSettingsUI();
  renderCard();
  consumeTap();

  const api = getPlugin();
  if (api) {
    try {
      api.addListener('notificationActionPerformed', (evt) => {
        const extra = (evt && evt.notification && evt.notification.extra) || {};
        if (extra.source !== 'daily-pact' || extra.test) return;
        lsSet(K_TAP, { at: Date.now(), id: extra.id });
      });
    } catch (e) {}
  }

  // 只在书架可见时刷新进度，避免阅读热路径每秒操作 DOM
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    const shelf = document.getElementById('shelf');
    if (shelf && !shelf.classList.contains('hidden')) renderCard();
  }, 1000);

  return {
    refresh: () => { lastSignature = ''; renderCard(); },
    reschedule,
    prepare,
    notifyDone,
    testNotification,
    _test: {
      todayMinutes,
      currentStreak,
      parseTime,
      nextAt,
      renderCard,
      state: () => ({ goal: ctx.getSettings().checkinGoalMin, enabled: !!ctx.getSettings().reminderEnabled, available: !!getPlugin() }),
    },
  };
}
