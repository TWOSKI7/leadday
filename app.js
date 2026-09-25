/* ChainPulse — Robinhood Chain winners, browser-only (HoodScan public APIs). */
const HS = 'https://hoodscan.co';
const MCP = HS + '/mcp';

const SCENARIOS = [
  { id: 'all_winners', label: 'All winners', blurb: 'Winning wallets · bots off · pace capped' },
  { id: 'conviction', label: 'Conviction', blurb: 'Multi-token · low pace · longer holds' },
  { id: 'swing', label: 'Swing', blurb: 'Hours-to-day holds' },
  { id: 'consistent', label: 'Multi-coin', blurb: '3+ tokens · win-rate floor' },
  { id: 'sized', label: 'Sized', blurb: 'Higher volume' },
  { id: 'early', label: 'Selective', blurb: 'Swing · score sort' },
  { id: 'fresh', label: 'Fresh', blurb: 'New opens still green' },
];

const LABEL_KEY = 'chainpulse.labels.v1';
const LABEL_SUGGESTIONS = ['conviction', 'swing', 'early-runner', 'sized', 'cluster', 'watch', 'avoid'];

let scenario = 'all_winners';
let tab = 'winners';
let items = [];
let clusters = [];
let tokens = [];
let detail = null;
let selected = null;
let loading = false;
let error = null;
let generatedAt = null;
let labels = loadLabels();
let mcpSid = null;

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');

function loadLabels() {
  try { return JSON.parse(localStorage.getItem(LABEL_KEY) || '{}'); } catch { return {}; }
}
function saveLabelStore() {
  localStorage.setItem(LABEL_KEY, JSON.stringify(labels));
}

function toast(msg) {
  toastEl.hidden = false;
  toastEl.textContent = msg;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, 2000);
}

function usd(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
  return sign + '$' + a.toFixed(0);
}
function holdLabel(sec) {
  if (sec == null || sec === '') return null;
  const s = Number(sec);
  if (s < 60) return Math.round(s) + 's';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return (s / 3600).toFixed(1) + 'h';
  return (s / 86400).toFixed(1) + 'd';
}
function shortAddr(a) {
  if (!a) return '';
  return a.slice(0, 6) + '…' + a.slice(-4);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function ago(iso) {
  if (!iso) return '';
  const t = typeof iso === 'number' ? iso * (iso < 1e12 ? 1000 : 1) : Date.parse(iso);
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

function scenarioQuery(id) {
  const base = {
    result: 'winning',
    includeBots: 'false',
    sort: 'realizedPnl',
    dir: 'desc',
    limit: '40',
    pace: '-120',
  };
  if (id === 'conviction') return { ...base, pace: '-25', tokens: '2-', minWinRate: '40', sort: 'avgHoldSeconds' };
  if (id === 'swing') return { ...base, style: 'swing', pace: '-80', tokens: '2-', minWinRate: '40', minClosed: '2' };
  if (id === 'consistent') return { ...base, tokens: '3-', pace: '-60', minWinRate: '45', minClosed: '3', sort: 'winRate' };
  if (id === 'sized') return { ...base, minVolume: '25000', pace: '-100', sort: 'volumeUsd' };
  if (id === 'early') return { ...base, style: 'swing', tokens: '2-', pace: '-50', minClosed: '2', sort: 'score' };
  return base;
}

function postFilter(list, id) {
  return (list || []).filter((it) => {
    if (it.bot === true) return false;
    if (it.tradesPerDay != null && it.tradesPerDay > 200) return false;
    const hold = it.avgHoldSeconds;
    if (hold != null && hold < 300 && ['conviction', 'swing', 'consistent', 'early'].includes(id)) return false;
    const vol = Number(it.volumeUsd) || 0;
    const trades = Number(it.trades) || 0;
    if (trades > 50 && vol > 0 && vol / trades < 1) return false;
    return true;
  });
}

function buildClusters(list) {
  const buckets = {};
  for (const it of list) {
    const tok = (it.topToken || {}).address;
    if (!tok) continue;
    (buckets[tok.toLowerCase()] ||= []).push(it);
  }
  return Object.values(buckets)
    .filter((m) => m.length >= 2)
    .map((m) => {
      m.sort((a, b) => (b.realizedPnl || 0) - (a.realizedPnl || 0));
      return { token: m[0].topToken, size: m.length, wallets: m.slice(0, 8) };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, 20);
}

async function mcpInit() {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chainpulse', version: '0.2' } },
    }),
  });
  mcpSid = res.headers.get('mcp-session-id');
  await res.json().catch(() => ({}));
  if (mcpSid) {
    await fetch(MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
        'mcp-session-id': mcpSid,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }).catch(() => {});
  }
}

