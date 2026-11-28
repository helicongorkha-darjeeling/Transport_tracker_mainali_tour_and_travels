// Keeps the data in Postgres (Neon from Vercel's Storage tab, Supabase, or any other), for running the
// tracker online on Vercel. Tables live in their own schema, "tracker", so they sit apart from anything
// else in the database (and, on Supabase, are not reachable through its public API).
//   tracker.records   one row per driver, place, trip, expense and handover (data as JSON)
//   tracker.meta      settings, logins, id counters
//   tracker.activity  the activity log
// Each request loads the data, and a save writes only the rows that changed, inside a transaction
// that holds a lock, so two people saving at once are handled one after the other.
const { newDb, upgradeDb, SCHEMA } = require('./tracker');

const COLLECTIONS = Object.keys(SCHEMA); // drivers, places, trips, expenses, handovers
const LOCK = 7240301; // any fixed number; used with pg_advisory_xact_lock
const SETUP = `
  create schema if not exists tracker;
  create table if not exists tracker.records (
    collection text not null, id text not null, data jsonb not null, seq bigserial,
    primary key (collection, id));
  create table if not exists tracker.meta (key text primary key, value jsonb not null);
  create table if not exists tracker.activity (seq bigserial primary key, data jsonb not null);`;
const LOAD = `
  select collection, id, data from tracker.records order by seq;
  select key, value from tracker.meta;
  select data from tracker.activity order by seq desc limit 500;`;

function pgStore(connectionString) {
  const { Pool } = require('pg');
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.searchParams.get('sslmode') === 'disable';
  url.searchParams.delete('sslmode'); // SSL is set below
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: local ? false : { rejectUnauthorized: false },
    max: 3, idleTimeoutMillis: 10e3, connectionTimeoutMillis: 10e3,
  });
  let ready = null; // first request on each server creates the tables (and demo data on a new database)

  async function setup() {
    const c = await pool.connect();
    try {
      await c.query(SETUP);
      await c.query('begin');
      await c.query('select pg_advisory_xact_lock($1)', [LOCK]);
      const { rows } = await c.query(`select 1 from tracker.meta where key = 'users'`);
      if (!rows.length) {
        const fresh = newDb();
        console.log('Empty database: creating the tracker' + (process.env.NO_SEED ? '.' : ' with sample data.'));
        await save(c, fresh, { records: new Map(), meta: new Map() }, [...fresh.activity].reverse());
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  async function load(c) {
    const [recs, meta, act] = await c.query(LOAD);
    const data = { activity: act.rows.map(r => r.data) };
    for (const col of COLLECTIONS) data[col] = [];
    for (const r of recs.rows) (data[r.collection] ||= []).push(r.data);
    for (const r of meta.rows) data[r.key] = r.value;
    return upgradeDb(data);
  }
  function snapshot(data) {
    const records = new Map(), meta = new Map();
    for (const col of COLLECTIONS) for (const r of data[col] || []) records.set(col + '\u0000' + r.id, JSON.stringify(r));
    for (const [k, v] of Object.entries(data)) if (!COLLECTIONS.includes(k) && k !== 'activity') meta.set(k, JSON.stringify(v));
    return { records, meta };
  }
  async function save(c, data, before, newActivity) {
    const after = snapshot(data);
    const upserts = [], deletes = [], metaUp = [], metaDel = [];
    for (const [k, json] of after.records) if (before.records.get(k) !== json) {
      const [col, id] = k.split('\u0000'); upserts.push({ c: col, i: id, d: JSON.parse(json) });
    }
    for (const k of before.records.keys()) if (!after.records.has(k)) { const [col, id] = k.split('\u0000'); deletes.push({ c: col, i: id }); }
    for (const [k, json] of after.meta) if (before.meta.get(k) !== json) metaUp.push({ k, v: JSON.parse(json) });
    for (const k of before.meta.keys()) if (!after.meta.has(k)) metaDel.push(k);

    if (deletes.length) await c.query(`delete from tracker.records r using jsonb_to_recordset($1::jsonb) x(c text, i text)
      where r.collection = x.c and r.id = x.i`, [JSON.stringify(deletes)]);
    if (upserts.length) await c.query(`insert into tracker.records (collection, id, data)
      select x->>'c', x->>'i', x->'d' from jsonb_array_elements($1::jsonb) with ordinality t(x, n) order by n
      on conflict (collection, id) do update set data = excluded.data`, [JSON.stringify(upserts)]);
    if (metaUp.length) await c.query(`insert into tracker.meta (key, value)
      select x->>'k', x->'v' from jsonb_array_elements($1::jsonb) x
      on conflict (key) do update set value = excluded.value`, [JSON.stringify(metaUp)]);
    if (metaDel.length) await c.query('delete from tracker.meta where key = any($1)', [metaDel]);
    if (newActivity.length) {
      await c.query(`insert into tracker.activity (data)
        select x from jsonb_array_elements($1::jsonb) with ordinality t(x, n) order by n`, [JSON.stringify(newActivity)]);
      await c.query('delete from tracker.activity where seq <= (select max(seq) - 5000 from tracker.activity)');
    }
  }

  return {
    async run(write, fn) {
      ready ||= setup().catch(e => { ready = null; throw e; });
      await ready;
      const c = await pool.connect();
      try {
        if (!write) return await fn(await load(c));
        await c.query('begin');
        await c.query('select pg_advisory_xact_lock($1)', [LOCK]);
        const data = await load(c);
        const before = snapshot(data);
        const newActivity = await fn(data);
        await save(c, data, before, newActivity || []);
        await c.query('commit');
        return newActivity;
      } catch (e) {
        if (write) await c.query('rollback').catch(() => {});
        throw e;
      } finally { c.release(); }
    },
  };
}

module.exports = { pgStore };
