# Scénarios navigateur Playwright

**État de validation : sources fournies, non exécutées dans l’environnement de réalisation.** L’outil de navigateur partagé requis par l’environnement géré n’était pas disponible. Aucune installation de navigateur ni exécution Playwright avec navigateur n’a été effectuée. Les tests d’intégration API/PostgreSQL ont une validation séparée.

Le scénario principal exécute réellement le parcours étudiant → recherche → acceptation automatique → remise au guichet → emprunt actif visible par l’étudiant → retour par le personnel → disponibilité publique. Les deux autres scénarios vérifient les messages de refus et d’absence de caméra avec des erreurs injectées exclusivement dans le navigateur de test. Ils ne prouvent pas un scan matériel ou une lecture OCR réussie.

## Préparation

Installer les dépendances du projet, démarrer PostgreSQL et créer `library_test` comme indiqué dans le README principal. Configurer `.env` : `TEST_DATABASE_URL` doit désigner une base dédiée dont le nom se termine par `_test`, distincte de `DATABASE_URL`.

Sur votre ordinateur, installer Chromium pour Playwright :

```powershell
npx playwright install chromium
```

Arrêter les serveurs de développement qui occupent déjà les ports 3001 et 5173. Puis, depuis la racine du projet sous PowerShell :

```powershell
$env:E2E_START_SERVERS = "true"
$env:TEST_BASE_URL = "http://localhost:5173"
npm run test:e2e
```

Sur Bash :

```bash
E2E_START_SERVERS=true TEST_BASE_URL=http://localhost:5173 npm run test:e2e
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

Les traces et captures d’échec sont écrites sous `work/playwright-results/`, et le rapport HTML sous `work/playwright-report/`. Un résultat d’exécution ne peut être revendiqué qu’après avoir lancé les scénarios sur votre machine.
