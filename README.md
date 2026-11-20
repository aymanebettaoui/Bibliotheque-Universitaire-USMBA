# Bibliothèque Universitaire USMBA

Application web pour gérer la circulation **d'ouvrages physiques** dans une bibliothèque universitaire. Elle relie la recherche d'un livre, la réservation d'un exemplaire, sa remise au guichet et son retour. Deux espaces sont prévus : **Étudiant** et **Bibliothécaire**.

Ce README présente les améliorations apportées à l'utilisabilité de la solution, les fonctionnalités concernées et la manière de les utiliser.

## Améliorations de l'utilisabilité

| Fonctionnalité concernée | Amélioration pour l'utilisateur | Modalités d'utilisation |
| --- | --- | --- |
| Navigation | Les entrées du menu sont regroupées selon le rôle connecté. Sur petit écran, le menu s'ouvre avec le bouton de navigation. | Ouvrir **Catalogue** pour explorer les livres ; après connexion, utiliser **Mon espace** ou **Gestion** pour accéder aux actions de son rôle. |
| Recherche dans le catalogue | La recherche, les catégories, le filtre de disponibilité et le tri aident à réduire la liste des ouvrages. | Saisir un titre, un auteur ou un ISBN dans le champ de recherche, puis choisir une catégorie, **Disponibles uniquement** ou un ordre de tri. Ouvrir la fiche d'un livre pour voir ses exemplaires. |
| Fiche d'un ouvrage | La disponibilité et les informations utiles sont regroupées avant l'action de demande. | Consulter la fiche, vérifier le nombre d'exemplaires disponibles, puis cliquer sur **Demander cet ouvrage**. Si aucun exemplaire n'est disponible, le bouton est désactivé. |
| Retour après une demande refusée | Le motif apparaît directement **sous le bouton**, avec une icône d'alerte et une couleur discrète. L'étudiant reste sur la fiche. | Cliquer sur **Demander cet ouvrage**. Si la limite configurée d'emprunts et réservations actifs est atteinte, le message indique cette limite ; aucune demande n'est créée. Les autres motifs d'inéligibilité détectés sont également affichés à cet endroit. |
| Suivi des demandes | La page **Mes demandes** présente les demandes à suivre sans l'encombrement des demandes refusées. | Dans l'espace étudiant, ouvrir **Mes demandes** pour consulter une réservation acceptée, son exemplaire et sa date limite de retrait ; utiliser **Annuler** lorsque l'action est proposée. |
| Suivi des emprunts | La date de retour et l'état de chaque emprunt sont accessibles séparément des réservations. | Ouvrir **Mes emprunts** dans l'espace étudiant. La remise au guichet fait apparaître l'ouvrage comme emprunt actif ; le bibliothécaire enregistre ensuite son retour. |
| Tableau de bord bibliothécaire | Quatre indicateurs mettent en avant les informations essentielles : ouvrages au catalogue, exemplaires disponibles, emprunts actifs en bleu et emprunts en retard en rouge. Les cartes sont cliquables. | Ouvrir **Gestion → Tableau de bord**, puis cliquer sur une carte pour accéder au catalogue, aux exemplaires ou aux emprunts. |
| Réservations au tableau de bord | La vue des réservations et les livres à remettre figurent directement **sous les indicateurs**. | Dans le tableau de bord bibliothécaire, descendre sous les cartes et utiliser l'onglet **Réservations**. Cette vue reste aussi accessible par **Gestion → Réservations**. |
| Remise physique et retour | Les actions du guichet sont séparées des décisions automatiques de réservation. | Dans **Réservations**, choisir **Confirmer la remise** et vérifier la carte universitaire ainsi que le code-barres de l'exemplaire. Dans **Emprunts & retours**, choisir **Enregistrer le retour** et indiquer l'état du livre. |
| Aide et accessibilité | Une aide intégrée décrit le parcours d'emprunt ; les messages d'erreur importants sont annoncés comme alertes. Un lien permet de passer directement au contenu principal au clavier. | Utiliser **Aide & informations** dans le menu, ou le lien **Aller au contenu** qui apparaît au focus clavier. |

