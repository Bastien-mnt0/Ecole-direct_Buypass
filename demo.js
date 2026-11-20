// EDUNOTA — session de démonstration (élève fictif, données 100 % inventées).
// Chargé uniquement après saisie des identifiants de démonstration (voir app.js). Aucun appel réseau n'est fait ici :
// api() et fetch() remplacent le relais EDUNOTA / l'API École Directe tant que la session de démonstration est ouverte.
// Tout vit en mémoire : un rechargement de la page remet la démonstration à zéro.
(() => {
  'use strict';
  const SCHOOL = 'Lycée Les Horizons';
  const ELEVE = { id: 'demo', prenom: 'Lucas', nom: 'MARTIN', classe: 'Seconde 4' };

  // ---------- Outils ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const noon = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
  const TODAY = noon();
  const ago = (n) => addDays(TODAY, -n);
  const weekday = (d) => { while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1); return d; }; // ramène au jour de classe précédent
  const b64 = (s) => { let t = ''; new TextEncoder().encode(s).forEach((c) => (t += String.fromCharCode(c))); return btoa(t); };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const comma = (n) => String(n).replace('.', ',');
  const isoWeek = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
  const y0 = TODAY.getMonth() >= 8 ? TODAY.getFullYear() : TODAY.getFullYear() - 1; // année de la rentrée en cours

  // ---------- PDF minimal (aperçus et téléchargements de documents fictifs) ----------
  function pdf(title, lines) {
    const enc = (s) => [...String(s)].map((c) => (c.charCodeAt(0) < 256 ? c : '?')).join('').replace(/[\\()]/g, '\\$&');
    let c = `BT /F1 20 Tf 56 780 Td (${enc(title)}) Tj ET\n`, y = 748;
    for (const l of lines) { c += `BT /F1 12 Tf 56 ${y} Td (${enc(l)}) Tj ET\n`; y -= 20; }
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${c.length} >>\nstream\n${c}endstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];
    let out = '%PDF-1.4\n'; const off = [];
    objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const x = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
    const u = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) u[i] = out.charCodeAt(i) & 255;
    return new Blob([u], { type: 'application/pdf' });
  }
  const docNames = new Map(); // identifiant de document fictif → nom
  let docSeq = 0;
  const doc = (name, type = 'FICHIER_CDT') => { const id = 'demo-doc-' + ++docSeq; docNames.set(id, name); return { id, type, libelle: name }; };
  const sampleBlob = (name) => pdf(String(name).replace(/\.[a-z0-9]+$/i, ''), ['Document de démonstration EDUNOTA.', '', 'Ce fichier est fictif : il illustre l\'aperçu et le', 'téléchargement de pièces jointes dans l\'application.', '', 'Élève : ' + ELEVE.prenom + ' ' + ELEVE.nom + ' · ' + ELEVE.classe + ' · ' + SCHOOL]);

  // ---------- Matières, professeurs, notes ----------
  const SUBJ = [
    { c: 'FRANC', n: 'Français', coef: 4, prof: 'Mme GARNIER Hélène', col: '#b3402f', base: 13.2, cls: 11.6, notes: [['Dissertation : le romantisme', 'Devoir surveillé', 20, 2], ['Dictée et grammaire', 'Contrôle', 20, 1], ['Commentaire : Baudelaire', 'Devoir maison', 20, 1], ['Exposé sur Victor Hugo', 'Oral', 20, 1], ['Lecture cursive', 'Interrogation', 10, 1]] },
    { c: 'MATHS', n: 'Mathématiques', coef: 4, prof: 'M. LEFÈVRE Julien', col: '#1565c0', base: 15.4, cls: 11.2, newer: 1, notes: [['Fonctions affines', 'Devoir surveillé', 20, 2], ['Calcul algébrique', 'Interrogation', 10, 1], ['Second degré', 'Devoir surveillé', 20, 2], ['Géométrie repérée', 'Contrôle', 20, 1], ['DM : probabilités', 'Devoir maison', 20, 1]] },
    { c: 'HI-GE', n: 'Histoire-Géographie', coef: 3, prof: 'M. PERRIN Antoine', col: '#6d4c41', base: 12.6, cls: 11.9, newer: 1, notes: [['Les Lumières', 'Devoir surveillé', 20, 2], ['Croquis : la mondialisation', 'Contrôle', 20, 1], ['Frise chronologique', 'Interrogation', 10, 1], ['Étude de document', 'Devoir maison', 20, 1]] },
    { c: 'ANGL1', n: 'Anglais LV1', coef: 3, prof: 'Mme DURAND Claire', col: '#2e7d32', base: 16.1, cls: 12.8, newer: 1, notes: [['Compréhension orale', 'Contrôle', 20, 1], ['Essay : my dream city', 'Devoir maison', 20, 1], ['Vocabulary unit 3', 'Interrogation', 10, 1], ['Oral : presentation', 'Oral', 20, 2]] },
    { c: 'ESP2', n: 'Espagnol LV2', coef: 3, prof: 'Mme MORENO Lucía', col: '#e65100', base: 14.4, cls: 12.1, notes: [['Expression écrite', 'Devoir surveillé', 20, 1], ['Compréhension de texte', 'Contrôle', 20, 1], ['Conjugaison : pretérito', 'Interrogation', 10, 1], ['Oral : la familia', 'Oral', 20, 1]] },
    { c: 'PH-CH', n: 'Physique-Chimie', coef: 3, prof: 'M. ROUSSEAU Thomas', col: '#00838f', base: 11.8, cls: 10.9, notes: [['Mouvement et vitesse', 'Devoir surveillé', 20, 2], ['TP : dilution', 'Compte rendu', 20, 1], ['La mole', 'Contrôle', 20, 1], ['Atomes et ions', 'Interrogation', 10, 1]] },
    { c: 'SVT', n: 'SVT', coef: 2, prof: 'Mme BENOÎT Camille', col: '#558b2f', base: 14.0, cls: 12.4, notes: [['L\'ADN', 'Devoir surveillé', 20, 1], ['TP : microscope', 'Compte rendu', 20, 1], ['La photosynthèse', 'Contrôle', 20, 1], ['Exposé : biodiversité', 'Oral', 20, 1, 'ns']] },
    { c: 'EPS', n: 'EPS', coef: 2, prof: 'M. PETIT Nicolas', col: '#5e35b1', base: 15.0, cls: 13.2, notes: [['Badminton', 'Évaluation', 20, 1], ['Course de demi-fond', 'Évaluation', 20, 1], ['Gymnastique', 'Évaluation', 20, 1]] },
    { c: 'SES', n: 'Sciences économiques et sociales', coef: 1.5, prof: 'Mme LAMBERT Sophie', col: '#ad1457', base: 13.0, cls: 11.7, notes: [['Les marchés', 'Devoir surveillé', 20, 1], ['Exposé : la consommation', 'Oral', 20, 1], ['Le PIB', 'Interrogation', 10, 1]] },
    { c: 'SNT', n: 'Sciences numériques et technologie', coef: 1.5, prof: 'M. ROBIN Maxime', col: '#37474f', base: 16.0, cls: 13.5, notes: [['Projet : réseaux sociaux', 'Projet', 20, 2], ['QCM : internet', 'Interrogation', 20, 1]] },
  ];
  const BY = Object.fromEntries(SUBJ.map((s) => [s.c, s]));
  const TRI = (d) => { const m = d.getMonth() + 1; return m >= 9 && m <= 11 ? ['A001', '1er Trimestre'] : m === 12 || m <= 2 ? ['A002', '2e Trimestre'] : ['A003', '3e Trimestre']; };
  const toNum = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const avg = (list) => { let s = 0, c = 0; for (const n of list) { const v = toNum(n.valeur); if (v == null || n.nonSignificatif === 'true') continue; const on = toNum(n.noteSur) || 20, k = toNum(n.coef) || 1; s += (v / on) * 20 * k; c += k; } return c ? s / c : null; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const stat = (m, r) => ({ moyenneClasse: comma(r2(m).toFixed(2)), moyenneMin: comma(Math.max(3, r2(m - 4.5 - r() * 2)).toFixed(2)), moyenneMax: comma(Math.min(19.5, r2(m + 4 + r() * 2.5)).toFixed(2)) });

  // Génère les notes d'une année : span = nombre de jours couverts, fin = date de la dernière note
  function makeNotes(r, code, label, endAgo, spanDays, level, trend = 0) {
    const out = [];
    SUBJ.forEach((s, i) => {
      const n = s.notes.length;
      s.notes.forEach(([devoir, type, sur, coef, ns], k) => {
        const when = weekday(ago(endAgo + Math.round(spanDays * (1 - k / Math.max(1, n - 1 + 0.4))) + (i % 3)));
        const v20 = Math.max(4, Math.min(20, s.base + level + trend * (k / Math.max(1, n - 1) - 0.5) * 3 + (r() - 0.5) * 5)), v = Math.round(v20 * (sur / 20) * 2) / 2;
        const cl = Math.max(7, Math.min(16, s.cls + (r() - 0.5) * 3)) * (sur / 20);
        const on = (x) => comma(r2(x).toFixed(2));
        const e = { codePeriode: code, codeMatiere: s.c, libelleMatiere: s.n, devoir, typeDevoir: type, date: iso(when), dateSaisie: iso(addDays(when, 1 + (k % 2))), valeur: comma(v), noteSur: String(sur), coef: comma(coef), nonSignificatif: ns ? 'true' : 'false', moyenneClasse: on(cl), minClasse: on(Math.max(2, cl - 5 - r() * 2)), maxClasse: on(Math.min(sur, cl + 4 + r() * 3)) };
        if (v20 >= 17) e.commentaire = 'Excellent travail, continue ainsi.'; else if (v20 < 9) e.commentaire = 'Résultat insuffisant : à retravailler avec le cours.';
        out.push(e);
      });
    });
    return out;
  }
  let NOTES = null;
  function notesData(label) {
    const cur = `${y0}-${y0 + 1}`, prev = `${y0 - 1}-${y0}`;
    if (label && label !== cur && label !== prev) return { periodes: [], notes: [] };
    if (label === prev) { // année précédente (3e) : sert à l'onglet Analyse
      const r = rng(7), notes = [];
      [['A001', 350], ['A002', 295], ['A003', 235]].forEach(([code, endAgo], j) => {
        notes.push(...makeNotes(r, code, label, endAgo, 55, -0.9).filter((_, i) => j === 0 || i % 2 === 0));
      });
      return { periodes: [['A001', '1er Trimestre'], ['A002', '2e Trimestre'], ['A003', '3e Trimestre']].map(([c, p]) => ({ codePeriode: c, periode: p, annuel: false, cloture: true, ensembleMatieres: { disciplines: [] } })), notes };
    }
    if (NOTES) return clone(NOTES);
    const r = rng(2026), [code, name] = TRI(TODAY), notes = makeNotes(r, code, cur, 2, 56, 0, 1); // progression régulière au fil du trimestre
    const discs = SUBJ.map((s) => {
      const mine = notes.filter((n) => n.codeMatiere === s.c).sort((a, b) => a.dateSaisie.localeCompare(b.dateSaisie));
      const off = avg(s.newer ? mine.slice(0, -1) : mine);
      return { codeMatiere: s.c, discipline: s.n, coef: s.coef, moyenne: off == null ? '' : comma(r2(off).toFixed(2)), ...stat(s.cls + 0.3, r), professeurs: [{ nom: s.prof }], groupeMatiere: false, sousMatiere: false, idGroupeMatiere: '0' };
    });
    let sw = 0, sc = 0; for (const d of discs) { const v = toNum(d.moyenne); if (v != null) { sw += v * d.coef; sc += d.coef; } }
    NOTES = { periodes: [{ codePeriode: code, periode: name, annuel: false, cloture: false, ensembleMatieres: { moyenneGenerale: comma(r2(sw / sc).toFixed(2)), moyenneClasse: '11,94', moyenneMin: '7,48', moyenneMax: '16,52', disciplines: discs } }], notes };
    return clone(NOTES);
  }

  // ---------- Emploi du temps ----------
  const H = { a: ['08:00', '09:00'], b: ['09:00', '10:00'], c: ['10:10', '11:10'], d: ['11:10', '12:10'], e: ['13:30', '14:30'], f: ['14:30', '15:30'], g: ['15:40', '16:40'] };
  const ROOM = { FRANC: 'B104', MATHS: 'C201', 'HI-GE': 'B207', ANGL1: 'A103', ESP2: 'A105', 'PH-CH': 'L2', SVT: 'L1', EPS: 'G1', SES: 'B110', SNT: 'I1' };
  const PLAN = { 1: [['a', 'MATHS'], ['b', 'FRANC'], ['c', 'ANGL1'], ['d', 'SVT'], ['e', 'EPS'], ['f', 'EPS'], ['g', 'SNT']], 2: [['a', 'HI-GE'], ['b', 'ESP2'], ['c', 'PH-CH'], ['d', 'MATHS'], ['f', 'SES'], ['g', 'FRANC']], 3: [['a', 'ANGL1'], ['b', 'MATHS'], ['c', 'HI-GE']], 4: [['a', 'PH-CH'], ['b', 'PH-CH'], ['c', 'FRANC'], ['d', 'ESP2'], ['e', 'SVT']], 5: [['a', 'MATHS'], ['b', 'ANGL1'], ['c', 'SES'], ['e', 'HI-GE'], ['f', 'PH-CH'], ['g', 'AP']] };
  function edt(a, b) {
    const out = [];
    for (let d = new Date(a + 'T12:00:00'), end = new Date(b + 'T12:00:00'); d <= end; d = addDays(d, 1)) {
      for (const [slot, code] of PLAN[d.getDay()] || []) {
        const s = BY[code], [t0, t1] = H[slot], key = iso(d);
        const ap = code === 'AP', cancelled = ap && isoWeek(d) % 2 === 0;
        out.push({ id: Number(key.replace(/-/g, '') + slot.charCodeAt(0)), text: ap ? 'Accompagnement personnalisé' : s.n, matiere: ap ? 'Accompagnement personnalisé' : s.n, codeMatiere: ap ? 'AP' : code, prof: ap ? 'Mme ROSSI Nadia' : s.prof, salle: ap ? 'VS' : ROOM[code], classe: ELEVE.classe, start_date: `${key} ${t0}`, end_date: `${key} ${t1}`, color: ap ? '#455a64' : s.col, isAnnule: cancelled, isModifie: false, typeCours: 'COURS' });
      }
    }
    return out;
  }

  // ---------- Cahier de texte ----------
  const WORK = {
    FRANC: ['Lire le chapitre 4 et préparer le commentaire du poème « L\'Albatros ».', 'Rédiger l\'introduction de la dissertation.', 'Apprendre le vocabulaire de la fiche « Romantisme » et relire les pages 80 à 95.'],
    MATHS: ['Exercices 12, 15 et 18 page 112.', 'Terminer la fiche sur le second degré et apprendre les formules du cours.', 'Refaire les exercices corrigés en classe sur les fonctions affines.'],
    'HI-GE': ['Apprendre la leçon sur les Lumières et compléter la frise.', 'Préparer le croquis sur la mondialisation (fond de carte distribué).'],
    ANGL1: ['Learn the irregular verbs (list 3) and write 8 sentences.', 'Workbook p. 45, exercises 2 and 3.'],
    ESP2: ['Apprendre la conjugaison du pretérito indefinido.', 'Rédiger six phrases pour décrire sa famille.'],
    'PH-CH': ['Terminer le compte rendu du TP de dilution.', 'Exercices 8 et 9 page 156 : vitesse moyenne.'],
    SVT: ['Compléter le schéma de la cellule et relire le cours sur l\'ADN.', 'Préparer l\'exposé sur la biodiversité (3 diapositives).'],
    EPS: ['Apporter une tenue de sport adaptée à l\'extérieur.'],
    SES: ['Lire le document 2 page 64 et répondre aux trois questions.', 'Fiche de révision : le fonctionnement d\'un marché.'],
    SNT: ['Finaliser la présentation du projet « Réseaux sociaux ».'],
  };
  const CONTROLS = [[4, 'HI-GE', 'Contrôle : les Lumières et la Révolution (cours + frise).'], [8, 'MATHS', 'Contrôle de mathématiques : second degré et fonctions.'], [11, 'ANGL1', 'Test d\'anglais : vocabulaire unit 3 et compréhension écrite.']];
  const doneIds = new Set([9001]);
  let HW = null;
  function hwPlan() {
    if (HW) return HW;
    const days = {}; let id = 9000, k = 0, sched = 0;
    for (let n = 1; n <= 14 && sched < 7; n++) {
      const d = addDays(TODAY, n); if (d.getDay() === 0 || d.getDay() === 6) continue;
      sched++; const key = iso(d), here = [...new Set((PLAN[d.getDay()] || []).map((x) => x[1]))].filter((c) => WORK[c] && c !== 'EPS' || c === 'EPS' && sched % 4 === 0);
      const picks = [here[k++ % here.length], sched % 2 ? here[k++ % here.length] : null].filter((c, i, a) => c && a.indexOf(c) === i);
      days[key] = picks.map((c) => { const t = WORK[c], dc = sched % 5 === 1 && c === 'MATHS' ? [doc('Exercices - Second degré.pdf')] : sched % 6 === 2 && c === 'FRANC' ? [doc('Texte - L\'Albatros.pdf')] : []; return { c, interro: false, text: t[(sched + id) % t.length], id: ++id, docs: dc }; });
    }
    for (const [offset, c, text] of CONTROLS) {
      let d = addDays(TODAY, offset); for (let g = 0; g < 7 && !(PLAN[d.getDay()] || []).some((x) => x[1] === c); g++) d = addDays(d, 1);
      (days[iso(d)] ||= []).push({ c, interro: true, text, id: ++id, docs: [] });
    }
    return (HW = days);
  }
  const hwList = () => Object.fromEntries(Object.keys(hwPlan()).sort().map((d) => [d, hwPlan()[d].map((m) => ({ matiere: BY[m.c].n, codeMatiere: m.c, aFaire: true, idDevoir: m.id, interrogation: m.interro, effectue: doneIds.has(m.id) }))]));
  const hwDay = (date) => ({ date, matieres: (hwPlan()[date] || []).map((m) => ({ matiere: BY[m.c].n, codeMatiere: m.c, interrogation: m.interro, aFaire: { idDevoir: m.id, contenu: b64(`<p>${m.text}</p>`), effectue: doneIds.has(m.id), documents: m.docs } })) });

  // ---------- Vie scolaire ----------
  const vie = () => ({
    absencesRetards: [
      { typeElement: 'Absence', date: iso(ago(20)), dateFin: iso(ago(19)), justifie: true, motif: 'Maladie', libelle: 'Certificat médical fourni' },
      { typeElement: 'Absence', date: iso(weekday(ago(9))), justifie: true, motif: 'Rendez-vous médical' },
      { typeElement: 'Retard', date: iso(weekday(ago(13))), justifie: true, motif: 'Transports en commun' },
      { typeElement: 'Retard', date: iso(weekday(ago(6))), justifie: false, motif: 'Retard en début de matinée' },
      { typeElement: 'Retard', date: iso(weekday(ago(3))), justifie: false, motif: 'Retard en cours d\'EPS' },
    ],
    dispenses: [{ typeElement: 'Dispense', date: iso(weekday(ago(15))), dateFin: iso(weekday(ago(15))), motif: 'EPS : dispense ponctuelle (certificat médical)', matiere: 'EPS' }],
    sanctionsEncouragements: [
      { typeElement: 'Encouragement', date: iso(weekday(ago(12))), par: 'M. LEFÈVRE Julien', motif: 'Très bon investissement en mathématiques' },
      { typeElement: 'Félicitations', date: iso(weekday(ago(25))), par: 'Mme DURAND Claire', motif: 'Remarquable prestation orale en anglais' },
      { typeElement: 'Observation', date: iso(weekday(ago(18))), par: 'M. PERRIN Antoine', motif: 'Matériel oublié à deux reprises' },
    ],
  });

  // ---------- Messagerie ----------
  const P = (n) => ({ name: n });
  const ME = P('Lucas MARTIN');
  const para = (...t) => t.map((x) => `<p>${x}</p>`).join('');
  const MSGS = {
    received: [
      [1, 'Contrôle de mathématiques : chapitre fonctions', 'M. Julien LEFÈVRE', false, 1, para('Bonjour à tous,', 'Le prochain contrôle portera sur les fonctions affines et le second degré. Pensez à revoir les exercices corrigés en classe et à apprendre les formules du cours.', 'Bon travail,', 'M. Lefèvre')],
      [2, 'Sortie au musée : autorisation à rendre', 'Vie scolaire', false, 2, para('Bonjour,', 'Une sortie au musée est organisée pour les classes de seconde. Merci de remettre l\'autorisation signée à la vie scolaire avant la fin de la semaine.', 'La vie scolaire'), [['Autorisation de sortie.pdf']]],
      [3, 'Lecture cursive : Les Fleurs du mal', 'Mme Hélène GARNIER', true, 4, para('Bonjour,', 'Pour la séance de jeudi, merci de lire les poèmes de la section « Spleen et Idéal » indiqués en classe.', 'Mme Garnier')],
      [4, 'Absence du jeudi : justificatif', 'Mme Nadia ROSSI (CPE)', true, 6, para('Bonjour Lucas,', 'Je n\'ai pas reçu de justificatif pour ton absence de jeudi. Peux-tu le déposer à la vie scolaire dès que possible ?', 'Cordialement,', 'Mme Rossi')],
      [5, 'Conseils de classe du 1er trimestre : calendrier', 'Direction', true, 9, para('Bonjour,', 'Vous trouverez en pièce jointe le calendrier des conseils de classe. Les délégués sont invités à préparer leurs interventions.', 'La direction'), [['Calendrier des conseils de classe.pdf']]],
      [6, 'Compte rendu du TP sur l\'ADN', 'Mme Camille BENOÎT', true, 11, para('Bonjour,', 'Merci de déposer votre compte rendu de TP avant vendredi. Pensez à légender vos schémas.', 'Mme Benoît')],
      [7, 'Réunion parents-professeurs', 'M. Julien LEFÈVRE (professeur principal)', true, 14, para('Bonjour,', 'La réunion parents-professeurs de la classe de Seconde 4 aura lieu en fin de mois. Vos parents recevront une convocation par courrier.', 'M. Lefèvre')],
      [8, 'Menus de la semaine', 'Service de restauration', true, 16, para('Bonjour,', 'Les menus de la semaine sont disponibles dans l\'onglet « Menu » de votre espace.', 'Le service de restauration')],
      [9, 'Projet SNT : inscription au CDI', 'Mme Élise MARCHAND (documentaliste)', true, 20, para('Bonjour,', 'Pour travailler sur votre projet, vous pouvez réserver des créneaux au CDI sur le temps du midi.', 'Mme Marchand')],
      [10, 'Cross du lycée : informations', 'M. Nicolas PETIT', true, 24, para('Bonjour,', 'Le cross du lycée aura lieu en fin de mois. Venez avec une tenue adaptée et une bouteille d\'eau.', 'M. Petit')],
    ],
    sent: [
      [101, 'Re : Absence du jeudi : justificatif', 'Mme Nadia ROSSI (CPE)', true, 5, para('Bonjour Madame,', 'Je vous apporte le justificatif demain matin.', 'Lucas Martin')],
      [102, 'Question sur le devoir de mathématiques', 'M. Julien LEFÈVRE', true, 8, para('Bonjour Monsieur,', 'Pouvez-vous me confirmer que l\'exercice 18 est bien à faire pour lundi ?', 'Lucas Martin')],
      [103, 'Demande de créneau au CDI', 'Mme Élise MARCHAND (documentaliste)', true, 19, para('Bonjour Madame,', 'Serait-il possible de réserver un poste informatique mardi à midi ?', 'Lucas Martin')],
    ],
    archived: [
      [201, 'Bienvenue au Lycée Les Horizons', 'Direction', true, 70, para('Bonjour,', 'Nous sommes heureux de vous accueillir pour cette nouvelle année scolaire.', 'La direction')],
      [202, 'Règlement intérieur : à lire', 'Vie scolaire', true, 66, para('Bonjour,', 'Merci de lire attentivement le règlement intérieur de l\'établissement.', 'La vie scolaire'), [['Règlement intérieur.pdf']]],
    ],
  };
  const msgState = {};
  const msgRows = (box) => MSGS[box].map(([id, subject, who, read, d, body, files]) => {
    const t = ago(d); t.setHours(7 + (id % 9), (id * 7) % 60, 0, 0);
    const date = `${iso(t)} ${pad(t.getHours())}:${pad(t.getMinutes())}:00`, fl = (files || []).map((f, i) => ({ id: 'demo-pj-' + id + '-' + i, libelle: f[0] }));
    fl.forEach((f) => docNames.set(f.id, f.libelle));
    const other = P(who), isRead = id in msgState ? msgState[id] : read;
    return { id, subject, date, read: isRead, from: box === 'sent' ? ME : other, to: box === 'sent' ? [other] : [ME], files: fl, content: b64(body) };
  });
  function messages(box) {
    const list = msgRows(box).map(({ content, ...m }) => m);
    return { messages: { [box]: list }, pagination: { messagesRecusNotReadCount: msgRows('received').filter((m) => m.read === false).length } };
  }
  function message(id) {
    for (const box of Object.keys(MSGS)) { const m = msgRows(box).find((x) => String(x.id) === String(id)); if (m) { msgState[m.id] = true; return m; } }
    return null;
  }

  // ---------- Espaces de travail ----------
  const SPACES = [
    { id: 4101, titre: 'Club Robotique', creePar: 'M. ROBIN Maxime', nbMembres: 14, estMembre: true, estAdmin: false, ouvert: false, public: false, cloud: true, agenda: true, discussion: true, resume: b64(para('Bienvenue dans l\'espace du club de robotique.', 'Retrouvez ici les plans, les programmes et le planning des séances du mercredi.')) },
    { id: 4102, titre: 'Projet SNT : réseaux sociaux', creePar: 'M. ROBIN Maxime', nbMembres: 31, estMembre: true, estAdmin: false, ouvert: true, public: false, cloud: true, agenda: false, discussion: true, resume: b64(para('Espace de dépôt des présentations et des ressources du projet.')) },
    { id: 4103, titre: 'Délégués de la Seconde 4', creePar: 'Mme ROSSI Nadia', nbMembres: 4, estMembre: true, estAdmin: true, ouvert: false, public: false, cloud: true, agenda: true, discussion: true, resume: b64(para('Espace de préparation des conseils de classe.')) },
    { id: 4104, titre: 'Option Théâtre', creePar: 'Mme MARCHAND Élise', nbMembres: 18, estMembre: true, estAdmin: false, ouvert: false, public: true, cloud: false, agenda: true, discussion: false, resume: b64(para('Répétitions le jeudi à 17 h 30, salle polyvalente.')) },
  ];
  const wsTree = (id) => ({ type: 'folder', id: 'W' + id, libelle: 'Cloud', isLoaded: true, children: [
    { type: 'folder', id: `W${id}\\Ressources`, libelle: 'Ressources', isLoaded: true, children: [{ type: 'file', id: `W${id}\\Ressources\\Guide de démarrage.pdf`, libelle: 'Guide de démarrage.pdf' }, { type: 'file', id: `W${id}\\Ressources\\Liens utiles.pdf`, libelle: 'Liens utiles.pdf' }] },
    { type: 'folder', id: `W${id}\\Dépôts`, libelle: 'Dépôts', isLoaded: true, children: [{ type: 'file', id: `W${id}\\Dépôts\\Présentation du projet.pdf`, libelle: 'Présentation du projet.pdf' }] },
    { type: 'file', id: `W${id}\\Planning.pdf`, libelle: 'Planning.pdf' },
  ] });

  // ---------- Porte-monnaie ----------
  const wallet = () => {
    const meals = [], e = [];
    for (let w = 0; w < 4; w++) {
      const sub = []; for (let d = 0; d < 4; d++) sub.push({ libelle: 'Déjeuner demi-pension', date: iso(weekday(ago(2 + w * 7 + d))), montant: 3.4 });
      meals.push({ libelle: 'Consommations', date: sub[0].date, ecritures: sub });
    }
    e.push({ libelle: 'Rechargement par carte bancaire', date: iso(ago(26)), montant: 40 }, { libelle: 'Rechargement par carte bancaire', date: iso(ago(5)), montant: 20 }, ...meals);
    return { comptes: [{ idEleve: 'demo', libelleCompte: 'Restauration scolaire', solde: 23.4, ecritures: e, avenir: [{ libelle: 'Repas réservé', date: iso(addDays(TODAY, 1)), montant: 3.4 }] }] };
  };

  // ---------- Menus de la cantine ----------
  const DISH = {
    entree: [['Salade de tomates', 'Carottes râpées', 'Concombre vinaigrette', 'Soupe de légumes', 'Salade verte et croûtons'], ['Pâté de campagne', 'Betteraves en salade', 'Œuf mayonnaise', 'Taboulé', 'Radis beurre']],
    plat: [['Poulet rôti', 'Poisson pané', 'Rôti de porc', 'Lasagnes végétariennes', 'Colin sauce citron'], ['Steak haché', 'Saucisse de volaille', 'Omelette', 'Cuisse de poulet', 'Filet de lieu']],
    acc: [['Pommes de terre sautées', 'Riz pilaf', 'Haricots verts', 'Salade verte', 'Purée de carottes'], ['Frites', 'Pâtes', 'Gratin de chou-fleur', 'Ratatouille', 'Semoule']],
    lait: [['Yaourt nature', 'Fromage blanc', 'Camembert', 'Emmental', 'Petit-suisse'], ['Yaourt aux fruits', 'Saint-Nectaire', 'Brie', 'Fromage frais', 'Yaourt nature']],
    dessert: [['Fruit de saison', 'Compote de pommes', 'Gâteau au yaourt', 'Crème vanille', 'Fruit de saison'], ['Poire', 'Mousse au chocolat', 'Banane', 'Tarte aux pommes', 'Orange']],
  };
  const menuData = (week) => ({ at: 0, days: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'].map((name, i) => ({ name, rows: Object.fromEntries(Object.entries(DISH).map(([k, v]) => [k, [{ text: v[week % 2][(i + week) % 5], bold: k === 'plat' && i % 2 === 0, low: false }]])) })) });
  const menuList = () => [-1, 0, 1, 2].map((o) => ({ semaine: isoWeek(addDays(TODAY, o * 7)), doc: { id: 'demo-menu-' + isoWeek(addDays(TODAY, o * 7)) } }));

  // ---------- Cloud personnel (arborescence en mémoire) ----------
  const PFX = '\\\\CLOUD0\\cloud\\DEMO0000\\E\\demo', HOME = 'MON CLOUD EDUNOTA', TRASH = PFX + '\\Corbeille\\' + HOME;
  const blobs = new Map();
  const dir = (parent, name, kids = []) => ({ type: 'folder', id: parent + '\\' + name, libelle: name, isLoaded: true, children: kids });
  const file = (parent, name, size = 48213) => ({ type: 'file', id: parent + '\\' + name, libelle: name, taille: size });
  let ROOT = null;
  function vfs() {
    if (ROOT) return ROOT;
    const h = PFX + '\\' + HOME, sub = (n, files) => { const d = dir(h, n); d.children = files.map((f) => file(d.id, f)); return d; };
    ROOT = { type: 'folder', id: PFX, libelle: '/', isLoaded: true, children: [
      { type: 'folder', id: h, libelle: HOME, isLoaded: true, children: [
        sub('Mathématiques', ['Cours - Fonctions affines.pdf', 'Exercices - Second degré.pdf', 'Formulaire.pdf']),
        sub('Français', ['Fiche - Le romantisme.pdf', 'Plan de dissertation.pdf']),
        sub('Histoire-Géographie', ['Frise - Les Lumières.pdf', 'Croquis - Mondialisation.pdf']),
        sub('Projet SNT', ['Présentation - Réseaux sociaux.pdf']),
        file(h, 'Fiche de révision - Physique-Chimie.pdf'), file(h, 'Liste de matériel.pdf'),
      ] },
      { type: 'folder', id: TRASH, libelle: HOME, isLoaded: true, isTrash: true, children: [] },
    ] };
    return ROOT;
  }
  const full = (id) => (String(id).startsWith('\\\\') ? String(id) : '\\\\CLOUD0\\cloud' + id); // l'envoi et la copie transmettent un chemin sans préfixe de serveur
  function find(id, n = vfs(), parent = null) {
    if (n.id === id) return { node: n, parent };
    for (const c of n.children || []) { const r = find(id, c, n); if (r) return r; }
    return null;
  }
  const reid = (n, parentId) => { n.id = parentId + '\\' + n.libelle; (n.children || []).forEach((c) => reid(c, n.id)); };
  const free = (parent, name) => { const taken = new Set((parent.children || []).map((c) => c.libelle.toLowerCase())); const m = /(\.[A-Za-z0-9]{1,8})$/.exec(name), ext = m ? m[1] : '', base = name.slice(0, name.length - ext.length); let n = name, i = 2; while (taken.has(n.toLowerCase())) n = `${base} (${i++})${ext}`; return n; };
  const trashNode = () => vfs().children.find((c) => c.isTrash);
  function cloudOp(method, vis, data) {
    const root = vfs();
    if (method === 'get') return { code: 200, data: clone([root]) };
    if (method === 'post' && !vis) { // nouveau dossier
      const p = find(full(data.parentNode.id)) || find(root.id); const name = free(p.node, String(data.libelle));
      p.node.children.push(dir(p.node.id, name)); return { code: 200, data: {} };
    }
    if (method === 'put') { // renommer
      const f = find(full(data.node.id)); if (!f) return { code: 404, message: 'Élément introuvable' };
      f.node.libelle = free({ children: (f.parent.children || []).filter((c) => c !== f.node) }, String(data.newLibelle)); reid(f.node, f.parent.id); return { code: 200, data: {} };
    }
    if (method === 'copy') { // déplacement : copie dans la destination (l'original est supprimé ensuite)
      const d = find(full(data.parentNode.id)), s = find(full(data.clipboard[0].id)); if (!d || !s) return { code: 404, message: 'Élément introuvable' };
      const c = clone(s.node); c.libelle = free(d.node, c.libelle); reid(c, d.node.id);
      (function mv(a, b) { if (blobs.has(a.id)) blobs.set(b.id, blobs.get(a.id)); (a.children || []).forEach((x, i) => mv(x, b.children[i])); })(s.node, c);
      d.node.children.push(c); return { code: 200, data: {} };
    }
    const tn = data && data.tabNodes && data.tabNodes[0]; if (!tn) return { code: 400, message: 'Requête invalide' };
    if (method === 'delete' && vis) { // mise à la corbeille
      const f = find(full(tn.id)); if (!f || !f.parent) return { code: 404, message: 'Élément introuvable' };
      f.parent.children = f.parent.children.filter((c) => c !== f.node);
      const t = trashNode(); f.node.libelle = free(t, f.node.libelle); f.node._from = f.parent.id; reid(f.node, t.id); t.children.push(f.node); return { code: 200, data: {} };
    }
    if (method === 'delete') { // suppression directe, ou définitive si l'élément est dans la corbeille
      const f = find(full(tn.id)); if (f && f.parent) f.parent.children = f.parent.children.filter((c) => c !== f.node); return { code: 200, data: {} };
    }
    if (method === 'post' && vis) { // restauration
      const t = trashNode(), f = find(full(tn.id)); if (!f || f.parent !== t) return { code: 404, message: 'Élément introuvable' };
      const home = (find(f.node._from) || find(PFX + '\\' + HOME)).node; t.children = t.children.filter((c) => c !== f.node);
      f.node.libelle = free(home, f.node.libelle); delete f.node._from; reid(f.node, home.id); home.children.push(f.node); return { code: 200, data: {} };
    }
    return { code: 400, message: 'Opération non prise en charge dans la démonstration' };
  }

  // ---------- Routage des appels « École Directe » ----------
  function route(path, data) {
    const [name, qs = ''] = path.split('?'), q = new URLSearchParams(qs), verbe = q.get('verbe') || 'get';
    let m;
    if (/^\/v3\/eleves\/[^/]+\/notes\.awp$/i.test(name)) return { code: 200, data: notesData((data || {}).anneeScolaire || '') };
    if (/^\/v3\/eleves\/[^/]+\/viescolaire\.awp$/i.test(name)) return { code: 200, data: vie() };
    if (/^\/v3\/(eleves|familles)\/[^/]+\/messages\.awp$/i.test(name)) return { code: 200, data: messages(q.get('typeRecuperation') || 'received') };
    if ((m = /^\/v3\/(?:eleves|familles)\/[^/]+\/messages\/([\w-]+)\.awp$/i.exec(name))) { const x = message(m[1]); return x ? { code: 200, data: x } : { code: 404, message: 'Message introuvable' }; }
    if (/^\/v3\/E\/[^/]+\/emploidutemps\.awp$/.test(name)) return { code: 200, data: edt(data.dateDebut, data.dateFin) };
    if (/^\/v3\/E\/[^/]+\/espacestravail\.awp$/.test(name)) return { code: 200, data: clone(SPACES) };
    if (/^\/v3\/Eleves\/[^/]+\/cahierdetexte\.awp$/i.test(name)) {
      if (verbe === 'put') { (data.idDevoirsEffectues || []).forEach((i) => doneIds.add(Number(i))); (data.idDevoirsNonEffectues || []).forEach((i) => doneIds.delete(Number(i))); return { code: 200, data: {} }; }
      return { code: 200, data: hwList() };
    }
    if ((m = /^\/v3\/Eleves\/[^/]+\/cahierdetexte\/(\d{4}-\d{2}-\d{2})\.awp$/i.exec(name))) return { code: 200, data: hwDay(m[1]) };
    if (/^\/v3\/comptes\/detail\.awp$/.test(name)) return { code: 200, data: wallet() };
    if (/^\/v3\/menusRestaurationScolaire\.awp$/.test(name)) return { code: 200, data: menuList() };
    if ((m = /^\/v3\/cloud\/([A-Z])\/([\w-]+)(\/visibility)?\.awp$/.exec(name))) {
      if (m[1] === 'W') return { code: 200, data: clone(wsTree(m[2])) };
      return cloudOp(verbe, !!m[3], data || {});
    }
    return { code: 404, message: 'Route non disponible dans la démonstration' };
  }

  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  async function fileResponse(id, type) {
    id = String(id);
    if (blobs.has(id)) return new Response(blobs.get(id), { status: 200 });
    if (type === 'FICHIER_MENU_RESTAURATION') return new Response(pdf('Menu de la semaine', ['Menu de démonstration : lundi au vendredi.', 'Voir le détail jour par jour dans l\'application.']), { status: 200 });
    const name = docNames.get(id) || id.split('\\').pop() || 'Document';
    return new Response(sampleBlob(name), { status: 200 });
  }

  window.EdunotaDemo = {
    school: SCHOOL,
    account: () => ({ id: ELEVE.id, typeCompte: 'E', prenom: ELEVE.prenom, nom: ELEVE.nom, nomEtablissement: SCHOOL, profile: { classe: { libelle: ELEVE.classe } } }),
    menuData,
    async api(path, data) { await wait(40); return clone(route(String(path), data || {})); },
    // Remplace fetch() pour les routes du relais : jamais de requête réseau.
    async fetch(url, opts = {}) {
      await wait(30);
      const u = String(url);
      if (u.includes('/api/ed-file')) { const b = JSON.parse(opts.body || '{}'); return fileResponse(b.id, b.type); }
      if (u.includes('/api/ed-upload-file')) {
        const dest = new URL(u, 'http://x').searchParams.get('dest'), f = opts.body && opts.body.get && opts.body.get('file'), d = find(full(dest));
        if (!d || !f) return json({ error: 'envoi refusé' }, 400);
        const n = free(d.node, f.name || 'fichier'); const node = file(d.node.id, n, f.size); d.node.children.push(node); blobs.set(node.id, f);
        return json({ json: { code: 200 }, token: null, cookies: {} });
      }
      if (u.includes('/api/ed-upload')) return json({ json: { code: 200 }, token: null, cookies: {} });
      return json({ error: 'Non disponible dans la démonstration' }, 404);
    },
  };
})();