async function mcpCall(name, args) {
  if (!mcpSid) await mcpInit();
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-11-25',
  };
  if (mcpSid) headers['mcp-session-id'] = mcpSid;
  let res = await fetch(MCP, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args || {} } }),
  });
  if (res.status === 404 || res.status === 400) {
    mcpSid = null;
    await mcpInit();
    if (mcpSid) headers['mcp-session-id'] = mcpSid;
    res = await fetch(MCP, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args || {} } }),
    });
  }
  const sid = res.headers.get('mcp-session-id');
  if (sid) mcpSid = sid;
  const raw = await res.text();
  let d;
  if (raw.trim().startsWith('{')) d = JSON.parse(raw);
  else {
    const lines = raw.split('\n').filter((l) => l.startsWith('data:') && l.slice(5).trim().startsWith('{'));
    d = JSON.parse(lines.at(-1).slice(5).trim());
  }
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  const result = d.result || {};
  if (result.structuredContent) return result.structuredContent;
  for (const c of result.content || []) {
    if (c.type === 'text') {
      try { return JSON.parse(c.text); } catch { return { text: c.text }; }
    }
  }
  return result;
}

async function loadWinners() {
  loading = true; error = null; detail = null; selected = null; tab = 'winners';
  render();
  try {
    if (scenario === 'fresh') {
      const data = await mcpCall('list_stories', { kind: 'fresh', limit: 40 });
      items = data.items || [];
      clusters = [];
      generatedAt = data.asOf;
    } else {
      const q = new URLSearchParams(scenarioQuery(scenario));
      const res = await fetch(HS + '/swaps-api/discover/traders?' + q.toString());
      if (!res.ok) throw new Error('HoodScan traders failed (' + res.status + ')');
      const data = await res.json();
      items = postFilter(data.items || [], scenario);
      clusters = buildClusters(items);
      generatedAt = data.generatedAt;
    }
  } catch (e) {
    error = e.message || String(e);
    items = []; clusters = [];
  } finally {
    loading = false;
    render();
  }
}

async function loadTokens() {
  loading = true; error = null; tab = 'tokens'; render();
  try {
    const res = await fetch(HS + '/swaps-api/discover/trending?window=60');
    if (!res.ok) throw new Error('trending failed');
    const data = await res.json();
    tokens = (data.items || []).filter((t) => !t.suspicious && (t.smartBuyers || 0) >= 1).slice(0, 50);
    generatedAt = data.generatedAt;
  } catch (e) {
    error = e.message || String(e);
  } finally {
    loading = false;
    render();
  }
}

async function openTrader(addr) {
  loading = true; error = null; tab = 'detail'; selected = addr.toLowerCase(); render();
  try {
    detail = await mcpCall('get_trader', { address: addr, positions_limit: 30, recent_limit: 30 });
  } catch (e) {
    error = e.message || String(e);
    // still show list row info
    detail = items.find((i) => (i.trader || '').toLowerCase() === addr.toLowerCase()) || { trader: addr };
  } finally {
    loading = false;
    render();
  }
}

function blurb() {
  return (SCENARIOS.find((s) => s.id === scenario) || {}).blurb || '';
}

