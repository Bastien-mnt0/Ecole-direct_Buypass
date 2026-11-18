// EDUNOVA — Cloudflare Worker : même rôle que server.js (relais API uniquement, il ne sert aucune page), hébergé gratuitement.
// Il n'accepte que les requêtes venant de ALLOWED_ORIGIN (ton site GitHub Pages).
const BASE = 'https://api.ecoledirecte.com';
const API_VERSION = '4.75.0'; // à ajuster si l'API répond 517
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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
// Envoi dans le cloud : uniquement edunova.json (JSON, 200 Ko max) dans un dossier désigné par son id. Pas d'envoi générique.
const okUpload = (b) => b.name === 'edunova.json' && b.mime === 'application/json' && typeof b.text === 'string' && b.text.length <= 2e5 && /^[\p{L}\p{N}_\-./ %\\]{1,300}$/u.test(String(b.parent)) && !String(b.parent).includes('..');
const uploadForm = (b) => { const f = new FormData(); f.append('file', new Blob([b.text], { type: 'application/json' }), b.name); return f; };
const uploadPath = (b) => `/v3/televersement.awp?verbe=post&mode=CLOUD&dest=${encodeURIComponent(b.parent)}`; // format relevé sur le site officiel (champ multipart : file)

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || '';
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'X-Token', Vary: 'Origin' };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed || req.headers.get('Origin') !== allowed) return reply({ error: 'origine refusée' }, 403);
    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'POST' && pathname === '/api/gtk') {
        const r = await ed('/v3/login.awp?gtk=1', { method: 'GET' });
        return reply({ cookies: r.cookies });
      }
      if (req.method === 'POST' && pathname === '/api/ed') {
        const { path, data, token, cookies } = await req.json();
        if (typeof path !== 'string' || !path.startsWith('/v3/')) return reply({ error: 'chemin refusé' }, 400);
        return reply(await ed(path, { token, data, cookies }));
      }
      if (req.method === 'POST' && pathname === '/api/ed-upload') {
        const b = await req.json();
        if (!okUpload(b)) return reply({ error: 'envoi refusé' }, 400);
        return reply(await ed(uploadPath(b), { token: b.token, cookies: b.cookies, form: uploadForm(b) }));
      }
      if (req.method === 'POST' && pathname === '/api/ed-file') {
        const { id, type, token, cookies } = await req.json();
        if (!okFileId(id, type) || !/^[A-Z_]+$/.test(String(type))) return reply({ error: 'fichier refusé' }, 400);
        const out = await ed(`/v3/telechargement.awp?verbe=get&fichierId=${encodeURIComponent(id)}&leTypeDeFichier=${type}`, { token, cookies, data: {}, raw: true });
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