# Mon carnet

Client EcoleDirecte non officiel : notes avec moyennes recalculées en direct (nouvelles notes comprises) et emploi du temps.

## En local
```
node server.js
```
puis ouvre http://localhost:3000 (Node 18 ou plus).

## Sur GitHub Pages
GitHub Pages n'héberge que des fichiers statiques : l'API d'EcoleDirecte bloque les appels directs depuis un navigateur (CORS), il faut donc un petit relais. Le plus simple et gratuit : un Cloudflare Worker.

1. Crée un dépôt GitHub et envoie le projet :
   ```
   git init && git add . && git commit -m "Mon carnet"
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
4. Dans `public/index.html`, renseigne `PROXY_URL` avec cette URL, puis commit et push.

## À savoir
- Tes identifiants passent par ton Worker pour aller chez EcoleDirecte : n'en donne pas l'accès à d'autres personnes. Ils ne sont jamais enregistrés.
- EcoleDirecte peut bloquer les adresses de Cloudflare (protection anti-robot) ou changer son API sans prévenir. Si le Worker échoue, le mode local reste possible.
- Projet non affilié à EcoleDirecte ; vérifie que cet usage est compatible avec leurs conditions d'utilisation.
