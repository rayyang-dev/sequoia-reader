// 统一工具面板（hub）—— 把阅读器里分散的 5 套面板入口收敛为一个带文字的「工具」按钮。
// 设计目标：一眼看懂、功能集中。只调用 app.js 暴露的 window.__INK_HUB API，不改任何现有业务逻辑。
// 零污染可回退：不加载本模块即恢复原 pro/plus/nexus 图标入口（见底部 note）。
// 依赖：app.js 在初始化后挂 window.__INK_HUB；pro/plus/nexus 已把各自入口按钮追加到 #pro-chip。

const TABS = [
  { id: 'toc', label: '目录', icon: '☰' },
  { id: 'mark', label: '书签', icon: '🔖' },
  { id: 'display', label: '显示', icon: 'Aa' },
  { id: 'read', label: '朗读', icon: '🔊' },
  { id: 'flip', label: '翻页', icon: '⇄' },
  { id: 'stats', label: '统计', icon: '◔' },
];

const THEMES = [
  { id: 'ink', label: '墨水' }, { id: 'paper', label: '简约' },
  { id: 'night', label: '夜览' }, { id: 'sepia', label: '米黄' },
];

function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('data-')) n.setAttribute(k, v);
    else n.setAttribute(k, v);
  }
  if (children) (Array.isArray(children) ? children : [children]).forEach((c) => c && n.appendChild(c));
  return n;
}

