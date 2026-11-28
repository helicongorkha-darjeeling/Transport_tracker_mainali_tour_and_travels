// Mainali Tour & Travels — Transport Tracker: the app logic and JSON API, shared by
//   server.js     (on your own computer, data in data/db.json)
//   api/index.js  (online on Vercel, data in a Postgres database such as Supabase)
// Each request runs against one in-memory copy of the data (`db`). The store decides where that
// copy comes from and saves what changed; requests are handled one at a time per process.

const crypto = require('crypto');

// ---------- schema ----------
// Mirrors the daily Excel sheet: one row per trip (driver, pax, place, collection, received,
// remarks) and a separate list of expenses (amount + remarks). Each driver drives one car.
const SCHEMA = {
  drivers: ['id', 'name', 'phone', 'vehicleNo', 'vehicleModel', 'active', 'notes'],
  places: ['id', 'code', 'name', 'standardRate', 'active'],
  // collectedBy: 'driver' = the driver took the money and owes it to the office until handed in;
  // 'office' = customer paid the office directly (cash at the desk or online), nothing owed by the driver.
  // received: ticked = already settled at the time (how the Excel sheet tracked it).
  trips: ['id', 'date', 'drivers', 'pax', 'place', 'collection', 'status', 'collectedBy', 'received', 'payMode',
    'remarks', 'source', 'createdBy', 'createdAt', 'updatedAt'],
  // paidBy: 'office' or 'driver' (driver paid it out of the cash he is holding, so he owes less).
  expenses: ['id', 'date', 'amount', 'driver', 'category', 'paidBy', 'remarks', 'source', 'createdBy', 'createdAt', 'updatedAt'],
  // Cash a driver hands in to the office.
  handovers: ['id', 'date', 'driver', 'amount', 'method', 'receivedBy', 'note', 'source', 'createdBy', 'createdAt', 'updatedAt'],
};
const NUMERIC = new Set(['standardRate', 'collection', 'amount']);
const BOOLEAN = new Set(['active', 'received']);
// Who may write what. Staff enter the daily sheet; the owner manages drivers and places.
const EMPLOYEE_WRITABLE = new Set(['trips', 'expenses', 'handovers']);
const DAILY = new Set(['trips', 'expenses', 'handovers']);
const ID_PREFIX = { drivers: 'D', places: 'P', trips: 'T', expenses: 'E', handovers: 'H' };
const STATUSES = ['done', 'cancelled', 'no charge'];
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India time

// ---------- data ----------
let db; // the data for the request being handled (set by handle())
let pendingActivity = []; // activity entries added during this request, for the store to save
function emptyDb() {
  return {
    settings: { businessName: 'Mainali Tour & Travels', currency: '₹' },
    users: defaultUsers(),
    drivers: [], places: [], trips: [], expenses: [], handovers: [], activity: [],
    counters: {},
  };
}
// The first logins. OWNER_PIN and STAFF_PIN let an online copy start without the demo PINs.
function defaultUsers() {
  return [
    { id: 'U1', name: 'Owner', role: 'owner', pin: String(process.env.OWNER_PIN || '1234') },
    { id: 'U2', name: 'Mehboob', role: 'employee', pin: String(process.env.STAFF_PIN || '1111') },
  ];
}
// A new database: demo data (unless NO_SEED is set) so the dashboard has something to show.
function newDb() {
  let fresh = emptyDb();
  if (!process.env.NO_SEED) {
    fresh = require('../scripts/seed').buildSeed(fresh);
    fresh.users = defaultUsers();
  }
  fresh.secret = crypto.randomBytes(32).toString('hex');
  return fresh;
}
function upgradeDb(d) { // older files from before these existed
  d.handovers ||= [];
  d.counters ||= {};
  d.activity ||= [];
  return d;
}
function nextId(collection) {
  // Never reuse an id, even after a CSV import brought in rows with their own ids.
  const highest = db[collection].reduce((m, r) => Math.max(m, Number(String(r.id).replace(/^\D+/, '')) || 0), 0);
  db.counters[collection] = Math.max(db.counters[collection] || 0, highest) + 1;
  return ID_PREFIX[collection] + String(db.counters[collection]).padStart(4, '0');
}
function addActivity(entry) {
  db.activity.unshift(entry);
  if (db.activity.length > 5000) db.activity.length = 5000;
  pendingActivity.push(entry);
}

