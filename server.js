// Mainali Tour & Travels — Transport Tracker on your own computer.
// Zero-dependency Node.js server: serves the web app and the JSON API.
// Data lives in data/db.json (override the folder with DATA_DIR). Run: node server.js
// With DATABASE_URL set it uses that Postgres database instead (needs `npm install` once).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('./lib/tracker');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

const store = process.env.DATABASE_URL
  ? require('./lib/store-pg').pgStore(process.env.DATABASE_URL)
  : require('./lib/store-file').fileStore(DATA_DIR);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };
function serveStatic(req, res, url) {
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handle(req, res, store);
  serveStatic(req, res, url);
}).listen(PORT, () => console.log(`Transport tracker running at http://localhost:${PORT}` +
  (process.env.DATABASE_URL ? ' (data in Postgres)' : ` (data in ${store.file})`)));
