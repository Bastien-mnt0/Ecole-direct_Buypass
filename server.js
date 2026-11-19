// Serveur local sans dépendance (Node 18+) : node server.js
// Sert public/index.html (page d'accueil EDUNOTA ; l'application École Directe est sur /ecoledirecte.html) et relaie les appels vers api.ecoledirecte.com (le navigateur ne peut pas les faire : CORS).
// Sans état : les cookies font l'aller-retour avec le navigateur (utilisable par plusieurs sessions).
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE = 'https://api.ecoledirecte.com';
const API_VERSION = process.env.ED_VERSION || '4.75.0'; // à ajuster si l'API répond 517
const CLOUD_VERSION = process.env.ED_CLOUD_VERSION || '4.104.4'; // version utilisée par le site officiel pour le cloud : en dessous, la suppression ne passe pas par la corbeille
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

// Routes récentes (cloud, menus de la cantine) : on utilise la version du site officiel
const newer = (p) => p.startsWith('/v3/cloud/') || p.startsWith('/v3/menusRestaurationScolaire') || p.includes('leTypeDeFichier=FICHIER_MENU_RESTAURATION');
async function ed(urlPath, { method = 'POST', token, data, cookies = {}, raw = false, form, upload } = {}) {
  const jar = { ...cookies };
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://www.ecoledirecte.com',
    Referer: 'https://www.ecoledirecte.com/',
    Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
  };
  if (form) delete headers['Content-Type']; // multipart : la bibliothèque fetch ajoute elle-même la frontière
  if (upload) headers['Content-Type'] = upload.type; // multipart déjà construit par le navigateur (frontière incluse)
  if (jar.GTK) headers['X-GTK'] = jar.GTK;
  if (token) headers['X-Token'] = token;
  const res = await fetch(`${BASE}${urlPath}${urlPath.includes('?') ? '&' : '?'}v=${newer(urlPath) ? CLOUD_VERSION : API_VERSION}`, {
    method,
    headers,
    body: upload ? upload.body : form || (method === 'POST' ? 'data=' + encodeURIComponent(JSON.stringify(data || {})) : undefined),
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
// Chemin du cloud : pas de caractère de contrôle ni de « .. » (les noms de fichiers peuvent contenir parenthèses, apostrophes, etc.).
const okCloudPath = (p) => typeof p === 'string' && /^[^\u0000-\u001f"<>|?*]{1,400}$/u.test(p) && !p.includes('..');
const okFileId = (id, type) => (type === 'CLOUD' ? okCloudPath(String(id)) : /^\d+$/.test(String(id)));
// Envoi dans le cloud : uniquement edunota.json (JSON, 200 Ko max) dans un dossier désigné par son id. Pas d'envoi générique.
const okUpload = (b) => b.name === 'edunota.json' && b.mime === 'application/json' && typeof b.text === 'string' && b.text.length <= 2e5 && /^[\p{L}\p{N}_\-./ %\\]{1,300}$/u.test(String(b.parent)) && !String(b.parent).includes('..');
const uploadForm = (b) => { const f = new FormData(); f.append('file', new Blob([b.text], { type: 'application/json' }), b.name); return f; };
const uploadPath = (b) => `/v3/televersement.awp?verbe=post&mode=CLOUD&dest=${encodeURIComponent(b.parent)}`; // format relevé sur le site officiel (champ multipart : file)

// Envoi de fichiers de l'élève dans son cloud (onglet Cloud) : le navigateur envoie le multipart tel quel (champ « file »),
// le dossier de destination est dans l'URL (?dest=) et la session dans l'en-tête X-Ed-Auth. Uniquement dans le dossier « MON CLOUD EDUNOTA » (insensible à la casse, pour l'ancien dossier en minuscules) (donc jamais dans EDUNOTA, où se trouve edunota.json).
const MAX_UP = 10.5e6; // 10 Mo de fichier + enveloppe multipart
const okDest = (d) => okCloudPath(d) && d.startsWith('\\') && /(^|\\)mon cloud edunota(\\|$)/i.test(d); // uniquement dans le dossier « MON CLOUD EDUNOTA » (insensible à la casse, pour l'ancien dossier en minuscules) de l'élève
const uploadFilePath = (dest) => `/v3/televersement.awp?verbe=post&mode=CLOUD&dest=${encodeURIComponent(dest)}`;
const readAuth = (h) => { try { const a = JSON.parse(decodeURIComponent(h || '')); return a && typeof a === 'object' && typeof a.token === 'string' ? { token: a.token, cookies: a.cookies && typeof a.cookies === 'object' ? a.cookies : {} } : null; } catch { return null; } };

const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b ? JSON.parse(b) : {})); });
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

