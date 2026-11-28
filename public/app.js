// Mainali Tour & Travels — Transport Tracker front end (plain JavaScript, no build step).
'use strict';

const S = { user: null, data: null };
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayIso = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * 86400e3).toISOString().slice(0, 10);
const cur = () => S.data?.settings?.currency || '₹';
const money = n => { const v = Math.round(n || 0); return (v < 0 ? '−' : '') + cur() + Math.abs(v).toLocaleString('en-IN'); };
const fmtDate = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtTime = ts => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const isOwner = () => S.user?.role === 'owner';
const driversOf = t => String(t.drivers || '').split(',').map(s => s.trim()).filter(Boolean);
const countsAsExpense = e => e.category !== 'Opening balance';

async function api(path, opts = {}) {
  const res = await fetch('/api/' + path, {
    method: opts.method || 'GET', headers: opts.body && typeof opts.body !== 'string' ? { 'Content-Type': 'application/json' } : {},
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const body = isJson ? await res.json() : await res.text();
  if (res.status === 401 && path !== 'login') { showLogin(); throw new Error('Please log in'); }
  if (!res.ok) throw new Error(body.error || body || res.statusText);
  return body;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}
async function reload() { S.data = await api('data'); }

// ---------- login ----------
function showLogin() {
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#pin').focus();
  // Show the demo PINs only while they still work, and learn the PIN length for the keypad.
  fetch('/api/hint').then(r => r.json()).then(h => {
    $('#demo-hint').classList.toggle('hidden', !h.demoPins);
    window.PIN_LENGTH = h.pinLength || 0;
  }).catch(() => {});
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    S.user = await api('login', { method: 'POST', body: { pin: $('#pin').value } });
    $('#pin').value = ''; $('#login-err').textContent = '';
    await start();
  } catch (err) { $('#login-err').textContent = err.message; }
});
$('#logout').addEventListener('click', async () => { await api('logout', { method: 'POST' }).catch(() => {}); S.user = null; showLogin(); });

async function start() {
  await reload();
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#biz-name').textContent = S.data.settings.businessName;
  $('#who').textContent = S.user.name;
  $('#role').textContent = isOwner() ? 'Owner' : 'Office staff';
  $('#avatar').textContent = S.user.name.trim()[0].toUpperCase();
  if (!location.hash) location.hash = isOwner() ? '#/dashboard' : '#/day';
  route();
}

