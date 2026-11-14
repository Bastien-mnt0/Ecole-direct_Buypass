// Serveur local sans dépendance (Node 18+) : node server.js
// Sert public/index.html et relaie les appels vers api.ecoledirecte.com (le navigateur ne peut pas les faire : CORS).
// Sans état : les cookies font l'aller-retour avec le navigateur (utilisable par plusieurs sessions).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE = 'https://api.ecoledirecte.com';
const API_VERSION = process.env.ED_VERSION || '4.75.0'; // à ajuster si l'API répond 517
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function ed(urlPath, { method = 'POST', token, data, cookies = {} } = {}) {
  const jar = { ...cookies };
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://www.ecoledirecte.com',
    Referer: 'https://www.ecoledirecte.com/',
    Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
  };
  if (jar.GTK) headers['X-GTK'] = jar.GTK;
  if (token) headers['X-Token'] = token;
  const res = await fetch(`${BASE}${urlPath}${urlPath.includes('?') ? '&' : '?'}v=${API_VERSION}`, {
    method,
    headers,
    body: method === 'POST' ? 'data=' + encodeURIComponent(JSON.stringify(data || {})) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const kv = c.split(';')[0], i = kv.indexOf('=');
    jar[kv.slice(0, i).trim()] = kv.slice(i + 1);
  }
  const json = await res.json().catch(() => ({ code: 0, message: 'Réponse invalide' }));
  return { json, token: res.headers.get('x-token'), cookies: jar };
}

const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b ? JSON.parse(b) : {})); });
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/gtk') {
      const r = await ed('/v3/login.awp?gtk=1', { method: 'GET' });
      return send(res, 200, { cookies: r.cookies });
    }
    if (req.method === 'POST' && req.url === '/api/ed') {
      const { path: p, data, token, cookies } = await readBody(req);
      if (typeof p !== 'string' || !p.startsWith('/v3/')) return send(res, 400, { error: 'chemin refusé' });
      return send(res, 200, await ed(p, { token, data, cookies }));
    }
    if (req.method === 'GET') {
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
      const p = new URL(req.url, 'http://x').pathname, name = p === '/' ? 'index.html' : path.basename(p), file = path.join(__dirname, 'public', name);
      if (!types[path.extname(name)] || !fs.existsSync(file)) return send(res, 404, 'introuvable', 'text/plain');
      return send(res, 200, fs.readFileSync(file, 'utf8'), types[path.extname(name)]);
    }
    send(res, 404, { error: 'introuvable' });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}`));
