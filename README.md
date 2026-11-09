# UniBiblio — Bibliothèque universitaire

Application de gestion de livres **physiques** : catalogue public, sessions Google OIDC, inscription par caméra/OCR, demandes automatiques, réservations, guichet de remise/retour, sanctions, propositions d'acquisition, notifications et gestion bibliothécaire.

Le projet est un monorepo React/TypeScript/Vite et Express/Prisma/PostgreSQL. Les données et mutations passent réellement par le backend et la base PostgreSQL ; le frontend ne contient pas de stockage métier de remplacement. Les sources UML et leurs SVG se trouvent dans [`docs/uml`](docs/uml/README.md).

## Ce qui nécessite encore vos accès

- **Google** : aucun client OAuth n'a été fourni. Le code vérifie les jetons avec la bibliothèque officielle Google, mais la connexion à un vrai compte doit être configurée puis validée avec vos accès. Aucun mot de passe n'est demandé.
- **Université** : aucun protocole ni accès à une base officielle n'a été fourni. Le connecteur production refuse l'activation sur OCR seul. Le fournisseur de démonstration traite uniquement des étudiants fictifs.
- **Caméra/OCR** : une caméra réelle et une permission navigateur sont nécessaires. La reconnaissance peut échouer et ne vaut pas preuve d'identité. Le parcours matériel doit être vérifié sur vos appareils.
- **Tests et couverture** : consulter le [bilan de validation](docs/testing.md) et le [bilan par phase](docs/phase-status.md). Un fichier de test fourni n'est pas une preuve d'exécution.

Validation effectuée : **74 tests serveur réussis sur PostgreSQL réel**, compilation/build backend et frontend réussis, OCR Tesseract réellement exécuté sur la carte fictive, et **4 scénarios Playwright réussis dans Chromium** sur `library_test`. La caméra matérielle et une connexion Google réelle ne sont pas attestées ; voir le bilan détaillé.

Il n'y a ni livres numériques téléchargeables, ni passerelle bancaire, ni emails envoyés. Les notifications sont internes et le règlement d'une pénalité est enregistré au guichet.

## Installation sur Windows, pas à pas

### 1. Installer les prérequis

1. Installer **Node.js 22.12 ou supérieur** depuis <https://nodejs.org/> (version LTS recommandée), avec npm.
2. Installer **Docker Desktop pour Windows** depuis <https://www.docker.com/products/docker-desktop/>. Activer WSL 2 lorsque l'installateur le demande et redémarrer Windows si nécessaire.
3. Démarrer Docker Desktop et attendre que son moteur soit prêt. Si WSL manque, ouvrir PowerShell en administrateur, exécuter `wsl --install`, redémarrer puis relancer Docker Desktop.
4. Extraire l'archive du projet dans un dossier accessible, par exemple `C:\Projets\library-management`. Git est facultatif pour une installation depuis ZIP ; l'installer depuis <https://git-scm.com/> si vous utilisez un dépôt.
5. Ouvrir **PowerShell** dans ce dossier. Fermer et rouvrir le terminal après l'installation de Node pour actualiser le PATH.

Vérifier les outils :

```powershell
node --version
npm --version
docker --version
docker compose version
```

Si PowerShell interdit `npm.ps1`, utiliser `npm.cmd` à la place de `npm` dans les commandes suivantes, sans désactiver globalement la politique de sécurité Windows.

### 2. Configurer et initialiser

Toutes les commandes suivantes s'exécutent **à la racine du projet**, là où se trouve ce README.

```powershell
Copy-Item .env.example .env
docker compose up -d db
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
```

`docker compose up -d db` lance PostgreSQL 16 dans un volume persistant. Le mot de passe de `.env.example` est réservé à une démonstration locale. `DATABASE_URL` doit correspondre aux valeurs `POSTGRES_USER`, `POSTGRES_PASSWORD` et `POSTGRES_DB`.

Le port local 5432 doit être libre. Si PostgreSQL est déjà installé sur votre ordinateur, adaptez le port publié dans `docker-compose.yml` et celui de `DATABASE_URL`. Attendre l'état `healthy` avec `docker compose ps` avant les migrations.

### 3. Démarrer

```powershell
npm run dev
```

Ouvrir **<http://localhost:5173>**. Le frontend transmet `/api` au backend Express, disponible sur le port 3001. Garder le terminal ouvert ; `Ctrl+C` arrête les serveurs. Les jobs backend tournent au démarrage puis toutes les minutes pendant que le backend fonctionne.

Les origines doivent rester cohérentes : si vous remplacez `localhost` par une adresse IP ou changez le port, mettre à jour `APP_ORIGIN`, le proxy Vite et les origines OAuth. La caméra requiert HTTPS, sauf pour `localhost` reconnu comme contexte sûr par le navigateur.

### 4. Essayer les données fictives

Avec `DEMO_MODE=true` et `NODE_ENV=development`, la page de connexion donne accès aux deux rôles de démonstration étudiant et bibliothécaire. La bannière rappelle le caractère fictif de l'environnement. Ce mécanisme est interdit en production et ne permet pas de transformer un vrai compte Google en personnel.

Parcours conseillé :

