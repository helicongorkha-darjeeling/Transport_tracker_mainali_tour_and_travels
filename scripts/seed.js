// Builds DEMO data in the same shape as the daily Excel sheet: about 45 days of trips and
// expenses for the 13 drivers in the sheet's driver list. Amounts are made up.
// Used automatically when no database exists. To reset: node scripts/seed.js --reset

const DRIVERS = ['Aniraj', 'Arpan', 'Abhishek', 'Ayup', 'Ishaq', 'Nikhil', 'Norsang', 'Passang',
  'Rajesh', 'Sandeep', 'Sewan', 'Lakpa', 'Pranay'];
const MODELS = ['Mahindra Bolero', 'Tata Sumo', 'Mahindra Scorpio', 'Toyota Innova', 'Maruti Alto', 'Maruti WagonR'];
// Place-of-visit codes used in the sheet. Meanings are for the owner to fill in.
const PLACES = [
  ['3+m', 3000], ['m/3+r', 3500], ['3+r/m', 3000], ['vm', 3500], ['pkg', 3500], ['pkg njp', 5000],
  ['L.T.T', 3000], ['3p', 1300], ['m', 2000], ['M/3', 3000],
];
const EXPENSE_ITEMS = [['oil', 1500, 4500, 10], ['garage', 800, 6000, 2], ['tyre', 1200, 6000, 1],
  ['tube', 900, 1600, 1], ['mat', 400, 900, 1], ['aligment', 300, 600, 1], ['battry', 4500, 6000, 0.3], ['token', 100, 200, 1]];

