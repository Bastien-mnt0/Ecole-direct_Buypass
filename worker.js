// EDUNOTA — Cloudflare Worker : même rôle que server.js (relais API uniquement, il ne sert aucune page), hébergé gratuitement.
// Il n'accepte que les requêtes venant de ALLOWED_ORIGIN (ton site GitHub Pages).
const BASE = 'https://api.ecoledirecte.com';
const API_VERSION = '4.75.0'; // à ajuster si l'API répond 517
const CLOUD_VERSION = '4.104.4'; // version utilisée par le site officiel pour le cloud : en dessous, la suppression ne passe pas par la corbeille
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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
const cleanToken = (t) => (typeof t === 'string' && /^[\x21-\x7e]{1,4096}$/.test(t) ? t : undefined);
const cleanCookies = (c) => { const o = {}; if (c && typeof c === 'object' && !Array.isArray(c)) for (const [k, v] of Object.entries(c).slice(0, 50)) { if (typeof v === 'string' && /^[^\s=;,\u0000-\u001f]{1,1024}$/u.test(k) && /^[^;\u0000-\u001f\u007f]{0,4096}$/u.test(v)) o[k] = v; else console.log('cookie ignoré :', String(k).slice(0, 40), typeof v, typeof v === 'string' ? v.length : '-'); } return o; };
const readAuth = (h) => { try { const a = JSON.parse(decodeURIComponent(h || '')); return a && typeof a === 'object' && cleanToken(a.token) ? { token: cleanToken(a.token), cookies: cleanCookies(a.cookies) } : null; } catch { return null; } };

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
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Ed-Auth', 'Access-Control-Expose-Headers': 'X-Token', Vary: 'Origin', 'Access-Control-Max-Age': '86400', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed || req.headers.get('Origin') !== allowed) return reply({ error: 'origine refusée' }, 403);
    const { pathname } = new URL(req.url);
    const ip = req.headers.get('CF-Connecting-IP') || 'inconnu', tooMany = () => reply({ error: 'Trop de requêtes : réessaie dans un instant' }, 429);
    try {
      if (req.method === 'POST' && pathname !== '/api/ed-upload-file' && (Number(req.headers.get('Content-Length')) || 0) > 1e6) return reply({ error: 'Requête trop volumineuse' }, 413);
      if (req.method === 'POST' && pathname === '/api/gtk') {
        if (limited(ip, 'login', 20, 600e3)) return tooMany();
        const r = await ed('/v3/login.awp?gtk=1', { method: 'GET' });
        return reply({ cookies: r.cookies });
      }
      if (req.method === 'POST' && pathname === '/api/ed') {
        const { path, data, token, cookies } = await req.json();
        if (typeof path !== 'string' || !okRoute(path)) return reply({ error: 'chemin refusé' }, 400);
        if (isAuth(path) ? limited(ip, 'login', 20, 600e3) : limited(ip, 'api', 240, 60e3)) return tooMany();
        return reply(await ed(path, { token: cleanToken(token), data, cookies: cleanCookies(cookies) }));
      }
      if (req.method === 'POST' && pathname.startsWith('/api/ed-') && limited(ip, 'file', 60, 60e3)) return tooMany();
      if (req.method === 'POST' && pathname === '/api/ed-upload') {
        const b = await req.json();
        if (!okUpload(b)) return reply({ error: 'envoi refusé' }, 400);
        return reply(await ed(uploadPath(b), { token: cleanToken(b.token), cookies: cleanCookies(b.cookies), form: uploadForm(b) }));
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
        const { id, type, token, cookies, entity } = await req.json();
        if (!okFileId(id, type) || !/^[A-Z_]+$/.test(String(type))) return reply({ error: 'fichier refusé' }, 400);
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
          return reply({ error: expired ? 'Session expirée' : j.message || 'Fichier indisponible', code: j.code, detail: `${tried.join(' | ')} ${t.replace(/\s+/g, ' ').slice(0, 160)}` }, expired ? 401 : 404);
        }
        const h = { ...cors, 'Content-Type': ct || 'application/octet-stream' };
        if (out.token) h['X-Token'] = out.token;
        return new Response(out.res.body, { status: 200, headers: h });
      }
      return reply({ error: 'introuvable' }, 404);
    } catch { return reply({ error: 'Erreur du relais' }, 500); }
  },
};