La confirmation d'une demande éligible s'effectue dans une boîte de dialogue. Un refus connu au moment du clic est présenté sous le bouton, sans ouvrir cette confirmation.

## Parcours de l'étudiant

1. Ouvrir le **Catalogue**, rechercher un ouvrage et consulter sa fiche ainsi que la disponibilité des exemplaires.
2. Se connecter avec un compte universitaire. En première utilisation, suivre la vérification de la carte si le compte n'est pas encore vérifié.
3. Cliquer sur **Demander cet ouvrage**. L'application vérifie l'éligibilité et la limite d'emprunts et réservations actifs configurée par la bibliothèque.
4. Si la demande peut aboutir, confirmer l'envoi. La réservation d'un exemplaire accepté apparaît dans **Mes demandes**, avec sa date limite de retrait.
5. Présenter la carte universitaire au guichet. Après confirmation de la remise par le bibliothécaire, retrouver l'ouvrage et sa date de retour dans **Mes emprunts**.

Une **réservation** garde temporairement un exemplaire pour l'étudiant ; un **emprunt** commence seulement après sa remise physique. La plateforme ne propose pas de lecture ou de téléchargement de livres numériques.

## Parcours du bibliothécaire

1. Ouvrir **Gestion → Tableau de bord** pour consulter les quatre indicateurs et la liste des réservations à traiter.
2. Pour une réservation, ouvrir **Réservations**, identifier l'étudiant et l'exemplaire, puis confirmer la remise physique au guichet.
3. Ouvrir **Emprunts & retours** pour suivre les prêts en cours et enregistrer l'état de l'exemplaire lors du retour.
4. Utiliser **Catalogue** et **Exemplaires** pour gérer la collection. Les sanctions, propositions, paramètres et autres opérations sensibles sont accessibles selon les habilitations du compte.

## Démarrage local

Prérequis : Node.js **22.12 ou plus récent**, npm et Docker Compose. Depuis la racine du dépôt :

```powershell
Copy-Item .env.example .env
docker compose up -d db
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Sous macOS ou Linux, remplacer `Copy-Item .env.example .env` par `cp .env.example .env`. L'interface est disponible sur `http://localhost:5173` et l'API sur `http://localhost:3001`.

Le fichier `.env.example` fournit des valeurs **fictives pour le développement local**. Adapter notamment `DATABASE_URL` et `SESSION_SECRET`. La connexion Google réelle exige un `GOOGLE_CLIENT_ID` configuré. Avec `DEMO_MODE=true`, la page de connexion propose des comptes fictifs **Étudiant — Démo** et **Bibliothécaire — Démo** ; ce mode est interdit en production. La vérification par OCR seule ne valide pas une identité universitaire réelle sans connecteur officiel.

## Vérification du projet

```powershell
npm run typecheck
npm run build
npm run db:test:migrate
npm test
npm run test:e2e:isolated
```

Les tests utilisent `TEST_DATABASE_URL`, une base distincte dont le nom se termine par `_test`. Les modalités détaillées figurent dans [docs/testing.md](docs/testing.md) et [frontend/e2e/README.md](frontend/e2e/README.md).

## Organisation du dépôt

| Dossier | Contenu |
| --- | --- |
| [`frontend/`](frontend/) | Interface React et scénarios Playwright |
| [`backend/`](backend/) | API Express, règles métier, schéma et migrations Prisma, tests serveur |
| [`docs/`](docs/) | Documentation, diagrammes et captures d'écran |
| [`scripts/`](scripts/) | Commandes auxiliaires de développement et de test |

Le frontend utilise React, TypeScript et Vite ; le backend utilise Node.js, Express et Prisma avec PostgreSQL 16. Les tests reposent sur Vitest, Supertest et Playwright.
