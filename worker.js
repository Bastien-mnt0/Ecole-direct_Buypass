// EDUNOTA — Cloudflare Worker : même rôle que server.js (relais API uniquement, il ne sert aucune page), hébergé gratuitement.
// Il n'accepte que les requêtes venant de ALLOWED_ORIGIN (ton site GitHub Pages).
const BASE = 'https://api.ecoledirecte.com';
const API_VERSION = '4.75.0'; // à ajuster si l'API répond 517
const CLOUD_VERSION = '4.104.4'; // version utilisée par le site officiel pour le cloud : en dessous, la suppression ne passe pas par la corbeille
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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
const isAuth = (p) => /\/(login|doubleauth)\.awp(\?|$)/.test(p);
// Limitation de débit par adresse IP (en mémoire : propre à chaque instance du Worker, donc un garde-fou et non une garantie absolue).
const hits = new Map();
const limited = (ip, bucket, max, ms) => {
  const now = Date.now(), k = bucket + ':' + ip, h = (hits.get(k) || []).filter((t) => now - t < ms);
  h.push(now); hits.set(k, h);
  if (hits.size > 5000) for (const [x, v] of hits) if (!v.length || now - v[v.length - 1] > 3600e3) hits.delete(x);
  return h.length > max;
};

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || '';
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Ed-Auth', 'Access-Control-Expose-Headers': 'X-Token', Vary: 'Origin' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed || req.headers.get('Origin') !== allowed) return reply({ error: 'origine refusée' }, 403);
    const { pathname } = new URL(req.url);
    const ip = req.headers.get('CF-Connecting-IP') || 'inconnu', tooMany = () => reply({ error: 'Trop de requêtes : réessaie dans un instant' }, 429);
    try {
      if (req.method === 'POST' && pathname === '/api/gtk') {
        if (limited(ip, 'login', 20, 600e3)) return tooMany();
        const r = await ed('/v3/login.awp?gtk=1', { method: 'GET' });
        return reply({ cookies: r.cookies });
      }
      if (req.method === 'POST' && pathname === '/api/ed') {
        const { path, data, token, cookies } = await req.json();
        if (typeof path !== 'string' || !okRoute(path)) return reply({ error: 'chemin refusé' }, 400);
        if (isAuth(path) ? limited(ip, 'login', 20, 600e3) : limited(ip, 'api', 240, 60e3)) return tooMany();
        return reply(await ed(path, { token, data, cookies }));
      }
      if (req.method === 'POST' && pathname.startsWith('/api/ed-') && limited(ip, 'file', 60, 60e3)) return tooMany();
      if (req.method === 'POST' && pathname === '/api/ed-upload') {
        const b = await req.json();
        if (!okUpload(b)) return reply({ error: 'envoi refusé' }, 400);
        return reply(await ed(uploadPath(b), { token: b.token, cookies: b.cookies, form: uploadForm(b) }));
      }
      if (req.method === 'POST' && pathname === '/api/ed-upload-file') {
        const dest = new URL(req.url).searchParams.get('dest'), type = req.headers.get('Content-Type') || '', auth = readAuth(req.headers.get('X-Ed-Auth')), len = Number(req.headers.get('Content-Length')) || 0;
        if (!okDest(dest) || !type.startsWith('multipart/form-data') || !auth) return reply({ error: 'envoi refusé' }, 400);
        if (!len || len > MAX_UP) return reply({ error: 'Fichier trop volumineux (10 Mo maximum)' }, 413);
        const body = await req.arrayBuffer();
        if (body.byteLength > MAX_UP) return reply({ error: 'Fichier trop volumineux (10 Mo maximum)' }, 413);
        return reply(await ed(uploadFilePath(dest), { token: auth.token, cookies: auth.cookies, upload: { type, body } }));
      }
      if (req.method === 'POST' && pathname === '/api/ed-file') {
        const { id, type, token, cookies } = await req.json();
        if (!okFileId(id, type) || !/^[A-Z_]+$/.test(String(type))) return reply({ error: 'fichier refusé' }, 400);
        const out = await ed(`/v3/telechargement.awp?verbe=get&fichierId=${encodeURIComponent(id)}&leTypeDeFichier=${type}`, { token, cookies, data: type === 'FICHIER_MENU_RESTAURATION' ? { forceDownload: 0, idEtab: 0 } : {}, raw: true });
        const ct = out.res.headers.get('content-type') || '';
        if (!out.res.ok || ct.includes('json')) {
          const j = await out.res.json().catch(() => ({}));
          const expired = [520, 521, 525].includes(j.code);
          return reply({ error: expired ? 'Session expirée' : j.message || 'Fichier indisponible', code: j.code }, expired ? 401 : 404);
        }
        const h = { ...cors, 'Content-Type': ct || 'application/octet-stream' };
        if (out.token) h['X-Token'] = out.token;
        return new Response(out.res.body, { status: 200, headers: h });
      }
      return reply({ error: 'introuvable' }, 404);
    } catch (e) { return reply({ error: String(e.message || e) }, 500); }
  },
};