function renderWinners() {
  if (!items.length) return `<div class="empty">Nothing matched. Try another scenario.</div>`;
  if (scenario === 'fresh') {
    return items.map((it) => {
      const addr = (it.trader || '').toLowerCase();
      const mine = (labels[addr] || []).map((t) => `<span class="pill mine">${esc(t)}</span>`).join('');
      return `<button class="card" data-open="${esc(addr)}">
        <div class="card-main">
          <div class="name">${esc(it.short || 'Fresh position')}</div>
          <div class="sub">${esc(shortAddr(addr))} · $${esc((it.token || {}).symbol || '?')}</div>
          <div class="pills">${mine}</div>
        </div>
        <div class="card-side">
          <div class="money up">${esc(usd(it.heldWorthUsd || it.boughtUsd))}</div>
          <div class="sub">in ${esc(usd(it.boughtUsd))}</div>
        </div>
      </button>`;
    }).join('');
  }
  return items.map((it) => {
    const addr = (it.trader || '').toLowerCase();
    const pnl = Number(it.realizedPnl) || 0;
    const tok = (it.topToken || (it.lastTrade && it.lastTrade.token) || {}).symbol || '—';
    const hold = holdLabel(it.avgHoldSeconds);
    const mine = (labels[addr] || []).map((t) => `<span class="pill mine">${esc(t)}</span>`).join('');
    const wr = it.winRate != null ? Math.round(it.winRate * (it.winRate <= 1 ? 100 : 1)) : null;
    return `<button class="card" data-open="${esc(addr)}">
      <div class="card-main">
        <div class="name">${esc(it.nickname || shortAddr(addr))}</div>
        <div class="sub">${esc(shortAddr(addr))} · $${esc(tok)}${hold ? ' · hold ' + esc(hold) : ''}</div>
        <div class="pills">
          ${wr != null ? `<span class="pill">${wr}% win</span>` : ''}
          <span class="pill">${esc(Number(it.tradesPerDay || 0).toFixed(0))}/d</span>
          <span class="pill">${esc(it.tokens || 0)} tok</span>
          ${mine}
        </div>
      </div>
      <div class="card-side">
        <div class="money ${pnl >= 0 ? 'up' : 'down'}">${esc(usd(pnl))}</div>
        <div class="sub">vol ${esc(usd(it.volumeUsd))}</div>
      </div>
    </button>`;
  }).join('');
}

function renderClusters() {
  if (!clusters.length) return `<div class="empty">No clusters in this set yet.</div>`;
  return clusters.map((c) => {
    const sym = (c.token || {}).symbol || 'token';
    const members = (c.wallets || []).map((w) =>
      `<button type="button" class="inline" data-open="${esc((w.trader || '').toLowerCase())}">${esc(w.nickname || shortAddr(w.trader))}</button>`
    ).join('<span class="dot">·</span>');
    return `<div class="cluster">
      <div class="name">${esc(c.size)} wallets on $${esc(sym)}</div>
      <div class="sub members">${members}</div>
    </div>`;
  }).join('');
}

function renderTokens() {
  if (!tokens.length) return `<div class="empty">No smart-buyer tokens right now.</div>`;
  return tokens.map((t) => `
    <a class="card linkcard" href="${esc(HS)}/token/${esc(t.address)}" target="_blank" rel="noopener">
      <div class="card-main">
        <div class="name">${esc(t.symbol || shortAddr(t.address))}</div>
        <div class="sub">mcap ${esc(usd(t.marketCapUsd))} · liq ${esc(usd(t.liquidityUsd))}</div>
        <div class="pills">
          <span class="pill">${esc(t.smartBuyers || 0)} smart</span>
          ${(t.signals || []).slice(0, 2).map((s) => `<span class="pill">${esc(s)}</span>`).join('')}
        </div>
      </div>
      <div class="card-side">
        <div class="money ${(t.priceChange || 0) >= 0 ? 'up' : 'down'}">${esc(((t.priceChange || 0) * 100).toFixed(0))}%</div>
      </div>
    </a>`).join('');
}

