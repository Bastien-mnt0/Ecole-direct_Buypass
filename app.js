// Adresse du relais : vide = même origine (node server.js en local).
// Pour GitHub Pages, mets l'URL de ton Cloudflare Worker, ex. 'https://ed-proxy.xxx.workers.dev'
const WORKER_URL = 'https://ecole-direct-buypass.didierbleu90.workers.dev';
const PROXY_URL = ['localhost', '127.0.0.1'].includes(location.hostname) ? '' : WORKER_URL; // en local : serveur node ; en ligne : Worker
const $ = (s) => document.querySelector(s);
const S = { cookies: {}, token: null, eleves: [], eleve: null, notes: null, tab: 'notes', week: 0, dayOff: 0, sub: 'eval', edtView: matchMedia('(max-width:760px)').matches ? 'day' : 'week', subjects: [] };
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
const toNum = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmt = (n, d = 2) => (n == null ? '–' : n.toFixed(d).replace('.', ','));
const color = (n) => (n == null ? 'var(--mute)' : n >= 14 ? 'var(--good)' : n >= 10 ? 'var(--mid)' : 'var(--bad)');
const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const longDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const hue = (s) => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const textOf = (html) => new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();

function show(view) {
  for (const v of ['login', 'qcm', 'app']) $('#' + v).classList.toggle('hidden', v !== view);
  $('#logout').classList.toggle('hidden', view !== 'app');
  $('#side').classList.toggle('hidden', view !== 'app');
  $('#who').classList.toggle('hidden', view !== 'app');
  $('#sport').classList.toggle('hidden', view !== 'app');
  if (view !== 'app') $('#eleve').classList.add('hidden');
}

// ---------- Session conservée (jamais le mot de passe) ----------
// Par défaut : sessionStorage (effacé à la fermeture de l'onglet). Avec « Rester connecté » : localStorage.
const SESS = 'ed-session';
const sess = {
  save() {
    if (!S.token || !S.eleve) return;
    const v = JSON.stringify({ t: S.token, c: S.cookies, e: S.eleves, i: S.eleves.indexOf(S.eleve), s: S.school, a: S.tab, ac: S.acc, at: Date.now() });
    try { window[S.keep ? 'localStorage' : 'sessionStorage'].setItem(SESS, v); window[S.keep ? 'sessionStorage' : 'localStorage'].removeItem(SESS); } catch {}
  },
  load() {
    for (const name of ['sessionStorage', 'localStorage']) {
      try { const v = JSON.parse(window[name].getItem(SESS)); if (v && v.t) return { ...v, keep: name === 'localStorage' }; } catch {}
    }
    return null;
  },
  clear() { for (const name of ['sessionStorage', 'localStorage']) { try { window[name].removeItem(SESS); } catch {} } },
};
function restore() {
  const v = sess.load();
  if (!v) return;
  if (Date.now() - v.at > 12 * 3600e3 || !(v.e || []).length) return sess.clear(); // inactif depuis plus de 12 h
  Object.assign(S, { token: v.t, cookies: v.c || {}, eleves: v.e, keep: v.keep, acc: v.ac || null, school: v.s || '', tab: ['home', 'dash', 'notes', 'edt', 'devoirs'].includes(v.a) ? v.a : 'home' });
  S.eleve = S.eleves[v.i] || S.eleves[0];
  $('#eleve').innerHTML = S.eleves.map((e, i) => `<option value="${i}">${esc(e.prenom)} ${esc(e.nom || '')}</option>`).join('');
  $('#eleve').value = String(S.eleves.indexOf(S.eleve));
  $('#eleve').classList.toggle('hidden', S.eleves.length < 2);
  setWho(); show('app'); openTab(S.tab); cloud.push(0);
}
async function api(path, data) {
  const r = await fetch(PROXY_URL + '/api/ed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, data, token: S.token, cookies: S.cookies }) });
  const o = await r.json().catch(() => ({ error: 'Relais injoignable : renseigne PROXY_URL dans index.html' }));
  if (o.error) throw new Error(o.error);
  if (o.token) S.token = o.token;
  if (o.cookies) S.cookies = o.cookies;
  sess.save();
  if ([520, 521, 525].includes(o.json.code)) {
    sess.clear(); show('login'); $('#loginErr').textContent = 'Session expirée : reconnecte-toi.';
    throw new Error('Session expirée');
  }
  return o.json;
}

function setNav(open) {
  $('#side').classList.toggle('open', open);
  $('#scrim').classList.toggle('show', open);
  $('#burger').classList.toggle('on', open);
  $('#burger').setAttribute('aria-expanded', open);
}
$('#burger').onclick = () => setNav(!$('#side').classList.contains('open'));
$('#scrim').onclick = () => setNav(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setNav(false); });
const wide = matchMedia('(min-width:761px)');
if (wide.addEventListener) wide.addEventListener('change', (e) => { if (e.matches) setNav(false); });
const applyTheme = (t) => { document.documentElement.dataset.theme = t; store.set('ed-theme', t); };
applyTheme(store.get('ed-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#theme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
// ---------- Connexion ----------
function setWho() { $('#school').textContent = S.school || ''; $('#who').textContent = `${S.eleve.prenom} ${S.eleve.nom || ''}`.trim(); }
async function login(fa = []) {
  const res = await api('/v3/login.awp', { identifiant: $('#id').value.trim(), motdepasse: $('#pw').value, isReLogin: false, uuid: '', fa });
  if (res.code === 250) return startQcm();
  if (res.code !== 200) throw new Error(res.message || 'Connexion refusée (code ' + res.code + ')');
  const acc = res.data.accounts[0];
  S.eleves = acc.typeCompte === 'E' ? [acc] : acc.profile?.eleves || [];
  if (!S.eleves.length) throw new Error('Aucun élève trouvé sur ce compte.');
  if (res.token) S.token = res.token;
  store.set('ed-id', $('#id').value.trim());
  $('#pw').value = ''; $('#pw').type = 'password';
  const sel = $('#eleve');
  sel.innerHTML = S.eleves.map((e, i) => `<option value="${i}">${esc(e.prenom)} ${esc(e.nom || '')}</option>`).join('');
  sel.classList.toggle('hidden', S.eleves.length < 2);
  S.eleve = S.eleves[0]; S.notes = null; S.hist = undefined; S.school = acc.nomEtablissement || ''; S.acc = { id: acc.id, type: acc.typeCompte || 'E' }; setWho();
  S.keep = $('#keep').checked; store.set('ed-keep', S.keep); sess.save();
  show('app'); openTab('home'); cloud.push(0);
}

async function startQcm() {
  const q = await api('/v3/connexion/doubleauth.awp?verbe=get', {});
  if (q.code !== 200) throw new Error(q.message || 'Double authentification impossible');
  $('#question').textContent = b64(q.data.question);
  $('#choix').innerHTML = q.data.propositions.map((p) => `<option value="${esc(p)}">${esc(b64(p))}</option>`).join('');
  show('qcm');
}

async function doLogin() {
  $('#loginErr').textContent = '';
  $('#go').disabled = true;
  try {
    const g = await (await fetch(PROXY_URL + '/api/gtk', { method: 'POST' })).json();
    S.cookies = g.cookies || {};
    await login();
  }
  catch (e) { $('#loginErr').textContent = e.message; }
  $('#go').disabled = false;
}
$('#go').onclick = doLogin;
$('#pw').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
const EYE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>', EYE_OFF = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
$('#eye').onclick = () => {
  const show = $('#pw').type === 'password';
  $('#pw').type = show ? 'text' : 'password';
  $('#eye').setAttribute('aria-pressed', show);
  $('#eye').setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  $('#eye').innerHTML = show ? EYE_OFF : EYE;
};
$('#id').value = store.get('ed-id', '');
$('#keep').checked = !!store.get('ed-keep', false);
$('#qcmGo').onclick = async () => {
  $('#qcmErr').textContent = '';
  try {
    const r = await api('/v3/connexion/doubleauth.awp?verbe=post', { choix: $('#choix').value });
    if (r.code !== 200) throw new Error(r.message || 'Mauvaise réponse');
    await login([{ cn: r.data.cn, cv: r.data.cv }]);
  } catch (e) { $('#qcmErr').textContent = e.message; }
};
$('#logout').onclick = async () => { await cloud.flush(); sess.clear(); location.reload(); };
$('#eleve').onchange = (e) => { S.eleve = S.eleves[+e.target.value]; S.notes = null; S.hist = undefined; setWho(); sess.save(); openTab(S.tab); };

// ---------- Onglets ----------
function openTab(name) {
  S.tab = name; setNav(false);
  $('#ptitle').textContent = { home: 'Accueil', dash: 'Analyse', notes: 'Notes et Moyennes', edt: 'Emploi du temps', devoirs: 'Cahier de texte' }[name];
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $('#appErr').textContent = '';
  $('#view').innerHTML = '<p class="mute">Chargement…</p>';
  ({ home: loadHome, dash: loadDash, notes: loadNotes, edt: loadEdt, devoirs: loadDevoirs })[name]().catch((e) => { $('#view').innerHTML = ''; $('#appErr').textContent = e.message; });
}
document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));

// ---------- Notes ----------
const sig = (n) => !(n.nonSignificatif === true || n.nonSignificatif === 'true');
function avg(list, key = 'valeur') {
  let s = 0, c = 0;
  for (const n of list) {
    const v = toNum(n[key]); if (v == null || !sig(n)) continue;
    const on = toNum(n.noteSur) || 20, k = toNum(n.coef) || 1;
    s += (v / on) * 20 * k; c += k;
  }
  return c ? s / c : null;
}
function groupBy(notes) {
  const g = {};
  for (const n of notes) (g[n.codeMatiere] ||= { code: n.codeMatiere, name: n.libelleMatiere, notes: [] }).notes.push(n);
  return Object.values(g).sort((a, b) => a.name.localeCompare(b.name));
}
// Comme EcoleDirecte : moyenne de matière = notes pondérées par leur coef (ramenées sur 20, notes
// « non significatives » ignorées) ; moyenne générale / de bloc = moyenne des matières pondérée par le coef de matière.
let ST = { coef: {}, official: {}, blocs: [] };
function structure() {
  const ps = S.notes.periodes || [];
  const p = ps.find((x) => x.codePeriode === S.periode) || ps.find((x) => x.annuel) || ps[ps.length - 1];
  const coef = {}, official = {}, order = [], blocs = [];
  let cur = null;
  for (const d of p?.ensembleMatieres?.disciplines || []) {
    if (d.groupeMatiere) { cur = { name: d.discipline, codes: [], st: [d.moyenneClasse, d.moyenneMin, d.moyenneMax] }; blocs.push(cur); order.push({ head: cur }); continue; }
    if (d.sousMatiere) continue;
    coef[d.codeMatiere] = toNum(d.coef) ?? 1;
    official[d.codeMatiere] = toNum(d.moyenne);
    const gid = d.idGroupeMatiere;
    if (cur && (gid === undefined || String(gid) !== '0')) cur.codes.push(d.codeMatiere); else cur = null;
    order.push({ st: [d.moyenneClasse, d.moyenneMin, d.moyenneMax], code: d.codeMatiere, name: d.discipline, prof: (d.professeurs || []).map((x) => x.nom).join(' · ') });
  }
  return { gst: [p?.ensembleMatieres?.moyenneClasse, p?.ensembleMatieres?.moyenneMin, p?.ensembleMatieres?.moyenneMax], coef, official, order, gen: toNum(p?.ensembleMatieres?.moyenneGenerale), blocs: blocs.filter((x) => x.codes.length) };
}
// Notes « nouvelles » (soulignées) : les plus récentes que la moyenne officielle n'a pas encore prises en compte
function newOnes(s) {
  if (!(s.code in ST.official)) return new Set();
  const off = ST.official[s.code];
  const sorted = [...s.notes].sort((a, b) => String(a.dateSaisie || a.date).localeCompare(String(b.dateSaisie || b.date)));
  if (off == null) return new Set(sorted);
  for (let k = 0; k <= sorted.length; k++) {
    const a = avg(sorted.slice(0, sorted.length - k));
    if (a != null && Math.abs(a - off) < 0.006) return new Set(sorted.slice(sorted.length - k));
  }
  return new Set();
}
function general(notes, key, only) {
  let s = 0, c = 0;
  for (const g of groupBy(notes)) {
    if (only && !only.has(g.code)) continue;
    const a = avg(g.notes, key); if (a == null) continue;
    const k = ST.coef[g.code] ?? 1;
    s += a * k; c += k;
  }
  return c ? s / c : null;
}
function spark(notes) {
  const dates = [...new Set(notes.map((n) => n.date))].sort();
  const pts = dates.map((d) => general(notes.filter((n) => n.date <= d))).filter((x) => x != null);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts), r = Math.max(...pts) - lo || 1, W = 220, H = 48;
  const xy = pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 4 - ((v - lo) / r) * (H - 8)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Évolution de la moyenne générale"><polyline points="${xy}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

