// Vercel runs this for every /api/... request (see vercel.json). The web pages in public/ are
// served by Vercel directly. The data lives in the Postgres database named by DATABASE_URL.
const { handle } = require('../lib/tracker');
const { pgStore } = require('../lib/store-pg');

let store;
module.exports = async (req, res) => {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'The tracker has no database yet. Add DATABASE_URL in the Vercel project settings (see README).' }));
  }
  store ||= pgStore(url);
  return handle(req, res, store);
};