function rng(seed) { // small deterministic PRNG so the demo looks the same every time
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

function buildSeed(db) {
  const r = rng(7);
  const pick = a => a[Math.floor(r() * a.length)];
  const weighted = a => { const t = a.reduce((s, x) => s + x[3], 0); let v = r() * t; return a.find(x => (v -= x[3]) < 0) || a[0]; };
  const round = (n, to = 100) => Math.round(n / to) * to;
  const pad = n => String(n).padStart(4, '0');
  const todayIso = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const today = new Date(todayIso + 'T00:00:00Z');
  const iso = d => d.toISOString().slice(0, 10);

  db.users = [
    { id: 'U1', name: 'Owner', role: 'owner', pin: '1234' },
    { id: 'U2', name: 'Mehboob', role: 'employee', pin: '1111' },
  ];
  db.drivers = DRIVERS.map((name, i) => ({
    id: 'D' + pad(i + 1), name, phone: '', vehicleNo: `WB 76 ${String.fromCharCode(65 + (i % 6))} ${4100 + i * 37}`,
    vehicleModel: MODELS[i % MODELS.length], active: true, notes: 'Demo car number: replace with the real one',
  }));
  db.drivers.find(d => d.name === 'Abhishek').aliases = ['Avishek'];
  db.places = PLACES.map(([code, standardRate], i) => ({ id: 'P' + pad(i + 1), code, name: '', standardRate, active: true }));

  const trips = [], expenses = [], handovers = [];
  const owed = Object.fromEntries(DRIVERS.map(d => [d, 0]));       // cash each driver is holding
  const nextHandIn = Object.fromEntries(DRIVERS.map(d => [d, 1 + Math.floor(r() * 3)]));
  const slow = ['Ishaq', 'Rajesh'];                                  // two drivers who hand in late and short
  const stamp = (date, h) => `${date}T${String(h).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00.000+05:30`;
  for (let back = 44; back >= 0; back--) {
    const date = iso(new Date(today.getTime() - back * 86400e3));
    const nTrips = back === 0 ? 6 : 8 + Math.floor(r() * 8);
    for (let k = 0; k < nTrips; k++) {
      const [code, rate] = pick(PLACES);
      const shared = r() < 0.15;
      const drivers = shared ? [pick(DRIVERS), pick(DRIVERS)].filter((v, i, a) => a.indexOf(v) === i).join(', ') : pick(DRIVERS);
      const roll = r();
      const status = roll < 0.07 ? 'cancelled' : roll < 0.11 ? 'no charge' : 'done';
      const adults = 2 + Math.floor(r() * 5), kids = r() < 0.3 ? 1 + Math.floor(r() * 2) : 0;
      // Most customers pay the driver; some pay the office directly.
      const collectedBy = r() < 0.25 ? 'office' : 'driver';
      trips.push({
        id: 'T' + pad(trips.length + 1), date, drivers, pax: kids ? `${adults}+${kids}` : String(adults), place: code,
        collection: status === 'done' ? round(rate * (0.85 + r() * 0.4), 100) : null, status, collectedBy, received: false,
        payMode: status === 'done' ? (r() < 0.55 ? 'T' : 'Cash') : '', remarks: '', source: 'demo',
        createdBy: 'Mehboob', createdAt: stamp(date, 9 + Math.floor(r() * 10)), updatedAt: '',
      });
      const t = trips[trips.length - 1];
      if (status === 'done' && collectedBy === 'driver') { const ds = drivers.split(', '); ds.forEach(d => owed[d] += t.collection / ds.length); }
    }
    const nExp = back === 0 ? 3 : 3 + Math.floor(r() * 6);
    if (back % 7 === 0) expenses.push({ amount: round(8000 + r() * 20000, 50), driver: '', category: 'Opening balance', paidBy: 'office', remarks: 'opening balance', date });
    for (let k = 0; k < nExp; k++) {
      const [item, lo, hi] = weighted(EXPENSE_ITEMS);
      const driver = pick(DRIVERS);
      const category = { oil: 'Fuel', garage: 'Garage & repair', aligment: 'Garage & repair', battry: 'Garage & repair',
        tyre: 'Tyre & tube', tube: 'Tyre & tube', mat: 'Accessories', token: 'Token & tax' }[item];
      const amount = round(lo + r() * (hi - lo), 50);
      // Drivers often pay for fuel out of the cash they collected.
      const paidBy = item === 'oil' && r() < 0.6 ? 'driver' : 'office';
      if (paidBy === 'driver') owed[driver] -= amount;
      expenses.push({ amount, driver, category, paidBy, remarks: `${driver.toLowerCase()} ${item}`, date });
    }
    // Drivers come in every few days and hand over what they're holding.
    if (back > 0) for (const d of DRIVERS) {
      if (--nextHandIn[d] > 0 || owed[d] < 500) continue;
      const amount = Math.floor(owed[d] * (slow.includes(d) ? 0.5 : 1) / 100) * 100;
      nextHandIn[d] = slow.includes(d) ? 4 + Math.floor(r() * 4) : 2 + Math.floor(r() * 3);
      if (amount <= 0) continue;
      owed[d] -= amount;
      handovers.push({ date, driver: d, amount, method: r() < 0.7 ? 'Cash' : 'UPI', receivedBy: 'Mehboob', note: '' });
    }
  }
  db.trips = trips;
  db.expenses = expenses.map((e, i) => ({ id: 'E' + pad(i + 1), ...e, source: 'demo', createdBy: 'Mehboob',
    createdAt: stamp(e.date, 18 + Math.floor(r() * 3)), updatedAt: '' }));
  db.handovers = handovers.map((h, i) => ({ id: 'H' + pad(i + 1), ...h, source: 'demo', createdBy: 'Mehboob',
    createdAt: stamp(h.date, 19), updatedAt: '' }));
  db.counters = { drivers: db.drivers.length, places: db.places.length, trips: db.trips.length, expenses: db.expenses.length, handovers: db.handovers.length };

  // A few sample log lines so the activity page shows what owner observability looks like.
  db.activity = [];
  const recent = trips.filter(t => t.date >= iso(new Date(today.getTime() - 2 * 86400e3)));
  for (const t of recent.slice(-25)) db.activity.push({ at: t.createdAt, user: 'Mehboob', role: 'employee', action: 'create',
    collection: 'trips', recordId: t.id, summary: `${t.date} · ${t.drivers} · ${t.place} · ` +
      (t.status === 'done' ? `₹${t.collection} ${t.collectedBy === 'office' ? '(paid to office)' : '(with driver)'}` : t.status), changes: null, late: false });
  for (const h of db.handovers.filter(h => h.date >= iso(new Date(today.getTime() - 2 * 86400e3)))) db.activity.push({ at: h.createdAt,
    user: 'Mehboob', role: 'employee', action: 'create', collection: 'handovers', recordId: h.id,
    summary: `${h.date} · ${h.driver} handed in ₹${h.amount} by ${h.method}`, changes: null, late: false });
  const edited = recent.find(t => t.status === 'done');
  if (edited) db.activity.push({ at: stamp(todayIso, 8), user: 'Mehboob', role: 'employee', action: 'update', collection: 'trips',
    recordId: edited.id, summary: `${edited.date} · ${edited.drivers} · ${edited.place} · ₹${edited.collection}`,
    changes: { collection: [edited.collection + 500, edited.collection] }, late: edited.date < todayIso });
  db.activity.push({ at: new Date().toISOString(), user: 'System', role: 'owner', action: 'seed', collection: '', recordId: '',
    summary: `Loaded DEMO data: ${trips.length} trips and ${expenses.length} expenses over 45 days (made-up amounts)` });
  db.activity.sort((a, b) => b.at.localeCompare(a.at));
  return db;
}

module.exports = { buildSeed };

if (require.main === module) {
  const fs = require('fs'); const path = require('path');
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const file = path.join(dir, 'db.json');
  if (fs.existsSync(file) && !process.argv.includes('--reset')) {
    console.log('A database already exists at ' + file + '. Run with --reset to replace it with demo data.');
    process.exit(1);
  }
  const empty = process.argv.includes('--empty');
  fs.mkdirSync(dir, { recursive: true });
  let db = { settings: { businessName: 'Mainali Tour & Travels', currency: '₹' }, activity: [] };
  db = buildSeed(db);
  if (empty) { db.trips = []; db.expenses = []; db.handovers = []; db.counters.trips = 0; db.counters.expenses = 0; db.counters.handovers = 0;
    db.activity = [{ at: new Date().toISOString(), user: 'System', role: 'owner', action: 'seed', summary: 'Started with an empty tracker' }]; }
  fs.writeFileSync(file, JSON.stringify(db, null, 1));
  console.log(`Wrote ${empty ? 'an empty tracker' : 'demo data'} to ${file}: ${db.trips.length} trips, ${db.expenses.length} expenses.`);
}
