# Configuration, Google, OCR et connecteur universitaire

## Variables et lancement local

Copier `.env.example` vers `.env` à la racine. Ce fichier reste local et ne doit pas être versionné. Le navigateur reçoit l'identifiant public Google nécessaire à GIS, jamais les accès PostgreSQL ni un secret de serveur.

| Variable | Rôle |
| --- | --- |
| NODE_ENV | `development`, `test` ou `production` ; la production refuse le mode démo. |
| PORT | Port Express, 3001 par défaut. |
| APP_ORIGIN | Origine exacte autorisée pour CORS et CSRF ; `http://localhost:5173` en local, HTTPS obligatoire en production. |
| DATABASE_URL | URL Prisma/PostgreSQL de l'application ; correspondre aux identifiants du conteneur local. |
| TEST_DATABASE_URL | Base séparée réservée aux tests d'intégration ; ne jamais désigner la base d'exploitation. |
| DEMO_MODE | `true` uniquement pour la démo fictive hors production ; `false` en exploitation. |
| GOOGLE_CLIENT_ID | Client OAuth Web, audience des jetons Google ID ; vide tant que vous n'avez pas créé le client. |
| SESSION_SECRET | Valeur serveur forte exigée en production ; générer au moins 32 caractères aléatoires. Les sessions elles-mêmes utilisent des jetons opaques aléatoires et leurs empreintes. |
| POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB | Initialisation du conteneur PostgreSQL local ; changer aussi DATABASE_URL si vous modifiez ces valeurs. |

Le volume Docker persiste après l'arrêt. Les variables d'initialisation PostgreSQL ne changent pas automatiquement le mot de passe d'un volume déjà initialisé. Modifier un déploiement existant exige une migration/administration explicite de PostgreSQL.

## Configurer Google Identity Services

1. Ouvrir <https://console.cloud.google.com/> avec le compte autorisé à administrer le projet.
2. Créer ou sélectionner un projet, configurer l'écran de consentement OAuth et le type d'audience adapté à l'établissement. En mode test, ajouter vos utilisateurs de test autorisés.
3. Créer un **identifiant client OAuth 2.0 de type application Web**.
4. Ajouter `http://localhost:5173` dans les **origines JavaScript autorisées** pour le développement. Ajouter l'origine HTTPS finale lorsque vous déployez. Respecter exactement schéma, hôte et port.
5. Copier uniquement le **Client ID** dans `GOOGLE_CLIENT_ID` de `.env`, puis redémarrer le backend. Le flux GIS ID token utilisé ne demande pas de secret OAuth dans React ni de callback redirigeant vers une URI inventée.
6. Ouvrir la connexion et utiliser « Se connecter avec Google » avec un compte étudiant `@usmba.ac.ma` autorisé par votre configuration Google.
7. Vérifier également le rejet d'un compte hors domaine et l'expiration de session dans l'environnement réel.

Le backend utilise `google-auth-library` pour vérifier signature, audience et validité du jeton, puis contrôle les claims et le nonce. Le `sub` est la clé stable. `hd` sert seulement d'indication d'interface. Les demandes sont liées à un défi de préauthentification à usage unique, CSRF et durée limitée.

**Limite de la livraison** : aucun Client ID ni compte universitaire réel n'a été fourni. Le code d'intégration est livré, mais une connexion réelle et la configuration de votre console ne sont pas attestées par les tests locaux. Les tests de claims et le rejet d'un jeton invalide n'équivalent pas à une authentification réelle validée avec Google.

## Provisionner le personnel

Une personne disposant de l'accès administratif au terminal et à PostgreSQL peut créer un compte de personnel avant sa première connexion Google. À la racine :

```powershell
npm run provision:staff -- --email bibliothecaire@votre-institution.ma --name "Nom Prénom" --role LIBRARIAN --confirm-local-admin-access
```

Pour le premier administrateur, remplacer `LIBRARIAN` par `ADMIN`. Le script n'est pas une route publique et n'est accessible qu'à l'opérateur du serveur. Il crée un nouveau compte ; les changements ultérieurs passent par l'administrateur de l'application et sont audités.

L'option `--google-sub` permet de préassocier l'identifiant Google stable connu. Sans cette option, la première connexion Google vérifiée avec l'email préattribué associe le `sub`. Contrôler soigneusement l'adresse et l'identité avant cette préattribution. Les comptes étudiants nouvellement inscrits restent STUDENT et ne peuvent choisir leur rôle.

## Caméra et OCR

Le frontend utilise réellement `navigator.mediaDevices.getUserMedia`. Le parcours doit être exécuté en HTTPS ou sur localhost. Autoriser la caméra du navigateur ; sur mobile, utiliser la caméra arrière si elle est disponible. Présenter une carte lisible, avec éclairage homogène et sans reflet, puis capturer.

La capture est traitée temporairement dans le navigateur et reconnue par **Tesseract.js**, en anglais pour les identifiants alphanumériques, avec segmentation de champs séparés `PSM.SPARSE_TEXT`. Le parseur exige une lettre suivie de 8 à 11 chiffres et une confiance d’au moins 30 ; les formats réels de votre établissement devront être validés et adaptés ensemble côté frontend et backend si nécessaire. Les données du moteur peuvent être téléchargées à la première utilisation ; votre environnement doit permettre leur accès ou les héberger localement selon la configuration du composant. Une progression et une erreur de reconnaissance permettent de recommencer. L'identifiant extrait peut être confirmé/corrigé, puis le serveur le vérifie avec son fournisseur configuré. Aucune information n'est inventée si l'image est illisible.

