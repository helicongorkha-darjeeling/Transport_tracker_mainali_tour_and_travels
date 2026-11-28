// Vercel runs this for every /api/... request (see vercel.json). The web pages in public/ are
// served by Vercel directly. The data lives in the Postgres database named by DATABASE_URL
// (see databaseUrl below), which Vercel fills in when a Neon database is connected from the Storage tab.
const { handle } = require('../lib/tracker');
const { pgStore } = require('../lib/store-pg');

// The database address: DATABASE_URL, POSTGRES_URL or STORAGE_URL, or the same with the prefix
// Vercel adds when a database is connected with a custom prefix (STORAGE_DATABASE_URL, ...).
// Pooled addresses come first; "unpooled" / "non_pooling" ones only if nothing else is there.
function databaseUrl(env = process.env) {
  const named = ['DATABASE_URL', 'POSTGRES_URL', 'STORAGE_URL'].map(k => env[k]);
  const found = Object.keys(env)
    .filter(k => /(^|_)(DATABASE_URL|POSTGRES_URL)$/.test(k) && !/UNPOOLED|NON_POOLING|PRISMA/.test(k))
    .sort().map(k => env[k]);
  const fallback = Object.keys(env).filter(k => /UNPOOLED|NON_POOLING/.test(k)).sort().map(k => env[k]);
  return [...named, ...found, ...fallback].find(v => /^postgres(ql)?:\/\//.test(v || ''));
}

let store;
module.exports = async (req, res) => {
  const url = databaseUrl();
  if (!url) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'The tracker has no database yet. Connect a database in the Vercel project (Storage tab), then redeploy. See the README.' }));
  }
  store ||= pgStore(url);
  return handle(req, res, store);
};
module.exports.databaseUrl = databaseUrl;
