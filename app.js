/* ChainPulse — clarity first: still trading? last move? then track record. */
const HS = 'https://hoodscan.co';
const MCP = HS + '/mcp';
const LABEL_KEY = 'chainpulse.labels.v1';

/** Three views. Not six “scenarios.” */
const VIEWS = [
  {
    id: 'active',
    label: 'Active now',
    help: 'Won money recently and still trading (last move under 24h).',
  },
  {
    id: 'bought',
    label: 'Just bought',
    help: 'Winners whose latest move was a buy — still putting money in.',
  },
  {
    id: 'quiet',
    label: 'Quiet / done',
    help: 'Past winners who have not traded in 24h+. History, not a live signal.',
  },
];

let view = 'active';
let rows = [];
let selected = null;
let detail = null;
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
function persistLabels() {
  localStorage.setItem(LABEL_KEY, JSON.stringify(labels));
}

function toast(msg) {
  toastEl.hidden = false;
  toastEl.textContent = msg;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, 1800);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function usd(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
  return sign + '$' + a.toFixed(0);
}

function shortAddr(a) {
  if (!a) return '';
  return a.slice(0, 6) + '…' + a.slice(-4);
}

function lastTs(it) {
  const lt = it.lastTrade || {};
  const t = lt.ts || it.lastTs;
  if (!t) return null;
  return t < 1e12 ? t * 1000 : t;
}

function ageMs(it) {
  const t = lastTs(it);
  return t == null ? null : Date.now() - t;
}

function ago(ms) {
  if (ms == null) return 'unknown';
  const s = Math.max(0, ms / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

function activity(it) {
  const ms = ageMs(it);
  if (ms == null) return { key: 'unknown', label: 'Activity unknown', live: false };
  if (ms < 24 * 3600 * 1000) return { key: 'live', label: 'Still trading', live: true };
  if (ms < 7 * 24 * 3600 * 1000) return { key: 'quiet', label: 'Quiet (1–7d)', live: false };
  return { key: 'idle', label: 'Idle / likely done', live: false };
}

function lastMove(it) {
  const lt = it.lastTrade || {};
  const side = (lt.side || '').toLowerCase();
  const tok = (lt.token || it.topToken || {}).symbol || '?';
  const when = ago(ageMs(it));
  if (side === 'buy') return { side: 'buy', text: `Last bought $${tok} · ${when}`, tok };
  if (side === 'sell') return { side: 'sell', text: `Last sold $${tok} · ${when}`, tok };
  return { side: '', text: `Last trade · ${when}`, tok };
}

function holdLabel(sec) {
  if (sec == null || sec === '') return null;
  const s = Number(sec);
  if (s < 60) return Math.round(s) + 's avg hold';
  if (s < 3600) return Math.round(s / 60) + 'm avg hold';
  if (s < 86400) return (s / 3600).toFixed(1) + 'h avg hold';
  return (s / 86400).toFixed(1) + 'd avg hold';
}

function winPct(it) {
  if (it.winRate == null) {
    const w = Number(it.wins) || 0;
    const l = Number(it.losses) || 0;
    if (w + l === 0) return null;
    return Math.round((w / (w + l)) * 100);
  }
  const r = Number(it.winRate);
  return Math.round(r <= 1 ? r * 100 : r);
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
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'chainpulse', version: '0.3' },
      },
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
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name, arguments: args || {} },
    }),
  });
  if (res.status >= 400) {
    mcpSid = null;
    await mcpInit();
    if (mcpSid) headers['mcp-session-id'] = mcpSid;
    res = await fetch(MCP, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name, arguments: args || {} },
      }),
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
  if (d.error) throw new Error(d.error.message || 'MCP error');
  const result = d.result || {};
  if (result.structuredContent) return result.structuredContent;
  for (const c of result.content || []) {
    if (c.type === 'text') {
      try { return JSON.parse(c.text); } catch { return { text: c.text }; }
    }
  }
  return result;
}

function baseFilter(it) {
  if (it.bot === true) return false;
  if (it.tradesPerDay != null && it.tradesPerDay > 200) return false;
  const vol = Number(it.volumeUsd) || 0;
  const trades = Number(it.trades) || 0;
  if (trades > 50 && vol > 0 && vol / trades < 1) return false;
  return true;
}