// ---------- helpers ----------
// Logins are signed cookies (user id, expiry, signature), so they work across server restarts and
// across the many small servers Vercel runs. Changing someone's PIN logs them out everywhere.
const SESSION_DAYS = 30;
function secret() { return (db.secret ||= crypto.randomBytes(32).toString('hex')); }
function sign(user, exp) {
  return crypto.createHmac('sha256', secret()).update(`${user.id}.${exp}.${user.pin}`).digest('base64url');
}
function makeToken(user) {
  const exp = Date.now() + SESSION_DAYS * 86400e3;
  return `${user.id}.${exp}.${sign(user, exp)}`;
}
function currentUser(req) {
  const m = /(?:^|;\s*)sid=([A-Za-z0-9._-]+)/.exec(req.headers.cookie || '');
  if (!m || !db.secret) return null;
  const [uid, exp, sig] = m[1].split('.');
  const user = db.users.find(u => u.id === uid);
  if (!user || !(Number(exp) > Date.now()) || !sig) return null;
  const want = Buffer.from(sign(user, exp)), got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? user : null;
}
function cookie(req, value, maxAge) {
  const https = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL;
  return `sid=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}
function clientIp(req) {
  // On Vercel the platform sets x-real-ip; on your own computer use the connection's address.
  return (process.env.VERCEL && req.headers['x-real-ip']) || req.socket?.remoteAddress || 'unknown';
}
// Wrong-PIN limit: after 10 wrong PINs from one address, that address waits 15 minutes.
const FAIL_LIMIT = 10, FAIL_WINDOW = 15 * 60e3;
const DEMO_PINS = { U1: '1234', U2: '1111' };
const usesDemoPins = () => db.users.some(u => DEMO_PINS[u.id] && u.pin === DEMO_PINS[u.id]);
// OWNER_PIN / STAFF_PIN also take over from the demo PINs on a tracker that was created before
// they were set. A PIN changed in the app is never touched.
function applyEnvPins() {
  for (const [id, key] of [['U1', 'OWNER_PIN'], ['U2', 'STAFF_PIN']]) {
    const pin = String(process.env[key] || '').trim();
    const u = db.users.find(x => x.id === id);
    if (u && u.pin === DEMO_PINS[id] && /^\d{4,8}$/.test(pin) && !Object.values(DEMO_PINS).includes(pin)
      && !db.users.some(x => x !== u && x.pin === pin)) u.pin = pin;
  }
}
// Trips are paid in Cash or UPI. The old Excel sheet wrote "T" for online payments, so those
// (and anything saved as T or online) are stored as UPI.
const ONLINE_MODE = /^(t|online|t \(online\)|upi)$/i;
function normPayMode(v) { v = String(v ?? '').trim(); return ONLINE_MODE.test(v) ? 'UPI' : /^cash$/i.test(v) ? 'Cash' : v; }
function upgradePayModes() {
  for (const t of db.trips) if (t.payMode && t.payMode !== 'UPI' && ONLINE_MODE.test(t.payMode)) t.payMode = 'UPI';
}
function pinLengths() { return [...new Set(db.users.map(u => u.pin.length))]; }

// The API fills in `out`; handle() sends it once the data is saved, so nobody is told
// "saved" for something that wasn't.
function send(out, status, body, headers = {}) {
  const isStr = typeof body === 'string';
  out.status = status;
  out.headers = { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', ...headers };
  out.body = isStr ? body : JSON.stringify(body);
}
function writeOut(res, out) {
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}
function readBody(req) {
  // Vercel may have read the body already and parsed it into req.body.
  if (req.readableEnded && req.body !== undefined) {
    const b = req.body;
    return Promise.resolve(typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : JSON.stringify(b ?? ''));
  }
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 5e6) reject(new Error('Body too large')); else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function clean(collection, input, existing = {}) {
  const out = { ...existing };
  for (const f of SCHEMA[collection]) {
    if (['id', 'createdBy', 'createdAt', 'updatedAt'].includes(f)) continue;
    if (!(f in input)) continue;
    let v = input[f];
    if (NUMERIC.has(f)) v = v === '' || v == null ? null : Number(v);
    else if (BOOLEAN.has(f)) v = v === true || v === 'true' || v === '1' || v === 'yes';
    else v = v == null ? '' : String(v).trim().slice(0, 500);
    if (NUMERIC.has(f) && v != null && !Number.isFinite(v)) throw new Error(`${f} must be a number`);
    if (f === 'payMode') v = normPayMode(v);
    out[f] = v;
  }
  return out;
}
function validate(collection, r) {
  // Fill defaults so older records and CSV rows without the newer columns still pass.
  if (collection === 'trips') { r.status ||= 'done'; r.collectedBy ||= 'driver'; }
  if (collection === 'expenses') r.paidBy ||= 'office';
  const need = { drivers: ['name'], places: ['code'], trips: ['date', 'drivers'], expenses: ['date', 'amount'], handovers: ['date', 'driver', 'amount'] }[collection];
  for (const f of need) if (r[f] == null || r[f] === '') throw new Error(`${f} is required`);
  if (DAILY.has(collection) && !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw new Error('date must look like 2026-11-27');
  if (collection === 'trips') {
    if (!STATUSES.includes(r.status)) throw new Error('status must be one of: ' + STATUSES.join(', '));
    if (r.status === 'done' && !(r.collection >= 0)) throw new Error('collection amount is required for a done trip');
  }
  if (['expenses', 'handovers'].includes(collection) && !(r.amount > 0)) throw new Error('amount must be more than 0');
  if (collection === 'trips' && !['driver', 'office'].includes(r.collectedBy)) throw new Error('collectedBy must be driver or office');
  if (collection === 'expenses' && !['office', 'driver'].includes(r.paidBy)) throw new Error('paidBy must be office or driver');
  if (collection === 'expenses' && r.paidBy === 'driver' && !r.driver) throw new Error('pick the driver who paid');
}
function describe(collection, r) {
  const cur = db.settings.currency;
  switch (collection) {
    case 'trips':
      return `${r.date} · ${r.drivers} · ${r.place || '-'} · ` +
        (r.status === 'done' ? `${cur}${r.collection} ${r.collectedBy === 'office' ? '(paid to office)' : r.received ? '(settled)' : '(with driver)'}` : r.status);
    case 'handovers':
      return `${r.date} · ${r.driver} handed in ${cur}${r.amount}${r.method ? ' by ' + r.method : ''}${r.note ? ' · ' + r.note : ''}`;
    case 'expenses':
      return `${r.date} · expense ${cur}${r.amount} · ${r.category}${r.driver ? ' · ' + r.driver : ''}${r.paidBy === 'driver' ? ' (paid by driver)' : ''}${r.remarks ? ' · ' + r.remarks : ''}`;
    default:
      return `${collection.slice(0, -1)} ${r.name || r.code}`;
  }
}
function log(user, action, collection, record, changes) {
  // "late" = an entry for an earlier day was added, changed or deleted after that day ended.
  const late = DAILY.has(collection) && record.date < today();
  addActivity({
    at: new Date().toISOString(), user: user.name, role: user.role, action, collection,
    recordId: record.id, summary: describe(collection, record), changes: changes || null, late,
  });
}
function diff(before, after) {
  const ch = {};
  for (const k of Object.keys(after)) {
    if (['updatedAt'].includes(k)) continue;
    if (String(before[k] ?? '') !== String(after[k] ?? '')) ch[k] = [before[k] ?? '', after[k] ?? ''];
  }
  return ch;
}

// Expense remarks in the sheet look like "lakpa oil", "aniraj garage", "norsang tyre".
const CATEGORY_WORDS = [
  ['Fuel', /\b(oil|diesel|petrol|fuel)\b/i], ['Garage & repair', /\b(garage|repair|service|aligment|alignment|battery|battry|clutch|brake)\b/i],
  ['Tyre & tube', /\b(tyre|tire|tube|puncture)\b/i], ['Accessories', /\b(mat|cover|seat)\b/i],
  ['Token & tax', /\b(token|tax|permit|toll|parking)\b/i], ['Opening balance', /opening balance/i],
  ['Driver payment', /\b(salary|advance|bhatta|allowance)\b/i],
];
function guessCategory(remarks = '') {
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(remarks)) return cat;
  return 'Other';
}
function guessDriver(remarks = '') {
  const words = remarks.toLowerCase().split(/[^a-z]+/);
  const d = db.drivers.find(d => words.includes(d.name.toLowerCase()) ||
    (d.aliases || []).some(a => words.includes(a.toLowerCase())));
  return d ? d.name : '';
}

// ---------- CSV ----------
function toCsv(rows, fields) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [fields.join(','), ...rows.map(r => fields.map(f => esc(r[f])).join(','))].join('\r\n') + '\r\n';
}
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; if (row.some(x => x !== '')) rows.push(row); row = [];
    } else field += c;
  }
  row.push(field); if (row.some(x => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows.shift().map(h => h.trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

// ---------- API ----------
async function api(req, res, url, body) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const method = req.method;

  // Before login: whether the demo PINs are still in use (the login page only shows them then),
  // and the PIN length so the keypad can log in as soon as the last digit is tapped.
  if (parts[0] === 'hint' && method === 'GET') {
    const lengths = pinLengths();
    return send(res, 200, { demoPins: usesDemoPins(), pinLength: lengths.length === 1 ? lengths[0] : null });
  }

  if (parts[0] === 'login' && method === 'POST') {
    const { pin } = JSON.parse(body || '{}');
    const ip = clientIp(req), now = Date.now();
    const fails = db.loginFailures ||= {};
    for (const k of Object.keys(fails)) if (now - fails[k].since > FAIL_WINDOW) delete fails[k];
    if (fails[ip]?.count >= FAIL_LIMIT) {
      const mins = Math.ceil((fails[ip].since + FAIL_WINDOW - now) / 60e3);
      return send(res, 429, { error: `Too many wrong PINs. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` });
    }
    const user = db.users.find(u => u.pin === String(pin || ''));
    if (!user) {
      fails[ip] ||= { count: 0, since: now };
      fails[ip].count++;
      return send(res, 401, { error: 'Wrong PIN' });
    }
    delete fails[ip];
    return send(res, 200, { id: user.id, name: user.name, role: user.role, demoPins: usesDemoPins() },
      { 'Set-Cookie': cookie(req, makeToken(user), SESSION_DAYS * 86400) });
  }

  if (parts[0] === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });

  const user = currentUser(req);
  if (!user) return send(res, 401, { error: 'Please log in' });

  if (parts[0] === 'me') return send(res, 200, { id: user.id, name: user.name, role: user.role, demoPins: usesDemoPins() });

  if (parts[0] === 'data' && method === 'GET') {
    const { users, counters, activity, secret: _s, loginFailures: _f, ...rest } = db;
    return send(res, 200, {
      ...rest,
      users: user.role === 'owner' ? users.map(({ pin, ...u }) => u) : [],
      activity: user.role === 'owner' ? activity.slice(0, 500) : activity.filter(a => a.user === user.name).slice(0, 50),
    });
  }

  if (parts[0] === 'export' && method === 'GET') {
    const col = (parts[1] || '').replace(/\.csv$/, '');
    if (!SCHEMA[col]) return send(res, 404, { error: 'Unknown collection' });
    if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can export' });
    return send(res, 200, toCsv(db[col], SCHEMA[col]), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${col}-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  }

  if (parts[0] === 'import' && method === 'POST') {
    const col = parts[1];
    if (!SCHEMA[col]) return send(res, 404, { error: 'Unknown collection' });
    if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can import' });
    const rows = parseCsv(body);
    let added = 0, updated = 0; const errors = [];
    rows.forEach((row, i) => {
      try {
        const existing = row.id && db[col].find(r => r.id === row.id);
        if (existing) {
          const next = clean(col, row, existing); validate(col, next);
          next.updatedAt = new Date().toISOString();
          Object.assign(existing, next); updated++;
        } else {
          const rec = clean(col, row); validate(col, rec);
          rec.id = row.id || nextId(col);
          rec.createdBy = row.createdBy || user.name; rec.createdAt = row.createdAt || new Date().toISOString();
          db[col].push(rec); added++;
        }
      } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
    });
    addActivity({ at: new Date().toISOString(), user: user.name, role: user.role, action: 'import',
      collection: col, recordId: '', summary: `Imported ${col} CSV: ${added} added, ${updated} updated, ${errors.length} skipped` });
    return send(res, 200, { added, updated, errors });
  }

  // Import of the daily Excel sheets. The browser reads the .xlsx and sends plain rows.
  if (parts[0] === 'import-days' && method === 'POST') {
    if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can import' });
    const { days = [] } = JSON.parse(body);
    const stamp = new Date().toISOString();
    let trips = 0, expenses = 0, replacedDays = 0; const newDrivers = [];
    for (const day of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
      const before = db.trips.length + db.expenses.length;
      db.trips = db.trips.filter(t => !(t.date === day.date && t.source === 'excel'));
      db.expenses = db.expenses.filter(e => !(e.date === day.date && e.source === 'excel'));
      if (db.trips.length + db.expenses.length < before) replacedDays++;
      for (const t of day.trips || []) {
        for (const n of String(t.drivers).split(',').map(x => x.trim()).filter(x => x && !x.startsWith('('))) {
          if (!db.drivers.some(d => d.name.toLowerCase() === n.toLowerCase())) {
            db.drivers.push({ id: nextId('drivers'), name: n, phone: '', vehicleNo: '', vehicleModel: '', active: true, notes: 'Added by Excel import' });
            newDrivers.push(n);
          }
        }
        const rec = clean('trips', t);
        rec.status = rec.status || 'done';
        rec.collectedBy = rec.collectedBy || 'driver';
        rec.id = nextId('trips'); rec.date = day.date; rec.source = 'excel'; rec.createdBy = user.name + ' (Excel import)'; rec.createdAt = stamp;
        db.trips.push(rec); trips++;
      }
      for (const e of day.expenses || []) {
        const rec = clean('expenses', e);
        if (!(rec.amount > 0)) continue;
        rec.category = rec.category || guessCategory(rec.remarks);
        rec.driver = rec.driver || guessDriver(rec.remarks);
        rec.paidBy = rec.paidBy || 'office';
        rec.id = nextId('expenses'); rec.date = day.date; rec.source = 'excel'; rec.createdBy = user.name + ' (Excel import)'; rec.createdAt = stamp;
        db.expenses.push(rec); expenses++;
      }
    }
    addActivity({ at: stamp, user: user.name, role: user.role, action: 'import', collection: 'excel', recordId: '',
      summary: `Imported Excel: ${days.length} day sheets, ${trips} trips, ${expenses} expenses` +
        (replacedDays ? ` (replaced ${replacedDays} days imported before)` : '') + (newDrivers.length ? `. New drivers: ${newDrivers.join(', ')}` : '') });
    return send(res, 200, { days: days.length, trips, expenses, replacedDays, newDrivers });
  }

  if (parts[0] === 'clear-demo' && method === 'POST') {
    if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can do this' });
    const n = db.trips.length + db.expenses.length;
    db.trips = db.trips.filter(t => t.source !== 'demo');
    db.expenses = db.expenses.filter(e => e.source !== 'demo');
    const h = db.handovers.length; db.handovers = db.handovers.filter(x => x.source !== 'demo');
    const removed = n - db.trips.length - db.expenses.length + h - db.handovers.length;
    addActivity({ at: new Date().toISOString(), user: user.name, role: user.role, action: 'delete', collection: '',
      recordId: '', summary: `Removed ${removed} demo entries` });
    return send(res, 200, { removed });
  }

  // Logins (owner only): change a PIN, add or remove a staff login. PINs are never sent back.
  if (parts[0] === 'users' && ['POST', 'PUT', 'DELETE'].includes(method)) {
    if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can change logins' });
    const input = method === 'DELETE' ? {} : JSON.parse(body || '{}');
    const checkPin = (pin, self) => {
      pin = String(pin ?? '').trim();
      if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4 to 8 digits');
      if (Object.values(DEMO_PINS).includes(pin)) throw new Error('Pick a PIN other than the demo PINs 1234 and 1111');
      if (db.users.some(u => u !== self && u.pin === pin)) throw new Error('Someone else already uses that PIN. Pick another.');
      return pin;
    };
    const stamp = () => ({ at: new Date().toISOString(), user: user.name, role: user.role, collection: 'users', changes: null, late: false });
    try {
      if (method === 'POST') {
        const name = String(input.name || '').trim().slice(0, 60);
        if (!name) throw new Error('name is required');
        const u = { id: 'U' + (Math.max(0, ...db.users.map(x => Number(x.id.slice(1)) || 0)) + 1), name, role: 'employee', pin: checkPin(input.pin) };
        db.users.push(u);
        addActivity({ ...stamp(), action: 'create', recordId: u.id, summary: `New staff login for ${u.name}` });
        return send(res, 201, { id: u.id, name: u.name, role: u.role });
      }
      const u = db.users.find(x => x.id === parts[1]);
      if (!u) return send(res, 404, { error: 'Not found' });
      if (method === 'PUT') {
        const before = u.name;
        if (input.name != null && String(input.name).trim()) u.name = String(input.name).trim().slice(0, 60);
        if (input.pin != null && input.pin !== '') u.pin = checkPin(input.pin, u);
        const what = [input.pin ? 'PIN changed' : '', before !== u.name ? `renamed from ${before}` : ''].filter(Boolean);
        addActivity({ ...stamp(), action: 'update', recordId: u.id, summary: `Login for ${u.name}: ${what.join(', ') || 'no change'}` });
        // Changing your own PIN signs you out everywhere else, but keeps this browser logged in.
        return send(res, 200, { id: u.id, name: u.name, role: u.role, demoPins: usesDemoPins() },
          u === user ? { 'Set-Cookie': cookie(req, makeToken(u), SESSION_DAYS * 86400) } : {});
      }
      if (method === 'DELETE') {
        if (u.role === 'owner') throw new Error('The owner login cannot be removed');
        db.users = db.users.filter(x => x !== u);
        addActivity({ ...stamp(), action: 'delete', recordId: u.id, summary: `Removed the login for ${u.name}` });
        return send(res, 200, { ok: true });
      }
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  const col = parts[0];
  if (SCHEMA[col] && ['POST', 'PUT', 'DELETE'].includes(method)) {
    // Staff enter the daily sheet, and may also add a new driver (but not edit or remove one).
    if (user.role !== 'owner' && !EMPLOYEE_WRITABLE.has(col) && !(col === 'drivers' && method === 'POST'))
      return send(res, 403, { error: 'Only the owner can change ' + col });
    try {
      if (method === 'POST') {
        const rec = clean(col, JSON.parse(body));
        if (col === 'trips' && !rec.status) rec.status = 'done';
        if (col === 'trips' && !rec.collectedBy) rec.collectedBy = 'driver';
        if (col === 'expenses' && !rec.paidBy) rec.paidBy = 'office';
        if (col === 'handovers' && !rec.receivedBy) rec.receivedBy = user.name;
        if (col === 'expenses' && !rec.category) rec.category = guessCategory(rec.remarks);
        if (!DAILY.has(col) && rec.active == null) rec.active = true;
        validate(col, rec);
        if (col === 'drivers' && db.drivers.some(d => d.name.toLowerCase() === rec.name.toLowerCase()))
          throw new Error(`There is already a driver called ${rec.name}`);
        rec.id = nextId(col);
        if (DAILY.has(col)) { rec.source = rec.source || 'app'; rec.createdBy = user.name; rec.createdAt = new Date().toISOString(); }
        db[col].push(rec);
        log(user, 'create', col, rec);
        return send(res, 201, rec);
      }
      const rec = db[col].find(r => r.id === parts[1]);
      if (!rec) return send(res, 404, { error: 'Not found' });
      if (method === 'PUT') {
        const before = { ...rec };
        const input = JSON.parse(body);
        const next = clean(col, input, rec);
        // The expense type isn't picked by hand; it follows the remarks ("lakpa oil" is Fuel).
        if (col === 'expenses' && 'remarks' in input && !('category' in input)) next.category = guessCategory(next.remarks);
        validate(col, next);
        if (DAILY.has(col)) next.updatedAt = new Date().toISOString();
        Object.assign(rec, next);
        log(user, 'update', col, rec, diff(before, rec));
        return send(res, 200, rec);
      }
      if (method === 'DELETE') {
        if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can delete. Ask the owner, or edit the entry instead.' });
        db[col] = db[col].filter(r => r !== rec);
        log(user, 'delete', col, rec);
        return send(res, 200, { ok: true });
      }
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }
  return send(res, 404, { error: 'Not found' });
}

// ---------- request handling ----------
// store.run(write, fn) loads the data, calls fn(data), and for a write saves the changes, holding
// a lock so two people saving at the same moment can't overwrite each other.
let queue = Promise.resolve();
function handle(req, res, store) {
  const job = queue.then(() => handleOne(req, res, store));
  queue = job.catch(() => {});
  return job;
}
async function handleOne(req, res, store) {
  const url = new URL(req.url, 'http://localhost');
  // On Vercel, /api/anything is sent to api/index.js with the original path in ?__path=
  const rewritten = url.searchParams.get('__path');
  if (rewritten != null) { url.pathname = '/api/' + rewritten; url.searchParams.delete('__path'); }
  const out = {};
  try {
    const write = !['GET', 'HEAD'].includes(req.method);
    const body = write ? await readBody(req) : '';
    await store.run(write, async data => {
      db = data; pendingActivity = [];
      applyEnvPins();
      upgradePayModes();
      await api(req, out, url, body);
      return pendingActivity;
    });
  } catch (e) {
    console.error(e);
    const msg = e instanceof SyntaxError ? 'That request was not valid JSON' : 'Server error: ' + e.message;
    send(out, e instanceof SyntaxError ? 400 : 500, { error: msg });
  } finally {
    db = null;
  }
  writeOut(res, out);
}

module.exports = { handle, newDb, upgradeDb, SCHEMA };
