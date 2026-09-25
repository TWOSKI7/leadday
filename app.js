/* ChainPulse — Robinhood Chain winner discovery UI */
const SCENARIOS = [
  { id: 'all_winners', label: 'All winners', blurb: 'Winning wallets, bots off, pace capped' },
  { id: 'conviction', label: 'Conviction', blurb: 'Longer holds, multi-token, low pace' },
  { id: 'swing', label: 'Swing', blurb: 'Hours-to-day holds, not spray' },
  { id: 'consistent', label: 'Multi-coin', blurb: '3+ tokens, win-rate floor' },
  { id: 'sized', label: 'Sized', blurb: 'Higher volume winners' },
  { id: 'early', label: 'Selective', blurb: 'Swing style + score sort' },
  { id: 'fresh', label: 'Fresh', blurb: 'New opens still in profit' },
];

const LABEL_SUGGESTIONS = [
  'conviction', 'swing', 'early-runner', 'sized', 'cluster', 'avoid-bot', 'watch',
];

let scenario = 'all_winners';
let tab = 'winners'; // winners | clusters | tokens | detail
let payload = null;
let selected = null;
let detail = null;
let loading = false;
let error = null;
let labels = {};

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');

function toast(msg) {
  toastEl.hidden = false;
  toastEl.textContent = msg;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || 'request failed');
  return data;
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
  if (sec == null || sec === '') return 'hold n/a';
  const s = Number(sec);
  if (s < 60) return Math.round(s) + 's hold';
  if (s < 3600) return Math.round(s / 60) + 'm hold';
  if (s < 86400) return (s / 3600).toFixed(1) + 'h hold';
  return (s / 86400).toFixed(1) + 'd hold';
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

async function loadWinners() {
  loading = true; error = null; selected = null; detail = null; tab = 'winners';
  render();
  try {
    payload = await api('/api/winners?scenario=' + encodeURIComponent(scenario));
    labels = payload.labels || labels;
  } catch (e) {
    error = e.message || String(e);
    payload = null;
  } finally {
    loading = false;
    render();
  }
}

async function openTrader(addr) {
  loading = true; error = null; tab = 'detail'; render();
  try {
    detail = await api('/api/trader/' + addr);
    selected = addr.toLowerCase();
    if (detail.labels) {
      labels[selected] = detail.labels;
    }
  } catch (e) {
    error = e.message || String(e);
    tab = 'winners';
  } finally {
    loading = false;
    render();
  }
}

async function saveLabels(addr, list) {
  const data = await api('/api/labels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: addr, labels: list }),
  });
  labels[addr.toLowerCase()] = data.labels || [];
  toast('Labels saved');
  render();
}

async function loadTokens() {
  loading = true; error = null; tab = 'tokens'; render();
  try {
    const data = await api('/api/discover-tokens?window=60');
    payload = { ...(payload || {}), tokens: data.items || [], tokenWindow: data.windowMinutes };
  } catch (e) {
    error = e.message || String(e);
  } finally {
    loading = false;
    render();
  }
}

function scenarioBlurb() {
  return (SCENARIOS.find((s) => s.id === scenario) || {}).blurb || '';
}

function renderWinners() {
  const items = (payload && payload.items) || [];
  if (!items.length) {
    return `<div class="empty">No wallets matched this scenario. Try another preset or refresh.</div>`;
  }
  if (scenario === 'fresh') {
    return `<div class="list">${items.map((it) => {
      const addr = (it.trader || '').toLowerCase();
      const mine = (labels[addr] || []).map((t) => `<span class="tag mine">${esc(t)}</span>`).join('');
      return `<button class="row" data-open="${esc(addr)}">
        <div>
          <div class="row-title">${esc(it.short || it.text || 'Fresh position')}</div>
          <div class="row-sub">${esc(shortAddr(addr))} · $${esc((it.token || {}).symbol || '?')}</div>
          <div class="tags">${mine}</div>
        </div>
        <div class="row-right">
          <div class="pnl up">${esc(usd(it.heldWorthUsd || it.boughtUsd))}</div>
          <div class="row-sub">bought ${esc(usd(it.boughtUsd))}</div>
        </div>
      </button>`;
    }).join('')}</div>`;
  }
  return `<div class="list">${items.map((it) => {
    const addr = (it.trader || '').toLowerCase();
    const pnl = Number(it.realizedPnl) || 0;
    const mine = (labels[addr] || []).map((t) => `<span class="tag mine">${esc(t)}</span>`).join('');
    const tok = (it.topToken || (it.lastTrade && it.lastTrade.token) || {}).symbol || '—';
    return `<button class="row" data-open="${esc(addr)}">
      <div>
        <div class="row-title">${esc(it.nickname || shortAddr(addr))}</div>
        <div class="row-sub">${esc(shortAddr(addr))} · ${esc(tok)} · ${esc(it.tokens || 0)} tokens · ${esc(holdLabel(it.avgHoldSeconds))}</div>
        <div class="tags">
          <span class="tag">${esc(Math.round((it.winRate || 0) * 100))}% win</span>
          <span class="tag">${esc(Number(it.tradesPerDay || 0).toFixed(0))}/day</span>
          ${it.bot ? '<span class="tag">bot</span>' : ''}
          ${mine}
        </div>
      </div>
      <div class="row-right">
        <div class="pnl ${pnl >= 0 ? 'up' : 'down'}">${esc(usd(pnl))}</div>
        <div class="row-sub">vol ${esc(usd(it.volumeUsd))}</div>
      </div>
    </button>`;
  }).join('')}</div>`;
}