async function load() {
  loading = true;
  error = null;
  detail = null;
  selected = null;
  render();
  try {
    const q = new URLSearchParams({
      result: 'winning',
      includeBots: 'false',
      sort: 'lastTrade',
      dir: 'desc',
      limit: '80',
      pace: '-150',
    });
    const res = await fetch(HS + '/swaps-api/discover/traders?' + q);
    if (!res.ok) throw new Error('Could not load traders (' + res.status + ')');
    const data = await res.json();
    generatedAt = data.generatedAt;
    const all = (data.items || []).filter(baseFilter);

    if (view === 'active') {
      rows = all
        .filter((it) => activity(it).live)
        .sort((a, b) => (lastTs(b) || 0) - (lastTs(a) || 0));
    } else if (view === 'bought') {
      rows = all
        .filter((it) => activity(it).live && (it.lastTrade || {}).side === 'buy')
        .sort((a, b) => (lastTs(b) || 0) - (lastTs(a) || 0));
    } else {
      rows = all
        .filter((it) => !activity(it).live)
        .sort((a, b) => (Number(b.realizedPnl) || 0) - (Number(a.realizedPnl) || 0));
    }
  } catch (e) {
    error = e.message || String(e);
    rows = [];
  } finally {
    loading = false;
    render();
  }
}

async function openTrader(addr) {
  loading = true;
  error = null;
  selected = addr.toLowerCase();
  render();
  try {
    detail = await mcpCall('get_trader', {
      address: addr,
      positions_limit: 25,
      recent_limit: 25,
    });
  } catch (e) {
    detail = rows.find((r) => (r.trader || '').toLowerCase() === addr.toLowerCase()) || { trader: addr };
    error = 'Detail partially loaded: ' + (e.message || e);
  } finally {
    loading = false;
    render();
  }
}

function viewHelp() {
  return (VIEWS.find((v) => v.id === view) || {}).help || '';
}

