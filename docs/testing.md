# Tests, vérifications et limites

## Isolation indispensable

Les tests d'intégration utilisent PostgreSQL réel, et non un stockage mémoire. `backend/vitest.config.ts` exige `TEST_DATABASE_URL` distinct de `DATABASE_URL`, avec un nom de base se terminant par `_test`. Les tests peuvent supprimer/recréer leurs fixtures ; ne jamais pointer cette variable sur des données réelles.

Sur Windows, après l'installation initiale :

```powershell
docker compose exec db createdb -U library library_test
npm run db:test:migrate
npm test
```

La commande `createdb` est nécessaire une seule fois. Adapter `-U` si votre utilisateur est différent. `.env` doit contenir l'URL dédiée correspondante ; le script `db:test:migrate` applique les migrations uniquement à cette base après vérification du nom.

Vérification TypeScript et build :

```powershell
npm run typecheck
npm run build
```

## Couverture des suites

| Domaine | Vérifications prévues/réalisées par les tests sources |
| --- | --- |
| Authentification | Claims, issuer/audience/expiration/email/nonce, domaine exact, vrai rejet d'un jeton malformé par la bibliothèque Google, cookies/session/CSRF, expiration, déconnexion et RBAC. |
| Vérification | Fournisseur officiel absent → 503 sans activation, fournisseur fictif isolé des comptes Google réels, revue physique administrative auditée, unicité du numéro. |
| Circulation | Demande disponible/indisponible, étudiant non vérifié/suspendu, quota, concurrence d'étudiants pour un exemplaire et d'un étudiant sur plusieurs ouvrages, remise et retour réels. |
| Base | Index partiels et garde intertables, cohérence des états à COMMIT, intégrité face à écritures directes invalides. |
| Échéances | Expiration réservation, rappel dédupliqué, retard constaté une fois, remise hors délai refusée. |
| Sanctions | Cycles de retards, suspension, deuxième cycle/bannissement, perte selon seuil de prix, détériorations et calcul Decimal. |
| Gestion | Catalogue, propositions, rôles, paramètres et opérations administratives selon les suites présentes. |

Un test de validation de claims avec des données construites ne prouve pas qu'une signature Google valide a été reçue. Le jeton valide d'un utilisateur réel n'a pas été fourni. La vérification cryptographique réelle est appelée par le code ; son parcours positif dépend de votre configuration Google.

## Résultats observés

Dernier lancement complet communiqué par l’agent principal : `npm test` — **74 tests réussis sur 74**, en exécution séquentielle sur PostgreSQL réel (5,37 secondes).

| Suite | Résultat |
| --- | --- |
| `backend/src/tests/auth.test.ts` | 26 / 26 réussis |
| `backend/src/tests/circulation.test.ts` | 31 / 31 réussis |
| `backend/src/tests/http.test.ts` | 12 / 12 réussis |
| `backend/src/tests/management.test.ts` | 5 / 5 réussis |

`npm run typecheck` a réussi pour le backend et le frontend. Les builds finaux `npm run build -w backend` et `npm run build -w frontend` ont réussi, compilation TypeScript incluse. Les quatre SVG UML ont été régénérés avec PlantUML 1.2026.2 / OpenJDK 21 / Graphviz ; code de sortie 0 et XML valides.

Un contrôle HTTP réel du serveur Express construit a également réussi : PostgreSQL connecté, 16 ouvrages, index frontend et assets JavaScript servis, route SPA `/gestion/guichet` et image `/demo-card.png` accessibles (200). Il ne constitue pas un rendu dans un navigateur. La réinitialisation/migration/peuplement de la base fictive a été exécutée avec succès : 16 livres, 5 comptes.

Les tests HTTP comprennent le cycle réel de réservation/remise/retour, l’isolation des ressources, la persistance entre instances Express, le téléversement d’une image valide réellement réencodée par Sharp et servie en WebP, le rejet d’une fausse image, les propositions d’acquisition et les règlements/corrections audités. Les tests positifs du flux Google après la frontière cryptographique utilisent une doublure explicitement limitée à cette frontière ; ils ne sont pas une connexion à Google avec un compte réel.

