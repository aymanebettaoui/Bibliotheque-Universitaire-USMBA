# Scénarios navigateur Playwright

**État de validation : 4 scénarios sur 4 réussis dans Chromium, le 9 novembre 2026, sur `library_test`.** Les tests d’intégration API/PostgreSQL ont une validation séparée.

Le premier scénario importe réellement `frontend/public/demo-card.png`, exécute Tesseract dans Chromium, active `demo:onboarding`, vérifie la déconnexion immédiate puis la reconnexion sans scan. Le scénario de circulation exécute étudiant → recherche → acceptation automatique → remise → emprunt → retour → disponibilité. Deux scénarios vérifient les erreurs de permission et d'absence de caméra. Ils ne prouvent pas une capture avec caméra matérielle.

## Préparation

Installer les dépendances du projet, démarrer PostgreSQL et créer `library_test` comme indiqué dans le README principal. Configurer `.env` : `TEST_DATABASE_URL` doit désigner une base dédiée dont le nom se termine par `_test`, distincte de `DATABASE_URL`.

Sur votre ordinateur, installer Chromium pour Playwright :

```powershell
npx playwright install chromium
```

La commande isolée recommandée utilise 5174/3002 et peut cohabiter avec les serveurs de développement 5173/3001 :

```powershell
npm run test:e2e:isolated
```

La commande avancée reste configurable :

```bash
$env:E2E_START_SERVERS = "true"
$env:TEST_BASE_URL = "http://localhost:5174"
$env:E2E_API_PORT = "3002"
npm run test:e2e
```

Le lanceur migre et peuple uniquement `TEST_DATABASE_URL`, puis démarre les deux serveurs avec `DATABASE_URL` remplacée par cette base de tests. Il ne réinitialise aucune base et refuse une base de tests identique à la base principale. `reuseExistingServer=false` évite de réutiliser silencieusement un serveur de démonstration déjà ouvert. Les fixtures unitaires sont nettoyées à la fin des tests API ; les données de démonstration ajoutées pour ces scénarios navigateur peuvent rester dans la base de tests.

Pour tester une instance **de tests locale déjà démarrée**, configurer explicitement :

```powershell
$env:E2E_START_SERVERS = "false"
$env:E2E_USE_EXISTING_TEST_SERVER = "true"
$env:TEST_BASE_URL = "http://localhost:5173"
npm run test:e2e
```

Dans ce cas, il vous appartient de démarrer cette instance avec sa base dédiée. Le scénario vérifie également `demo:true` côté API et refuse une adresse distante. Il ne fonctionne pas avec une instance de production et n’utilise aucun compte Google réel.

## Données et résultats

Un livre et un exemplaire aux noms uniques sont créés par l’API autorisée du bibliothécaire. L’étudiant fictif principal doit disposer d’un créneau dans sa limite d’emprunts ; le peuplement initial lui laisse un créneau. En fin de scénario, même après un échec, seuls les emprunts/réservations de ce livre sont clôturés ou annulés, puis sa référence est archivée. Aucun emprunt existant du peuplement n’est retourné ou supprimé. Les historiques et audits sont conservés.

Les traces et captures d’échec sont écrites sous `work/playwright-results/`, et le rapport HTML sous `work/playwright-report/`. Résultat observé : **4 réussis, 0 échec, 48,6 secondes**.