async function loadNotes() {
  if (!S.notes) {
    const r = await api(`/v3/eleves/${S.eleve.id}/notes.awp?verbe=get`, { anneeScolaire: '' });
    if (r.code !== 200) throw new Error(r.message || 'Impossible de charger les notes');
    S.notes = r.data; S.periode = undefined;
  }
  renderNotes();
}

const ICON = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18"/><path d="M6 17v-5M10 17V8M14 17v-6M18 17V6"/></svg>';
function renderNotes() {
  const periodes = (S.notes.periodes || []).filter((p) => !p.annuel);
  if (S.periode === undefined) S.periode = (periodes.find((p) => !p.cloture) || {}).codePeriode || '';
  const notes = (S.notes.notes || []).filter((n) => !S.periode || n.codePeriode === S.periode);
  ST = structure(); S.cur = notes;
  S.subjects = groupBy(notes).map((x, i) => ({ ...x, i, avg: avg(x.notes) }));
  const byCode = Object.fromEntries(S.subjects.map((x) => [x.code, x]));
  const order = ST.order.slice();
  const placed = new Set(order.filter((o) => o.code).map((o) => o.code));
  S.subjects.filter((x) => !placed.has(x.code)).forEach((x) => order.push({ code: x.code, name: x.name, prof: '' }));
  const g = general(notes);
  const ptabs = periodes.map((p) => `<button class="ptab" data-p="${esc(p.codePeriode)}" aria-selected="${p.codePeriode === S.periode}">${esc(p.periode)}</button>`).join('') + `<button class="ptab" data-p="" aria-selected="${!S.periode}">Année</button>`;
  const opts = ['<option value="">Toute l\'année</option>'].concat(periodes.map((p) => `<option value="${esc(p.codePeriode)}" ${p.codePeriode === S.periode ? 'selected' : ''}>${esc(p.periode)}</option>`)).join('');
  const ev = (n, isNew) => `<span class="ev ${isNew ? 'new' : ''} ${sig(n) ? '' : 'ns'}">${sig(n) ? esc(n.valeur) : '(' + esc(n.valeur) + ')'}${(toNum(n.noteSur) || 20) !== 20 ? `<sub> /${esc(n.noteSur)}</sub>` : ''}${(toNum(n.coef) || 1) !== 1 ? `<sup> (${esc(n.coef)})</sup>` : ''}</span>`;
  const rows = order.map((o) => {
    if (o.head) return `<tr class="grp"><td>${esc(/^moyenne/i.test(o.head.name) ? o.head.name : 'Moyenne ' + o.head.name)}</td><td class="c-coef"></td><td class="c-avg">${fmt(general(notes, undefined, new Set(o.head.codes)))}</td><td class="c-ev"></td><td class="c-x"></td></tr>`;
    const x = byCode[o.code] || { code: o.code, notes: [], avg: null, i: -1 };
    const nw = newOnes(x);
    const list = [...x.notes].sort((a, b) => String(a.dateSaisie || a.date).localeCompare(String(b.dateSaisie || b.date)));
    return `<tr><td class="disc"><b>${esc(o.name)}</b>${o.prof ? `<i>${esc(o.prof)}</i>` : ''}</td><td class="c-coef">${esc(String(ST.coef[o.code] ?? 1).replace('.', ','))}</td><td class="c-avg">${x.avg != null ? fmt(x.avg) : ''}<small class="cf">Coef ${esc(String(ST.coef[o.code] ?? 1).replace('.', ','))}</small></td><td class="c-ev">${list.map((n) => ev(n, nw.has(n))).join('')}</td><td class="c-x"></td></tr>`;
  }).join('');
  const stat = (st) => (st && st[0] != null && st[0] !== '' ? `<div class="stat"><u>Moy.</u> Classe: ${fmt(toNum(st[0]))} Min: ${fmt(toNum(st[1]))} Max: ${fmt(toNum(st[2]))}</div>` : '');
  const bx = (v, c) => `<div class="bx">${v != null ? fmt(v) + ' / 20' : ''}${c != null ? `<small>Coef ${esc(String(c).replace('.', ','))}</small>` : ''}</div>`;
  const moyHtml = `<div class="mrow head"><span>Moyenne générale</span>${bx(g)}</div>${stat(ST.gst)}` + order.map((o) => o.head
    ? `<div class="mrow head"><span>${esc(o.head.name)}</span>${bx(general(notes, undefined, new Set(o.head.codes)))}</div>${stat(o.head.st)}`
    : `<div class="mrow">${bx((byCode[o.code] || {}).avg ?? null, ST.coef[o.code] ?? 1)}<span><b>${esc(o.name)}</b><i>${esc(o.prof || '')}</i></span></div>${stat(o.st)}`).join('');
  S.testSubs = order.filter((o) => o.code).map((o) => ({ ...(byCode[o.code] || { notes: [], avg: null }), code: o.code, name: o.name }));
  $('#view').innerHTML = `
    <div class="ptabs">${ptabs}</div><div class="card" style="margin-top:10px">
    <div class="wrap"><table>
      <thead><tr><th>Disciplines</th><th>Coef.</th><th>Moyennes</th><th>Evaluations</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="mute">Aucune note sur cette période.</td></tr>'}
      <tr class="gen"><td class="r gl" colspan="2">Moyenne générale</td><td class="c-avg">${fmt(g)}</td><td colspan="2" class="mute note" style="font-weight:400">${ST.gen != null ? `Officielle (actualisée toutes les 24 h) : ${fmt(ST.gen)} · notes soulignées = nouvelles` : ''}</td></tr></tbody>
    </table></div><div class="sim" id="testnote" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line)"><b>Test de note</b> <select id="tsub" style="width:auto;max-width:240px">${S.testSubs.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join('')}</select> note <input id="tval" type="number" min="0" step="0.25" placeholder="15" aria-label="Note"> / <input id="ton" type="number" min="1" value="20" aria-label="Sur"> coef <input id="tcoef" type="number" min="0.25" step="0.25" value="1" aria-label="Coefficient"> <span class="num" id="tres"></span></div><p class="mute" style="font-style:italic;margin:14px 0 6px">Moyennes recalculées en direct à partir de toutes tes notes, nouvelles notes comprises.</p><b>Légende des notes</b><div class="mute">note <sup>(x)</sup> : note coefficientée · note <sub>/X</sub> : note sur X · (note) : note non significative · <u>note</u> : nouvelle note, pas encore dans la moyenne officielle</div></div>`;
  if (S.sub === 'moy') $('#view .card').innerHTML = moyHtml;
  $('#view').insertAdjacentHTML('afterbegin', `<div class="subtabs"><button data-s="eval" aria-selected="${S.sub !== 'moy'}">Évaluations</button><button data-s="moy" aria-selected="${S.sub === 'moy'}">Moyennes</button></div>`);
  document.querySelectorAll('.subtabs button').forEach((b) => (b.onclick = () => { S.sub = b.dataset.s; renderNotes(); }));
  document.querySelectorAll('.ptab').forEach((b) => (b.onclick = () => { S.periode = b.dataset.p; renderNotes(); }));
}
// Test de note : effet d'une note hypothétique sur la matière et sur la moyenne générale
function testNote() {
  const out = $('#tres'); if (!out) return;
  const s = S.testSubs[+$('#tsub').value], x = toNum($('#tval').value);
  out.textContent = '';
  if (!s || x == null) return;
  const hyp = { codeMatiere: s.code, libelleMatiere: s.name, date: '9999', valeur: x, noteSur: toNum($('#ton').value) || 20, coef: toNum($('#tcoef').value) || 1, nonSignificatif: false };
  const a = avg([...s.notes, hyp]), g0 = general(S.cur), g1 = general(S.cur.concat(hyp));
  const sg = (v) => (v >= 0 ? '+' : '−') + fmt(Math.abs(v));
  out.textContent = `→ ${s.name} : ${fmt(a)}${s.avg != null ? ` (${sg(a - s.avg)})` : ''} · moyenne générale : ${fmt(g1)}${g0 != null ? ` (${sg(g1 - g0)})` : ''}`;
  out.style.color = g0 == null || g1 >= g0 ? 'var(--good)' : 'var(--bad)';
}
document.addEventListener('input', (e) => { if (e.target.closest('#testnote')) testNote(); });

