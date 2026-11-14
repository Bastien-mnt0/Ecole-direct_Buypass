// Cloudflare Worker : même rôle que server.js, hébergé gratuitement.
// Il n'accepte que les requêtes venant de ALLOWED_ORIGIN (ton site GitHub Pages).
const BASE = 'https://api.ecoledirecte.com';
const API_VERSION = '4.75.0'; // à ajuster si l'API répond 517
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

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || '';
    const cors = { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
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
      return reply({ error: 'introuvable' }, 404);
    } catch (e) { return reply({ error: String(e.message || e) }, 500); }
  },
};
