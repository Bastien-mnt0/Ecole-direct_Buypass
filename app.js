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
  if (view !== 'app') $('#eleve').classList.add('hidden');
}

// ---------- Session conservée (jamais le mot de passe) ----------
// Par défaut : sessionStorage (effacé à la fermeture de l'onglet). Avec « Rester connecté » : localStorage.
const SESS = 'ed-session';
const sess = {
  save() {
    if (!S.token || !S.eleve) return;
    const v = JSON.stringify({ t: S.token, c: S.cookies, e: S.eleves, i: S.eleves.indexOf(S.eleve), s: S.school, a: S.tab, at: Date.now() });
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
  Object.assign(S, { token: v.t, cookies: v.c || {}, eleves: v.e, keep: v.keep, school: v.s || '', tab: ['dash', 'notes', 'edt'].includes(v.a) ? v.a : 'dash' });
  S.eleve = S.eleves[v.i] || S.eleves[0];
  $('#eleve').innerHTML = S.eleves.map((e, i) => `<option value="${i}">${esc(e.prenom)} ${esc(e.nom || '')}</option>`).join('');
  $('#eleve').value = String(S.eleves.indexOf(S.eleve));
  $('#eleve').classList.toggle('hidden', S.eleves.length < 2);
  setWho(); show('app'); openTab(S.tab);
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
  S.eleve = S.eleves[0]; S.notes = null; S.hist = undefined; S.school = acc.nomEtablissement || ''; setWho();
  S.keep = $('#keep').checked; store.set('ed-keep', S.keep); sess.save();
  show('app'); openTab('dash');
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
$('#logout').onclick = () => { sess.clear(); location.reload(); };
$('#eleve').onchange = (e) => { S.eleve = S.eleves[+e.target.value]; S.notes = null; S.hist = undefined; setWho(); sess.save(); openTab(S.tab); };

// ---------- Onglets ----------
function openTab(name) {
  S.tab = name; setNav(false);
  $('#ptitle').textContent = { dash: 'Analyse', notes: 'Notes et Moyennes', edt: 'Emploi du temps' }[name];
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name));
  $('#appErr').textContent = '';
  $('#view').innerHTML = '<p class="mute">Chargement…</p>';
  ({ dash: loadDash, notes: loadNotes, edt: loadEdt })[name]().catch((e) => { $('#view').innerHTML = ''; $('#appErr').textContent = e.message; });
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
    <div class="panel ctrl"><b>Prévision</b> ${sel('dN', [[1, '1 note'], [3, '3 notes'], [5, '5 notes'], [10, '10 notes']], S.dN)} de plus par matière, valant ${sel('dScen', [...(M.years ? [['hist', 'Modèle historique']] : []), ['trend', 'Moyenne de tes 3 dernières notes'], ['stable', 'Moyenne actuelle'], ['high', 'Ta moyenne + 2 points'], ['low', 'Ta moyenne − 2 points']], S.dScen)}</div>
    <h3 style="margin-top:18px">Évolution par matière</h3><div class="sgrid">${cards}</div>
    <p class="mute">Estimation indicative : elle suppose que tes prochaines notes (coef 1) auront la valeur du scénario choisi ; elle ne prédit pas tes vrais résultats.</p>`;
  document.querySelectorAll('.ptab').forEach((b) => (b.onclick = () => { S.periode = b.dataset.p; renderDash(); }));
  $('#dN').onchange = (e) => { S.dN = +e.target.value; renderDash(); };
  $('#dScen').onchange = (e) => { S.dScen = e.target.value; renderDash(); };
}

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
const weekNo = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
async function loadEdt() {
  const day = S.edtView === 'day', base = new Date(); base.setHours(12, 0, 0, 0);
  const f = new Date(base); f.setDate(f.getDate() + S.dayOff); const focus = iso(f);
  const mon = new Date(day ? f : base); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7) + (day ? 0 : S.week * 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const r = await api(`/v3/E/${S.eleve.id}/emploidutemps.awp?verbe=get`, { dateDebut: iso(mon), dateFin: iso(sun), avecTrous: false });
  if (r.code !== 200) throw new Error(r.message || "Impossible de charger l'emploi du temps");
  const min = (t) => +t.slice(11, 13) * 60 + +t.slice(14, 16);
  const H0 = 7, H1 = 20;
  const PX = day ? 80 : 56, today = iso(new Date());
  const hours = Array.from({ length: H1 - H0 }, (_, k) => `<div class="hr" style="height:${PX}px">${String(H0 + k).padStart(2, '0')}:00</div>`).join('');
  const cols = [...Array(7)].map((_, k) => {
    const d = new Date(mon); d.setDate(mon.getDate() + k); const key = iso(d);
    if (day && key !== focus) return '';
    const blocks = r.data.filter((c) => c.start_date.slice(0, 10) === key).map((c) => {
      const top = ((min(c.start_date) - H0 * 60) / 60) * PX, h = ((min(c.end_date) - min(c.start_date)) / 60) * PX;
      const bg = c.isAnnule ? '#333' : c.color || `hsl(${hue(c.matiere || c.text)} 70% 38%)`;
      return `<div class="blk" style="top:${top}px;height:${h}px;background:${esc(bg)};color:${inkOn(bg)}"><b>${esc(c.start_date.slice(11, 16))} - ${esc(c.end_date.slice(11, 16))}${c.isAnnule ? ' · ANNULÉ' : ''}</b>${esc(c.text)}<br>${esc(c.prof)}${c.salle ? '<br>Salle ' + esc(c.salle) : ''}</div>`;
    }).join('');
    return `<div class="dcol ${key === today ? 'today' : ''}"><div class="dh">${esc(d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }))}</div><div class="dbody" style="height:${(H1 - H0) * PX}px;--px:${PX}px">${blocks}</div></div>`;
  }).join('');
  const fr = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  $('#view').innerHTML = `<div class="card"><div class="nav2"><b>${day ? esc(longDate(focus)) : `${esc(fr(mon))} – ${esc(fr(sun))} (Semaine ${weekNo(mon)})`}</b><span><button id="tod">Aujourd'hui</button><button id="prev" aria-label="Semaine précédente">‹</button><button id="next" aria-label="Semaine suivante">›</button></span></div><div class="cal"><div class="axis"><div class="dh"></div>${hours}</div>${cols}</div></div>`;
  $('#tod').onclick = () => { S.week = 0; S.dayOff = 0; openTab('edt'); };
  $('#prev').onclick = () => { day ? S.dayOff-- : S.week--; openTab('edt'); };
  $('#next').onclick = () => { day ? S.dayOff++ : S.week++; openTab('edt'); };
  $('#view').insertAdjacentHTML('afterbegin', `<div class="subtabs"><button data-v="day" aria-selected="${day}">JOUR</button><button data-v="week" aria-selected="${!day}">SEMAINE</button></div>`);
  document.querySelectorAll('.subtabs button').forEach((b) => (b.onclick = () => { S.edtView = b.dataset.v; openTab('edt'); }));
}

restore();