// ---------- Analyse (courbes, prévisions) ----------
let gid = 0;
const lastN = (list, k) => list.filter((n) => toNum(n.valeur) != null && sig(n)).sort((a, b) => a.date.localeCompare(b.date)).slice(-k).map((n) => (toNum(n.valeur) / (toNum(n.noteSur) || 20)) * 20);
function chart(pts, pred = [], o = {}) {
  if (!pts.length) return '<p class="mute">Pas assez de notes.</p>';
  const small = !!o.small, W = small ? 220 : 720, H = small ? 64 : 240, P = small ? { l: 4, r: 4, t: 6, b: 6 } : { l: 8, r: 60, t: 14, b: 22 };
  const all = pts.concat(pred), n = all.length;
  let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo || 1) * 0.2;
  lo = Math.max(0, lo - pad); hi = Math.min(20, hi + pad); if (hi - lo < 1) { lo = Math.max(0, lo - 0.5); hi = lo + 1; }
  const X = (i) => P.l + (n < 2 ? (W - P.l - P.r) / 2 : (i / (n - 1)) * (W - P.l - P.r)), Y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const last = pts.length - 1, c = pts[last] >= pts[0] ? 'var(--good)' : 'var(--bad)', id = 'g' + ++gid, mono = 'font-family="ui-monospace,monospace"';
  const line = pts.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  let grid = '';
  if (!small) for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4, y = Y(v).toFixed(1); grid += `<line x1="${P.l}" x2="${W - P.r}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${W - P.r + 6}" y="${+y + 4}" fill="var(--mute)" font-size="11" ${mono}>${fmt(v, 1)}</text>`; }
  const dots = small ? '' : pts.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" fill="${i === 0 || v >= pts[i - 1] ? 'var(--good)' : 'var(--bad)'}"/>`).join('');
  const pl = pred.length ? `<polyline points="${[pts[last], ...pred].map((v, i) => `${X(last + i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4"/><circle cx="${X(n - 1).toFixed(1)}" cy="${Y(pred[pred.length - 1]).toFixed(1)}" r="4" fill="var(--accent)"/>` : '';
  const ly = Y(pts[last]), py0 = pred.length ? Y(pred[pred.length - 1]) : 0, py = Math.abs(py0 - ly) < 22 ? ly + (py0 >= ly ? 22 : -22) : py0;
  const tag = (y, col, v) => `<rect x="${W - P.r + 2}" y="${(y - 10).toFixed(1)}" width="54" height="20" rx="4" fill="${col}"/><text x="${W - P.r + 29}" y="${(y + 4).toFixed(1)}" text-anchor="middle" fill="#0b0e11" font-size="11" font-weight="700" ${mono}>${fmt(v)}</text>`;
  const tags = small ? '' : tag(ly, c, pts[last]) + (pred.length ? tag(py, 'var(--accent)', pred[pred.length - 1]) : '');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'Évolution')}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${c};stop-opacity:.3"/><stop offset="1" style="stop-color:${c};stop-opacity:0"/></linearGradient></defs>${grid}<polygon points="${X(0).toFixed(1)},${H - P.b} ${line} ${X(last).toFixed(1)},${H - P.b}" fill="url(#${id})"/><polyline points="${line}" fill="none" stroke="${c}" stroke-width="${small ? 1.8 : 2.4}" stroke-linejoin="round" stroke-linecap="round"/>${dots}${pl}${tags}</svg>`;
}
function bars(items) {
  const W = 720, n = items.length, step = (W - 70) / n, bw = Math.min(90, step - 28), Y = (v) => 150 - (v / 20) * 130, mono = 'font-family="ui-monospace,monospace"';
  const grid = [0, 5, 10, 15, 20].map((v) => `<line x1="40" x2="${W}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="34" y="${Y(v) + 4}" text-anchor="end" fill="var(--mute)" font-size="11" ${mono}>${v}</text>`).join('');
  const b = items.map((it, i) => {
    const x = 50 + (i + 0.5) * step, col = !i ? 'var(--accent)' : it.v >= items[i - 1].v ? 'var(--good)' : 'var(--bad)';
    return `<rect x="${x - bw / 2}" y="${Y(it.v)}" width="${bw}" height="${150 - Y(it.v)}" rx="4" fill="${col}" opacity=".85"/><text x="${x}" y="${Y(it.v) - 6}" text-anchor="middle" fill="var(--ink)" font-size="13" font-weight="700" ${mono}>${fmt(it.v)}</text><text x="${x}" y="170" text-anchor="middle" fill="var(--mute)" font-size="12">${esc(it.label)}</text>` +
      (it.cls != null ? `<line x1="${x - bw / 2 - 8}" x2="${x + bw / 2 + 8}" y1="${Y(it.cls)}" y2="${Y(it.cls)}" stroke="var(--ink)" stroke-width="2" stroke-dasharray="4 3"/>` : '');
  }).join('');
  return `<svg viewBox="0 0 ${W} 186" role="img" aria-label="Moyenne par trimestre">${grid}${b}</svg>`;
}
// ---------- Années précédentes + modèle de prévision ----------
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
function schoolYears(n) {
  const d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return Array.from({ length: n }, (_, i) => `${y - 1 - i}-${y - i}`);
}
// Récupère jusqu'à 3 années précédentes (si le compte y donne accès). Les erreurs sont ignorées.
async function loadHistory() {
  if (S.hist) return S.hist;
  const res = await Promise.all(schoolYears(3).map((label) => api(`/v3/eleves/${S.eleve.id}/notes.awp?verbe=get`, { anneeScolaire: label })
    .then((r) => (r.code === 200 && (r.data?.notes || []).length ? { label, notes: r.data.notes, periodes: r.data.periodes || [] } : null)).catch(() => null)));
  return (S.hist = { years: res.filter(Boolean) });
}
// Modèle : pour chaque matière, niveau habituel (moyenne pondérée des années, la plus récente compte le plus : 1, 0.6, 0.36)
// et dérive habituelle entre le 1er trimestre et la fin d'année.
function buildModel() {
  const ys = (S.hist && S.hist.years) || [], acc = {};
  ys.forEach((y, i) => {
    const w = Math.pow(0.6, i), first = (y.periodes || []).filter((p) => !p.annuel)[0];
    const t1 = first ? y.notes.filter((n) => n.codePeriode === first.codePeriode) : [];
    groupBy(y.notes).forEach((x) => {
      const k = norm(x.name), a = avg(x.notes), a1 = t1.length ? avg(t1.filter((n) => norm(n.libelleMatiere) === k)) : null;
      if (a == null) return;
      const o = (acc[k] ||= { h: 0, w: 0, d: 0, dw: 0 });
      o.h += w * a; o.w += w;
      if (a1 != null) { o.d += w * (a - a1); o.dw += w; }
    });
  });
  const subj = {};
  for (const [k, o] of Object.entries(acc)) subj[k] = { h: o.h / o.w, d: o.dw ? o.d / o.dw : 0 };
  return { years: ys.length, subj };
}
async function loadDash() {
  if (!S.notes) {
    const r = await api(`/v3/eleves/${S.eleve.id}/notes.awp?verbe=get`, { anneeScolaire: '' });
    if (r.code !== 200) throw new Error(r.message || 'Impossible de charger les notes');
    S.notes = r.data; S.periode = undefined;
  }
  await loadHistory();
  renderDash();
}
function renderDash() {
  S.dN ??= 3; const M = buildModel(); S.dScen ??= M.years ? 'hist' : 'trend'; if (S.dScen === 'hist' && !M.years) S.dScen = 'trend';
  const periodes = (S.notes.periodes || []).filter((p) => !p.annuel);
  if (S.periode === undefined) S.periode = (periodes.find((p) => !p.cloture) || {}).codePeriode || '';
  ST = structure();
  const all = S.notes.notes || [], notes = all.filter((n) => !S.periode || n.codePeriode === S.periode);
  const subs = groupBy(notes).map((x) => ({ ...x, avg: avg(x.notes) }));
  const val = (x) => {
    const l = lastN(x.notes, 3), tr = l.length ? l.reduce((t, v) => t + v, 0) / l.length : null;
    let b = S.dScen === 'stable' ? x.avg : tr;
    if (S.dScen === 'hist') {
      // le niveau habituel pèse comme 3 notes, la tendance actuelle comme le nombre de notes de l'année ; + moitié de la dérive habituelle
      const m = M.subj[norm(x.name)];
      b = tr == null ? null : m ? (x.notes.length * tr + 3 * m.h) / (x.notes.length + 3) + 0.5 * Math.max(-2, Math.min(2, m.d)) : tr;
    }
    return b == null ? null : Math.max(0, Math.min(20, b + (S.dScen === 'high' ? 2 : S.dScen === 'low' ? -2 : 0)));
  };
  const hyp = (x, k) => { const v = val(x); return v == null ? [] : Array.from({ length: k }, () => ({ codeMatiere: x.code, libelleMatiere: x.name, date: '9999', valeur: v, noteSur: 20, coef: 1, nonSignificatif: false })); };
  const dates = [...new Set(notes.map((n) => n.date))].sort();
  const gser = dates.map((d) => general(notes.filter((n) => n.date <= d))).filter((v) => v != null);
  const gpred = gser.length ? Array.from({ length: S.dN }, (_, i) => general(notes.concat(subs.flatMap((x) => hyp(x, i + 1))))).filter((v) => v != null) : [];
  const g = gser.length ? gser[gser.length - 1] : null, gp = gpred.length ? gpred[gpred.length - 1] : null;
  const dlt = (v) => `<span class="${v >= 0 ? 'up' : 'dn'}">${v >= 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(v))}</span>`;
  const ranked = subs.filter((x) => x.avg != null).sort((a, b) => b.avg - a.avg);
  const kpi = (t, v, sub) => `<div class="kpi"><small>${t}</small><b>${v}</b><small>${sub || ''}</small></div>`;
  const tabs = periodes.map((p) => `<button class="ptab" data-p="${esc(p.codePeriode)}" aria-selected="${p.codePeriode === S.periode}">${esc(p.periode)}</button>`).join('') + `<button class="ptab" data-p="" aria-selected="${!S.periode}">Année</button>`;
  const items = periodes.map((p) => ({ label: p.periode, v: general(all.filter((n) => n.codePeriode === p.codePeriode)), cls: toNum(p.ensembleMatieres?.moyenneClasse) })).filter((it) => it.v != null);
  const hItems = ((S.hist && S.hist.years) || []).slice().reverse().map((y) => ({ label: y.label, v: general(y.notes) })).filter((it) => it.v != null).concat(general(all) != null ? [{ label: 'En cours', v: general(all) }] : []);
  const cards = subs.sort((a, b) => a.name.localeCompare(b.name)).map((x) => {
    const ser = [...new Set(x.notes.map((n) => n.date))].sort().map((d) => avg(x.notes.filter((n) => n.date <= d))).filter((v) => v != null);
    const pr = Array.from({ length: S.dN }, (_, i) => avg([...x.notes, ...hyp(x, i + 1)])).filter((v) => v != null);
    if (!ser.length) return '';
    const cur = ser[ser.length - 1], d = ser.length > 1 ? cur - ser[ser.length - 2] : 0, end = pr.length ? pr[pr.length - 1] : null;
    return `<div class="scard"><header><div><b>${esc(x.name)}</b><div class="v" style="color:${color(cur)}">${fmt(cur)}</div></div><span class="chip ${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(d))}</span></header>${chart(ser, pr, { small: true, label: x.name })}<div class="mute">${M.subj[norm(x.name)] ? `Historique : ${fmt(M.subj[norm(x.name)].h)} · ` : ''}Prévision : <b class="num ${end != null && end >= cur ? 'up' : 'dn'}">${fmt(end)}</b></div></div>`;
  }).join('');
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  $('#view').innerHTML = `<div class="ptabs">${tabs}</div>
    <div class="kpis">${kpi('Moyenne générale', `<span style="color:${color(g)}">${fmt(g)}</span>`, gser.length > 1 ? dlt(g - gser[gser.length - 2]) + ' dernière note' : '')}
      ${kpi('Prévision', `<span class="${gp != null && g != null && gp >= g ? 'up' : 'dn'}">${fmt(gp)}</span>`, gp != null && g != null ? dlt(gp - g) + ` après ${S.dN} notes/matière` : '')}
      ${kpi('Classe', fmt(toNum(ST.gst && ST.gst[0])), g != null && toNum(ST.gst && ST.gst[0]) != null ? dlt(g - toNum(ST.gst[0])) + ' vs classe' : '')}
      ${kpi('Meilleure matière', ranked.length ? fmt(ranked[0].avg) : '–', ranked.length ? esc(ranked[0].name) : '')}
      ${kpi('À surveiller', ranked.length ? fmt(ranked[ranked.length - 1].avg) : '–', ranked.length ? esc(ranked[ranked.length - 1].name) : '')}</div>
    <div class="panel"><h3>Évolution de la moyenne générale</h3>${chart(gser, gpred, { label: 'Moyenne générale' })}<div class="mute"><span class="up">●</span> hausse · <span class="dn">●</span> baisse · <span style="color:var(--accent)">╌╌</span> prévision</div></div>
    <div class="panel"><h3>Moyenne par trimestre</h3>${items.length ? bars(items) : '<p class="mute">Pas encore de notes.</p>'}<div class="mute">Barre verte/rouge : progression par rapport au trimestre précédent · trait pointillé : moyenne de la classe</div></div>
    ${M.years ? `<div class="panel"><h3>Années précédentes</h3>${bars(hItems)}<div class="mute">Le modèle s'appuie sur ${M.years} année${M.years > 1 ? 's' : ''} d'historique : il rapproche tes prochaines notes de ton niveau habituel dans chaque matière, d'autant plus que tu as peu de notes cette année.</div></div>` : '<div class="panel mute">Aucune année précédente n\'est accessible sur ce compte : les prévisions reposent sur ta tendance actuelle.</div>'}
    <div class="panel ctrl"><b>Prévision</b> ${sel('dN', [[1, '1 note'], [3, '3 notes'], [5, '5 notes'], [10, '10 notes']], S.dN)} de plus par matière · modèle de calcul : ${sel('dScen', [...(M.years ? [['hist', 'Modèle historique']] : []), ['trend', 'Moyenne de tes 3 dernières notes'], ['stable', 'Moyenne actuelle'], ['high', 'Ta moyenne + 2 points'], ['low', 'Ta moyenne − 2 points']], S.dScen)}</div>
    <h3 style="margin-top:18px">Évolution par matière</h3><div class="sgrid">${cards}</div>
    <p class="mute">Estimation indicative : elle suppose que tes prochaines notes (coef 1) auront la valeur du scénario choisi ; elle ne prédit pas tes vrais résultats.</p>`;
  document.querySelectorAll('.ptab').forEach((b) => (b.onclick = () => { S.periode = b.dataset.p; renderDash(); }));
  $('#dN').onchange = (e) => { S.dN = +e.target.value; renderDash(); };
  $('#dScen').onchange = (e) => { S.dScen = e.target.value; renderDash(); };
}

// ---------- Cahier de texte : travail à faire et contrôles ----------
// Nom de salle propre : retire les <balises> d'EcoleDirecte et évite « salle Salle P-5 »
function room(s) {
  const t = String(s || '').replace(/<[^>]*>/g, '').trim();
  return !t ? '' : /^salle\b/i.test(t) ? t : 'Salle ' + t;
}
const NOTHING = 'Aucun contrôle et devoir';
async function hwList() {
  if (S.hw && S.hw.id === S.eleve.id) return S.hw;
  const r = await api(`/v3/Eleves/${S.eleve.id}/cahierdetexte.awp?verbe=get`, {});
  S.hw = { id: S.eleve.id, list: r.code === 200 && r.data ? r.data : {}, days: {} };
  return S.hw;
}
async function hwDay(date) {
  const h = await hwList();
  if (!h.days[date]) {
    const r = await api(`/v3/Eleves/${S.eleve.id}/cahierdetexte/${date}.awp?verbe=get`, {}).catch(() => null);
    h.days[date] = r && r.code === 200 ? r.data?.matieres || [] : [];
  }
  return h.days[date];
}
const safeText = (x) => { try { return textOf(b64(x)); } catch { return ''; } };
// seulement le « travail à faire » (le contenu de séance est ignoré) et les contrôles annoncés
const docsOf = (m) => (m.aFaire && Array.isArray(m.aFaire.documents) ? m.aFaire.documents : []).filter((d) => d && d.id != null).map((d) => ({ id: d.id, type: d.type || 'FICHIER_CDT', name: String(d.libelle || 'Fichier') }));
const todo = (m) => ({ id: m.aFaire && m.aFaire.idDevoir != null ? m.aFaire.idDevoir : null, matiere: m.matiere, text: m.aFaire && m.aFaire.contenu ? safeText(m.aFaire.contenu) : '', interro: !!m.interrogation, done: !!(m.aFaire && m.aFaire.effectue), docs: docsOf(m) });
const hasWork = (m) => (m.aFaire && m.aFaire.contenu) || m.interrogation;
const sameSubject = (m, c) => (m.codeMatiere && m.codeMatiere === c.codeMatiere) || norm(m.matiere) === norm(c.matiere || c.text);
const workHtml = (t) => `<div class="hwi"><b>${esc(t.matiere)}</b>${t.interro ? '<span class="tag tag-c">contrôle</span>' : ''}${t.done ? '<span class="tag">fait</span>' : ''}<div>${t.text ? esc(t.text) : '<span class="mute">Contrôle annoncé</span>'}</div>${docsHtml(t.docs)}</div>`;
const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const extOf = (n) => { const m = /\.([a-z0-9]{1,5})$/i.exec(n); return m ? m[1].toLowerCase() : ''; };
const docsHtml = (docs) => !docs || !docs.length ? '' : `<div class="pjs">${docs.map((d) => {
  const e = extOf(d.name);
  return `<div class="pj" data-id="${esc(d.id)}" data-type="${esc(d.type)}" data-name="${esc(d.name)}"><span class="pjn">${esc(d.name)}</span><span class="tag">${esc((e || 'fichier').toUpperCase())}</span><span class="pja">${MIME[e] ? '<button type="button" class="pjb" data-act="view">Aperçu</button>' : ''}<button type="button" class="pjb" data-act="dl">Télécharger</button></span><div class="pjm err" role="alert"></div><div class="pjv"></div></div>`;
}).join('')}</div>`;
const files = new Map();
async function fileBlob(d) {
  const key = d.type + ':' + d.id;
  if (files.has(key)) return files.get(key);
  const r = await fetch(PROXY_URL + '/api/ed-file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id, type: d.type, token: S.token, cookies: S.cookies }) }).catch(() => null);
  if (!r) throw new Error('Relais injoignable');
  const t = r.headers.get('X-Token');
  if (t) { S.token = t; sess.save(); }
  if (!r.ok) {
    const o = await r.json().catch(() => ({}));
    if ([520, 521, 525].includes(o.code)) { sess.clear(); show('login'); $('#loginErr').textContent = 'Session expirée : reconnecte-toi.'; }
    throw new Error(o.error || 'Fichier indisponible');
  }
  const b = await r.blob(), e = extOf(d.name);
  if (!b.size) throw new Error('Fichier indisponible');
  const blob = MIME[e] && b.type !== MIME[e] ? new Blob([b], { type: MIME[e] }) : b;
  const f = { url: URL.createObjectURL(blob), type: blob.type };
  files.set(key, f);
  return f;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.pjb'); if (!b) return;
  const row = b.closest('.pj'), d = { id: row.dataset.id, type: row.dataset.type, name: row.dataset.name }, msg = row.querySelector('.pjm'), view = row.querySelector('.pjv'), label = b.textContent;
  msg.textContent = '';
  if (b.dataset.act === 'view' && view.firstChild) { view.innerHTML = ''; b.textContent = 'Aperçu'; return; }
  b.disabled = true; b.textContent = 'Chargement…';
  try {
    const f = await fileBlob(d);
    if (b.dataset.act === 'dl') {
      const ext = Object.entries(MIME).find(([, m]) => m === f.type);
      const a = Object.assign(document.createElement('a'), { href: f.url, download: extOf(d.name) || !ext ? d.name : d.name + '.' + ext[0] });
      document.body.appendChild(a); a.click(); a.remove();
      b.textContent = label;
    } else if (f.type.startsWith('image/')) {
      view.innerHTML = `<img src="${f.url}" alt="${esc(d.name)}">`; b.textContent = 'Masquer';
    } else if (f.type === 'application/pdf') {
      view.innerHTML = `<iframe src="${f.url}" title="${esc(d.name)}"></iframe>`; b.textContent = 'Masquer';
    } else { b.textContent = label; msg.textContent = 'Aperçu non disponible pour ce format : télécharge le fichier.'; }
  } catch (err) { b.textContent = label; msg.textContent = err.message || 'Fichier indisponible'; }
  b.disabled = false;
});
// ---------- Devoirs : urgence, progression, devoirs personnels ----------
const HW_ST = { todo: 'À faire', doing: 'En cours', done: 'Terminé' };
const HW_UR = { red: 'Urgent', orange: 'Échéance proche', green: 'À venir' };
const HW_RANK = { red: 0, orange: 1, green: 2 };
const HW_SRANK = { todo: 0, doing: 1, done: 2 };
const hwKeyFor = (id, k) => `ed-hw-${k}:${id}`;
const hwKey = (k) => hwKeyFor(S.eleve.id, k);
const hwHash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
function hwAuto(date) {
  const d = Math.round((new Date(date + 'T00:00:00') - new Date(iso(new Date()) + 'T00:00:00')) / 864e5);
  return d <= 1 ? 'red' : d <= 3 ? 'orange' : 'green';
}
async function hwEntries() {
  const h = await hwList();
  const days = Object.keys(h.list).sort().slice(0, 10);
  const det = await Promise.all(days.map(async (d) => [d, (await hwDay(d)).filter(hasWork).map(todo)]));
  const saved = store.get(hwKey('etat'), {}), seen = {};
  const sync = det.flatMap(([d, l]) => l.map((t) => {
    const base = `ed:${d}:${t.id != null ? t.id : norm(t.matiere) + ':' + hwHash(t.text + (t.interro ? '#c' : ''))}`;
    const key = seen[base] ? `${base}~${seen[base]++}` : (seen[base] = 1, base);
    const o = saved[key] || {};
    return { key, src: 'ed', date: d, matiere: t.matiere, text: t.text, interro: t.interro, docs: t.docs, st: o.st || (t.done ? 'done' : 'todo'), urg: o.urg || 'auto' };
  }));
  const mine = store.get(hwKey('perso'), []).map((p) => ({ key: 'me:' + p.id, src: 'me', date: p.date, matiere: p.matiere, titre: p.titre, text: p.desc || '', interro: false, docs: [], st: p.st, urg: p.urg }));
  return sync.concat(mine).map((e) => ({ ...e, level: e.urg === 'auto' ? hwAuto(e.date) : e.urg }));
}
const hwSel = (attr, opts, cur, label) => `<select ${attr} aria-label="${label}">${opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
function hwItem(e, grouped) {
  const when = grouped ? '' : `<span class="mute"> · pour ${esc(longDate(e.date))}</span>`;
  const title = e.src === 'me' ? `<div><b>${esc(e.titre)}</b></div>` : '';
  const body = e.text ? `<div>${esc(e.text)}</div>` : e.interro ? '<div><span class="mute">Contrôle annoncé</span></div>' : '';
  const states = Object.entries(HW_ST).map(([k, l]) => `<button type="button" class="ptab" data-hw="st" data-v="${k}" aria-selected="${e.st === k}">${l}</button>`).join('');
  const urgs = hwSel('data-hwu', [['auto', 'Urgence : auto'], ...Object.entries(HW_UR)], e.urg, 'Urgence');
  const acts = e.src === 'me' ? '<button type="button" class="hwb" data-hw="edit">Modifier</button><button type="button" class="hwb del" data-hw="del">Supprimer</button>' : '';
  return `<div class="hwi ${e.src === 'me' ? 'me' : ''} ${e.st === 'done' ? 'fin' : ''}" data-key="${esc(e.key)}"><div><span class="urg ${e.level}" title="${HW_UR[e.level]}" role="img" aria-label="${HW_UR[e.level]}"></span><b>${esc(e.matiere)}</b>${e.interro ? '<span class="tag tag-c">contrôle</span>' : ''}${e.src === 'me' ? '<span class="tag">personnel</span>' : '<span class="tag tag-ed">École Directe</span>'}${when}</div>${title}${body}${docsHtml(e.docs)}<div class="ctrl hwc"><span class="ptabs">${states}</span>${urgs}${acts}</div></div>`;
}
async function hwRender() {
  const all = await hwEntries();
  if (S.tab !== 'devoirs') return;
  S.hwAll = all;
  const p = store.get('ed-hw-prefs', {}), f = { urg: p.urg || '', st: p.st || '', src: p.src || '', sort: p.sort || 'date' };
  const list = all.filter((e) => (!f.urg || e.level === f.urg) && (!f.st || e.st === f.st) && (!f.src || e.src === f.src));
  const byDate = (a, b) => a.date.localeCompare(b.date);
  list.sort(f.sort === 'urg' ? (a, b) => HW_RANK[a.level] - HW_RANK[b.level] || byDate(a, b) : f.sort === 'st' ? (a, b) => HW_SRANK[a.st] - HW_SRANK[b.st] || byDate(a, b) : (a, b) => byDate(a, b) || HW_RANK[a.level] - HW_RANK[b.level]);
  const bar = `<div class="card"><div class="ctrl hwbar">${hwSel('data-hwf="urg"', [['', 'Urgence : toutes'], ...Object.entries(HW_UR)], f.urg, 'Filtrer par urgence')}${hwSel('data-hwf="st"', [['', 'État : tous'], ...Object.entries(HW_ST)], f.st, 'Filtrer par état')}${hwSel('data-hwf="src"', [['', 'Origine : toutes'], ['ed', 'École Directe'], ['me', 'Personnels']], f.src, 'Filtrer par origine')}${hwSel('data-hwf="sort"', [['date', 'Tri : date'], ['urg', 'Tri : urgence'], ['st', 'Tri : état']], f.sort, 'Trier')}<button type="button" data-hw="add">Ajouter un devoir</button></div><div class="mute legend"><span><span class="urg red"></span>urgent</span><span><span class="urg orange"></span>échéance proche</span><span><span class="urg green"></span>à venir</span></div></div>`;
  let body;
  if (!all.length) body = `<div class="card"><p>${NOTHING}</p></div>`;
  else if (!list.length) body = '<div class="card"><p class="mute">Aucun devoir ne correspond aux filtres.</p></div>';
  else if (f.sort === 'date') body = [...new Set(list.map((e) => e.date))].map((d) => `<div class="card"><h3 style="text-transform:capitalize">Pour ${esc(longDate(d))}</h3>${list.filter((e) => e.date === d).map((e) => hwItem(e, true)).join('')}</div>`).join('');
  else body = `<div class="card">${list.map((e) => hwItem(e, false)).join('')}</div>`;
  $('#view').innerHTML = bar + body + '<p class="mute" id="cloudSt"></p>';
  cloud.paint();
}
const loadDevoirs = async () => { cloud.push(0, true); return hwRender(); };
const hwApply = (fn) => { fn(); hwRender().catch((e) => { $('#appErr').textContent = e.message; }); };
function hwPatch(key, patch) {
  const now = Date.now();
  if (key.startsWith('me:')) store.set(hwKey('perso'), store.get(hwKey('perso'), []).map((p) => (p.id === key.slice(3) ? { ...p, ...patch, t: now } : p)));
  else {
    const s = store.get(hwKey('etat'), {}), e = { ...s[key] };
    for (const [f, v] of Object.entries(patch)) { e[f] = v; e[f === 'st' ? 'ts' : 'tu'] = now; }
    s[key] = e; store.set(hwKey('etat'), s);
  }
  cloud.push();
}
function hwForm(p) {
  const v = { titre: '', matiere: '', desc: '', date: iso(new Date()), urg: 'auto', st: 'todo', ...p };
  const subjects = [...new Set((S.hwAll || []).map((e) => e.matiere).filter(Boolean))].sort();
  const opt = (o, cur) => Object.entries(o).map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${l}</option>`).join('');
  $('#mtitle').textContent = p ? 'Modifier le devoir' : 'Nouveau devoir';
  $('#mbody').innerHTML = `<label for="hwT">Intitulé</label><input id="hwT" maxlength="120" value="${esc(v.titre)}"><label for="hwM">Matière</label><input id="hwM" list="hwML" maxlength="60" value="${esc(v.matiere)}"><datalist id="hwML">${subjects.map((s) => `<option value="${esc(s)}">`).join('')}</datalist><label for="hwDe">Description (facultative)</label><textarea id="hwDe" rows="3" maxlength="1000">${esc(v.desc)}</textarea><label for="hwD">Date limite</label><input id="hwD" type="date" value="${esc(v.date)}"><label for="hwU">Urgence</label><select id="hwU">${opt({ auto: 'Automatique (selon la date limite)', ...HW_UR }, v.urg)}</select><label for="hwS">État</label><select id="hwS">${opt(HW_ST, v.st)}</select><button type="button" id="hwSave">Enregistrer</button><div id="hwErr" class="err" role="alert"></div>`;
  $('#hwSave').onclick = () => {
    const o = { titre: $('#hwT').value.trim(), matiere: $('#hwM').value.trim(), desc: $('#hwDe').value.trim(), date: $('#hwD').value, urg: $('#hwU').value, st: $('#hwS').value };
    if (!o.titre || !o.matiere || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) { $('#hwErr').textContent = "Renseigne l'intitulé, la matière et la date limite."; return; }
    hwApply(() => {
      const l = store.get(hwKey('perso'), []);
      const t = Date.now();
      store.set(hwKey('perso'), p ? l.map((x) => (x.id === p.id ? { ...x, ...o, t } : x)) : l.concat({ id: t.toString(36) + Math.random().toString(36).slice(2, 6), ...o, t }));
      cloud.push();
    });
    modal.open(false);
  };
  modal.open(true);
  $('#hwT').focus();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-hw]'); if (!b) return;
  const a = b.dataset.hw, key = b.closest('.hwi')?.dataset.key;
  if (a === 'add') return hwForm();
  if (!key) return;
  if (a === 'st') hwApply(() => hwPatch(key, { st: b.dataset.v }));
  else if (a === 'edit') hwForm(store.get(hwKey('perso'), []).find((p) => p.id === key.slice(3)));
  else if (a === 'del' && confirm('Supprimer ce devoir ?')) hwApply(() => {
    const id = key.slice(3), del = store.get(hwKey('del'), {});
    store.set(hwKey('perso'), store.get(hwKey('perso'), []).filter((p) => p.id !== id));
    del[id] = Date.now(); store.set(hwKey('del'), del); // pierre tombale : la suppression se propage aux autres appareils
    cloud.push();
  });
});
document.addEventListener('change', (e) => {
  const f = e.target.closest('[data-hwf]'), u = e.target.closest('[data-hwu]');
  if (f) hwApply(() => store.set('ed-hw-prefs', { ...store.get('ed-hw-prefs', {}), [f.dataset.hwf]: f.value }));
  else if (u) hwApply(() => hwPatch(u.closest('.hwi').dataset.key, { urg: u.value }));
});
// ---------- Synchronisation avec le cloud personnel École Directe ----------
// Dossier « BUYPASS » à la racine du cloud, contenant buypass.json : états, urgences et devoirs personnels.
// Seules les données de l'app sont lues/écrites ; rien n'est jamais modifié côté devoirs / notes / EDT d'École Directe,
// et le fichier ne contient ni identifiant, ni mot de passe, ni jeton.
// Les routes sont regroupées ici : ce sont les seules lignes à ajuster si le cloud École Directe change.
const CLOUD = {
  dir: 'BUYPASS', file: 'buypass.json',
  acct: () => S.acc || { id: S.eleve.id, type: 'E' },
  route: {
    list: (a) => ({ path: `/v3/cloud/${a.type}/${a.id}.awp?verbe=get`, data: { forceDownload: 0 } }),
    mkdir: (a, name, root) => ({ path: `/v3/cloud/${a.type}/${a.id}.awp?verbe=post`, data: { parentNode: { ...root, children: [] }, libelle: name, typeRessource: 'folder' } }), // format relevé sur le site officiel

    del: (a, node) => ({ path: `/v3/cloud/${a.type}/${a.id}.awp?verbe=delete`, data: { nodes: [{ ...node, children: [] }], ids: [node.id] } }), // à confirmer (onglet Réseau, suppression)
    read: '/api/ed-file',    // relais existant (téléchargement), type de fichier « CLOUD »
    write: '/api/ed-upload', // relais : { parent, name, mime, text } → { json, token, cookies }, comme /api/ed
  },
};
const num = (v) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v > 0 ? v : 0; };
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
// Tout ce qui vient du cloud est une donnée non fiable : on ne garde que des champs connus, validés.
function cleanEtat(o) {
  const out = {};
  for (const [k, v] of Object.entries(isObj(o) ? o : {})) {
    if (!k.startsWith('ed:') || k.length > 300 || !isObj(v)) continue;
    const e = {};
    if (v.st in HW_ST) { e.st = v.st; e.ts = num(v.ts); }
    if (v.urg === 'auto' || v.urg in HW_UR) { e.urg = v.urg; e.tu = num(v.tu); }
    if (Object.keys(e).length) out[k] = e;
  }
  return out;
}
function cleanPerso(l) {
  const out = [], seen = new Set();
  for (const p of Array.isArray(l) ? l : []) {
    if (!isObj(p) || typeof p.id !== 'string' || !/^[\w-]{1,40}$/.test(p.id) || seen.has(p.id)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !(p.st in HW_ST) || !(p.urg === 'auto' || p.urg in HW_UR)) continue;
    seen.add(p.id);
    out.push({ id: p.id, titre: String(p.titre ?? '').slice(0, 120), matiere: String(p.matiere ?? '').slice(0, 60), desc: String(p.desc ?? '').slice(0, 1000), date: p.date, urg: p.urg, st: p.st, t: num(p.t) });
  }
  return out;
}
function cleanDel(o) {
  const out = {}, lim = Date.now() - 180 * 864e5; // les pierres tombales de plus de 6 mois sont oubliées
  for (const [k, v] of Object.entries(isObj(o) ? o : {})) if (/^[\w-]{1,40}$/.test(k) && num(v) > lim) out[k] = num(v);
  return out;
}
const cleanEleve = (e) => ({ etat: cleanEtat(e?.etat), perso: cleanPerso(e?.perso), del: cleanDel(e?.del) });
// Conflits : le dernier à avoir modifié gagne, champ par champ pour les états (une urgence changée sur un appareil et un état
// changé sur un autre sont tous deux conservés) ; égalité d'horodatage = version du cloud. Une suppression plus récente
// qu'une modification l'emporte (pierre tombale), et inversement.
function mergeEleve(L, R) {
  const pick = (a, b, f, tf) => {
    const A = a && a[f] !== undefined ? [a[f], a[tf]] : null, B = b && b[f] !== undefined ? [b[f], b[tf]] : null;
    return !A ? B : !B ? A : B[1] >= A[1] ? B : A;
  };
  const etat = {};
  for (const k of new Set([...Object.keys(L.etat), ...Object.keys(R.etat)])) {
    const e = {}, st = pick(L.etat[k], R.etat[k], 'st', 'ts'), ur = pick(L.etat[k], R.etat[k], 'urg', 'tu');
    if (st) { e.st = st[0]; e.ts = st[1]; }
    if (ur) { e.urg = ur[0]; e.tu = ur[1]; }
    etat[k] = e;
  }
  const del = { ...R.del };
  for (const [k, t] of Object.entries(L.del)) del[k] = Math.max(del[k] || 0, t);
  const byId = new Map();
  for (const p of R.perso) byId.set(p.id, p);
  for (const p of L.perso) { const r = byId.get(p.id); if (!r || p.t > r.t) byId.set(p.id, p); }
  const perso = [...byId.values()].filter((p) => !(del[p.id] >= p.t && del[p.id] > 0)).sort((a, b) => a.id.localeCompare(b.id));
  return { etat, perso, del };
}
const cloud = {
  timer: null, cur: null, dirty: false, fails: 0, last: 0, st: null,
  // push(délai) : planifie une synchro ; soft = ignorée si une synchro a eu lieu il y a moins de 30 s
  push(delay = 800, soft = false) {
    if (!S.token || !S.eleve || (soft && Date.now() - cloud.last < 30e3)) return;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(() => { cloud.timer = null; cloud.sync(); }, delay);
  },
  sync() {
    cloud.dirty = true;
    return (cloud.cur ||= (async () => {
      try { while (cloud.dirty) { cloud.dirty = false; await cloud.run(); } } finally { cloud.cur = null; }
    })());
  },
  async flush() {
    if (!cloud.timer && !cloud.cur) return;
    clearTimeout(cloud.timer); cloud.timer = null;
    await Promise.race([cloud.sync(), new Promise((r) => setTimeout(r, 4000))]);
  },
  set(state, msg) {
    cloud.st = { state, msg, at: new Date() };
    cloud.paint();
  },
  paint() {
    const el = $('#cloudSt'); if (!el || !cloud.st) return;
    const { state, msg, at } = cloud.st, hm = at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    el.textContent = state === 'sync' ? 'Synchronisation avec le cloud École Directe…'
      : state === 'ok' ? `Synchronisé avec le cloud École Directe (dossier ${CLOUD.dir}) · ${hm}`
      : `Cloud indisponible : ${msg}. Tes données restent enregistrées sur cet appareil.`;
  },
  // Seules les routes /v3/cloud/ sont autorisées : aucune écriture possible sur le reste d'École Directe.
  async call({ path, data }) {
    if (!path.startsWith('/v3/cloud/')) throw new Error('Route non autorisée');
    const r = await api(path, data);
    if (r.code !== 200) throw new Error(r.message || 'code ' + r.code);
    return r;
  },
  // Recherche en largeur (le plus proche de la racine d'abord) dans l'arborescence renvoyée par le cloud
  find(root, name, wantDir) {
    const isDir = (n) => /^(folder|dossier|dir)$/i.test(n.type || '') || n.isFolder === true || Array.isArray(n.children) || Array.isArray(n.contenu);
    const q = [root];
    while (q.length) {
      const n = q.shift();
      if (Array.isArray(n)) { q.push(...n); continue; }
      if (!isObj(n)) continue;
      if ((n.libelle ?? n.name) === name && isDir(n) === wantDir && n.id != null) return n;
      for (const v of Object.values(n)) if (v && typeof v === 'object') q.push(v);
    }
    return null;
  },
  // Dossier racine (libelle « / ») renvoyé par la liste : parent du dossier à créer
  root(tree) {
    const dirs = [], q = [tree];
    while (q.length) {
      const n = q.shift();
      if (Array.isArray(n)) { q.push(...n); continue; }
      if (!isObj(n)) continue;
      if (n.id != null && /^(folder|dossier|dir)$/i.test(n.type || '')) dirs.push(n);
      for (const v of Object.values(n)) if (v && typeof v === 'object') q.push(v);
    }
    return dirs.find((n) => n.libelle === '/') || dirs[0] || null;
  },
  async read(file) {
    const r = await fetch(PROXY_URL + CLOUD.route.read, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: file.id, type: 'CLOUD', token: S.token, cookies: S.cookies }) }).catch(() => null);
    if (!r) throw new Error('relais injoignable');
    const t = r.headers.get('X-Token'); if (t) { S.token = t; sess.save(); }
    if (!r.ok) throw new Error('lecture du fichier impossible');
    return r.text();
  },
  async write(a, dir, old, text) {
    if (old) await cloud.call(CLOUD.route.del(a, old)); // le fichier remplacé est toujours buypass.json dans BUYPASS
    const r = await fetch(PROXY_URL + CLOUD.route.write, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parent: dir.id, name: CLOUD.file, mime: 'application/json', text, token: S.token, cookies: S.cookies }) }).catch(() => null);
    if (!r) throw new Error('relais injoignable');
    const o = await r.json().catch(() => ({}));
    if (o.token) S.token = o.token;
    if (o.cookies) S.cookies = o.cookies;
    sess.save();
    if (!r.ok || o.error || !o.json || o.json.code !== 200) throw new Error(o.error || (o.json && o.json.message) || 'envoi impossible');
  },
  async run() {
    if (!S.token || !S.eleve) return;
    cloud.set('sync');
    try {
      const a = CLOUD.acct(), ids = S.eleves.map((e) => String(e.id));
      let tree = (await cloud.call(CLOUD.route.list(a))).data, dir = cloud.find(tree, CLOUD.dir, true);
      if (!dir) { // création automatique du dossier BUYPASS
        const root = cloud.root(tree);
        if (!root) throw new Error('racine du cloud introuvable');
        await cloud.call(CLOUD.route.mkdir(a, CLOUD.dir, root));
        tree = (await cloud.call(CLOUD.route.list(a))).data; dir = cloud.find(tree, CLOUD.dir, true);
        if (!dir) throw new Error('création du dossier ' + CLOUD.dir + ' impossible');
      }
      const file = cloud.find(dir, CLOUD.file, false);
      let remote = {};
      if (file) {
        let o; try { o = JSON.parse(await cloud.read(file)); } catch { throw new Error(CLOUD.file + ' illisible (non écrasé, à vérifier dans le cloud)'); }
        if (!isObj(o) || !isObj(o.eleves)) throw new Error(CLOUD.file + ' invalide (non écrasé, à vérifier dans le cloud)');
        for (const [id, e] of Object.entries(o.eleves)) if (/^\d{1,20}$/.test(id)) remote[id] = cleanEleve(e);
      }
      const merged = { ...remote };
      let changed = false;
      for (const id of ids) {
        const L = cleanEleve({ etat: store.get(hwKeyFor(id, 'etat'), {}), perso: store.get(hwKeyFor(id, 'perso'), []), del: store.get(hwKeyFor(id, 'del'), {}) });
        const M = mergeEleve(L, remote[id] || cleanEleve({}));
        merged[id] = M;
        // mise à jour locale uniquement si le résultat diffère (évite des écritures et rendus inutiles)
        for (const k of ['etat', 'perso', 'del']) {
          if (canon(M[k]) !== canon(L[k])) { store.set(hwKeyFor(id, k), M[k]); changed = true; }
        }
      }
      if (!file || canon(merged) !== canon(remote)) {
        await cloud.write(a, dir, file, JSON.stringify({ app: CLOUD.dir, v: 1, maj: new Date().toISOString(), eleves: merged }));
      }
      cloud.fails = 0; cloud.last = Date.now(); cloud.set('ok');
      if (changed && S.tab === 'devoirs' && !$('#modal').classList.contains('show')) hwRender().catch(() => {});
    } catch (e) {
      cloud.set('err', e.message || 'erreur inconnue');
      if (++cloud.fails <= 3 && S.token) cloud.push(60e3 * cloud.fails);
    }
  },
};
document.addEventListener('visibilitychange', () => { if (document.hidden) cloud.flush(); else cloud.push(0, true); });
addEventListener('online', () => cloud.push(0));
// Rapproche cours annulés et remplacements (événements distincts dans l'EDT) : c.st = annule | deplace | remplace, c.from/c.to = cours lié, c.hide = annulé déjà représenté par son remplacement
const EDT_ST = { annule: 'ANNULÉ', deplace: 'DÉPLACÉ', remplace: 'REMPLACÉ' };
function edtPrep(list) {
  const day = (c) => c.start_date.slice(0, 10), ts = (c) => Date.parse(c.start_date.replace(' ', 'T'));
  const overlap = (a, b) => a.start_date < b.end_date && a.end_date > b.start_date;
  list.forEach((c) => { delete c.st; delete c.from; delete c.to; delete c.hide; });
  const live = list.filter((c) => !c.isAnnule);
  list.filter((c) => c.isAnnule).forEach((c) => {
    const rep = live.filter((d) => day(d) === day(c) && overlap(c, d));
    if (rep.length) {
      c.hide = true;
      rep.forEach((d) => { d.from = d.from || c; d.st = sameSubject(d, c) && (d.prof || '') === (c.prof || '') && (d.start_date !== c.start_date || d.end_date !== c.end_date) ? 'deplace' : 'remplace'; });
      return;
    }
    const mv = live.filter((d) => d.isModifie && !d.from && sameSubject(d, c)).sort((a, b) => Math.abs(ts(a) - ts(c)) - Math.abs(ts(b) - ts(c)))[0];
    if (mv) { mv.from = c; mv.st = 'deplace'; c.to = mv; c.st = 'deplace'; } else c.st = 'annule';
  });
  return list;
}
const edtTag = (c) => (c.st ? EDT_ST[c.st] : c.isAnnule ? EDT_ST.annule : '');
function edtNote(c) {
  const o = c.from || c.to; if (!o) return '';
  const hm = `${o.start_date.slice(11, 16)} - ${o.end_date.slice(11, 16)}`, d = o.start_date.slice(0, 10) === c.start_date.slice(0, 10) ? '' : longDate(o.start_date.slice(0, 10)) + ' ';
  return c.from ? `au lieu de : ${o.text || o.matiere || ''}${o.prof ? ' · ' + o.prof : ''} (${d}${hm})` : `déplacé : ${longDate(o.start_date.slice(0, 10))} ${hm}`;
}
// Pastille sur un cours : rouge « ! » = contrôle, jaune = devoir à faire pour ce cours
function badge(c) {
  const l = ((S.hw && S.hw.list) || {})[c.start_date.slice(0, 10)], e = (Array.isArray(l) ? l : []).filter((m) => sameSubject(m, c));
  if (!e.length) return '';
  const ctl = e.some((m) => m.interrogation), hw = e.some((m) => m.aFaire !== false && !m.interrogation) || (ctl && e.some((m) => m.aFaire === true));
  return `<span class="dots">${ctl ? '<span class="dot ctl" title="Contrôle" aria-label="Contrôle">!</span>' : ''}${hw ? '<span class="dot hw" title="Devoir à faire" aria-label="Devoir à faire"></span>' : ''}</span>`;
}
// Détail d'un cours (clic sur un cours de l'emploi du temps)
const modal = { open(on) { $('#modal').classList.toggle('show', on); if (on) { modal.from = document.activeElement; $('.mclose').focus(); } else if (modal.from) { modal.from.focus(); modal.from = null; } } };
async function openCourse(i) {
  const c = (S.edtItems || [])[i]; if (!c) return;
  const date = c.start_date.slice(0, 10), my = (S.mseq = (S.mseq || 0) + 1);
  const head = `<p class="mute">${esc(longDate(date))} · ${esc(c.start_date.slice(11, 16))} - ${esc(c.end_date.slice(11, 16))}${edtTag(c) ? ` · <b class="${c.isAnnule ? 'dn' : ''}">${edtTag(c).toLowerCase()}</b>` : ''}<br>${esc(c.prof || '')}${room(c.salle) ? ' · ' + esc(room(c.salle)) : ''}${edtNote(c) ? '<br>' + esc(edtNote(c)) : ''}</p>`;
  $('#mtitle').textContent = c.text || c.matiere || 'Cours';
  $('#mbody').innerHTML = head + '<p class="mute">Chargement…</p>';
  modal.open(true);
  let items = [];
  try { items = (await hwDay(date)).filter((m) => hasWork(m) && sameSubject(m, c)).map(todo); } catch {}
  if (my === S.mseq) $('#mbody').innerHTML = head + (items.length ? items.map(workHtml).join('') : `<p><b>${NOTHING}</b></p>`);
}
$('.mclose').onclick = () => modal.open(false);
$('#modal').onclick = (e) => { if (e.target === $('#modal')) modal.open(false); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#modal').classList.contains('show')) modal.open(false); });
document.addEventListener('click', (e) => { const b = e.target.closest('.blk,.hc'); if (b) openCourse(+b.dataset.i); });
document.addEventListener('keydown', (e) => { const b = e.target.closest && e.target.closest('.blk,.hc'); if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCourse(+b.dataset.i); } });

// ---------- Accueil ----------
async function ensureNotes() {
  if (S.notes) return;
  const r = await api(`/v3/eleves/${S.eleve.id}/notes.awp?verbe=get`, { anneeScolaire: '' });
  if (r.code !== 200) throw new Error(r.message || 'Impossible de charger les notes');
  S.notes = r.data; S.periode = undefined;
}
async function loadHome() {
  await ensureNotes();
  const periodes = (S.notes.periodes || []).filter((p) => !p.annuel);
  if (S.periode === undefined) S.periode = (periodes.find((p) => !p.cloture) || {}).codePeriode || '';
  ST = structure();
  const notes = (S.notes.notes || []).filter((n) => !S.periode || n.codePeriode === S.periode);
  const day = nextSchoolDay(new Date()), dkey = iso(day), isToday = dkey === iso(new Date());
  const [hw, edt] = await Promise.all([hwList(), api(`/v3/E/${S.eleve.id}/emploidutemps.awp?verbe=get`, { dateDebut: dkey, dateFin: dkey, avecTrous: false }).catch(() => null)]);
  S.edtItems = edt && edt.code === 200 ? edtPrep(edt.data.sort((a, b) => a.start_date.localeCompare(b.start_date))) : [];
  const gser = [...new Set(notes.map((n) => n.date))].sort().map((d) => general(notes.filter((n) => n.date <= d))).filter((v) => v != null);
  const g = gser.length ? gser[gser.length - 1] : null, cls = toNum(ST.gst && ST.gst[0]);
  const delta = (v) => `<span class="${v >= 0 ? 'up' : 'dn'}">${v >= 0 ? '▲ +' : '▼ −'}${fmt(Math.abs(v))}</span>`;
  const entries = Object.keys(hw.list).sort().flatMap((d) => (Array.isArray(hw.list[d]) ? hw.list[d] : []).map((m) => ({ ...m, d })));
  const nextCtl = entries.find((m) => m.interrogation), nbHw = entries.filter((m) => m.aFaire !== false && !m.interrogation).length;
  const k = (t, v, s) => `<div class="kpi"><small>${t}</small><b>${v}</b><small>${s || ''}</small></div>`;
  const courses = S.edtItems.map((c, i) => {
    if (c.hide) return '';
    const col = c.isAnnule ? 'var(--mute)' : c.color && inkOn(c.color) === '#fff' ? c.color : 'var(--accent)';
    return `<div class="hc ${c.isAnnule ? 'off' : ''} ${c.st ? 'st-' + c.st : ''}" role="button" tabindex="0" data-i="${i}" style="border-left-color:${esc(col)}"><span class="num">${esc(c.start_date.slice(11, 16))} - ${esc(c.end_date.slice(11, 16))}</span><span><b>${esc(c.text)}</b>${edtTag(c) ? `<span class="tag${c.isAnnule ? ' tag-c' : ''}">${edtTag(c)}</span>` : ''}<br><span class="mute">${esc(c.prof || '')}${room(c.salle) ? ' · ' + esc(room(c.salle)) : ''}${edtNote(c) ? '<br>' + esc(edtNote(c)) : ''}</span></span>${badge(c)}</div>`;
  }).join('') || '<p class="mute">Aucun cours.</p>';
  const days = Object.keys(hw.list).sort().slice(0, 4);
  const det = await Promise.all(days.map(async (d) => [d, (await hwDay(d)).filter(hasWork).map(todo)]));
  const work = det.flatMap(([d, l]) => l.map((t) => ({ ...t, d }))).slice(0, 5).map((t) => `<div class="hrow"><span><b>${esc(t.matiere)}</b>${t.interro ? '<span class="tag tag-c">contrôle</span>' : ''}<br><span class="mute">pour ${esc(longDate(t.d))}${t.text ? ' · ' + esc(t.text.length > 70 ? t.text.slice(0, 70) + '…' : t.text) : ''}</span></span></div>`).join('') || `<p>${NOTHING}</p>`;
  const last = notes.filter((n) => toNum(n.valeur) != null).sort((a, b) => String(b.dateSaisie || b.date).localeCompare(String(a.dateSaisie || a.date))).slice(0, 5)
    .map((n) => `<div class="hrow"><span><b>${esc(n.libelleMatiere)}</b><br><span class="mute">${esc(n.devoir || '')} · ${esc(longDate(n.date))}</span></span><span class="num" style="color:${color((toNum(n.valeur) / (toNum(n.noteSur) || 20)) * 20)}">${esc(n.valeur)}/${esc(n.noteSur)}</span></div>`).join('') || '<p class="mute">Aucune note pour l\'instant.</p>';
  $('#view').innerHTML = `<div class="hello"><h2>Bonjour ${esc(S.eleve.prenom)}</h2><div class="mute">${esc(longDate(iso(new Date())))}</div></div>
    <div class="kpis">${k('Moyenne générale', `<span style="color:${color(g)}">${fmt(g)}</span>`, gser.length > 1 ? delta(g - gser[gser.length - 2]) + ' dernière note' : '')}
      ${k('Classe', fmt(cls), g != null && cls != null ? delta(g - cls) + ' vs classe' : '')}
      ${k('Devoirs à faire', nbHw, nbHw ? 'à venir' : nextCtl ? 'Aucun devoir' : NOTHING)}
      ${k('Prochain contrôle', nextCtl ? esc(nextCtl.matiere) : '–', nextCtl ? esc(longDate(nextCtl.d)) : 'Aucun contrôle')}</div>
    <div class="hgrid">
      <div class="panel"><h3>${isToday ? "Aujourd'hui" : 'Prochain jour de cours : ' + esc(longDate(dkey))}</h3>${courses}<button class="link" data-go="edt">Emploi du temps →</button></div>
      <div class="panel"><h3>À faire</h3>${work}<button class="link" data-go="devoirs">Cahier de texte →</button></div>
      <div class="panel"><h3>Dernières notes</h3>${last}<button class="link" data-go="notes">Toutes les notes →</button></div>
      <div class="panel"><h3>Évolution de la moyenne</h3>${chart(gser, [], { label: 'Moyenne générale' })}<button class="link" data-go="dash">Analyse et prévisions →</button></div>
    </div>`;
  wxMount('home');
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) openTab(b.dataset.go); });

// ---------- Emploi du temps ----------
// Couleur de texte lisible selon le fond du cours (EcoleDirecte renvoie parfois du blanc ou des teintes très claires)
function inkOn(bg) {
  const s = String(bg).trim();
  let r, g, b, m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) { let h = m[1]; if (h.length === 3) h = [...h].map((c) => c + c).join(''); [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  else if ((m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s))) [r, g, b] = [+m[1], +m[2], +m[3]];
  else return '#fff';
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}
// Samedi et dimanche : on affiche le lundi suivant
function nextSchoolDay(d) {
  const x = new Date(d); x.setHours(12, 0, 0, 0);
  if (x.getDay() === 6) x.setDate(x.getDate() + 2); else if (x.getDay() === 0) x.setDate(x.getDate() + 1);
  return x;
}
const weekNo = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
async function loadEdt() {
  const day = S.edtView === 'day', base = nextSchoolDay(new Date());
  const f = new Date(base); f.setDate(f.getDate() + S.dayOff); const focus = iso(f);
  const mon = new Date(day ? f : base); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + (day ? 0 : S.week * 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const r = await api(`/v3/E/${S.eleve.id}/emploidutemps.awp?verbe=get`, { dateDebut: iso(mon), dateFin: iso(sun), avecTrous: false });
  if (r.code !== 200) throw new Error(r.message || "Impossible de charger l'emploi du temps");
  await hwList(); S.edtItems = edtPrep(r.data);
  const min = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16);
  const H0 = 7, H1 = 20;
  const PX = day ? 80 : 56, today = iso(new Date());
  const hours = Array.from({ length: H1 - H0 }, (_, k) => `<div class="hr" style="height:${PX}px">${String(H0 + k).padStart(2, '0')}:00</div>`).join('');
  const cols = [...Array(7)].map((_, k) => {
    const d = new Date(mon); d.setDate(mon.getDate() + k); const key = iso(d);
    if (day && key !== focus) return '';
    const blocks = r.data.filter((c) => !c.hide && c.start_date.slice(0, 10) === key).map((c) => {
      const top = ((min(c.start_date) - H0 * 60) / 60) * PX, h = ((min(c.end_date) - min(c.start_date)) / 60) * PX;
      const bg = c.isAnnule ? '#333' : c.color || `hsl(${hue(c.matiere || c.text)} 70% 38%)`;
      return `<div class="blk ${c.st ? 'st-' + c.st : ''}" role="button" tabindex="0" data-i="${r.data.indexOf(c)}" style="top:${top}px;height:${h}px;background:${esc(bg)};color:${inkOn(bg)}">${badge(c)}<b>${esc(c.start_date.slice(11, 16))} - ${esc(c.end_date.slice(11, 16))}${edtTag(c) ? ' · ' + edtTag(c) : ''}</b>${esc(c.text)}<br>${esc(c.prof)}${room(c.salle) ? '<br>' + esc(room(c.salle)) : ''}${edtNote(c) ? '<br><i>' + esc(edtNote(c)) + '</i>' : ''}</div>`;
    }).join('');
    return `<div class="dcol ${key === today ? 'today' : ''}"><div class="dh">${esc(d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }))}</div><div class="dbody" style="height:${(H1 - H0) * PX}px;--px:${PX}px">${blocks}</div></div>`;
  }).join('');
  const fr = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  $('#view').innerHTML = `<div class="card"><div class="nav2"><b>${day ? esc(longDate(focus)) : `${esc(fr(mon))} – ${esc(fr(sun))} (Semaine ${weekNo(mon)})`}</b><span><button id="tod">Aujourd'hui</button><button id="prev" aria-label="Semaine précédente">‹</button><button id="next" aria-label="Semaine suivante">›</button></span></div><div class="cal"><div class="axis"><div class="dh"></div>${hours}</div>${cols}</div><div class="mute legend"><span><span class="dot ctl">!</span> contrôle</span><span><span class="dot hw"></span> devoir à faire</span><span>Touche un cours pour le détail</span></div></div>`;
  $('#tod').onclick = () => { S.week = 0; S.dayOff = 0; openTab('edt'); };
  $('#prev').onclick = () => { day ? S.dayOff-- : S.week--; openTab('edt'); };
  $('#next').onclick = () => { day ? S.dayOff++ : S.week++; openTab('edt'); };
  $('#view').insertAdjacentHTML('afterbegin', `<div class="subtabs"><button data-v="day" aria-selected="${day}">JOUR</button><button data-v="week" aria-selected="${!day}">SEMAINE</button></div>`);
  document.querySelectorAll('.subtabs button').forEach((b) => (b.onclick = () => { S.edtView = b.dataset.v; openTab('edt'); }));
  S.wxR = day ? { a: focus, b: focus, day: true } : { a: iso(mon), b: iso(sun), day: false };
  wxMount('edt');
}

