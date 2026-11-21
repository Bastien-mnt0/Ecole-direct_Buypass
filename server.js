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
// Écrit dans captures/AAAA-MM-JJ.jsonl (ignoré par git, voir .gitignore). Identifiants, mots de passe, jetons et cookies sont masqués, mais les données scolaires (notes, messages…) y figurent : fichier personnel, à ne jamais partager.
const LOG = process.env.ED_LOG === '1';
const SECRET = /^(identifiant|motdepasse|token|cookies|gtk|cn|cv|fa|uuid)$/i;
const redact = (v) => Array.isArray(v) ? v.map(redact) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? '***' : redact(x)])) : v;
function record(entry) {
  const dir = path.join(__dirname, 'captures');
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, new Date().toISOString().slice(0, 10) + '.jsonl'), JSON.stringify(redact(entry)) + '\n');
}

// Routes récentes (cloud, menus de la cantine) : on utilise la version du site officiel
const newer = (p) => p.startsWith('/v3/cloud/') || p.startsWith('/v3/menusRestaurationScolaire') || p.includes('leTypeDeFichier=FICHIER_MENU_RESTAURATION') || p.includes('leTypeDeFichier=CLOUD');
async function ed(urlPath, { method = 'POST', token, data, cookies = {}, raw = false, form, upload, ver } = {}) {
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
  const res = await fetch(`${BASE}${urlPath}${urlPath.includes('?') ? '&' : '?'}v=${ver || (newer(urlPath) ? CLOUD_VERSION : API_VERSION)}`, {
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
// Jeton et cookies fournis par le navigateur : type et caractères contrôlés avant d'être renvoyés à École Directe (les entrées invalides sont ignorées).
// Alignement sur worker.js (défense en profondeur : fetch() rejette déjà les CR/LF, mais sans ce contrôle explicite ici).
const cleanToken = (t) => (typeof t === 'string' && /^[\x21-\x7e]{1,4096}$/.test(t) ? t : undefined);
const cleanCookies = (c) => { const o = {}; if (c && typeof c === 'object' && !Array.isArray(c)) for (const [k, v] of Object.entries(c).slice(0, 50)) { if (typeof v === 'string' && /^[^\s=;,\u0000-\u001f]{1,1024}$/u.test(k) && /^[^;\u0000-\u001f\u007f]{0,4096}$/u.test(v)) o[k] = v; } return o; };
const readAuth = (h) => { try { const a = JSON.parse(decodeURIComponent(h || '')); return a && typeof a === 'object' && cleanToken(a.token) ? { token: cleanToken(a.token), cookies: cleanCookies(a.cookies) } : null; } catch { return null; } };

const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b ? JSON.parse(b) : {})); });
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

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
  /^\/v3\/messagerie\/contacts\/(professeurs|personnels)\.awp$/,
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
      const out = await ed(p, { token: cleanToken(token), data, cookies: cleanCookies(cookies) });
      if (LOG) record({ time: new Date().toISOString(), path: p, v: newer(p) ? CLOUD_VERSION : API_VERSION, request: data, response: out.json });
      return send(res, 200, out);
    }
    if (req.method === 'POST' && req.url === '/api/ed-upload') {
      const b = await readBody(req);
      if (!okUpload(b)) return send(res, 400, { error: 'envoi refusé' });
      return send(res, 200, await ed(uploadPath(b), { token: cleanToken(b.token), cookies: cleanCookies(b.cookies), form: uploadForm(b) }));
    }
    if (req.method === 'POST' && req.url.startsWith('/api/ed-upload-file')) {
      const dest = new URL(req.url, 'http://x').searchParams.get('dest'), type = req.headers['content-type'] || '', auth = readAuth(req.headers['x-ed-auth']);
      if (!okDest(dest) || !type.startsWith('multipart/form-data') || !auth) return send(res, 400, { error: 'envoi refusé' });
      const chunks = []; let n = 0;
      for await (const c of req) { n += c.length; if (n > MAX_UP) return send(res, 413, { error: 'Fichier trop volumineux (10 Mo maximum)' }); chunks.push(c); }
      return send(res, 200, await ed(uploadFilePath(dest), { token: auth.token, cookies: auth.cookies, upload: { type, body: Buffer.concat(chunks) } }));
    }
    if (req.method === 'POST' && req.url === '/api/ed-file') {
      const { id, type, token, cookies, entity } = await readBody(req);
      if (!okFileId(id, type) || !/^[A-Z_]+$/.test(String(type))) return send(res, 400, { error: 'fichier refusé' });
      const fp = `/v3/telechargement.awp?verbe=get&fichierId=${encodeURIComponent(id)}&leTypeDeFichier=${type}`, fo = { token: cleanToken(token), cookies: cleanCookies(cookies), data: type === 'FICHIER_MENU_RESTAURATION' ? { forceDownload: 0, idEtab: 0 } : type === 'CLOUD' && entity && /^[A-Z]$/.test(String(entity.type)) && Number.isInteger(Number(entity.id)) && Number(entity.id) > 0 ? { forceDownload: 0, idEntity: Number(entity.id), typeEntity: String(entity.type) } : {}, raw: true };
      let out, ct = '', tried = [];
      // Fichiers du cloud / espaces de travail : l'identifiant est un chemin (\\SERVEUR\cloud\...). On essaie plusieurs formes du chemin et plusieurs variantes de requête (POST/GET, version de l'API)
      // jusqu'à obtenir un vrai fichier : École Directe renvoie sa page web (HTML) quand la requête n'est pas reconnue.
      const sid = String(id), idForms = [sid];
      const pathOf = (i, extra = '') => `/v3/telechargement.awp?verbe=get&fichierId=${encodeURIComponent(i)}&leTypeDeFichier=${type}${extra}`;
      outer: for (const i of idForms) for (const v of [{}, { method: 'GET' }, { ver: CLOUD_VERSION }, { method: 'GET', ver: CLOUD_VERSION }]) {
        out = await ed(pathOf(i, v.method === 'GET' ? '&forceDownload=0' : ''), { ...fo, ...v }); ct = out.res.headers.get('content-type') || '';
        tried.push(i.slice(0, 60) + ' ' + (v.method || 'POST') + (v.ver ? '@' + v.ver : '') + ':' + out.res.status + ' ' + ct.split(';')[0]);
        if (!ct.includes('html')) break outer;
      }
      if (!out.res.ok || ct.includes('json') || ct.includes('html')) {
        const t = await out.res.text().catch(() => ''); let j = {}; try { j = JSON.parse(t); } catch {}
        const expired = [520, 521, 525].includes(j.code);
        return send(res, expired ? 401 : 404, { error: expired ? 'Session expirée' : j.message || 'Fichier indisponible', code: j.code, detail: `${tried.join(' | ')} ${t.replace(/\s+/g, ' ').slice(0, 160)}` });
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