## OCR : moteur réellement exécuté

```powershell
npm run test:ocr
```

Le script `scripts/verify-ocr.ts` utilise le vrai moteur **Tesseract.js**, le même parseur d’identifiant que le frontend et une image fictive `tests/fixtures/demo-student-card.png`. Résultat observé : **PASS**, identifiant `R202400003`, confiance **92**. Les cas texte sans identifiant et faible confiance sont également refusés. Le mode de segmentation `PSM.SPARSE_TEXT` est utilisé dans le smoke test et l’interface pour cette carte à champs séparés.

Le premier téléchargement de données linguistiques nécessite Internet. La carte porte une mention de démonstration/sans valeur officielle et ne contient pas de donnée personnelle réelle. Le navigateur fournit aussi `frontend/public/demo-card.png` comme exemple à télécharger puis importer dans le parcours de démonstration ONBOARDING.

Ce résultat prouve une reconnaissance réelle sur **cette image synthétique**. Il ne prouve ni la qualité sur toutes les cartes universitaires ni l’accès matériel à une caméra ; ces essais restent à réaliser.

## Scénario E2E navigateur

Les sources Playwright décrivent le parcours : connexion démo étudiant → recherche/catalogue → demande acceptée → connexion personnel → remise → prêt actif → retour → disponibilité. Une démo de rôle ne constitue pas un test E2E d'une connexion Google réelle.

Pour préparer Playwright sur votre ordinateur :

```powershell
npx playwright install chromium
$env:E2E_START_SERVERS = "true"
$env:TEST_BASE_URL = "http://localhost:5173"
npm run test:e2e
```

Arrêter les serveurs de développement qui occupent déjà les ports 3001 et 5173. `scripts/start-e2e.mjs` migre et peuple la base TEST_DATABASE_URL puis lance frontend/backend en remplaçant DATABASE_URL par cette base dédiée. Le lanceur refuse une base principale, et Playwright refuse une cible distante. Le scénario crée puis archive son propre ouvrage et conserve les historiques ; il ne retourne pas les prêts préexistants. Les trois tests Playwright ont été découverts, mais aucun navigateur n’a été lancé. Le guide détaillé est [`frontend/e2e/README.md`](../frontend/e2e/README.md).

**Limite de cette session** : l’environnement géré ne fournit pas `cua_repl.js`, l’outil navigateur requis par son flux de prévisualisation. La compétence [Sites — SKILL.md](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md) impose : « If cua_repl.js is unavailable, skip browser QA: do not start a preview server, install a browser, or improvise another browser-control path. » Les scénarios navigateur sont donc fournis sans prétendre les avoir exécutés. Les tests API et compilations ne prouvent pas à eux seuls le rendu responsive ou l’accessibilité matérielle.

## Matrice manuelle à exécuter sur les appareils cibles

| Test manuel | Résultat attendu |
| --- | --- |
| Connexion Google universitaire réelle | Session valide, première vérification requise ; connexion suivante sans nouveau scan si vérifié. |
| Compte hors domaine | Refus serveur, sauf personnel explicitement préattribué par procédure administrative. |
| Caméra absente / refusée | Message explicite, possibilité de recommencer ou de demander revue physique. |
| Image floue / numéro absent | Aucun identifiant inventé ; erreur/nouvelle capture. |
| Navigation après caméra | Flux et pistes vidéo arrêtés, voyant caméra éteint. |
| Mobile et clavier | Navigation, dialogues, formulaires et états d'erreur accessibles ; absence de débordement. |
| Deux navigateurs réservant le dernier exemplaire | Une seule acceptation ; l'autre demande indique l'indisponibilité. |
| Serveur arrêté puis relancé après échéance | Rattrapage des expirations et retards, notifications non dupliquées. |
| Retour endommagé/perdu | Prêt clos, exemplaire WITHDRAWN, sanction attendue et audit conservé. |
| Production derrière HTTPS | Cookies Secure, origines exactes, démo refusée, intégrations configurées. |