document.querySelectorAll('.side button').forEach((b) => (b.title = b.textContent.trim()));
addEventListener('scroll', () => $('.top').classList.toggle('scrolled', scrollY > 4), { passive: true });

// ---------- Mode Sportif ----------
const WX_PLACE = { name: 'Marseille', lat: 43.2965, lon: 5.3698 };
const WX_MODELS = { meteofrance_arome_france_hd: ['AROME France HD (Météo-France)', '≈ 1,5 km'], meteofrance_arome_france: ['AROME France (Météo-France)', '≈ 2,5 km'], icon_eu: ['ICON-EU (DWD)', '≈ 7 km'], ecmwf_ifs: ['ECMWF IFS', '≈ 9 km'], gfs_seamless: ['GFS (NOAA)', '≈ 13 km'] };
const WX_COMP = 'ecmwf_ifs025';
const WX_CUR = ['temperature_2m', 'apparent_temperature', 'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'precipitation', 'cloud_cover'];
const WX_HR = ['wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'precipitation', 'cloud_cover', 'precipitation_probability'];
const WX_DAY = ['weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max', 'wind_gusts_10m_max', 'wind_direction_10m_dominant', 'cloud_cover_mean', 'precipitation_probability_max'];
const WX_CODE = { 0: 'Ciel dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert', 45: 'Brouillard', 48: 'Brouillard givrant', 51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine dense', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante', 61: 'Pluie faible', 63: 'Pluie', 65: 'Pluie forte', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante', 71: 'Neige faible', 73: 'Neige', 75: 'Neige forte', 77: 'Grains de neige', 80: 'Averses faibles', 81: 'Averses', 82: 'Averses violentes', 85: 'Averses de neige', 86: 'Averses de neige', 95: 'Orage', 96: 'Orage et grêle', 99: 'Orage et grêle' };
const WX_DIR = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const wxDir = (d) => (d == null ? '–' : WX_DIR[Math.round(d / 22.5) % 16]);
const wxArrow = (d) => (d == null ? '' : `<svg class="ar" viewBox="-8 -8 16 16" style="transform:rotate(${d + 180}deg)" aria-hidden="true"><path d="M0-6L4 5 0 3-4 5z" fill="currentColor"/></svg>`);
const wxCache = {};
let wxSeq = 0, wxFound = [];
const savedPlace = store.get('ed-place');
S.sport = !!store.get('ed-sport', false);
S.place = savedPlace && savedPlace.name && Number.isFinite(savedPlace.lat) && Number.isFinite(savedPlace.lon) ? savedPlace : WX_PLACE;
S.wxModel = WX_MODELS[store.get('ed-wx-model2')] ? store.get('ed-wx-model2') : 'meteofrance_arome_france_hd';

const wxRange = () => { const t = iso(new Date()); return S.tab === 'edt' && S.wxR ? S.wxR : { a: t, b: t, day: true }; };
async function wxFetch(p, model, r0) {
  const lim = new Date(); lim.setDate(lim.getDate() + 15);
  if (r0.a > iso(lim)) throw new Error('Prévisions disponibles sur 16 jours seulement.');
  const r = { ...r0, b: r0.b > iso(lim) ? iso(lim) : r0.b };
  const key = `${p.lat},${p.lon},${model},${r.a},${r.b}`, hit = wxCache[key];
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit;
  // Un seul appel : le modèle choisi + ECMWF en complément (probabilité de pluie, et jours au-delà de l'horizon d'AROME).
  // Le courant et l'horaire ne servent que pour la vue « jour » ; la vue semaine n'utilise que le quotidien.
  const ms = model === WX_COMP ? [model] : [model, WX_COMP], isToday = r.day && r.a === iso(new Date());
  const q = new URLSearchParams({
    latitude: p.lat, longitude: p.lon, models: ms.join(','), wind_speed_unit: 'kn', timezone: 'auto', start_date: r.a, end_date: r.b,
    daily: WX_DAY.join(','),
  });
  if (isToday) q.set('current', WX_CUR.join(','));
  if (r.day) q.set('hourly', WX_HR.join(','));
  const res = await fetch('https://api.open-meteo.com/v1/forecast?' + q);
  if (!res.ok) throw new Error('Météo indisponible (' + res.status + ')');
  const j = wxMerge(await res.json(), ms, r.day, isToday);
  if (!(j.daily.time || []).length || j.daily.wind_speed_10m_max[0] == null || (r.day && (!j.hourly.wind_speed_10m || !j.hourly.wind_gusts_10m)) || (isToday && (!j.current || j.current.temperature_2m == null || j.current.wind_speed_10m == null))) throw new Error('Données vides pour ' + model);
  return (wxCache[key] = { j, model, at: Date.now(), r });
}
// Avec plusieurs modèles, Open-Meteo suffixe chaque variable (« wind_speed_10m_<modèle> ») : on prend, valeur par valeur, la première non nulle dans l'ordre des modèles.
function wxMerge(raw, ms, day, isToday) {
  const key = (b, v, m) => (ms.length > 1 ? b[`${v}_${m}`] : b[v]);
  const cols = (b, v) => ms.map((m) => key(b, v, m)).filter(Array.isArray);
  const arr = (b, v) => { const c = cols(b, v); return c.length ? b.time.map((_, i) => { for (const a of c) if (a[i] != null) return a[i]; return null; }) : null; };
  const out = { daily: { time: (raw.daily || {}).time || [] }, hourly: null, current: null, fill: false };
  if (raw.daily) { WX_DAY.forEach((v) => { out.daily[v] = arr(raw.daily, v) || out.daily.time.map(() => null); }); const own = key(raw.daily, 'wind_speed_10m_max', ms[0]); out.fill = ms.length > 1 && Array.isArray(own) && own.some((x) => x == null); }
  if (day && raw.hourly) { out.hourly = { time: raw.hourly.time }; WX_HR.forEach((v) => { out.hourly[v] = arr(raw.hourly, v) || raw.hourly.time.map(() => null); }); }
  if (isToday && raw.current) { out.current = { time: raw.current.time }; WX_CUR.forEach((v) => { out.current[v] = ms.map((m) => key(raw.current, v, m)).find((x) => x != null) ?? null; }); }
  return out;
}
async function wxGet(p, r) {
  let err;
  for (const m of [S.wxModel, ...Object.keys(WX_MODELS).filter((k) => k !== S.wxModel)]) {
    try { return await wxFetch(p, m, r); } catch (e) { err = e; }
  }
  throw err;
}
const wxLink = (p) => `https://www.windguru.cz/map/?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&zoom=10`;
const wxHead = (p) => `<h3><span>Météo · ${esc(p.name)}</span><button type="button" class="link" data-wx="place">Changer</button></h3>`;

function wxChart(h, now) {
  const W = 300, H = 150, P = { l: 26, r: 6, t: 8, b: 30 }, sp = h.wind_speed_10m, gu = h.wind_gusts_10m, dr = h.wind_direction_10m, n = sp.length;
  const top = Math.max(10, Math.ceil(Math.max(...sp.filter((v) => v != null), ...gu.filter((v) => v != null)) / 5) * 5);
  const X = (i) => P.l + (i / (n - 1)) * (W - P.l - P.r), Y = (v) => P.t + (1 - v / top) * (H - P.t - P.b);
  const line = (a) => a.map((v, i) => (v == null ? '' : `${i === 0 || a[i - 1] == null ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).join('');
  const mute = 'style="fill:var(--mute)" font-size="10"';
  const grid = [0, top / 2, top].map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" style="stroke:var(--line)"/><text x="${P.l - 4}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" ${mute}>${Math.round(v)}</text>`).join('');
  const ticks = Array.from({ length: Math.floor((n - 1) / 3) + 1 }, (_, k) => k * 3).map((i) => `<text x="${X(i).toFixed(1)}" y="${H - 16}" text-anchor="middle" ${mute}>${String(i).padStart(2, '0')}h</text>${dr[i] == null ? '' : `<g transform="translate(${X(i).toFixed(1)} ${H - 6}) rotate(${dr[i] + 180}) scale(.7)" style="fill:var(--mute)"><path d="M0-6L4 5 0 3-4 5z"/></g>`}`).join('');
  const nowX = now >= 0 && now < n ? `<line x1="${X(now).toFixed(1)}" x2="${X(now).toFixed(1)}" y1="${P.t}" y2="${H - P.b}" stroke-dasharray="3 3" style="stroke:var(--mute)"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution du vent sur la journée, en nœuds">${grid}${nowX}<path d="${line(sp)}L${X(n - 1).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z" style="fill:var(--accent);fill-opacity:.14;stroke:none"/><path d="${line(sp)}" fill="none" stroke-width="2" style="stroke:var(--accent)"/><path d="${line(gu)}" fill="none" stroke-width="1.5" stroke-dasharray="4 3" style="stroke:var(--blue)"/>${ticks}</svg>`;
}

function wxHtml(d) {
  const p = S.place, j = d.j, c = j.current, h = j.hourly, dl = j.daily, u = (v) => (v == null ? '–' : Math.round(v)), kmh = (v) => (v == null ? '' : Math.round(v * 1.852) + ' km/h');
  const [name, res] = WX_MODELS[d.model], at = new Date(d.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const hasProb = (h ? h.precipitation_probability : dl.precipitation_probability_max).some((v) => v != null);
  const foot = (info) => `<select id="wxm" aria-label="Modèle de prévision">${Object.entries(WX_MODELS).map(([k, [n, r]]) => `<option value="${k}"${k === S.wxModel ? ' selected' : ''}>${n} ${r}</option>`).join('')}</select>
    <p class="mute wxf">Modèle : ${name} ${res}${d.model !== S.wxModel ? ' (modèle de secours)' : ''}${j.fill ? ' · complété par ECMWF IFS au-delà de l\'horizon du modèle (≈ 48 h)' : ''}${hasProb ? ' · probabilités de pluie : ensemble ECMWF' : ''} · ${info} · chargé à ${esc(at)}<br><a class="link" href="${wxLink(p)}" target="_blank" rel="noopener">Voir sur Windguru ↗</a> · données <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a></p>`;
  if (!d.r.day) {
    const rows = dl.time.map((t, i) => `<div class="hrow"><span><b style="text-transform:capitalize">${esc(new Date(t + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }))}</b><br><span class="mute">${esc(WX_CODE[dl.weather_code[i]] || '–')}</span></span><span style="text-align:right"><b class="num">${u(dl.temperature_2m_min[i])}° / ${u(dl.temperature_2m_max[i])}°</b><br><span class="mute">${fmt(dl.precipitation_sum[i], 1)} mm${dl.precipitation_probability_max[i] != null ? ` (${u(dl.precipitation_probability_max[i])} %)` : ''} · ${u(dl.wind_speed_10m_max[i])} kn (raf. ${u(dl.wind_gusts_10m_max[i])}) ${wxArrow(dl.wind_direction_10m_dominant[i])} ${wxDir(dl.wind_direction_10m_dominant[i])}${dl.cloud_cover_mean[i] != null ? ` · ☁ ${u(dl.cloud_cover_mean[i])} %` : ''}</span></span></div>`).join('');
    return `${wxHead(p)}${rows}<p class="mute wxh">Min / max · cumul de pluie (probabilité max) · vent max en nœuds · ☁ couverture nuageuse moyenne</p>${foot('semaine du ' + esc(longDate(d.r.a)))}`;
  }
  const today = d.r.a === iso(new Date());
  const rain = h.precipitation.reduce((a, v) => a + (v || 0), 0), now = today ? +c.time.slice(11, 13) : -1;
  const pk = h.wind_speed_10m.reduce((m, v, i, a) => (v > a[m] ? i : m), 0), gmax = Math.max(...h.wind_gusts_10m.filter((v) => v != null));
  const pmax = Math.max(...h.precipitation.filter((v) => v != null), 0), ph = h.precipitation.indexOf(pmax);
  const inten = pmax < 0.1 ? 'Aucune' : pmax < 2.5 ? 'Faible' : pmax < 7.6 ? 'Modérée' : 'Forte';
  const probs = h.precipitation_probability.filter((v) => v != null), prob = probs.length ? Math.max(...probs) : null;
  const cl = (v) => (v < 20 ? 'dégagé' : v < 50 ? 'peu nuageux' : v < 80 ? 'nuageux' : 'couvert');
  const cc = today ? c.cloud_cover : dl.cloud_cover_mean[0];
  const k = today
    ? { t: c.temperature_2m, code: c.weather_code, sub: 'ressenti ' + u(c.apparent_temperature) + '°', w: c.wind_speed_10m, g: c.wind_gusts_10m, dir: c.wind_direction_10m, prs: 'en ce moment : ' + fmt(c.precipitation, 1) + ' mm', wl: 'Vent', gl: 'Rafales' }
    : { t: dl.temperature_2m_max[0], code: dl.weather_code[0], sub: 'min ' + u(dl.temperature_2m_min[0]) + '°', w: dl.wind_speed_10m_max[0], g: dl.wind_gusts_10m_max[0], dir: dl.wind_direction_10m_dominant[0], prs: 'sur la journée', wl: 'Vent max', gl: 'Rafales max' };
  const cell = (t, v, s) => `<div><small>${t}</small><b class="num">${v}</b><small>${s || ''}</small></div>`;
  const rainCells = cell('Pluie du jour', fmt(rain, 1) + ' mm', k.prs)
    + (prob != null ? cell('Probabilité de pluie', u(prob) + ' %', 'maximum de la journée') : '')
    + cell('Intensité', inten, pmax >= 0.1 ? `pic ${fmt(pmax, 1)} mm/h vers ${ph} h` : '')
    + (cc != null ? cell('Nuages', u(cc) + ' %', cl(cc) + (today ? '' : ' (moyenne)')) : '');
  return `${wxHead(p)}
    <div class="wxmain"><b class="num wxt">${u(k.t)}°</b><div><div>${esc(WX_CODE[k.code] || '–')}</div><span class="mute">${k.sub}</span></div></div>
    <div class="wxs">${cell(k.wl, u(k.w) + ' kn', kmh(k.w))}${cell(k.gl, u(k.g) + ' kn', kmh(k.g))}${cell('Direction', `${wxArrow(k.dir)} ${wxDir(k.dir)}`, k.dir == null ? '' : Math.round(k.dir) + '°')}${rainCells}</div>
    <div class="mute wxh">Vent sur la journée (nœuds)</div>${wxChart(h, now)}
    <div class="mute legend"><span><i class="lg" style="background:var(--accent)"></i>Vent</span><span><i class="lg" style="background:var(--blue)"></i>Rafales</span><span>Flèches : sens du vent</span></div>
    <p class="mute">Pic : ${u(h.wind_speed_10m[pk])} kn vers ${pk} h, rafales jusqu'à ${u(gmax)} kn.</p>
    ${foot(today ? 'valeurs de ' + esc(c.time.slice(11, 16)) : 'prévisions du ' + esc(longDate(d.r.a)))}`;
}

async function wxLoad() {
  const my = ++wxSeq, put = (html) => { if (my === wxSeq && $('#wx')) $('#wx').innerHTML = html; };
  put(`${wxHead(S.place)}<p class="mute">Chargement…</p>`);
  try { put(wxHtml(await wxGet(S.place, wxRange()))); }
  catch (e) { put(`${wxHead(S.place)}<p class="mute">${esc(e.message || 'Météo indisponible')}</p><a class="link" href="${wxLink(S.place)}" target="_blank" rel="noopener">Voir sur Windguru ↗</a>`); }
}
function wxMount(where) {
  if (!S.sport || S.tab !== where) return;
  if (where === 'edt') {
    const card = $('#view>.card'); if (!card) return;
    const w = document.createElement('div'); w.className = 'sgrid'; card.replaceWith(w); w.append(card);
    w.insertAdjacentHTML('beforeend', '<aside id="wx" class="panel wx"></aside>');
  } else {
    const first = $('.hgrid .panel'); if (!first) return;
    first.insertAdjacentHTML('afterend', '<div id="wx" class="panel wx"></div>');
  }
  wxLoad();
}
function wxSetPlace(p) { S.place = p; store.set('ed-place', p); modal.open(false); wxLoad(); }
function wxPlaceModal() {
  $('#mtitle').textContent = 'Localisation météo';
  $('#mbody').innerHTML = '<label for="wxq">Ville</label><input id="wxq" maxlength="80" autocomplete="off" placeholder="Ex. : La Ciotat, Nice, Paris…"><button type="button" id="wxs">Rechercher</button> <button type="button" id="wxd" class="link">Revenir à Marseille</button><div id="wxr"></div><div id="wxe" class="err" role="alert"></div>';
  modal.open(true);
  const go = async () => {
    const q = $('#wxq').value.trim(); if (q.length < 2) return;
    $('#wxe').textContent = ''; $('#wxr').innerHTML = '<p class="mute">Recherche…</p>';
    try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: 6, language: 'fr', format: 'json' }));
      if (!r.ok) throw new Error('Recherche indisponible');
      wxFound = (await r.json()).results || [];
      $('#wxr').innerHTML = wxFound.length ? wxFound.map((x, i) => `<button type="button" class="wxres" data-k="${i}">${esc(x.name)}<small>${esc([x.admin1, x.country].filter(Boolean).join(', '))}</small></button>`).join('') : '<p class="mute">Aucun résultat.</p>';
    } catch (e) { $('#wxr').innerHTML = ''; $('#wxe').textContent = e.message || 'Recherche indisponible'; }
  };
  $('#wxs').onclick = go;
  $('#wxq').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  $('#wxr').onclick = (e) => { const b = e.target.closest('[data-k]'), x = b && wxFound[+b.dataset.k]; if (x) wxSetPlace({ name: x.name, lat: x.latitude, lon: x.longitude }); };
  $('#wxd').onclick = () => wxSetPlace(WX_PLACE);
  $('#wxq').focus();
}
function syncSport() { $('#sport').setAttribute('aria-pressed', S.sport); $('#sport').title = S.sport ? 'Mode Sportif activé' : 'Mode Sportif'; }
$('#sport').onclick = () => { S.sport = !S.sport; store.set('ed-sport', S.sport); syncSport(); if (['edt', 'home'].includes(S.tab)) openTab(S.tab); };
document.addEventListener('click', (e) => { if (e.target.closest('[data-wx=place]')) wxPlaceModal(); });
document.addEventListener('change', (e) => { if (e.target.id === 'wxm') { S.wxModel = e.target.value; store.set('ed-wx-model2', S.wxModel); wxLoad(); } });
syncSport();

restore();