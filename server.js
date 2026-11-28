// Mainali Tour & Travels — Transport Tracker (demo)
// Zero-dependency Node.js server: serves the web app and a small JSON API.
// Data lives in data/db.json (override folder with DATA_DIR). Run: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

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

// ---------- storage ----------
let db;
function emptyDb() {
  return {
    settings: { businessName: 'Mainali Tour & Travels', currency: '₹' },
    users: [
      { id: 'U1', name: 'Owner', role: 'owner', pin: '1234' },
      { id: 'U2', name: 'Mehboob', role: 'employee', pin: '1111' },
    ],
    drivers: [], places: [], trips: [], expenses: [], handovers: [], activity: [],
    counters: {},
  };
}
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const seed = path.join(__dirname, 'scripts', 'seed.js');
    if (fs.existsSync(seed) && !process.env.NO_SEED) {
      db = require(seed).buildSeed(emptyDb());
      console.log('No database found. Created one with sample data.');
    } else db = emptyDb();
    saveDb();
  } else {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.handovers ||= []; // older files from before handovers existed
  }
}
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE); // atomic replace so a crash never leaves half a file
}
function nextId(collection) {
  db.counters[collection] = (db.counters[collection] || db[collection].length) + 1;
  return ID_PREFIX[collection] + String(db.counters[collection]).padStart(4, '0');
}

// ---------- helpers ----------
const sessions = new Map(); // token -> userId (in memory: restarting the server logs everyone out)
function currentUser(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
  const uid = m && sessions.get(m[1]);
  return uid ? db.users.find(u => u.id === uid) : null;
}
function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) reject(new Error('Body too large')); });
    req.on('end', () => resolve(data));
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
  db.activity.unshift({
    at: new Date().toISOString(), user: user.name, role: user.role, action, collection,
    recordId: record.id, summary: describe(collection, record), changes: changes || null, late,
  });
  if (db.activity.length > 5000) db.activity.length = 5000;
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
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const method = req.method;

  if (parts[0] === 'login' && method === 'POST') {
    const { pin } = JSON.parse((await readBody(req)) || '{}');
    const user = db.users.find(u => u.pin === String(pin || ''));
    if (!user) return send(res, 401, { error: 'Wrong PIN' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user.id);
    return send(res, 200, { id: user.id, name: user.name, role: user.role },
      { 'Set-Cookie': `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000` });
  }

  const user = currentUser(req);
  if (!user) return send(res, 401, { error: 'Please log in' });

  if (parts[0] === 'logout') {
    const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || '');
    if (m) sessions.delete(m[1]);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
  }
  if (parts[0] === 'me') return send(res, 200, { id: user.id, name: user.name, role: user.role });

  if (parts[0] === 'data' && method === 'GET') {
    const { users, counters, activity, ...rest } = db;
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
    const rows = parseCsv(await readBody(req));
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
    db.activity.unshift({ at: new Date().toISOString(), user: user.name, role: user.role, action: 'import',
      collection: col, recordId: '', summary: `Imported ${col} CSV: ${added} added, ${updated} updated, ${errors.length} skipped` });
    saveDb();
    return send(res, 200, { added, updated, errors });
  }

  // Import of the daily Excel sheets. The browser reads the .xlsx and sends plain rows.
  if (parts[0] === 'import-days' && method === 'POST') {
    if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can import' });
    const { days = [] } = JSON.parse(await readBody(req));
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
    db.activity.unshift({ at: stamp, user: user.name, role: user.role, action: 'import', collection: 'excel', recordId: '',
      summary: `Imported Excel: ${days.length} day sheets, ${trips} trips, ${expenses} expenses` +
        (replacedDays ? ` (replaced ${replacedDays} days imported before)` : '') + (newDrivers.length ? `. New drivers: ${newDrivers.join(', ')}` : '') });
    saveDb();
    return send(res, 200, { days: days.length, trips, expenses, replacedDays, newDrivers });
  }

  if (parts[0] === 'clear-demo' && method === 'POST') {
    if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can do this' });
    const n = db.trips.length + db.expenses.length;
    db.trips = db.trips.filter(t => t.source !== 'demo');
    db.expenses = db.expenses.filter(e => e.source !== 'demo');
    const h = db.handovers.length; db.handovers = db.handovers.filter(x => x.source !== 'demo');
    const removed = n - db.trips.length - db.expenses.length + h - db.handovers.length;
    db.activity.unshift({ at: new Date().toISOString(), user: user.name, role: user.role, action: 'delete', collection: '',
      recordId: '', summary: `Removed ${removed} demo entries` });
    saveDb();
    return send(res, 200, { removed });
  }

  const col = parts[0];
  if (SCHEMA[col] && ['POST', 'PUT', 'DELETE'].includes(method)) {
    if (user.role !== 'owner' && !EMPLOYEE_WRITABLE.has(col))
      return send(res, 403, { error: 'Only the owner can change ' + col });
    try {
      if (method === 'POST') {
        const rec = clean(col, JSON.parse(await readBody(req)));
        if (col === 'trips' && !rec.status) rec.status = 'done';
        if (col === 'trips' && !rec.collectedBy) rec.collectedBy = 'driver';
        if (col === 'expenses' && !rec.paidBy) rec.paidBy = 'office';
        if (col === 'handovers' && !rec.receivedBy) rec.receivedBy = user.name;
        if (col === 'expenses' && !rec.category) rec.category = guessCategory(rec.remarks);
        if (!DAILY.has(col) && rec.active == null) rec.active = true;
        validate(col, rec);
        rec.id = nextId(col);
        if (DAILY.has(col)) { rec.source = rec.source || 'app'; rec.createdBy = user.name; rec.createdAt = new Date().toISOString(); }
        db[col].push(rec);
        log(user, 'create', col, rec);
        saveDb();
        return send(res, 201, rec);
      }
      const rec = db[col].find(r => r.id === parts[1]);
      if (!rec) return send(res, 404, { error: 'Not found' });
      if (method === 'PUT') {
        const before = { ...rec };
        const next = clean(col, JSON.parse(await readBody(req)), rec);
        validate(col, next);
        if (DAILY.has(col)) next.updatedAt = new Date().toISOString();
        Object.assign(rec, next);
        log(user, 'update', col, rec, diff(before, rec));
        saveDb();
        return send(res, 200, rec);
      }
      if (method === 'DELETE') {
        if (user.role !== 'owner') return send(res, 403, { error: 'Only the owner can delete. Ask the owner, or edit the entry instead.' });
        db[col] = db[col].filter(r => r !== rec);
        log(user, 'delete', col, rec);
        saveDb();
        return send(res, 200, { ok: true });
      }
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }
  return send(res, 404, { error: 'Not found' });
}

// ---------- static files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };
function serveStatic(req, res, url) {
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

loadDb();
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error: ' + e.message });
  }
}).listen(PORT, () => console.log(`Transport tracker running at http://localhost:${PORT}`));
