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

// Journal local des échanges avec l'API (désactivé par défaut) : ED_LOG=1 node server.js
// Écrit dans captures/AAAA-MM-JJ.jsonl (ignoré par git, voir .gitignore). Mots de passe, jetons et cookies sont masqués.
const LOG = process.env.ED_LOG === '1';
const SECRET = /^(motdepasse|token|cookies|gtk|cn|cv|fa|uuid)$/i;
const redact = (v) => Array.isArray(v) ? v.map(redact) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? '***' : redact(x)])) : v;
function record(entry) {
  const dir = path.join(__dirname, 'captures');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, new Date().toISOString().slice(0, 10) + '.jsonl'), JSON.stringify(redact(entry)) + '\n');
}

async function ed(urlPath, { method = 'POST', token, data, cookies = {}, raw = false, form } = {}) {
  const jar = { ...cookies };
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://www.ecoledirecte.com',
    Referer: 'https://www.ecoledirecte.com/',
    Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
  };
  if (form) delete headers['Content-Type']; // multipart : la bibliothèque fetch ajoute elle-même la frontière
  if (jar.GTK) headers['X-GTK'] = jar.GTK;
  if (token) headers['X-Token'] = token;
  const res = await fetch(`${BASE}${urlPath}${urlPath.includes('?') ? '&' : '?'}v=${API_VERSION}`, {
    method,
    headers,
    body: form || (method === 'POST' ? 'data=' + encodeURIComponent(JSON.stringify(data || {})) : undefined),
  });
  for (const c of res.headers.getSetCookie?.() || []) {
    const kv = c.split(';')[0], i = kv.indexOf('=');
    jar[kv.slice(0, i).trim()] = kv.slice(i + 1);
  }
  if (raw) return { res, token: res.headers.get('x-token'), cookies: jar };
  const json = await res.json().catch(() => ({ code: 0, message: 'Réponse invalide' }));
  return { json, token: res.headers.get('x-token'), cookies: jar };
}

// Fichiers : id numérique (cahier de texte) ; pour le cloud (type CLOUD), l'id peut être un chemin (sans « .. »).
const okFileId = (id, type) => (type === 'CLOUD' ? /^[\p{L}\p{N}_\-./ %\\]{1,300}$/u.test(String(id)) && !String(id).includes('..') : /^\d+$/.test(String(id)));
// Envoi dans le cloud : uniquement buypass.json (JSON, 200 Ko max) dans un dossier désigné par son id. Pas d'envoi générique.
const okUpload = (b) => b.name === 'buypass.json' && b.mime === 'application/json' && typeof b.text === 'string' && b.text.length <= 2e5 && /^[\p{L}\p{N}_\-./ %\\]{1,300}$/u.test(String(b.parent)) && !String(b.parent).includes('..');
const uploadForm = (b) => { const f = new FormData(); f.append('file', new Blob([b.text], { type: 'application/json' }), b.name); return f; };
const uploadPath = (b) => `/v3/televersement.awp?verbe=post&mode=CLOUD&dest=${encodeURIComponent(b.parent)}`; // format relevé sur le site officiel (champ multipart : file)

const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b ? JSON.parse(b) : {})); });
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/gtk') {
      const r = await ed('/v3/login.awp?gtk=1', { method: 'GET' });
      return send(res, 200, { cookies: r.cookies });
    }
    if (req.method === 'POST' && req.url === '/api/ed') {
      const { path: p, data, token, cookies } = await readBody(req);
      if (typeof p !== 'string' || !p.startsWith('/v3/')) return send(res, 400, { error: 'chemin refusé' });
      const out = await ed(p, { token, data, cookies });
      if (LOG) record({ time: new Date().toISOString(), path: p, request: data, response: out.json });
      return send(res, 200, out);
    }
    if (req.method === 'POST' && req.url === '/api/ed-upload') {
      const b = await readBody(req);
      if (!okUpload(b)) return send(res, 400, { error: 'envoi refusé' });
      return send(res, 200, await ed(uploadPath(b), { token: b.token, cookies: b.cookies, form: uploadForm(b) }));
    }
    if (req.method === 'POST' && req.url === '/api/ed-file') {
      const { id, type, token, cookies } = await readBody(req);
      if (!okFileId(id, type) || !/^[A-Z_]+$/.test(String(type))) return send(res, 400, { error: 'fichier refusé' });
      const out = await ed(`/v3/telechargement.awp?verbe=get&fichierId=${encodeURIComponent(id)}&leTypeDeFichier=${type}`, { token, cookies, data: {}, raw: true });
      const ct = out.res.headers.get('content-type') || '';
      if (!out.res.ok || ct.includes('json')) {
        const j = await out.res.json().catch(() => ({}));
        return send(res, [520, 521, 525].includes(j.code) ? 401 : 404, { error: [520, 521, 525].includes(j.code) ? 'Session expirée' : j.message || 'Fichier indisponible', code: j.code });
      }
      const h = { 'Content-Type': ct || 'application/octet-stream' };
      if (out.token) h['X-Token'] = out.token;
      res.writeHead(200, h);
      return res.end(Buffer.from(await out.res.arrayBuffer()));
    }
    if (req.method === 'GET') {
      const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
      const p = new URL(req.url, 'http://x').pathname, name = p === '/' ? 'index.html' : path.basename(p), file = path.join(__dirname, 'public', name);
      if (!types[path.extname(name)] || !fs.existsSync(file)) return send(res, 404, 'introuvable', 'text/plain');
      return send(res, 200, fs.readFileSync(file), types[path.extname(name)]);
    }
    send(res, 404, { error: 'introuvable' });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`http://localhost:${PORT}`));