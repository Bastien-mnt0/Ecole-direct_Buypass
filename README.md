# EDUNOTA

Plateforme scolaire non officielle qui regroupe plusieurs environnements scolaires dans une seule interface.

| Environnement | État |
|---|---|
| École Directe | Disponible |
| Pronote | Bientôt disponible |

Pour École Directe : notes avec moyennes recalculées en direct (nouvelles notes comprises), analyse, emploi du temps, cahier de texte et mode sportif (affichage de la météo).

## Structure du projet
```
public/
  index.html     page d'accueil EDUNOTA (choix de l'environnement)
  edunota.css
  edunota.js     registre des environnements (tableau PLATFORMS)
  ecoledirecte.html   application École Directe (ancien index.html, contenu inchangé)
  app.js, style.css
  logo-dark.png, logo-light.png, favicon.ico, icon-192.png, apple-touch-icon.png
server.js        serveur local + relais vers l'API École Directe
worker.js        même relais, version Cloudflare Worker
```

## En local
```
node server.js
```
puis ouvre http://localhost:3000 (Node 18 ou plus). La page d'accueil EDUNOTA s'affiche ; la carte **École Directe** ouvre l'application (`/ecoledirecte.html`).

## Sur GitHub Pages
GitHub Pages n'héberge que des fichiers statiques : l'API d'EcoleDirecte bloque les appels directs depuis un navigateur (CORS), il faut donc un petit relais. Le plus simple et gratuit : un Cloudflare Worker.

1. Crée un dépôt GitHub et envoie le projet :
   ```
   git init && git add . && git commit -m "EDUNOTA"
   git branch -M main
   git remote add origin https://github.com/TON-PSEUDO/TON-DEPOT.git
   git push -u origin main
   ```
2. Dépôt → Settings → Pages → Source : **GitHub Actions**. Le site est publié à chaque push.
3. Déploie le relais :
   ```
   npm i -g wrangler
   wrangler login
   ```
   Dans `wrangler.toml`, mets ton adresse GitHub Pages dans `ALLOWED_ORIGIN` (ex. `https://TON-PSEUDO.github.io`), puis `wrangler deploy`. Note l'URL affichée (`https://ed-proxy.xxx.workers.dev`).
4. Dans `public/app.js`, renseigne `WORKER_URL` avec cette URL, puis commit et push.

Sur GitHub Pages, l'adresse racine (`https://TON-PSEUDO.github.io/TON-DEPOT/`) ouvre la page d'accueil EDUNOTA. Le Worker ne sert aucune page : il relaie uniquement les appels à l'API.

## Ajouter Pronote plus tard
Les cartes de la page d'accueil sont générées depuis le tableau `PLATFORMS` de `edunota.js`. Pour activer Pronote : passer son `status` de `'soon'` à `'available'` et renseigner son `href` (page d'entrée de son application). Un nouvel environnement s'ajoute de la même façon, avec une entrée de plus dans le tableau.

## À savoir
- Tes identifiants passent par ton Worker pour aller chez EcoleDirecte : n'en donne pas l'accès à d'autres personnes. Ils ne sont jamais enregistrés (seul l'identifiant peut être mémorisé sur l'appareil, jamais le mot de passe).
- EcoleDirecte peut bloquer les adresses de Cloudflare (protection anti-robot) ou changer son API sans prévenir. Si le Worker échoue, le mode local reste possible.
- Le fichier de sauvegarde cloud s'appelle encore `bypass.json` (nom historique du projet) ; le renommer demanderait de modifier aussi `app.js`.
- Projet indépendant, non affilié à EcoleDirecte ni à Pronote ; vérifie que cet usage est compatible avec leurs conditions d'utilisation.
