/* leadday — mobile-first board on the tested leadday logic. Data: on-device only. */
const L = window.leadday;
const STORE_KEY = 'leadday.tasks.v1';

const SPRINTS = [
  { key: 'URGENT',   label: 'Urgent',    emoji: '🔥' },
  { key: 'DEADLINE', label: 'Deadlines', emoji: '⏰' },
  { key: 'ADMIN',    label: 'Admin',     emoji: '🗂️' },
  { key: 'CREATIVE', label: 'Creative',  emoji: '🎨' },
];
const SPRINT_LABEL = Object.fromEntries(SPRINTS.map((s) => [s.key, s]));

const URG = {
  PAST_DUE:          { card: 'u-past',     badge: 'b-past',     label: 'Past Due',     icon: '🔴' },
  DUE_TODAY:         { card: 'u-today',    badge: 'b-today',    label: 'Due Today',    icon: '🟡' },
  DUE_TOMORROW:      { card: 'u-tomorrow', badge: 'b-tomorrow', label: 'Due Tomorrow', icon: '🟠' },
  BETTER_START_SOON: { card: 'u-soon',     badge: 'b-soon',     label: 'Start Soon',   icon: '🟠' },
  ON_TRACK:          { card: '',           badge: 'b-track',    label: 'On Track',     icon: '✅' },
  DONE:              { card: 'u-done',     badge: 'b-done',     label: 'Done',         icon: '☑️' },
};

let TASKS = load();
let nav = 'tasks';        // 'home' | 'tasks'
let chip = 'today';       // 'today' | sprint key

function load() {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  const seed = seedTasks();
  localStorage.setItem(STORE_KEY, JSON.stringify(seed));
  return seed;
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(TASKS)); }
function uid() { return 'id' + Math.random().toString(36).slice(2, 10); }

function seedTasks() {
  const P = 'Kaizen 2.0 Launch';
  const t = (o) => Object.assign({ id: uid(), project: P, depends_on: null, actual_minutes: null, template_task: P, priority: 'Must Do', status: 'todo' }, o);
  return [
    t({ name: 'Film the going-over template video for the landing page', sprint: 'URGENT', estimated_minutes: 60, status: 'in_progress', final_deadline: '2026-06-29', lead_days: 5 }),
    t({ name: 'Send the LP loom video to edit', sprint: 'URGENT', estimated_minutes: 90, final_deadline: '2026-06-29', lead_days: 5 }),
    t({ name: 'Set up the Discord', sprint: 'DEADLINE', estimated_minutes: 90, final_deadline: '2026-06-29', lead_days: 4 }),
    t({ name: 'Film the VSL', sprint: 'DEADLINE', estimated_minutes: 45, final_deadline: '2026-06-30', lead_days: 4 }),
    t({ name: 'Record lessons', sprint: 'DEADLINE', estimated_minutes: 180, final_deadline: '2026-06-30', lead_days: 5 }),
    t({ name: 'Edit the lessons on Loom', sprint: 'ADMIN', estimated_minutes: 180, final_deadline: '2026-06-29', lead_days: 4 }),
    t({ name: 'Edit the VSL', sprint: 'ADMIN', estimated_minutes: 45, final_deadline: '2026-06-30', lead_days: 5 }),
    t({ name: 'Daily 1 short creation challenge', sprint: 'ADMIN', estimated_minutes: 60, priority: 'Should Do', final_deadline: '2026-06-29', lead_days: 2 }),
    t({ name: 'Reply to Roxi and reschedule', sprint: 'CREATIVE', estimated_minutes: 30, final_deadline: '2026-06-29', lead_days: 4 }),
    t({ name: 'Switch email marketing to a new tool', sprint: 'CREATIVE', estimated_minutes: 30, final_deadline: '2026-07-12', lead_days: 0 }),
  ];
}

/* derived */
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function autoDate(t) { return L.autoDeadline(new Date(t.final_deadline + 'T00:00:00'), t.lead_days); }
function urgencyOf(t) { return L.urgency(autoDate(t), today(), t.status); }
function daysOf(t) { return L.daysLeft(autoDate(t), today()); }
function openTasks() { return TASKS.filter((t) => t.status !== 'done'); }

/* rendering */
const root = document.getElementById('app');

function card(t, showSprint) {
  const u = URG[urgencyOf(t)];
  const sp = SPRINT_LABEL[t.sprint];
  const priCls = t.priority === 'Must Do' ? 'pri-must' : 'pri-should';
  const priIcon = t.priority === 'Must Do' ? '🔥' : '📌';
  return `<div class="card ${u.card}">
    <input type="checkbox" class="check" ${t.status === 'done' ? 'checked' : ''} data-toggle="${t.id}" aria-label="Done">
    <div class="body">
      <div class="card-title">${esc(t.name)}</div>
      <div class="meta">
        <span class="badge ${u.badge}">${u.icon} ${u.label}</span>
        ${showSprint ? `<span class="tag">${sp.emoji} ${sp.label}</span>` : ''}
        <span class="tag">⏱ ${t.estimated_minutes}m</span>
        <span class="sub-badge ${priCls}">${priIcon} ${t.priority}</span>
      </div>
    </div>
  </div>`;
}