function renderDetail() {
  if (loading && !detail) return `<div class="empty">Loading…</div>`;
  if (!detail) return `<div class="empty">No detail.</div>`;
  const addr = (selected || detail.trader || '').toLowerCase();
  const stats = detail.stats || {};
  const wins = Number(detail.wins ?? 0);
  const losses = Number(detail.losses ?? 0);
  const closed = wins + losses;
  const winRate = closed ? wins / closed : (detail.winRate != null ? detail.winRate : null);
  const wrShow = winRate == null ? null : Math.round(winRate * (winRate <= 1 ? 100 : 1));
  const pnl = stats.realizedUsd ?? detail.realizedPnl ?? stats.realizedPnl;
  const hold = holdLabel(detail.avgHoldSeconds ?? stats.avgHoldSeconds);
  const nick = (detail.identity && detail.identity.nickname) || detail.nickname || shortAddr(addr);
  const mine = labels[addr] || [];
  const positions = detail.openPositions || [];
  const recent = detail.recentSwaps || [];

  return `<div class="detail">
    <button class="btn ghost" type="button" data-back>← Back</button>
    <h2>${esc(nick)}</h2>
    <div class="sub mono">${esc(addr)}</div>
    <div class="stats">
      <div><span>PnL</span><b class="${(Number(pnl)||0)>=0?'up':'down'}">${esc(usd(pnl))}</b></div>
      <div><span>Win</span><b>${esc(wrShow != null ? wrShow + '%' : '—')}</b></div>
      <div><span>Hold</span><b>${esc(hold || '—')}</b></div>
      <div><span>Vol</span><b>${esc(usd(stats.volumeUsd || detail.volumeUsd))}</b></div>
    </div>
    <a class="ext" href="${esc(HS)}/trader/${esc(addr)}" target="_blank" rel="noopener">Open on HoodScan ↗</a>
    <div class="labeler">
      <label>Your tags</label>
      <input id="label-input" value="${esc(mine.join(', '))}" placeholder="conviction, watch…">
      <div class="label-row">
        <button class="btn primary" type="button" data-save-labels="${esc(addr)}">Save</button>
        ${LABEL_SUGGESTIONS.map((s) => `<button type="button" class="pill mine" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}
      </div>
      <p class="fine">Saved on this phone only.</p>
    </div>
    ${positions.length ? `<h3>Open</h3>${positions.slice(0, 10).map((p) => {
      const sym = (p.token || {}).symbol || '?';
      return `<div class="mini"><div>$${esc(sym)}</div><div class="money ${(Number(p.realizedUsd)||0)>=0?'up':'down'}">${esc(usd(p.realizedUsd))}</div></div>`;
    }).join('')}` : ''}
    ${recent.length ? `<h3>Recent</h3>${recent.slice(0, 10).map((r) => {
      const sym = (r.token || {}).symbol || '?';
      return `<div class="mini"><div>${esc(r.side || '')} $${esc(sym)}</div><div class="money">${esc(usd(r.usd))}</div></div>`;
    }).join('')}` : ''}
  </div>`;
}

function render() {
  root.innerHTML = `
    <header class="hero">
      <div class="brand">Chain<span>Pulse</span></div>
      <p>Robinhood Chain winners — open this link on your phone anytime.</p>
      <div class="fine">${generatedAt ? 'Updated ' + esc(ago(generatedAt) || String(generatedAt)) : 'Live from HoodScan'} · free · no login</div>
    </header>

    <div class="scroller">
      ${SCENARIOS.map((s) => `<button type="button" class="chip ${scenario === s.id ? 'on' : ''}" data-scenario="${s.id}">${esc(s.label)}</button>`).join('')}
    </div>

    <div class="bar">
      <button class="btn primary" type="button" data-refresh ${loading ? 'disabled' : ''}>${loading ? '…' : 'Refresh'}</button>
      <button class="btn ${tab === 'winners' ? 'on' : ''}" type="button" data-tab="winners">Wallets</button>
      <button class="btn ${tab === 'clusters' ? 'on' : ''}" type="button" data-tab="clusters">Clusters</button>
      <button class="btn ${tab === 'tokens' ? 'on' : ''}" type="button" data-tab="tokens">Tokens</button>
    </div>
    <p class="fine bar-note">${esc(blurb())}</p>

    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    ${loading && tab !== 'detail' ? `<div class="empty">Loading…</div>` : ''}

    <main>
      ${tab === 'detail' ? renderDetail() : ''}
      ${tab === 'winners' && !loading ? renderWinners() : ''}
      ${tab === 'clusters' && !loading ? renderClusters() : ''}
      ${tab === 'tokens' && !loading ? renderTokens() : ''}
    </main>
  `;
}

root.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-scenario],[data-refresh],[data-tab],[data-open],[data-back],[data-save-labels],[data-suggest]');
  if (!t) return;
  if (t.dataset.scenario) { scenario = t.dataset.scenario; await loadWinners(); return; }
  if (t.dataset.refresh !== undefined) {
    if (tab === 'tokens') await loadTokens();
    else await loadWinners();
    return;
  }
  if (t.dataset.tab === 'tokens') { await loadTokens(); return; }
  if (t.dataset.tab === 'clusters') { tab = 'clusters'; if (!items.length) await loadWinners(); else render(); return; }
  if (t.dataset.tab === 'winners') { tab = 'winners'; if (!items.length) await loadWinners(); else render(); return; }
  if (t.dataset.open) { await openTrader(t.dataset.open); return; }
  if (t.dataset.back !== undefined) { tab = 'winners'; detail = null; render(); return; }
  if (t.dataset.saveLabels) {
    const input = document.getElementById('label-input');
    const list = (input.value || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
    labels[t.dataset.saveLabels] = list;
    if (!list.length) delete labels[t.dataset.saveLabels];
    saveLabelStore();
    toast('Saved on this phone');
    render();
    return;
  }
  if (t.dataset.suggest) {
    const input = document.getElementById('label-input');
    const cur = (input.value || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!cur.includes(t.dataset.suggest)) cur.push(t.dataset.suggest);
    input.value = cur.join(', ');
  }
});

render();
loadWinners();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