// ---------- routing ----------
const ROUTES = {
  dashboard: { label: 'Dashboard', render: renderDashboard }, // staff see it too (read only)
  day: { label: 'Day sheet', render: renderDay },
  cash: { label: 'Driver cash', render: renderCash },
  drivers: { label: 'Drivers & cars', owner: true, render: renderDrivers },
  activity: { label: 'Activity', owner: true, render: renderActivity },
  data: { label: 'Import / export', owner: true, render: renderData },
};
// Simple line icons (24px grid, drawn with currentColor).
const ICONS = {
  dashboard: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z"/>',
  day: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M8 14h3M8 17h6"/>',
  cash: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 11h18M7 15h3"/><path d="M6 7l9-3 2 3"/>',
  drivers: '<path d="M5 16l1.6-5.2A2 2 0 0 1 8.5 9.4h7a2 2 0 0 1 1.9 1.4L19 16v3h-2.5M5 16v3h2.5M5 16h14"/><circle cx="8" cy="16.5" r="1.4"/><circle cx="16" cy="16.5" r="1.4"/>',
  activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  data: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
};
const icon = k => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ''}</svg>`;
window.addEventListener('hashchange', route);
function route() {
  if (!S.user) return;
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const r = ROUTES[name] && (!ROUTES[name].owner || isOwner()) ? name : (isOwner() ? 'dashboard' : 'day');
  $('#nav').innerHTML = Object.entries(ROUTES).filter(([, v]) => !v.owner || isOwner())
    .map(([k, v]) => `<a href="#/${k}" class="${k === r ? 'active' : ''}">${icon(k)}<span>${v.label}</span></a>`).join('');
  ROUTES[r].render($('#view'), arg);
  window.scrollTo(0, 0);
}

// ---------- calculations ----------
function inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); }
// ---------- driver cash ledger ----------
// A driver owes the office every trip collection he took himself (collectedBy = driver), minus fuel etc.
// he paid out of that cash (expense paidBy = driver), minus cash he handed in. Handovers settle the
// oldest trips first, so each trip shows whether its money has reached the office yet.
// A trip ticked "received" (the old Excel tick) counts as settled on the day.
function cashLedger() {
  if (cashLedger.cache?.data === S.data) return cashLedger.cache;
  const acc = new Map(); const tripLeft = new Map(); // tripId -> amount still with drivers
  const get = n => { const k = n.toLowerCase(); if (!acc.has(k)) acc.set(k, { name: n, entries: [], collected: 0, spent: 0, handedIn: 0 }); return acc.get(k); };
  S.data.drivers.forEach(d => get(d.name));
  for (const t of S.data.trips) {
    if (t.status !== 'done' || t.collectedBy === 'office' || t.received) continue;
    const ds = driversOf(t); if (!ds.length || !t.collection) continue;
    tripLeft.set(t.id, 0);
    for (const n of ds) { const a = get(n); const share = t.collection / ds.length;
      a.collected += share; a.entries.push({ date: t.date, kind: 'trip', amount: share, ref: t }); }
  }
  for (const e of S.data.expenses) if (e.paidBy === 'driver' && e.driver) { const a = get(e.driver); a.spent += e.amount; a.entries.push({ date: e.date, kind: 'expense', amount: -e.amount, ref: e }); }
  for (const h of S.data.handovers || []) { const a = get(h.driver); a.handedIn += h.amount; a.entries.push({ date: h.date, kind: 'handover', amount: -h.amount, ref: h }); }
  const order = { trip: 0, expense: 1, handover: 2 };
  for (const a of acc.values()) {
    a.entries.sort((x, y) => x.date.localeCompare(y.date) || order[x.kind] - order[y.kind]);
    let bal = 0; for (const e of a.entries) { bal += e.amount; e.balance = bal; }
    a.owed = bal;
    // settle oldest trips first with everything credited
    let credit = a.spent + a.handedIn; a.oldest = null;
    for (const e of a.entries.filter(e => e.kind === 'trip')) {
      const used = Math.min(credit, e.amount); credit -= used;
      const left = e.amount - used;
      if (left > 0.5) { tripLeft.set(e.ref.id, tripLeft.get(e.ref.id) + left); a.oldest ||= e.date; }
    }
    a.lastHandover = [...a.entries].reverse().find(e => e.kind === 'handover')?.ref || null;
  }
  return (cashLedger.cache = { data: S.data, accounts: [...acc.values()], tripLeft,
    total: [...acc.values()].reduce((s, a) => s + Math.max(0, a.owed), 0) });
}
// 'office' | 'settled' | 'with driver' (+ how much is still out)
function tripCash(t) {
  if (t.status !== 'done') return { state: '' };
  if (t.collectedBy === 'office') return { state: 'office' };
  const left = cashLedger().tripLeft.get(t.id);
  return left > 0.5 ? { state: 'with driver', left } : { state: 'settled' };
}
function cashChip(t) {
  const c = tripCash(t);
  if (c.state === 'office') return '<span class="chip">paid to office</span>';
  if (c.state === 'settled') return '<span class="chip completed">handed in</span>';
  if (c.state === 'with driver') return `<span class="chip due">with driver${c.left < (t.collection || 0) - 0.5 ? ' ' + money(c.left) : ''}</span>`;
  return '';
}
const daysAgo = iso => Math.round((new Date(todayIso()) - new Date(iso)) / 86400e3);
const ago = iso => { const n = daysAgo(iso); return n === 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'; };

function summarize(from, to) {
  const trips = S.data.trips.filter(t => inRange(t.date, from, to));
  const exps = S.data.expenses.filter(e => inRange(e.date, from, to));
  const done = trips.filter(t => t.status === 'done');
  const collection = done.reduce((s, t) => s + (t.collection || 0), 0);
  const notReceived = done.reduce((s, t) => s + (tripCash(t).left || 0), 0);
  const expense = exps.filter(countsAsExpense).reduce((s, e) => s + e.amount, 0);
  return { trips, exps, done, collection, notReceived, expense, net: collection - expense,
    cancelled: trips.filter(t => t.status !== 'done').length };
}
function perDriver(trips, exps) {
  const m = new Map(S.data.drivers.map(d => [d.name.toLowerCase(), { name: d.name, car: d.vehicleNo, trips: 0, collection: 0, received: 0, pending: 0, expense: 0 }]));
  const get = n => { const k = n.toLowerCase(); if (!m.has(k)) m.set(k, { name: n, car: '', trips: 0, collection: 0, received: 0, pending: 0, expense: 0 }); return m.get(k); };
  for (const t of trips) {
    const ds = driversOf(t); if (!ds.length) continue;
    for (const n of ds) {
      const row = get(n); row.trips += 1 / ds.length;
      if (t.status !== 'done') continue;
      const share = (t.collection || 0) / ds.length; // a shared trip's money is split evenly between its drivers
      row.collection += share;
    }
  }
  for (const e of exps) if (e.driver && countsAsExpense(e)) get(e.driver).expense += e.amount;
  const led = cashLedger().accounts;
  return [...m.values()].map(r => ({ ...r, net: r.collection - r.expense, holding: led.find(a => a.name.toLowerCase() === r.name.toLowerCase())?.owed || 0 }))
    .sort((a, b) => b.collection - a.collection);
}

// ---------- dashboard (owner) ----------
const PERIODS = {
  today: ['Today', () => [todayIso(), todayIso()]],
  yesterday: ['Yesterday', () => [addDays(todayIso(), -1), addDays(todayIso(), -1)]],
  week: ['Last 7 days', () => [addDays(todayIso(), -6), todayIso()]],
  month: ['This month', () => [todayIso().slice(0, 8) + '01', todayIso()]],
  d30: ['Last 30 days', () => [addDays(todayIso(), -29), todayIso()]],
  all: ['All time', () => ['', '']],
};
function renderDashboard(el, period = 'month') {
  if (!PERIODS[period]) period = 'month';
  const [from, to] = PERIODS[period][1]();
  const s = summarize(from, to);
  const led = cashLedger();
  const holders = led.accounts.filter(a => a.owed > 0.5);
  const oldest = holders.map(a => a.oldest).filter(Boolean).sort()[0];
  const lateEdits = S.data.activity.filter(a => a.late && inRange(a.at.slice(0, 10), from, to));
  const drivers = perDriver(s.trips, s.exps);

  const byCat = {};
  for (const e of s.exps.filter(countsAsExpense)) byCat[e.category || 'Other'] = (byCat[e.category || 'Other'] || 0) + e.amount;
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map(c => c[1]));

  const byPlace = {};
  // Group "3+R/M" and "3+r/m" together: the sheet mixes upper and lower case.
  for (const t of s.done) { const k = String(t.place || '-').toLowerCase().replace(/\s+/g, ' '); const p = byPlace[k] ||= { n: 0, sum: 0 }; p.n++; p.sum += t.collection || 0; }
  const places = Object.entries(byPlace).sort((a, b) => b[1].n - a[1].n);
  const rate = code => S.data.places.find(p => p.code.toLowerCase() === String(code).toLowerCase());

  el.innerHTML = `
    <div class="pagehead">
      <div><p class="eyebrow">${isOwner() ? 'Owner overview' : 'Overview'}</p><h1>Dashboard</h1><div class="muted">${from ? `${fmtDate(from)} to ${fmtDate(to)}` : 'All time'}</div></div>
      <select id="period" style="width:auto">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${k === period ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
    </div>
    <div class="grid kpis">
      ${kpi('Collection (money in)', money(s.collection), `${s.done.length} trips done`, 'in')}
      ${kpi('Expenses (money out)', money(s.expense), `${s.exps.filter(countsAsExpense).length} entries`, 'out')}
      ${kpi('Net', money(s.net), 'collection minus expenses', s.net >= 0 ? 'in' : 'out')}
      ${kpi('Cancelled / no charge', s.cancelled, `of ${s.trips.length} trips`)}
      <a href="#/cash" class="card kpi" style="text-decoration:none;color:inherit">
        <div class="label">Cash with drivers right now</div><div class="value out">${money(led.total)}</div>
        <div class="sub">${holders.length} drivers${oldest ? ` · oldest from ${ago(oldest)}` : ''} · see who →</div></a>
    </div>

    <div class="card section chart">
      <div class="row spread"><h2>Daily collection vs expenses</h2>
        <div class="legend"><span><i style="background:var(--in)"></i>Collection</span><span><i style="background:var(--out)"></i>Expenses</span></div></div>
      ${dailyChart(from || S.data.trips.map(t => t.date).sort()[0], to || todayIso())}
    </div>

    <div class="card section">
      <div class="row spread"><h2>Per driver</h2><span class="muted small">Shared trips are split evenly. Expenses are matched by the driver named on the expense.</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Driver</th><th class="hide-sm">Car</th><th class="num">Trips</th><th class="num">Collection</th><th class="num">Car expenses</th><th class="num">Net</th><th class="num">Cash with driver now</th></tr></thead>
        <tbody>${drivers.map(d => `<tr>
          <td><b>${esc(d.name)}</b></td><td class="hide-sm muted">${esc(d.car)}</td><td class="num">${+d.trips.toFixed(1)}</td>
          <td class="num">${money(d.collection)}</td><td class="num">${money(d.expense)}</td>
          <td class="num"><b>${money(d.net)}</b></td>
          <td class="num"><a href="#/cash/${encodeURIComponent(d.name)}" class="${d.holding > 0.5 ? 'out' : 'muted'}">${money(d.holding)}</a></td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Total</td><td class="hide-sm"></td><td class="num">${s.trips.length}</td><td class="num">${money(s.collection)}</td>
          <td class="num">${money(drivers.reduce((a, d) => a + d.expense, 0))}</td><td class="num"></td><td class="num">${money(led.total)}</td></tr></tfoot>
      </table></div>
    </div>

    <div class="grid two section">
      <div class="card"><h2>Where the money goes</h2>
        ${cats.length ? `<div class="bars">${cats.map(([c, v]) => `<div class="bar-row"><span>${esc(c)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(v / maxCat * 100).toFixed(1)}%"></div></div><span class="num">${money(v)}</span></div>`).join('')}</div>` : '<div class="empty">No expenses in this period</div>'}
        ${s.exps.some(e => !countsAsExpense(e)) ? `<p class="muted small">Opening balance entries (${money(s.exps.filter(e => !countsAsExpense(e)).reduce((a, e) => a + e.amount, 0))}) are shown on the day sheet but left out of expenses here.</p>` : ''}
      </div>
      <div class="card"><h2>Places of visit</h2>
        <div class="table-wrap"><table><thead><tr><th>Place</th><th class="num">Trips</th><th class="num">Average</th><th class="num">Usual rate</th></tr></thead>
        <tbody>${places.map(([code, p]) => { const r = rate(code); const avg = p.sum / p.n;
          return `<tr><td><b>${esc(code)}</b> <span class="muted small">${esc(r?.name || '')}</span></td><td class="num">${p.n}</td>
          <td class="num ${r?.standardRate && avg < r.standardRate * 0.9 ? 'out' : ''}">${money(avg)}</td><td class="num muted">${r?.standardRate ? money(r.standardRate) : '-'}</td></tr>`; }).join('')}</tbody></table></div>
      </div>
    </div>

    ${isOwner() ? `<div class="card section">
      <div class="row spread"><h2>Latest updates</h2><a href="#/activity">Full activity log →</a></div>
      ${lateEdits.length ? `<p class="small out">⚠ ${lateEdits.length} change${lateEdits.length > 1 ? 's were' : ' was'} made to an earlier day's sheet in this period. <a href="#/activity/late">Review them</a></p>` : ''}
      ${feed(S.data.activity.slice(0, 12))}
    </div>` : ''}`;
  $('#period').onchange = e => { location.hash = '#/dashboard/' + e.target.value; };
}
function kpi(label, value, sub, cls = '') {
  return `<div class="card kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub || ''}</div></div>`;
}
function dailyChart(from, to) {
  if (!from) return '<div class="empty">No data yet</div>';
  const days = []; for (let d = from; d <= to && days.length < 120; d = addDays(d, 1)) days.push(d);
  const col = {}, exp = {};
  for (const t of S.data.trips) if (t.status === 'done') col[t.date] = (col[t.date] || 0) + (t.collection || 0);
  for (const e of S.data.expenses) if (countsAsExpense(e)) exp[e.date] = (exp[e.date] || 0) + e.amount;
  const max = Math.max(1, ...days.map(d => Math.max(col[d] || 0, exp[d] || 0)));
  const W = 1000, H = 180, pad = 22, bw = (W / days.length);
  const bars = days.map((d, i) => {
    const x = i * bw, h1 = (col[d] || 0) / max * (H - pad - 4), h2 = (exp[d] || 0) / max * (H - pad - 4);
    const w = Math.max(1, bw * 0.38);
    return `<a href="#/day/${d}"><g><title>${fmtDate(d)}: collection ${money(col[d])}, expenses ${money(exp[d])}</title>
      <rect x="${x + bw * 0.1}" y="${H - pad - h1}" width="${w}" height="${h1}" fill="var(--in)" rx="1.5"/>
      <rect x="${x + bw * 0.1 + w + 1}" y="${H - pad - h2}" width="${w}" height="${h2}" fill="var(--out)" rx="1.5"/>
      <rect x="${x}" y="0" width="${bw}" height="${H}" fill="transparent"/></g></a>`;
  }).join('');
  const step = Math.ceil(days.length / 8);
  const labels = days.map((d, i) => i % step === 0 ? `<text x="${i * bw + bw / 2}" y="${H - 6}" font-size="11" fill="var(--muted)" text-anchor="middle">${d.slice(8)}/${d.slice(5, 7)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily collection and expenses">${bars}${labels}</svg>
    <div class="muted small">Peak day ${money(max)}. Click a day to open its sheet.</div>`;
}

// ---------- day sheet (staff + owner) ----------
function renderDay(el, date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : todayIso();
  const trips = S.data.trips.filter(t => t.date === date);
  const exps = S.data.expenses.filter(e => e.date === date);
  const s = summarize(date, date);
  const opening = exps.filter(e => !countsAsExpense(e)).reduce((a, e) => a + e.amount, 0);
  const hands = (S.data.handovers || []).filter(h => h.date === date);
  el.innerHTML = `
    <div class="pagehead">
      <div><p class="eyebrow">Day sheet${date === todayIso() ? ' · today' : ''}</p><h1>${fmtDate(date)}</h1><div class="muted small">Same columns as the Excel sheet. Totals add up by themselves.</div></div>
      <div class="row">
        <a class="btn sm" href="#/day/${addDays(date, -1)}">← Prev</a>
        <input type="date" id="pick" value="${date}" style="width:auto">
        <a class="btn sm" href="#/day/${addDays(date, 1)}">Next →</a>
        ${date !== todayIso() ? `<a class="btn sm" href="#/day">Today</a>` : ''}
      </div>
    </div>
    <div class="grid kpis">
      ${kpi('Collection', money(s.collection), `${s.done.length} done · ${s.cancelled} cancelled/no`, 'in')}
      ${kpi('Expenses', money(s.expense), opening ? `plus opening balance ${money(opening)}` : `${exps.length} entries`, 'out')}
      ${kpi('Collection − expenses', money(s.net), 'same as the sheet’s total row' + (opening ? ', without opening balance' : ''))}
      ${kpi('Still with drivers', money(s.notReceived), `from this day’s trips · ${money(hands.reduce((a, h) => a + h.amount, 0))} handed in today`, s.notReceived ? 'out' : '')}
    </div>
    <div class="card section">
      <div class="row spread"><h2>Trips</h2><button class="btn primary" id="add-trip">+ Add trip</button></div>
      ${trips.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Driver</th><th>Pax</th><th>Place of visit</th><th class="num">Collection</th><th>Money</th><th>Paid by</th><th>Remarks</th><th class="hide-sm">Entered by</th></tr></thead>
        <tbody>${trips.map(t => `<tr class="click" data-trip="${t.id}">
          <td><b>${esc(t.drivers)}</b></td><td>${esc(t.pax)}</td><td>${esc(t.place)}</td>
          <td class="num">${t.status === 'done' ? money(t.collection) : `<span class="chip cancelled">${esc(t.status)}</span>`}</td>
          <td>${cashChip(t)}</td>
          <td>${esc(t.payMode)}</td><td class="muted">${esc(t.remarks)}</td>
          <td class="hide-sm muted small">${esc(t.createdBy)}${t.updatedAt ? ' · edited' : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total</td><td class="num">${money(s.collection)}</td><td colspan="4"></td></tr></tfoot>
      </table></div>` : '<div class="empty">No trips entered for this day yet.</div>'}
    </div>
    <div class="card section">
      <div class="row spread"><h2>Expenses</h2><button class="btn out-btn" id="add-exp">+ Add expense</button></div>
      ${exps.length ? `<div class="table-wrap"><table>
        <thead><tr><th class="num">Amount</th><th>Expense remarks</th><th>Driver</th><th>Type</th><th>Paid by</th><th class="hide-sm">Entered by</th></tr></thead>
        <tbody>${exps.map(e => `<tr class="click" data-exp="${e.id}">
          <td class="num"><b>${money(e.amount)}</b></td><td>${esc(e.remarks)}</td><td>${esc(e.driver)}</td>
          <td><span class="chip">${esc(e.category)}</span></td><td>${e.paidBy === 'driver' ? '<span class="chip ongoing">driver, from cash</span>' : '<span class="muted small">office</span>'}</td><td class="hide-sm muted small">${esc(e.createdBy)}${e.updatedAt ? ' · edited' : ''}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td class="num">${money(s.expense + opening)}</td><td colspan="5"></td></tr></tfoot>
      </table></div>` : '<div class="empty">No expenses entered for this day yet.</div>'}
    </div>
    <div class="card section">
      <div class="row spread"><h2>Cash handed in by drivers</h2><button class="btn in-btn" id="add-hand">+ Driver handed in cash</button></div>
      ${hands.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Driver</th><th class="num">Amount</th><th>How</th><th>Received by</th><th>Note</th></tr></thead>
        <tbody>${hands.map(h => `<tr class="click" data-hand="${h.id}"><td><b>${esc(h.driver)}</b></td><td class="num">${money(h.amount)}</td>
          <td>${esc(h.method)}</td><td>${esc(h.receivedBy)}</td><td class="muted">${esc(h.note)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">No cash handed in on this day.</div>'}
    </div>`;
  $('#pick').onchange = e => { location.hash = '#/day/' + e.target.value; };
  $('#add-trip').onclick = () => tripForm({ date });
  $('#add-exp').onclick = () => expenseForm({ date });
  $('#add-hand').onclick = () => handoverForm({ date });
  el.querySelectorAll('[data-hand]').forEach(tr => tr.onclick = () => handoverForm(S.data.handovers.find(h => h.id === tr.dataset.hand)));
  el.querySelectorAll('[data-trip]').forEach(tr => tr.onclick = e => { if (!e.target.closest('[data-stop]')) tripForm(S.data.trips.find(t => t.id === tr.dataset.trip)); });
  el.querySelectorAll('[data-exp]').forEach(tr => tr.onclick = () => expenseForm(S.data.expenses.find(x => x.id === tr.dataset.exp)));
}

// ---------- driver cash ----------
function renderCash(el, who) {
  const led = cashLedger();
  if (who) return renderStatement(el, decodeURIComponent(who), led);
  const rows = led.accounts.filter(a => a.entries.length).sort((a, b) => b.owed - a.owed);
  el.innerHTML = `
    <div class="pagehead"><div><p class="eyebrow">Collected, spent, handed in</p><h1>Driver cash</h1>
      <div class="muted">Money drivers collected from customers and haven't handed in yet: <b class="out">${money(led.total)}</b>.
      Fuel a driver paid from that cash is taken off. Handovers clear the oldest trips first.</div></div>
      <button class="btn in-btn" id="add-hand">+ Driver handed in cash</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Driver</th><th class="num">Holding now</th><th>Oldest money from</th><th>Last handed in</th><th class="num hide-sm">Collected (all)</th><th class="num hide-sm">Paid from cash</th><th class="num hide-sm">Handed in (all)</th><th></th></tr></thead>
      <tbody>${rows.map(a => `<tr class="click" data-who="${esc(a.name)}">
        <td><b>${esc(a.name)}</b></td>
        <td class="num ${a.owed > 0.5 ? 'out' : a.owed < -0.5 ? 'in' : 'muted'}"><b>${a.owed < -0.5 ? 'office owes ' + money(-a.owed) : money(a.owed)}</b></td>
        <td class="${a.oldest && daysAgo(a.oldest) > 3 ? 'out' : 'muted'}">${a.oldest ? ago(a.oldest) : '-'}</td>
        <td class="muted">${a.lastHandover ? `${money(a.lastHandover.amount)} · ${ago(a.lastHandover.date)}` : 'never'}</td>
        <td class="num hide-sm">${money(a.collected)}</td><td class="num hide-sm">${money(a.spent)}</td><td class="num hide-sm">${money(a.handedIn)}</td>
        <td data-stop>${a.owed > 0.5 ? `<button class="btn sm in-btn" data-hand="${esc(a.name)}" data-amt="${Math.round(a.owed)}">Handed in</button>` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${money(led.total)}</td><td colspan="6"></td></tr></tfoot>
    </table></div></div>
    <p class="muted small">Tap a driver for the full statement. Drivers older than 3 days are in red.</p>`;
  $('#add-hand').onclick = () => handoverForm({ date: todayIso() });
  el.querySelectorAll('[data-who]').forEach(tr => tr.onclick = e => { if (!e.target.closest('[data-stop]')) location.hash = '#/cash/' + encodeURIComponent(tr.dataset.who); });
  el.querySelectorAll('[data-hand]').forEach(b => b.onclick = () => handoverForm({ date: todayIso(), driver: b.dataset.hand, amount: +b.dataset.amt }));
}
function renderStatement(el, name, led) {
  const a = led.accounts.find(x => x.name.toLowerCase() === name.toLowerCase());
  if (!a) { el.innerHTML = '<div class="card empty">No such driver</div>'; return; }
  const rows = [...a.entries].reverse().slice(0, 200);
  const label = e => e.kind === 'trip' ? `Trip · ${esc(e.ref.place)} · ${esc(e.ref.pax)} pax${driversOf(e.ref).length > 1 ? ` · shared with ${esc(driversOf(e.ref).filter(n => n.toLowerCase() !== name.toLowerCase()).join(', '))}` : ''}`
    : e.kind === 'expense' ? `Paid from cash · ${esc(e.ref.category)} · ${esc(e.ref.remarks)}` : `Handed in · ${esc(e.ref.method)} · to ${esc(e.ref.receivedBy)}${e.ref.note ? ' · ' + esc(e.ref.note) : ''}`;
  el.innerHTML = `
    <div class="pagehead"><div><p class="eyebrow"><a href="#/cash">← All drivers</a> · Cash statement</p><h1>${esc(a.name)}</h1>
      <div class="muted">Holding now <b class="${a.owed > 0.5 ? 'out' : ''}">${money(a.owed)}</b>${a.oldest ? ` · oldest unpaid money from ${fmtDate(a.oldest)}` : ''}</div></div>
      ${a.owed > 0.5 ? `<button class="btn in-btn" id="hand-now">Record cash handed in</button>` : ''}</div>
    <div class="grid kpis">
      ${kpi('Collected from customers', money(a.collected), 'trips where the driver took the money', 'in')}
      ${kpi('Paid from that cash', money(a.spent), 'fuel and other costs', 'out')}
      ${kpi('Handed in', money(a.handedIn), `${a.entries.filter(e => e.kind === 'handover').length} times`)}
      ${kpi('Still holding', money(a.owed), a.lastHandover ? 'last handed in ' + ago(a.lastHandover.date) : 'never handed in', a.owed > 0.5 ? 'out' : '')}
    </div>
    <div class="card section"><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>What</th><th class="num">+ Collected</th><th class="num">− Paid / handed in</th><th class="num">Holding after</th><th></th></tr></thead>
      <tbody>${rows.map(e => `<tr><td><a href="#/day/${e.date}">${fmtDate(e.date)}</a></td><td>${label(e)}</td>
        <td class="num in">${e.amount > 0 ? money(e.amount) : ''}</td><td class="num out">${e.amount < 0 ? money(-e.amount) : ''}</td>
        <td class="num"><b>${money(e.balance)}</b></td><td>${e.kind === 'trip' ? cashChip(e.ref) : ''}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
  const b = $('#hand-now'); if (b) b.onclick = () => handoverForm({ date: todayIso(), driver: a.name, amount: Math.round(a.owed) });
}

// ---------- forms ----------
function openModal(html, onSubmit, onDelete) {
  const dlg = $('#modal'), form = $('#modal-form');
  form.innerHTML = html;
  form.onsubmit = async e => {
    e.preventDefault();
    if (e.submitter?.value === 'cancel') return dlg.close();
    const fd = new FormData(form); const obj = Object.fromEntries(fd.entries());
    form.querySelectorAll('input[type=checkbox][name]').forEach(cb => obj[cb.name] = cb.checked);
    try { await onSubmit(obj); dlg.close(); await reload(); route(); } catch (err) { $('.err', form).textContent = err.message; }
  };
  const del = $('[data-delete]', form);
  if (del) del.onclick = async () => {
    if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = 'Tap again to delete'; return; }
    try { await onDelete(); dlg.close(); await reload(); toast('Deleted'); route(); } catch (err) { $('.err', form).textContent = err.message; }
  };
  dlg.showModal();
  $('input:not([type=hidden]), select', form)?.focus();
}
const opt = (v, sel, label) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(label ?? v)}</option>`;
function actions(isEdit) {
  return `<p class="err"></p><div class="modal-actions">
    ${isEdit && isOwner() ? '<button type="button" class="btn ghost danger left" data-delete>Delete</button>' : ''}
    ${isEdit && !isOwner() ? '<span class="muted small left">Only the owner can delete. Every edit is logged.</span>' : ''}
    <button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="save">Save</button></div>`;
}
function tripForm(t) {
  const isEdit = !!t.id; const sel = driversOf(t);
  const activeDrivers = S.data.drivers.filter(d => d.active || sel.includes(d.name));
  openModal(`<h2>${isEdit ? 'Edit trip' : 'Add trip'} · ${fmtDate(t.date)}</h2>
    <div class="form-grid">
      <label class="full">Driver name (tick two if they shared the trip)
        <div class="row" style="gap:6px">${activeDrivers.map(d => `<label class="chip" style="cursor:pointer">
          <input type="checkbox" data-driver value="${esc(d.name)}" ${sel.includes(d.name) ? 'checked' : ''}>${esc(d.name)}</label>`).join('')}</div></label>
      <label>No of pax<input name="pax" value="${esc(t.pax)}" placeholder="e.g. 4 or 6+1"></label>
      <label>Place of visit<input name="place" list="places" value="${esc(t.place)}" placeholder="e.g. 3+m, pkg" required>
        <datalist id="places">${S.data.places.filter(p => p.active).map(p => `<option value="${esc(p.code)}">${esc(p.name || '')}</option>`).join('')}</datalist></label>
      <label>Trip status<select name="status" id="f-status">${['done', 'cancelled', 'no charge'].map(s => opt(s, t.status || 'done')).join('')}</select></label>
      <label>Collection (${cur()})<input name="collection" id="f-col" type="number" inputmode="numeric" min="0" step="1" value="${t.collection ?? ''}"></label>
      <label class="full">Who took the money?
        <div class="seg"><label><input type="radio" name="collectedBy" value="driver" ${t.collectedBy !== 'office' ? 'checked' : ''}>Driver (hands it in later)</label>
        <label><input type="radio" name="collectedBy" value="office" ${t.collectedBy === 'office' ? 'checked' : ''}>Paid to office directly</label></div></label>
      <label>Paid by<select name="payMode">${opt('', t.payMode, '-')}${opt('Cash', t.payMode)}${opt('T', t.payMode, 'T (online)')}</select></label>
      <label style="align-self:end" id="f-recv-wrap" title="Use this only for old entries. Normally record a handover instead."><span class="row" style="gap:6px;color:var(--text)"><input type="checkbox" name="received" ${t.received ? 'checked' : ''} style="width:auto"> Already settled (old Excel tick)</span></label>
      <label class="full">Remarks<input name="remarks" value="${esc(t.remarks)}" placeholder="e.g. avishek 1500 paid / norsang 1500 cash"></label>
    </div>${actions(isEdit)}`,
  async obj => {
    obj.drivers = [...document.querySelectorAll('[data-driver]:checked')].map(c => c.value).join(', ');
    if (!obj.drivers) throw new Error('Pick at least one driver');
    if (obj.status !== 'done') { obj.collection = ''; obj.received = false; }
    obj.date = t.date;
    await api(isEdit ? 'trips/' + t.id : 'trips', { method: isEdit ? 'PUT' : 'POST', body: obj });
    toast(isEdit ? 'Trip updated' : 'Trip added');
  }, () => api('trips/' + t.id, { method: 'DELETE' }));
  const st = $('#f-status'), col = $('#f-col'), form = $('#modal-form');
  const sync = () => { col.disabled = st.value !== 'done'; col.required = st.value === 'done';
    $('#f-recv-wrap').style.visibility = form.collectedBy.value === 'driver' && (t.received || isOwner()) ? 'visible' : 'hidden'; };
  st.onchange = sync; form.querySelectorAll('[name=collectedBy]').forEach(r => r.onchange = sync); sync();
}
const CATEGORIES = ['Fuel', 'Garage & repair', 'Tyre & tube', 'Accessories', 'Token & tax', 'Driver payment', 'Opening balance', 'Other'];
function expenseForm(e) {
  const isEdit = !!e.id;
  openModal(`<h2>${isEdit ? 'Edit expense' : 'Add expense'} · ${fmtDate(e.date)}</h2>
    <div class="form-grid">
      <label>Expense amount (${cur()})<input name="amount" type="number" inputmode="numeric" min="1" step="1" value="${e.amount ?? ''}" required></label>
      <label>Expense remarks<input name="remarks" id="f-rem" value="${esc(e.remarks)}" placeholder="e.g. lakpa oil"></label>
      <label>Driver / car<select name="driver" id="f-drv">${opt('', e.driver, '- office / none -')}${S.data.drivers.map(d => opt(d.name, e.driver, d.name + (d.vehicleNo ? ' · ' + d.vehicleNo : ''))).join('')}</select></label>
      <label>Type<select name="category" id="f-cat">${CATEGORIES.map(c => opt(c, e.category)).join('')}</select></label>
      <label class="full">Who paid?
        <div class="seg"><label><input type="radio" name="paidBy" value="office" ${e.paidBy !== 'driver' ? 'checked' : ''}>Office</label>
        <label><input type="radio" name="paidBy" value="driver" ${e.paidBy === 'driver' ? 'checked' : ''}>Driver, from cash he collected</label></div></label>
    </div>${actions(isEdit)}`,
  async obj => {
    obj.date = e.date;
    await api(isEdit ? 'expenses/' + e.id : 'expenses', { method: isEdit ? 'PUT' : 'POST', body: obj });
    toast(isEdit ? 'Expense updated' : 'Expense added');
  }, () => api('expenses/' + e.id, { method: 'DELETE' }));
  // Typing "lakpa oil" fills in the driver and type, the way the sheet's remarks are written.
  if (!isEdit) $('#f-rem').oninput = ev => {
    const words = ev.target.value.toLowerCase().split(/[^a-z]+/);
    const d = S.data.drivers.find(d => words.includes(d.name.toLowerCase()) || (d.aliases || []).some(a => words.includes(a.toLowerCase())));
    if (d) $('#f-drv').value = d.name;
    const v = ev.target.value;
    const c = /oil|diesel|petrol/i.test(v) ? 'Fuel' : /garage|repair|align|aligment|batt/i.test(v) ? 'Garage & repair' : /tyre|tire|tube/i.test(v) ? 'Tyre & tube'
      : /\bmat\b|cover/i.test(v) ? 'Accessories' : /token|tax|permit|toll/i.test(v) ? 'Token & tax' : /opening/i.test(v) ? 'Opening balance' : null;
    if (c) $('#f-cat').value = c;
  };
}

function handoverForm(h) {
  const isEdit = !!h.id;
  const led = cashLedger();
  const holding = n => led.accounts.find(a => a.name === n)?.owed || 0;
  openModal(`<h2>${isEdit ? 'Edit cash handed in' : 'Driver handed in cash'} · ${fmtDate(h.date)}</h2>
    <div class="form-grid">
      <label>Driver<select name="driver" id="f-hd" required>${opt('', h.driver, '- pick -')}${S.data.drivers.filter(d => d.active || d.name === h.driver)
        .map(d => opt(d.name, h.driver, `${d.name}${holding(d.name) > 0.5 ? ' · holding ' + money(holding(d.name)) : ''}`)).join('')}</select></label>
      <label>Amount handed in (${cur()})<input name="amount" id="f-ha" type="number" inputmode="numeric" min="1" step="1" value="${h.amount ?? ''}" required></label>
      <label>How<select name="method">${['Cash', 'UPI', 'Bank transfer'].map(m => opt(m, h.method || 'Cash')).join('')}</select></label>
      <label>Date<input name="date" type="date" value="${h.date}" required></label>
      <label class="full">Note<input name="note" value="${esc(h.note)}" placeholder="e.g. short by 500, will bring tomorrow"></label>
      <p class="full muted small" id="f-hleft"></p>
    </div>${actions(isEdit)}`,
  async obj => {
    await api(isEdit ? 'handovers/' + h.id : 'handovers', { method: isEdit ? 'PUT' : 'POST', body: obj });
    toast(`${obj.driver} handed in ${money(obj.amount)}`);
  }, () => api('handovers/' + h.id, { method: 'DELETE' }));
  const show = () => { const d = $('#f-hd').value; if (!d) return $('#f-hleft').textContent = '';
    const now = holding(d) + (isEdit && d === h.driver ? h.amount : 0); const after = now - (+$('#f-ha').value || 0);
    $('#f-hleft').textContent = `${d} is holding ${money(now)}. After this: ${after >= 0 ? money(after) + ' still with him' : 'office owes him ' + money(-after)}.`; };
  $('#f-hd').oninput = () => { if (!isEdit && !$('#f-ha').value) $('#f-ha').value = Math.max(0, Math.round(holding($('#f-hd').value))) || ''; show(); };
  $('#f-ha').oninput = show; show();
}

// ---------- drivers & places (owner) ----------
function renderDrivers(el) {
  el.innerHTML = `
    <div class="pagehead"><div><p class="eyebrow">Fleet</p><h1>Drivers &amp; cars</h1><div class="muted">Each driver has one car. Inactive drivers are hidden from the trip form.</div></div>
      <button class="btn primary" id="add-driver">+ Add driver</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Driver</th><th>Phone</th><th>Car number</th><th>Model</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>${S.data.drivers.map(d => `<tr class="click" data-id="${d.id}"><td><b>${esc(d.name)}</b></td><td>${esc(d.phone)}</td>
        <td>${esc(d.vehicleNo)}</td><td>${esc(d.vehicleModel)}</td><td>${d.active ? '<span class="chip completed">active</span>' : '<span class="chip cancelled">inactive</span>'}</td>
        <td class="muted small">${esc(d.notes)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="pagehead section"><div><h2>Places of visit</h2><div class="muted small">The short codes used in the sheet. Add what each one means and the usual rate, and the dashboard flags trips charged well below it.</div></div>
      <button class="btn" id="add-place">+ Add place</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Code</th><th>Meaning</th><th class="num">Usual rate</th><th>Status</th></tr></thead>
      <tbody>${S.data.places.map(p => `<tr class="click" data-place="${p.id}"><td><b>${esc(p.code)}</b></td><td>${esc(p.name) || '<span class="muted">add meaning</span>'}</td>
        <td class="num">${p.standardRate ? money(p.standardRate) : '-'}</td><td>${p.active ? 'active' : 'inactive'}</td></tr>`).join('')}</tbody></table></div></div>`;
  const driverForm = d => openModal(`<h2>${d.id ? 'Edit driver' : 'Add driver'}</h2><div class="form-grid">
      <label>Name<input name="name" value="${esc(d.name)}" required></label><label>Phone<input name="phone" value="${esc(d.phone)}"></label>
      <label>Car number<input name="vehicleNo" value="${esc(d.vehicleNo)}" placeholder="WB 76 A 1234"></label><label>Car model<input name="vehicleModel" value="${esc(d.vehicleModel)}"></label>
      <label class="full">Notes<input name="notes" value="${esc(d.notes)}"></label>
      <label><span class="row" style="gap:6px;color:var(--text)"><input type="checkbox" name="active" ${d.active !== false ? 'checked' : ''} style="width:auto"> Active</span></label>
    </div>${actions(!!d.id)}`,
    obj => api(d.id ? 'drivers/' + d.id : 'drivers', { method: d.id ? 'PUT' : 'POST', body: obj }), () => api('drivers/' + d.id, { method: 'DELETE' }));
  const placeForm = p => openModal(`<h2>${p.id ? 'Edit place' : 'Add place'}</h2><div class="form-grid">
      <label>Code<input name="code" value="${esc(p.code)}" required placeholder="3+m"></label><label>Usual rate (${cur()})<input name="standardRate" type="number" value="${p.standardRate ?? ''}"></label>
      <label class="full">Meaning<input name="name" value="${esc(p.name)}" placeholder="e.g. 3 point + Mirik"></label>
      <label><span class="row" style="gap:6px;color:var(--text)"><input type="checkbox" name="active" ${p.active !== false ? 'checked' : ''} style="width:auto"> Active</span></label>
    </div>${actions(!!p.id)}`,
    obj => api(p.id ? 'places/' + p.id : 'places', { method: p.id ? 'PUT' : 'POST', body: obj }), () => api('places/' + p.id, { method: 'DELETE' }));
  $('#add-driver').onclick = () => driverForm({});
  $('#add-place').onclick = () => placeForm({});
  el.querySelectorAll('[data-id]').forEach(tr => tr.onclick = () => driverForm(S.data.drivers.find(d => d.id === tr.dataset.id)));
  el.querySelectorAll('[data-place]').forEach(tr => tr.onclick = () => placeForm(S.data.places.find(p => p.id === tr.dataset.place)));
}

// ---------- activity (owner) ----------
function feed(items) {
  if (!items.length) return '<div class="empty">Nothing yet</div>';
  const label = { create: 'added', update: 'changed', delete: 'deleted', import: 'imported', seed: 'loaded' };
  return `<ul class="feed">${items.map(a => `<li><div class="when">${fmtTime(a.at)}</div><div>
    <span class="act">${esc(a.user)}</span> ${label[a.action] || a.action} ${a.collection === 'handovers' ? 'cash handover' : a.collection && a.action !== 'import' ? esc(a.collection.replace(/s$/, '')) : ''}
    ${a.late ? '<span class="chip due">earlier day</span>' : ''} <span class="muted">· ${esc(a.summary)}</span>
    ${a.changes && Object.keys(a.changes).length ? `<div class="changes">${Object.entries(a.changes).map(([k, [b, n]]) => `${esc(k)}: <s>${esc(b) || '∅'}</s> → <b>${esc(n) || '∅'}</b>`).join(' · ')}</div>` : ''}
  </div></li>`).join('')}</ul>`;
}
function renderActivity(el, filter = '') {
  const users = [...new Set(S.data.activity.map(a => a.user))];
  let items = S.data.activity;
  if (filter === 'late') items = items.filter(a => a.late);
  else if (filter === 'changes') items = items.filter(a => a.action === 'update' || a.action === 'delete');
  else if (filter) items = items.filter(a => a.user === decodeURIComponent(filter));
  el.innerHTML = `<div class="pagehead"><div><p class="eyebrow">Who changed what</p><h1>Activity log</h1><div class="muted">Every entry, edit and delete, with who did it and when. Edits show the old and new value.</div></div>
    <select id="flt" style="width:auto">${opt('', filter, 'Everything')}${opt('changes', filter, 'Edits and deletes only')}${opt('late', filter, 'Changes to earlier days')}
      ${users.map(u => opt(encodeURIComponent(u), filter, 'By ' + u)).join('')}</select></div>
    <div class="card">${feed(items.slice(0, 300))}</div>`;
  $('#flt').onchange = e => { location.hash = '#/activity/' + e.target.value; };
}

// ---------- import / export (owner) ----------
function renderData(el) {
  const demo = [...S.data.trips, ...S.data.expenses, ...(S.data.handovers || [])].filter(x => x.source === 'demo').length;
  const users = S.data.users || [];
  el.innerHTML = `<div class="pagehead"><div><p class="eyebrow">Your data</p><h1>Import / export</h1></div></div>
    <div class="card" style="margin-bottom:16px" id="logins">
      <div class="row spread"><div><h2>Logins and PINs</h2>
        ${S.user.demoPins ? `<p class="out small"><b>The demo PINs 1234 and 1111 still work.</b> Anyone who finds this page could log in, so give each person a new PIN now.</p>`
          : '<p class="muted small">Each person logs in with their own PIN. Changing a PIN logs that person out on every phone and computer.</p>'}</div>
        <button class="btn sm" id="add-login">Add staff login</button></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead>
        <tbody>${users.map(u => `<tr><td>${esc(u.name)}</td><td>${u.role === 'owner' ? 'Owner' : 'Office staff'}</td>
          <td class="num"><button class="btn sm" data-pin="${esc(u.id)}">Change PIN</button>
          ${u.role !== 'owner' ? `<button class="btn sm ghost" data-rm="${esc(u.id)}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    </div>
    ${demo ? `<div class="card" style="margin-bottom:16px"><div class="row spread"><div><b>The tracker has ${demo} made-up demo entries.</b>
      <div class="muted small">Remove them before you import your real Excel so the totals are only yours. Drivers and places stay.</div></div>
      <button class="btn danger" id="clear-demo">Remove demo entries</button></div></div>` : ''}
    <div class="grid two">
      <div class="card"><h2>Import the Excel tracker</h2>
        <p class="muted">Pick the Transport Tracker .xlsx. Each sheet named like <b>261126</b> becomes that day (26 Nov 2026). Rows with "cancel" or "no" in Collection come in as cancelled or no charge. Importing the same file again replaces those days instead of adding them twice.</p>
        <input type="file" id="xlsx" accept=".xlsx,.xls">
        <div id="xlsx-preview" class="section"></div>
      </div>
      <div class="card"><h2>Export (opens in Excel)</h2>
        <p class="muted">Download everything as CSV files for backup or your accountant.</p>
        <div class="row">${['trips', 'expenses', 'handovers', 'drivers', 'places'].map(c => `<a class="btn" href="/api/export/${c}.csv">${c[0].toUpperCase() + c.slice(1)} CSV</a>`).join('')}</div>
        <h2 class="section">Import CSV</h2>
        <p class="muted small">Same columns as the export. Rows with an existing id are updated, others are added.</p>
        <div class="row"><select id="csv-col" style="width:auto">${['trips', 'expenses', 'handovers', 'drivers', 'places'].map(c => opt(c, 'trips')).join('')}</select><input type="file" id="csv" accept=".csv" style="width:auto"></div>
      </div>
    </div>`;
  el.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => loginForm(users.find(u => u.id === b.dataset.pin)));
  $('#add-login').onclick = () => loginForm(null);
  el.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Tap again to remove'; return; }
    try { await api('users/' + b.dataset.rm, { method: 'DELETE' }); await reload(); toast('Login removed'); route(); } catch (err) { toast(err.message); }
  });
  const cd = $('#clear-demo');
  if (cd) cd.onclick = async () => {
    if (!cd.dataset.sure) { cd.dataset.sure = 1; cd.textContent = 'Tap again to remove'; return; }
    const r = await api('clear-demo', { method: 'POST' }); await reload(); toast(`Removed ${r.removed} demo entries`); route();
  };
  $('#csv').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await api('import/' + $('#csv-col').value, { method: 'POST', body: await f.text() });
      await reload(); toast(`${r.added} added, ${r.updated} updated${r.errors.length ? ', ' + r.errors.length + ' skipped' : ''}`); if (r.errors.length) alertBox(r.errors); }
    catch (err) { toast(err.message); }
  };
  $('#xlsx').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const box = $('#xlsx-preview'); box.innerHTML = '<p class="muted">Reading…</p>';
    try {
      await loadSheetJs();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const days = parseWorkbook(wb);
      const nT = days.reduce((a, d) => a + d.trips.length, 0), nE = days.reduce((a, d) => a + d.expenses.length, 0);
      box.innerHTML = `<p><b>${days.length} day sheets</b> with ${nT} trips and ${nE} expenses.</p>
        <div class="table-wrap"><table><thead><tr><th>Sheet</th><th>Date</th><th class="num">Trips</th><th class="num">Collection</th><th class="num">Expenses</th></tr></thead>
        <tbody>${days.map(d => `<tr><td>${esc(d.sheet)}</td><td>${fmtDate(d.date)}</td><td class="num">${d.trips.length}</td>
          <td class="num">${money(d.trips.reduce((a, t) => a + (t.collection || 0), 0))}</td><td class="num">${money(d.expenses.reduce((a, x) => a + x.amount, 0))}</td></tr>`).join('')}</tbody></table></div>
        ${days.skipped?.length ? `<p class="muted small">Skipped sheets (name is not a date or they are empty): ${days.skipped.map(esc).join(', ')}</p>` : ''}
        ${days.length ? '<button class="btn primary" id="do-import">Import these days</button>' : ''}`;
      const btn = $('#do-import');
      if (btn) btn.onclick = async () => {
        btn.disabled = true;
        try { const r = await api('import-days', { method: 'POST', body: { days } }); await reload();
          box.innerHTML = `<p class="in"><b>Done.</b> ${r.trips} trips and ${r.expenses} expenses imported${r.replacedDays ? `, ${r.replacedDays} days replaced` : ''}.
            ${r.newDrivers.length ? 'New drivers added: ' + r.newDrivers.map(esc).join(', ') + '.' : ''}</p>
            <a class="btn" href="#/day/${days[days.length - 1].date}">Open ${fmtDate(days[days.length - 1].date)}</a>`; }
        catch (err) { toast(err.message); btn.disabled = false; }
      };
    } catch (err) { box.innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  };
}
// Change a PIN (and name), or add a staff login when u is null.
function loginForm(u) {
  openModal(`<h2>${u ? 'Change PIN for ' + esc(u.name) : 'New staff login'}</h2><div class="form-grid">
      <label>Name<input name="name" value="${esc(u?.name || '')}" required maxlength="60"></label>
      <label>New PIN (4 to 8 digits)<input name="pin" inputmode="numeric" pattern="\\d{4,8}" autocomplete="new-password" ${u ? 'placeholder="Empty keeps the old PIN"' : 'required'}></label>
      <p class="full muted small">${u ? 'Tell ' + esc(u.name) + ' the new PIN in person. ' : 'Staff can fill in the day sheet and driver cash, but cannot delete or see the dashboard. '}When everyone's PIN has the same number of digits, the keypad logs in as soon as the last digit is tapped.</p>
    </div>${actions(false)}`,
    async obj => {
      const r = await api(u ? 'users/' + u.id : 'users', { method: u ? 'PUT' : 'POST', body: obj });
      if (r.demoPins !== undefined) S.user.demoPins = r.demoPins;
      if (u && u.id === S.user.id) { S.user.name = r.name; $('#who').textContent = r.name; }
      toast(u ? 'Saved' : 'Login added');
    });
}
function alertBox(lines) { $('#xlsx-preview').innerHTML = `<p class="err">${lines.slice(0, 20).map(esc).join('<br>')}</p>`; }
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/xlsx.core.min.js'; // SheetJS 0.18.5 (Apache-2.0), kept in the repo so import works offline
    s.onload = ok; s.onerror = () => fail(new Error('Could not load the Excel reader.'));
    document.head.appendChild(s);
  });
}
// Turns the daily sheets (columns found by their header names, which move around between sheets)
// into { date, trips, expenses }. The total rows at the bottom are formulas and are ignored.
function parseWorkbook(wb) {
  const days = []; days.skipped = [];
  for (const name of wb.SheetNames) {
    const m = /^(\d{2})(\d{2})(\d{2})$/.exec(name.trim());
    if (!m) { days.skipped.push(name); continue; }
    const date = `20${m[3]}-${m[2]}-${m[1]}`;
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const head = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
    const col = n => head.indexOf(n);
    const c = { driver: col('driver name'), pax: col('no of pax'), place: col('place of visit'), collection: col('collection'),
      received: col('amount received'), remarks: col('remarks'), expAmt: col('expense amount'), expRem: col('expense remarks') };
    const trips = [], expenses = [];
    rows.slice(1).forEach((r, i) => {
      // Skip formula total rows: SheetJS gives their cached value, so detect by the cell having a formula.
      const cellHasFormula = k => k >= 0 && ws[XLSX.utils.encode_cell({ r: i + 1, c: k })]?.f;
      if (cellHasFormula(c.collection) || cellHasFormula(c.expAmt) || cellHasFormula(c.received)) return;
      const v = k => (k >= 0 ? r[k] : null);
      const drv = v(c.driver), colRaw = v(c.collection);
      if (drv || v(c.place) || (colRaw != null && colRaw !== '')) {
        const num = typeof colRaw === 'number' ? colRaw : Number(String(colRaw ?? '').replace(/[^\d.]/g, ''));
        const txt = String(colRaw ?? '').trim().toLowerCase();
        const status = /canc/.test(txt) ? 'cancelled' : (txt === 'no' || (!txt && !num)) ? 'no charge' : 'done';
        const rem = String(v(c.remarks) ?? '').trim();
        const payMode = /^t$/i.test(rem) ? 'T' : /^cash$/i.test(rem) ? 'Cash' : '';
        trips.push({ drivers: String(drv || '').split(/\s*,\s*/).filter(Boolean).join(', ') || '(not entered)', pax: String(v(c.pax) ?? ''), place: String(v(c.place) ?? '').trim(),
          collection: status === 'done' ? num : null, status, received: v(c.received) === true || String(v(c.received)).toUpperCase() === 'TRUE',
          payMode, remarks: payMode ? '' : rem });
      }
      const amt = v(c.expAmt);
      if (typeof amt === 'number' && amt > 0) expenses.push({ amount: amt, remarks: String(v(c.expRem) ?? '').trim() });
    });
    if (!trips.length && !expenses.length) { days.skipped.push(name); continue; }
    days.push({ sheet: name, date, trips, expenses });
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- boot ----------
api('me').then(u => { S.user = u; return start(); }).catch(() => showLogin());