function renderClusters() {
  const clusters = (payload && payload.clusters) || [];
  if (!clusters.length) {
    return `<div class="empty">No multi-wallet clusters in this result set. Clusters appear when 2+ wallets share the same top token.</div>`;
  }
  return clusters.map((c) => {
    const sym = (c.token || {}).symbol || 'token';
    const members = (c.wallets || []).map((w) =>
      `<button class="link" data-open="${esc((w.trader || '').toLowerCase())}" style="border:0;background:0;padding:0;cursor:pointer;font:inherit;color:inherit">${esc(w.nickname || shortAddr(w.trader))} (${esc(usd(w.realizedPnl))})</button>`
    ).join(' · ');
    return `<div class="cluster">
      <strong>${esc(c.size)} wallets</strong> on <strong>$${esc(sym)}</strong>
      <div class="members">${members}</div>
    </div>`;
  }).join('');
}

function renderTokens() {
  const items = (payload && payload.tokens) || [];
  if (!items.length) return `<div class="empty">No smart-buyer tokens in window.</div>`;
  return `<div class="list">${items.map((t) => `
    <div class="row" style="cursor:default">
      <div>
        <div class="row-title">${esc(t.symbol || shortAddr(t.address))}</div>
        <div class="row-sub">${esc(shortAddr(t.address))} · mcap ${esc(usd(t.marketCapUsd))} · liq ${esc(usd(t.liquidityUsd))}</div>
        <div class="tags">
          <span class="tag">${esc(t.smartBuyers || 0)} smart buyers</span>
          <span class="tag">${esc((t.signals || []).slice(0, 3).join(' · ') || '—')}</span>
          <span class="tag">score ${esc(t.score)}</span>
        </div>
      </div>
      <div class="row-right">
        <div class="pnl ${(t.priceChange || 0) >= 0 ? 'up' : 'down'}">${esc(((t.priceChange || 0) * 100).toFixed(0))}%</div>
        <div class="row-sub"><a class="link" href="https://hoodscan.co/token/${esc(t.address)}" target="_blank" rel="noopener">HoodScan</a></div>
      </div>
    </div>`).join('')}</div>`;
}

function renderDetail() {
  if (!detail) return `<div class="loading">Loading trader…</div>`;
  const addr = (selected || detail.trader || '').toLowerCase();
  const stats = detail.stats || {};
  const wins = Number(detail.wins ?? 0);
  const losses = Number(detail.losses ?? 0);
  const closed = wins + losses;
  const winRate = closed ? wins / closed : null;
  const pnl = stats.realizedUsd ?? stats.realizedPnl ?? detail.realizedPnl;
  const hold = detail.avgHoldSeconds ?? stats.avgHoldSeconds;
  const nick = (detail.identity && detail.identity.nickname) || stats.nickname || shortAddr(addr);
  const mine = labels[addr] || [];
  const suggestions = LABEL_SUGGESTIONS.map((s) =>
    `<button class="tag mine" type="button" data-suggest="${esc(s)}">${esc(s)}</button>`
  ).join('');

  const positions = detail.openPositions || detail.positions || [];
  const recent = detail.recentSwaps || detail.recent || [];

  return `<div class="detail">
    <button class="btn" type="button" data-back>← Back</button>
    <h3 style="margin-top:12px">${esc(nick)}</h3>
    <div class="row-sub">${esc(addr)}</div>
    <div class="stat-grid">
      <div class="stat"><div class="k">Realized PnL</div><div class="v pnl ${(Number(pnl)||0)>=0?'up':'down'}">${esc(usd(pnl))}</div></div>
      <div class="stat"><div class="k">Win rate</div><div class="v">${esc(winRate != null ? Math.round(winRate * 100) + '% (' + wins + 'W/' + losses + 'L)' : '—')}</div></div>
      <div class="stat"><div class="k">Trades</div><div class="v">${esc(stats.trades ?? '—')}</div></div>
      <div class="stat"><div class="k">Avg hold</div><div class="v">${esc(holdLabel(hold))}</div></div>
      <div class="stat"><div class="k">Unrealized</div><div class="v">${esc(usd(detail.unrealizedUsd))}</div></div>
      <div class="stat"><div class="k">Volume</div><div class="v">${esc(usd(stats.volumeUsd))}</div></div>
    </div>
    <p class="hint"><a class="link" href="https://hoodscan.co/trader/${esc(addr)}" target="_blank" rel="noopener">Open on HoodScan</a></p>

    <div class="label-box">
      <div class="k" style="margin-bottom:6px">Your scenario labels</div>
      <input id="label-input" type="text" value="${esc(mine.join(', '))}" placeholder="conviction, early-runner, cluster…">
      <div class="label-actions">
        <button class="btn primary" type="button" data-save-labels="${esc(addr)}">Save labels</button>
        ${suggestions}
      </div>
    </div>

    ${positions.length ? `<h2 style="margin-top:20px">Open positions</h2><div class="list">${positions.slice(0, 12).map((p) => {
      const sym = (p.token || {}).symbol || shortAddr((p.token || {}).address);
      return `<div class="row" style="cursor:default"><div><div class="row-title">$${esc(sym)}</div>
        <div class="row-sub">${esc(p.buys || 0)} buys · ${esc(p.sells || 0)} sells</div></div>
        <div class="row-right"><div class="pnl ${(Number(p.realizedUsd)||0)>=0?'up':'down'}">${esc(usd(p.realizedUsd))}</div>
        <div class="row-sub">u ${esc(usd(p.unrealizedUsd))}</div></div></div>`;
    }).join('')}</div>` : ''}

    ${recent.length ? `<h2 style="margin-top:20px">Recent swaps</h2><div class="list">${recent.slice(0, 12).map((r) => {
      const sym = (r.token || {}).symbol || '—';
      return `<div class="row" style="cursor:default"><div><div class="row-title">${esc(r.side || '')} $${esc(sym)}</div>
        <div class="row-sub">${esc(r.time || r.ts || '')}</div></div>
        <div class="row-right"><div class="pnl">${esc(usd(r.usd || r.valueUsd))}</div></div></div>`;
    }).join('')}</div>` : ''}
  </div>`;
}