// Liste blanche : seules les routes réellement utilisées par app.js sont relayées (le reste de l'API École Directe reste inaccessible).
const ROUTES = [
  /^\/v3\/login\.awp$/,
  /^\/v3\/connexion\/doubleauth\.awp$/,
  /^\/v3\/eleves\/\d+\/(notes|viescolaire|messages|cahierdetexte)\.awp$/i,
  /^\/v3\/eleves\/\d+\/cahierdetexte\/\d{4}-\d{2}-\d{2}\.awp$/i,
  /^\/v3\/(eleves|familles)\/\d+\/messages(\/[\w-]+)?\.awp$/i,
  /^\/v3\/E\/\d+\/(emploidutemps|espacestravail)\.awp$/,
  /^\/v3\/cloud\/[A-Z]\/[\w-]+(\/visibility)?\.awp$/,
  /^\/v3\/comptes\/detail\.awp$/,
  /^\/v3\/menusRestaurationScolaire\.awp$/,
];
const okRoute = (p) => {
  const i = p.indexOf('?'), name = i < 0 ? p : p.slice(0, i), qs = i < 0 ? '' : p.slice(i + 1);
  return ROUTES.some((r) => r.test(name)) && /^[\w%=&.\-~!*'()]*$/.test(qs) && !qs.includes('..') && !/%2e%2e/i.test(qs);
};

http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/gtk') {
      const r = await ed('/v3/login.awp?gtk=1', { method: 'GET' });
      return send(res, 200, { cookies: r.cookies });
    }
    if (req.method === 'POST' && req.url === '/api/ed') {
      const { path: p, data, token, cookies } = await readBody(req);
      if (typeof p !== 'string' || !okRoute(p)) return send(res, 400, { error: 'chemin refusé' });
      const out = await ed(p, { token, data, cookies });
      if (LOG) record({ time: new Date().toISOString(), path: p, v: newer(p) ? CLOUD_VERSION : API_VERSION, request: data, response: out.json });
      return send(res, 200, out);
    }
    if (req.method === 'POST' && req.url === '/api/ed-upload') {
      const b = await readBody(req);
      if (!okUpload(b)) return send(res, 400, { error: 'envoi refusé' });
      return send(res, 200, await ed(uploadPath(b), { token: b.token, cookies: b.cookies, form: uploadForm(b) }));
    }
    if (req.method === 'POST' && req.url.startsWith('/api/ed-upload-file')) {
      const dest = new URL(req.url, 'http://x').searchParams.get('dest'), type = req.headers['content-type'] || '', auth = readAuth(req.headers['x-ed-auth']);
      if (!okDest(dest) || !type.startsWith('multipart/form-data') || !auth) return send(res, 400, { error: 'envoi refusé' });
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > MAX_UP) return send(res, 413, { error: 'Fichier trop volumineux (10 Mo maximum)' }); chunks.push(c); }
      return send(res, 200, await ed(uploadFilePath(dest), { token: auth.token, cookies: auth.cookies, upload: { type, body: Buffer.concat(chunks) } }));
    }
    if (req.method === 'POST' && req.url === '/api/ed-file') {
      const { id, type, token, cookies } = await readBody(req);
      if (!okFileId(id, type) || !/^[A-Z_]+$/.test(String(type))) return send(res, 400, { error: 'fichier refusé' });
      const out = await ed(`/v3/telechargement.awp?verbe=get&fichierId=${encodeURIComponent(id)}&leTypeDeFichier=${type}`, { token, cookies, data: type === 'FICHIER_MENU_RESTAURATION' ? { forceDownload: 0, idEtab: 0 } : {}, raw: true });
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
      const buf = fs.readFileSync(file), h = { 'Content-Type': types[path.extname(name)], 'Cache-Control': 'public, max-age=300' };
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && buf.length > 1024 && /^\.(html|css|js)$/.test(path.extname(name))) { h['Content-Encoding'] = 'gzip'; res.writeHead(200, h); return res.end(zlib.gzipSync(buf)); }
      res.writeHead(200, h); return res.end(buf);
    }
    send(res, 404, { error: 'introuvable' });
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`EDUNOTA : http://localhost:${PORT}`));