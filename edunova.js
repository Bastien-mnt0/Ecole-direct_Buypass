'use strict';
/* ------------------------------------------------------------------
   Registre des environnements scolaires.
   Pour activer Pronote plus tard : passer status à 'available'
   et renseigner href (page d'entrée de son application). Rien d'autre à toucher.
   ------------------------------------------------------------------ */
const PLATFORMS = [
  {
    id: 'ecoledirecte',
    name: 'École Directe',
    desc: 'Notes, analyse, emploi du temps et cahier de texte.',
    status: 'available',
    href: 'ecoledirecte.html',
    cta: 'Accéder',
    logo: 'ED',
  },
  {
    id: 'pronote',
    name: 'Pronote',
    desc: 'Le même confort de lecture pour ton espace Pronote.',
    status: 'soon',
    href: null,
    cta: 'Bientôt disponible',
    logo: 'P',
  },
];

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };

function renderPlatform(p) {
  const ok = p.status === 'available';
  const card = el(ok ? 'a' : 'div', 'pcard ' + (ok ? 'is-on' : 'is-soon'));
  card.dataset.platform = p.id;
  if (ok) card.href = p.href; else card.setAttribute('aria-disabled', 'true');

  const top = el('div', 'ptop');
  top.append(el('span', 'plogo', p.logo), el('span', ok ? 'badge on' : 'badge', ok ? 'Disponible' : 'Bientôt disponible'));
  const foot = el('span', 'pcta', ok ? p.cta + ' →' : p.cta);
  card.append(top, el('h3', '', p.name), el('p', '', p.desc), foot);
  return card;
}

const host = document.getElementById('platforms');
PLATFORMS.forEach(p => host.append(renderPlatform(p)));

/* Thème : même clé que l'application pour rester synchronisé */
const root = document.documentElement;
document.getElementById('theme').onclick = () => {
  const t = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = t;
  try { localStorage.setItem('ed-theme', JSON.stringify(t)); } catch {}
};