function renderTasks() {
  const open = openTasks();
  const chips = [`<button class="chip ${chip === 'today' ? 'active' : ''}" data-chip="today">⭐ Today <span class="ct">${open.length}</span></button>`]
    .concat(SPRINTS.map((s) => {
      const n = open.filter((t) => t.sprint === s.key).length;
      const info = L.sprintLoad(open)[s.key];
      return `<button class="chip ${chip === s.key ? 'active' : ''} ${info && info.over ? 'over' : ''}" data-chip="${s.key}">${s.emoji} ${s.label} <span class="ct">${n}</span></button>`;
    })).join('');

  let list, capLine = '';
  if (chip === 'today') {
    const items = open.slice().sort((a, b) => daysOf(a) - daysOf(b));
    list = items.length ? items.map((t) => card(t, true)).join('')
      : `<div class="empty"><div class="big">🌤️</div>Nothing pressing. Breathe.</div>`;
  } else {
    const items = TASKS.filter((t) => t.sprint === chip).sort((a, b) => daysOf(a) - daysOf(b));
    const info = L.sprintLoad(open)[chip];
    const sum = info ? info.sum : 0;
    capLine = `<div class="cap-line">Sprint load <span class="cap-pill ${sum > L.SPRINT_MAX ? 'over' : 'ok'}">${sum}/${L.SPRINT_MAX} min${sum > L.SPRINT_MAX ? ' · over cap ⚠' : ''}</span></div>`;
    list = items.length ? items.map((t) => card(t, false)).join('')
      : `<div class="empty"><div class="big">➕</div>No tasks here yet.</div>`;
  }
  return `<div class="chips">${chips}</div><div class="wrap">${capLine}<div class="cards">${list}</div></div>`;
}

function renderHome() {
  const open = openTasks();
  const past = open.filter((t) => urgencyOf(t) === 'PAST_DUE').length;
  const soon = open.filter((t) => ['DUE_TODAY', 'DUE_TOMORROW', 'BETTER_START_SOON'].includes(urgencyOf(t))).length;
  const focus = open.slice().sort((a, b) => daysOf(a) - daysOf(b)).slice(0, 4);
  return `<div class="wrap">
    <div class="callout green"><span>🌱</span><div><h3>Your Kaizen system</h3><p>Work backwards from deadlines so you start early instead of cramming. One small step at a time.</p></div></div>
    <div class="stats">
      <div class="stat ${past ? 'warn' : ''}"><div class="n">${past}</div><div class="l">Past due</div></div>
      <div class="stat"><div class="n">${soon}</div><div class="l">Due soon</div></div>
      <div class="stat"><div class="n">${open.length}</div><div class="l">Open</div></div>
    </div>
    <div class="section-h">Focus now</div>
    <div class="cards">${focus.length ? focus.map((t) => card(t, true)).join('') : `<div class="empty"><div class="big">✅</div>All clear.</div>`}</div>
  </div>`;
}

function render() {
  root.innerHTML = `
    <div class="topbar"><h1>🗂️ ${nav === 'home' ? 'Home' : 'Tasks'}</h1><div class="sub">${dateLine()}</div></div>
    ${nav === 'home' ? renderHome() : renderTasks()}
    <button class="fab" id="fab">+</button>
    <nav class="nav">
      <button data-nav="home" class="${nav === 'home' ? 'active' : ''}"><span class="ic">🏠</span>Home</button>
      <button data-nav="tasks" class="${nav === 'tasks' ? 'active' : ''}"><span class="ic">📋</span>Tasks</button>
    </nav>`;
}
function dateLine() {
  const d = today();
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/* interactions */
document.addEventListener('click', (e) => {
  const nb = e.target.closest('[data-nav]'); if (nb) { nav = nb.dataset.nav; render(); return; }
  const cb = e.target.closest('[data-chip]'); if (cb) { chip = cb.dataset.chip; render(); return; }
  if (e.target.id === 'fab') { openSheet(); return; }
});
document.addEventListener('change', (e) => {
  const id = e.target.dataset && e.target.dataset.toggle; if (!id) return;
  const t = TASKS.find((x) => x.id === id); t.status = e.target.checked ? 'done' : 'todo'; save(); render();
});

/* add sheet */
function openSheet() {
  document.getElementById('sheet-bg').classList.add('open');
  document.getElementById('sheet').classList.add('open');
  document.getElementById('f-name').value = '';
  document.getElementById('f-sprint').value = (chip !== 'today' ? chip : 'URGENT');
  const d = today(); d.setDate(d.getDate() + 7);
  document.getElementById('f-deadline').value = d.toISOString().slice(0, 10);
  document.getElementById('f-lead').value = 2;
  document.getElementById('f-est').value = 30;
  setTimeout(() => document.getElementById('f-name').focus(), 60);
}
function closeSheet() {
  document.getElementById('sheet').classList.remove('open');
  document.getElementById('sheet-bg').classList.remove('open');
}
function bind() {
  document.getElementById('f-cancel').onclick = closeSheet;
  document.getElementById('sheet-bg').onclick = closeSheet;
  document.getElementById('f-save').onclick = () => {
    const name = document.getElementById('f-name').value.trim();
    if (!name) { document.getElementById('f-name').focus(); return; }
    TASKS.push({
      id: uid(), name, project: 'Kaizen 2.0 Launch', template_task: 'Kaizen 2.0 Launch', depends_on: null,
      sprint: document.getElementById('f-sprint').value,
      final_deadline: document.getElementById('f-deadline').value,
      lead_days: Number(document.getElementById('f-lead').value) || 0,
      estimated_minutes: Number(document.getElementById('f-est').value) || 0,
      actual_minutes: null, priority: document.getElementById('f-pri').value, status: 'todo',
    });
    save(); closeSheet();
    if (nav === 'tasks' && chip !== 'today') chip = document.getElementById('f-sprint').value;
    render();
  };
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

bind();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