1. Ouvrir le catalogue et choisir un livre disponible.
2. Entrer comme étudiant de démonstration puis demander le livre. La décision du serveur et l'échéance de récupération apparaissent dans les demandes.
3. Se déconnecter puis entrer comme bibliothécaire. Au guichet, sélectionner la réservation et confirmer le numéro étudiant et le code de l'exemplaire.
4. Revenir comme étudiant : le prêt est actif avec sa date de retour.
5. Revenir comme bibliothécaire : enregistrer le retour et l'état physique. Le catalogue se met à jour ; le prêt clos reste dans l'historique.

Les étudiants usuels du seed sont déjà vérifiés pour faciliter les emprunts. Le bouton démo **« Tester l’inscription par scan »** ouvre un profil fictif distinct : Samir Exemple. Pour un parcours reproductible, lancer Playwright sur `library_test` : le lanceur remet uniquement la fixture `demo:onboarding` en état non vérifié, sans réinitialiser PostgreSQL ni toucher aux autres comptes. Importer `frontend/public/demo-card.png`, portant **R202400003**, puis lancer la lecture OCR et la vérification. Une fois ce profil vérifié, ses connexions suivantes ne demandent plus de scan.

Le fonds présenté est un inventaire fictif de démonstration, pas l’inventaire officiel de l’université.

Les identifiants fictifs du fournisseur universitaire sont `R202400001`, `R202400002` et `R202400003` (profil d’inscription). Un scan ne doit pas être présenté comme une vérification officielle. Pour reproduire exactement un test de réservation, choisir un exemplaire disponible et tenir compte des prêts/réservations déjà présents dans le jeu de démonstration.

### 5. Vérifier et construire

```powershell
npm run typecheck
npm run build
npm run test:ocr
npm run test:e2e:isolated
```

Pour préparer la base dédiée et lancer les tests :

```powershell
docker compose exec db createdb -U library library_test
npm run db:test:migrate
npm test
```

La création de `library_test` n’est nécessaire qu’une fois. Configurer `TEST_DATABASE_URL` dans `.env` selon l’exemple. Adapter l’utilisateur si vous l’avez changé.

Les tests d'intégration utilisent une base distincte désignée par `TEST_DATABASE_URL`. La configuration refuse d'utiliser la base principale. Utiliser exclusivement une base fictive dédiée ; ne jamais lancer ces commandes contre une base d'exploitation. Voir [les instructions de tests](docs/testing.md).

`npm run test:ocr` exécute réellement Tesseract.js sur une carte synthétique, sans données personnelles. Le premier lancement peut télécharger les données de langue ; ce test ne remplace pas un essai de caméra matérielle.

`npm run test:e2e:isolated` utilise les ports 5174/3002 pour ne pas perturber les serveurs de développement, force la base dédiée `_test`, remet uniquement `demo:onboarding` en état initial, puis exécute les quatre scénarios Chromium.

Le build produit `backend/dist` et `frontend/dist`. Pour un déploiement réel, il faut un serveur Node, PostgreSQL, HTTPS et un reverse proxy servant le frontend et acheminant `/api` vers Express. Une page statique seule ne remplace pas ce backend. Les commandes et points à valider figurent dans [la configuration](docs/configuration.md).

### 6. Arrêter et réinitialiser

```powershell
docker compose stop db
```

Le volume conserve les données. Pour reprendre : `docker compose up -d db`, puis `npm run dev`.

**Réinitialiser efface les données de la base configurée.** À utiliser uniquement pour la base fictive :

```powershell
npm run db:reset
```

`db:seed` crée les données si le catalogue est vide ; il ne réinitialise pas une base déjà peuplée. `db:reset` efface puis recrée la base fictive et refuse de s’exécuter hors mode démo. Le seed est également refusé en production.

## Configuration Google et personnel

Le guide [configuration](docs/configuration.md) décrit le client Google, les origines autorisées, le connecteur universitaire et l'OCR. Le personnel doit être préattribué par une procédure locale sécurisée ; une inscription publique ne peut obtenir que STUDENT. La commande `npm run provision:staff -- --email … --name … --confirm-local-server-access` crée un bibliothécaire ; l'option `--grant-sensitive-management` accorde explicitement les habilitations renforcées.

En production, `DEMO_MODE=false`, `NODE_ENV=production`, `APP_ORIGIN=https://votre-domaine` et `GOOGLE_CLIENT_ID` valide sont obligatoires. Les paramètres ne sont pas des secrets frontend. Aucun secret ne doit être commité dans `.env` ni envoyé dans un ticket ou journal.

## Documents pour la présentation universitaire

- [Analyse, architecture et risques](docs/architecture/01-analyse.md)
- [Règles métier](docs/architecture/02-regles-metier.md)
- [Modèle relationnel](docs/architecture/03-modele-relationnel.md)
- [Quatre diagrammes UML, sources et SVG](docs/uml/README.md)
- [Endpoints REST](docs/api/endpoints.md)
- [Rôles et sécurité](docs/security.md)
- [Installation, Google, OCR et connecteur](docs/configuration.md)
- [Traçabilité UML ↔ code](docs/traceability.md)
- [Tests et résultats observés](docs/testing.md)
- [Bilan des phases et limites](docs/phase-status.md)