export function mountHub() {
  const HUB = () => window.__INK_HUB;
  let open = false;
  let activeTab = 'toc';
  let ttsTimer = null;

  // ---------- 1. 统一入口：收拢 pro-chip 图标，插入带文字的「工具」按钮 ----------
  function unifyChip() {
    const chip = document.getElementById('pro-chip');
    if (!chip) return;
    // 隐藏分散的图标入口；保留百分比与返回（它们是信息/返回，不是"工具标识"）。
    ['pro-aa', 'pro-auto', 'plus-entry', 'nx-chip-open'].forEach((id) => {
      const b = document.getElementById(id);
      if (b) b.classList.add('hub-swallowed');
    });
    if (document.getElementById('hub-entry')) return;
    const entry = el('button', {
      id: 'hub-entry', class: 'hub-entry', type: 'button',
      'aria-label': '打开工具面板', title: '工具（目录 · 排版 · 朗读 · 设置）',
    });
    entry.innerHTML = '<span class="hub-entry-ico">☰</span><span class="hub-entry-txt">工具</span>';
    entry.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
    chip.insertBefore(entry, chip.firstChild);
  }

  // ---------- 2. 统一面板 DOM ----------
  function buildPanel() {
    const root = el('div', { id: 'hub-root' });
    const mask = el('div', { id: 'hub-mask' });
    const panel = el('div', { id: 'hub-panel', role: 'dialog', 'aria-label': '工具面板' });

    const head = el('div', { class: 'hub-head' });
    head.appendChild(el('strong', { text: '工具' }));
    const close = el('button', { class: 'hub-close', type: 'button', 'aria-label': '关闭', text: '✕' });
    close.addEventListener('click', () => setOpen(false));
    head.appendChild(close);
    panel.appendChild(head);

    const tabs = el('div', { class: 'hub-tabs' });
    const body = el('div', { class: 'hub-body' });
    TABS.forEach((t) => {
      const b = el('button', {
        class: 'hub-tab', type: 'button', 'data-tab': t.id,
        'aria-label': t.label,
      });
      b.innerHTML = `<span class="hub-tab-ico">${t.icon}</span><span class="hub-tab-label">${t.label}</span>`;
      b.addEventListener('click', () => switchTab(t.id));
      tabs.appendChild(b);
    });
    panel.appendChild(tabs);
    panel.appendChild(body);
    root.appendChild(mask);
    root.appendChild(panel);
    document.body.appendChild(root);

    mask.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });
  }

  function switchTab(id) {
    activeTab = id;
    document.querySelectorAll('.hub-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    renderBody();
  }

  function renderBody() {
    const body = document.querySelector('#hub-panel .hub-body');
    if (!body) return;
    body.innerHTML = '';
    const h = HUB();
    if (!h || !h.isReading()) {
      body.appendChild(el('p', { class: 'hub-empty', text: '打开一本书后即可使用工具' }));
      return;
    }
    if (activeTab === 'toc') renderToc(body, h);
    else if (activeTab === 'mark') renderMarks(body, h);
    else if (activeTab === 'display') renderDisplay(body, h);
    else if (activeTab === 'read') renderRead(body, h);
    else if (activeTab === 'flip') renderFlip(body, h);
    else if (activeTab === 'stats') renderStats(body, h);
  }

  // ---------- 分类内容 ----------
  function section(title, hint) {
    const s = el('div', { class: 'hub-sec' });
    s.appendChild(el('h4', { text: title }));
    if (hint) s.appendChild(el('p', { class: 'hub-hint', text: hint }));
    return s;
  }
  function row(label, control) {
    const r = el('div', { class: 'hub-row' });
    r.appendChild(el('span', { class: 'hub-row-label', text: label }));
    r.appendChild(control);
    return r;
  }
  function stepper(label, value, min, max, step, fmt, onSet) {
    const ctl = el('div', { class: 'hub-stepper' });
    const minus = el('button', { type: 'button', 'aria-label': '减小 ' + label, text: '−' });
    const val = el('span', { class: 'hub-stepper-val', text: fmt(value) });
    const plus = el('button', { type: 'button', 'aria-label': '增大 ' + label, text: '＋' });
    minus.addEventListener('click', () => { const v = clamp(value - step, min, max); value = v; val.textContent = fmt(v); onSet(v); });
    plus.addEventListener('click', () => { const v = clamp(value + step, min, max); value = v; val.textContent = fmt(v); onSet(v); });
    ctl.appendChild(minus); ctl.appendChild(val); ctl.appendChild(plus);
    return { row: row(label, ctl), ctl };
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, Math.round(v * 100) / 100)); }

  function renderToc(body, h) {
    const p = h.progress();
    const s = section('目录', `共 ${p ? p.chapters : 0} 章 · 点章名直达`);
    h.chapters().forEach((c) => {
      const b = el('button', { type: 'button', class: 'hub-item' + (p && c.i === p.ci ? ' active' : '') });
      b.textContent = c.label;
      b.addEventListener('click', () => { h.goChapter(c.i); setOpen(false); });
      s.appendChild(b);
    });
    body.appendChild(s);
  }

  function renderMarks(body, h) {
    const s = section('书签', '记录当前位置，点书签跳回');
    const add = el('button', { type: 'button', class: 'hub-primary', text: '＋ 标记当前页' });
    add.addEventListener('click', () => {
      if (h.addBookmarkHere()) { h.toast('已添加书签'); renderBody(); }
    });
    s.appendChild(add);
    const list = h.bookmarks();
    if (!list.length) s.appendChild(el('p', { class: 'hub-empty', text: '暂无书签' }));
    list.forEach((bm, idx) => {
      const r = el('div', { class: 'hub-item-row' });
      const jump = el('button', { type: 'button', class: 'hub-item', text: bm.label || `第${bm.ci + 1}章·第${bm.pi + 1}页` });
      jump.addEventListener('click', () => { h.goBookmark(bm); setOpen(false); });
      const del = el('button', { type: 'button', class: 'hub-item-del', 'aria-label': '删除书签', text: '删' });
      del.addEventListener('click', () => { h.removeBookmark(idx); renderBody(); });
      r.appendChild(jump); r.appendChild(del);
      s.appendChild(r);
    });
    body.appendChild(s);
  }

  function renderDisplay(body, h) {
    const L = h.layout();
    const s = section('显示排版', '改动会按当前位置重新分页');
    body.appendChild(s);
    s.appendChild(stepper('字号', L.fontSize, 14, 34, 1, (v) => v + 'px', (v) => h.setLayout('fontSize', v)).row);
    s.appendChild(stepper('行距', L.lineHeight, 1.2, 2.4, 0.05, (v) => v.toFixed(2), (v) => h.setLayout('lineHeight', v)).row);
    s.appendChild(stepper('边距', L.margin, 8, 40, 2, (v) => v + 'px', (v) => h.setLayout('margin', v)).row);
    const th = el('div', { class: 'hub-seg' });
    THEMES.forEach((t) => {
      const b = el('button', { type: 'button', class: L.theme === t.id ? 'active' : '', text: t.label });
      b.addEventListener('click', () => { h.setLayout('theme', t.id); renderBody(); });
      th.appendChild(b);
    });
    s.appendChild(row('主题', th));
  }

  function renderRead(body, h) {
    const s = section('朗读', '播放本页会读完自动续页；选中文字朗读读完即停');
    const ctl = el('div', { class: 'hub-btn-grid' });
    const play = el('button', { type: 'button', class: 'hub-primary', text: '▶ 播放本页' });
    play.addEventListener('click', () => { h.tts.speak(); syncTtsState(s, h); });
    const stop = el('button', { type: 'button', class: 'hub-secondary', text: '■ 停止' });
    stop.addEventListener('click', () => { h.tts.stop(); syncTtsState(s, h); });
    ctl.appendChild(play); ctl.appendChild(stop);
    s.appendChild(ctl);
    const state = el('p', { class: 'hub-tts-state', text: h.tts.isOn() ? '朗读中' : '未朗读' });
    s.appendChild(state);
    s.dataset.ttsStateSlot = '1';
    body.appendChild(s);
    if (!ttsTimer) ttsTimer = setInterval(() => {
      if (!open) return;
      const slot = document.querySelector('#hub-panel [data-tts-state-slot]');
      if (slot) {
        const p = slot.querySelector('.hub-tts-state');
        if (p) p.textContent = HUB().tts.isOn() ? '朗读中' : '未朗读';
      }
    }, 500);
  }
  function syncTtsState(sectionEl, h) {
    const p = sectionEl && sectionEl.querySelector('.hub-tts-state');
    if (p) p.textContent = h.tts.isOn() ? '朗读中' : '未朗读';
  }

  function renderFlip(body, h) {
    const s = section('自动翻页', '朗读时避免同时开自动翻页，以免重复翻页');
    const seg = el('div', { class: 'hub-seg' });
    [{ id: 'off', label: '关闭' }, { id: 'timed', label: '定时' }, { id: 'adaptive', label: '跟节奏' }].forEach((m) => {
      const b = el('button', { type: 'button', text: m.label });
      b.addEventListener('click', () => { h.autoMode(m.id); h.toast('自动翻页：' + m.label); seg.querySelectorAll('button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); });
      seg.appendChild(b);
    });
    s.appendChild(row('模式', seg));
    const jump = section('进度跳转');
    const p = h.progress();
    const slider = el('input', { type: 'range', min: '0', max: '100', value: String(p ? Math.round(p.pct) : 0), class: 'hub-range' });
    slider.addEventListener('change', () => { h.goPercent(Number(slider.value)); setOpen(false); });
    jump.appendChild(row('位置', slider));
    body.appendChild(s); body.appendChild(jump);
  }

  function renderStats(body, h) {
    const s = section('阅读统计');
    const st = h.stats() || {};
    const today = st.todayMinutes != null ? st.todayMinutes : (st.days && st.days[0] && st.days[0].minutes);
    const grid = el('div', { class: 'hub-stats' });
    [
      ['今日时长', today != null ? today + ' 分' : '—'],
      ['累计天数', st.streak != null ? st.streak + ' 天' : '—'],
    ].forEach(([k, v]) => {
      const c = el('div', { class: 'hub-stat' });
      c.appendChild(el('strong', { text: String(v) }));
      c.appendChild(el('span', { text: k }));
      grid.appendChild(c);
    });
    s.appendChild(grid);
    const more = el('button', { type: 'button', class: 'hub-secondary', text: '查看完整统计 →' });
    more.addEventListener('click', () => {
      const nav = document.querySelector('[data-nav="stats"]');
      setOpen(false); if (nav) nav.click();
    });
    s.appendChild(more);
    body.appendChild(s);
  }

  // ---------- 3. 开关 ----------
  function setOpen(v) {
    open = !!v;
    const root = document.getElementById('hub-root');
    if (root) root.classList.toggle('hub-on', open);
    const entry = document.getElementById('hub-entry');
    if (entry) entry.classList.toggle('active', open);
    if (open) renderBody();
  }

  // ---------- 4. 挂载 ----------
  function boot() {
    buildPanel();
    unifyChip();
    // pro/plus/nexus 入口可能在 app 初始化后才追加到 #pro-chip，延迟再收拢一次
    setTimeout(unifyChip, 300);
    setTimeout(unifyChip, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return { setOpen, switchTab, _test: { TABS } };
}