Le flux média doit s'arrêter au démontage du composant ou à la fermeture du parcours. Si la caméra est absente, refusée ou incompatible, l'interface explique l'erreur et propose un nouveau scan ou la demande de vérification administrative. Un lecteur de codes-barres USB au guichet peut saisir son texte dans le champ identifiant/code ; sa compatibilité matérielle et le format réel de la carte restent à valider.

**Vérification à réaliser sur vos appareils** : caméra absente, refus de permission, capture floue, OCR d'une vraie carte, arrêt de la LED caméra après navigation, Safari/iOS et Android. Un test synthétique de parsing ne remplace pas ces essais matériels.

## Connecteur universitaire : frontière explicite

`backend/src/integrations/university.ts` déclare `UniversityConnector`, `UniversityIdentity` et `UniversityVerification`. Le fournisseur officiel est intentionnellement `UnconfiguredUniversityConnector` : il lève une erreur HTTP 503 tant que vous n'avez pas intégré une source autorisée. Aucun endpoint universitaire officiel n'est inventé.

Pour une intégration réelle :

1. Obtenir de l'université un contrat d'API/documentation et une autorisation d'accès.
2. Implémenter `UniversityConnector.verify(identity)` avec délai, authentification serveur, correspondance du numéro/email/identité et vérification du statut actif.
3. Conserver les secrets exclusivement côté serveur et valider la politique de données avec l'établissement.
4. Remplacer l'instance du connecteur officiel par votre implémentation ; tester refus, indisponibilité, identité non concordante et doublon.
5. Ne jamais traiter une simple chaîne OCR comme une preuve d'inscription.

Le fournisseur `DemoUniversityConnector` utilise les étudiants fictifs connus et les identités `demo:*`. Une carte fictive téléchargeable dans ce parcours correspond au fichier `tests/fixtures/demo-student-card.png`. Le bouton démo « Tester l’inscription par scan » sélectionne uniquement `demo:onboarding` (Samir Exemple), initialement non vérifié ; sa carte fictive porte le numéro `R202400003`. Après vérification, ce profil ne repasse pas par le scan à chaque connexion. Réinitialiser la base fictive pour reproduire la première inscription. Il refuse un vrai compte Google, même si le mode démo est activé. Le libellé reste « Vérification simulée — environnement de démonstration ».

Une **revue administrative physique** est un parcours distinct : un étudiant peut demander un examen ; ADMIN consulte les demandes puis confirme explicitement un contrôle physique avec numéro et motif. La trace porte le fournisseur `ADMIN_REVIEW`, pas `OFFICIAL`. Cette procédure ne doit pas être présentée comme un appel à une API universitaire.

## Déploiement d'exploitation

L'archive est un projet local complet ; elle n'est pas un déploiement géré. Préparer PostgreSQL, un serveur Node compatible, les migrations, sauvegardes et un certificat TLS. Sauvegarder également `backend/var/uploads`, qui contient les couvertures, dans un volume persistant. Construire avec `npm ci`, `npm run db:generate`, `npm run db:migrate`, `npm run build` dans l'environnement approprié.

Servir `frontend/dist` via un serveur Web avec repli SPA vers `index.html`. Acheminer `/api` vers Express ; lancer le backend depuis le dossier `backend` avec sa commande `npm start` et un `.env` serveur adapté. Garder frontend et API sous la même origine simplifie cookies, CORS et CSRF. Les jobs nécessitent un processus backend actif et se rattrapent à son démarrage.

Fixer au minimum `NODE_ENV=production`, `DEMO_MODE=false`, `APP_ORIGIN=https://votre-domaine`, `DATABASE_URL`, `GOOGLE_CLIENT_ID` et un `SESSION_SECRET` fort. Ne pas exécuter le seed fictif en production. Tester les cookies Secure, l'origine exacte, Google réel, les sauvegardes et les échéances après redémarrage. Le connecteur officiel reste non configuré tant que vous ne l'avez pas intégré.

## Dépannage rapide

| Symptôme | Vérification |
| --- | --- |
| `npm` introuvable | Réinstaller Node LTS et ouvrir un nouveau terminal. |
| Docker ne démarre pas | Vérifier Docker Desktop, WSL2 et la virtualisation Windows. |
| Port 5432 occupé | Modifier port publié Docker et DATABASE_URL ensemble. |
| Prisma ne se connecte pas | Vérifier `docker compose ps`, identifiants, port et base de `.env`. |
| Tables absentes | Exécuter `npm run db:migrate` après le démarrage PostgreSQL. |
| Google non configuré | Fournir le Client ID et redémarrer ; configurer les origines Google. |
| Erreur CSRF/origine | Ouvrir l'origine exacte APP_ORIGIN et recharger la session. |
| Caméra indisponible | HTTPS/localhost, matériel, permissions système et navigateur. |
| Connecteur universitaire 503 | Comportement attendu sans intégration officielle ; demander une revue administrative. |
| Liste démo modifiée | Réinitialiser seulement la base fictive avec `npm run db:reset`. |