function renderList() {
  if (!rows.length) {
    return `<div class="empty">No wallets in this view right now. Try another tab or refresh.</div>`;
  }
  return rows.map((it) => {
    const addr = (it.trader || '').toLowerCase();
    const act = activity(it);
    const move = lastMove(it);
    const pnl = Number(it.realizedPnl) || 0;
    const wr = winPct(it);
    const hold = holdLabel(it.avgHoldSeconds);
    const mine = (labels[addr] || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

    return `<button class="row" type="button" data-open="${esc(addr)}">
      <div class="status ${esc(act.key)}">${esc(act.label)}</div>
      <div class="move ${esc(move.side)}">${esc(move.text)}</div>
      <div class="row-body">
        <div>
          <div class="name">${esc(it.nickname || shortAddr(addr))}</div>
          <div class="meta">${esc(shortAddr(addr))}${wr != null ? ' · ' + wr + '% wins' : ''}${hold ? ' · ' + esc(hold) : ''}</div>
          ${mine ? `<div class="tags">${mine}</div>` : ''}
        </div>
        <div class="side">
          <div class="pnl ${pnl >= 0 ? 'up' : 'down'}">${esc(usd(pnl))}</div>
          <div class="meta">past realized</div>
        </div>
      </div>
    </button>`;
  }).join('');
}

function renderDetail() {
  const fromList = rows.find((r) => (r.trader || '').toLowerCase() === selected) || {};
  const addr = selected || '';
  const act = activity(detail && detail.lastTrade ? detail : fromList);
  const move = lastMove(detail && detail.lastTrade ? { ...fromList, ...detail, lastTrade: detail.lastTrade || fromList.lastTrade } : fromList);
  const stats = (detail && detail.stats) || {};
  const pnl = stats.realizedUsd ?? fromList.realizedPnl;
  const nick = (detail && detail.identity && detail.identity.nickname) || fromList.nickname || shortAddr(addr);
  const positions = (detail && detail.openPositions) || [];
  const recent = (detail && detail.recentSwaps) || [];
  const openCount = positions.filter((p) => Number(p.heldQty || p.qty || 0) !== 0 || Number(p.unrealizedUsd || 0) !== 0).length;
  const mine = labels[addr] || [];

  return `<section class="detail">
    <button class="btn ghost" type="button" data-back>← Back</button>
    <div class="status ${esc(act.key)}" style="margin-top:12px">${esc(act.label)}</div>
    <div class="move ${esc(move.side)}">${esc(move.text)}</div>
    <h2>${esc(nick)}</h2>
    <div class="meta mono">${esc(addr)}</div>

    <div class="callout">
      <strong>How to read this</strong>
      <p><em>Still trading</em> / last buy·sell = what’s happening <u>now</u>. The dollar figure below is <u>already realized</u> — money they already took. It is not a promise they will keep winning.</p>
    </div>

    <div class="grid">
      <div><span>Past realized PnL</span><b class="${(Number(pnl)||0)>=0?'up':'down'}">${esc(usd(pnl))}</b></div>
      <div><span>Open positions</span><b>${esc(openCount || positions.length || '—')}</b></div>
      <div><span>Wins / losses</span><b>${esc((detail && detail.wins) ?? fromList.wins ?? '—')} / ${esc((detail && detail.losses) ?? fromList.losses ?? '—')}</b></div>
      <div><span>Avg hold</span><b>${esc(holdLabel((detail && detail.avgHoldSeconds) ?? fromList.avgHoldSeconds) || '—')}</b></div>
    </div>

    <a class="ext" href="${esc(HS)}/trader/${esc(addr)}" target="_blank" rel="noopener">Full history on HoodScan ↗</a>

    <div class="labeler">
      <label>Your note</label>
      <input id="label-input" value="${esc(mine.join(', '))}" placeholder="still-hot, skip, cluster…">
      <button class="btn primary" type="button" data-save="${esc(addr)}">Save on this phone</button>
    </div>

    ${recent.length ? `<h3>Recent swaps (proof of activity)</h3>
      ${recent.slice(0, 12).map((r) => {
        const sym = (r.token || {}).symbol || '?';
        const side = (r.side || '').toLowerCase();
        return `<div class="mini"><span class="${esc(side)}">${esc(side)} $${esc(sym)}</span><span>${esc(usd(r.usd))}</span></div>`;
      }).join('')}` : ''}

    ${positions.length ? `<h3>Open / leftover positions</h3>
      ${positions.slice(0, 12).map((p) => {
        const sym = (p.token || {}).symbol || '?';
        return `<div class="mini"><span>$${esc(sym)}</span><span class="${(Number(p.unrealizedUsd)||0)>=0?'up':'down'}">u ${esc(usd(p.unrealizedUsd))} · r ${esc(usd(p.realizedUsd))}</span></div>`;
      }).join('')}` : `<p class="meta">No open positions returned — may be flat.</p>`}
  </section>`;
}

function render() {
  const showingDetail = !!selected;
  root.innerHTML = `
    <header class="hero">
      <div class="brand">Chain<span>Pulse</span></div>
      <p class="lede">One question first: <strong>are they still trading?</strong></p>
      <p class="sublede">Past profit is labeled as past. Live buys/sells are labeled as live.</p>
    </header>

    ${showingDetail ? renderDetail() : `
      <nav class="tabs" aria-label="Views">
        ${VIEWS.map((v) => `<button type="button" class="tab ${view === v.id ? 'on' : ''}" data-view="${v.id}">${esc(v.label)}</button>`).join('')}
      </nav>
      <p class="help">${esc(viewHelp())}</p>
      <div class="toolbar">
        <button class="btn primary" type="button" data-refresh ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : 'Refresh'}</button>
        <span class="meta">${generatedAt ? 'Feed ' + esc(ago(Date.now() - (typeof generatedAt === 'number' ? (generatedAt < 1e12 ? generatedAt * 1000 : generatedAt) : Date.parse(generatedAt)))) : ''}</span>
      </div>
      ${error ? `<div class="err">${esc(error)}</div>` : ''}
      ${loading ? `<div class="empty">Loading wallets…</div>` : `<div class="legend">
        <span><i class="dot live"></i> Still trading (&lt;24h)</span>
        <span><i class="dot quiet"></i> Quiet</span>
        <span class="dim">Green $ = already banked (past)</span>
      </div>${renderList()}`}
    `}
  `;
}

root.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-view],[data-refresh],[data-open],[data-back],[data-save]');
  if (!t) return;
  if (t.dataset.view) {
    view = t.dataset.view;
    await load();
    return;
  }
  if (t.dataset.refresh !== undefined) {
    await load();
    return;
  }
  if (t.dataset.open) {
    await openTrader(t.dataset.open);
    return;
  }
  if (t.dataset.back !== undefined) {
    selected = null;
    detail = null;
    error = null;
    render();
    return;
  }
  if (t.dataset.save) {
    const input = document.getElementById('label-input');
    const list = (input.value || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (list.length) labels[t.dataset.save] = list;
    else delete labels[t.dataset.save];
    persistLabels();
    toast('Saved on this phone');
    render();
  }
});

render();
load();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