function render() {
  const gen = payload && (payload.generatedAt || payload.lookbackHours);
  root.innerHTML = `
    <header class="top">
      <h1 class="brand">Chain<em>Pulse</em></h1>
      <p class="tagline">Robinhood Chain winner discovery — multiple winning scenarios, not one mold.</p>
      <div class="meta-line">Chain 4663 · data via HoodScan (free) ${gen ? '· updated ' + esc(String(payload.generatedAt || '')) : ''}</div>
    </header>

    <div class="scenarios">
      ${SCENARIOS.map((s) => `<button type="button" class="scenario ${scenario === s.id ? 'active' : ''}" data-scenario="${s.id}">${esc(s.label)}</button>`).join('')}
    </div>

    <div class="toolbar">
      <button class="btn primary" type="button" data-refresh ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : 'Refresh'}</button>
      <button class="btn" type="button" data-tab="winners">Wallets</button>
      <button class="btn" type="button" data-tab="clusters">Clusters</button>
      <button class="btn" type="button" data-tab="tokens">Hot tokens</button>
      <span class="hint">${esc(scenarioBlurb())}</span>
    </div>

    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    ${loading && tab !== 'detail' ? `<div class="loading">Pulling Robinhood Chain traders…</div>` : ''}

    <section class="section">
      ${tab === 'detail' ? renderDetail() : ''}
      ${tab === 'winners' && !loading ? `<h2>Wallets</h2><p class="blurb">${esc(scenarioBlurb())}</p>${renderWinners()}` : ''}
      ${tab === 'clusters' && !loading ? `<h2>Clusters</h2><p class="blurb">Wallets in this list that share a top token — possible multi-wallet actors.</p>${renderClusters()}` : ''}
      ${tab === 'tokens' && !loading ? `<h2>Hot tokens</h2><p class="blurb">Tokens with smart-buyer flow in the last hour.</p>${renderTokens()}` : ''}
    </section>
  `;
}

root.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-scenario],[data-refresh],[data-tab],[data-open],[data-back],[data-save-labels],[data-suggest]');
  if (!t) return;

  if (t.dataset.scenario) {
    scenario = t.dataset.scenario;
    await loadWinners();
    return;
  }
  if (t.dataset.refresh !== undefined) {
    if (tab === 'tokens') await loadTokens();
    else await loadWinners();
    return;
  }
  if (t.dataset.tab === 'tokens') {
    await loadTokens();
    return;
  }
  if (t.dataset.tab === 'clusters') {
    tab = 'clusters';
    if (!payload) await loadWinners();
    else render();
    return;
  }
  if (t.dataset.tab === 'winners') {
    tab = 'winners';
    if (!payload) await loadWinners();
    else render();
    return;
  }
  if (t.dataset.open) {
    await openTrader(t.dataset.open);
    return;
  }
  if (t.dataset.back !== undefined) {
    tab = 'winners'; detail = null; render();
    return;
  }
  if (t.dataset.saveLabels) {
    const input = document.getElementById('label-input');
    const list = (input.value || '').split(',').map((s) => s.trim()).filter(Boolean);
    try { await saveLabels(t.dataset.saveLabels, list); }
    catch (err) { toast(err.message || 'Save failed'); }
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
