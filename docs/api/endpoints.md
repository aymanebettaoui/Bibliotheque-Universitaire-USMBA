# API REST

La référence initiale des objets est [`CONTRACT.md`](CONTRACT.md). Toutes les routes ci-dessous commencent par `/api`. Les identifiants sont UUID, les dates ISO 8601 UTC, les montants DH sérialisés depuis Decimal. Les états techniques sont anglais, les messages français.

Pour une mutation, le client transmet `Content-Type: application/json`, `Origin` égal à `APP_ORIGIN`, le cookie de session et `X-CSRF-Token` reçu de `/auth/me`. Les fichiers de couverture suivent le format explicite de leur route. Les erreurs respectent `{ "error": { "code": "…", "message": "…" } }`.

Statuts usuels : 400 entrée invalide, 401 absence de session/jeton invalide, 403 rôle ou CSRF interdit, 404 ressource introuvable ou étrangère, 409 conflit métier ou transition, 429 débit limité, 503 intégration absente. Une demande d'emprunt correctement traitée peut être créée avec état REFUSED et motif : le refus métier n'est pas un échec de transport.

## Public et authentification

| Méthode / route | Droits | Corps / résultat |
| --- | --- | --- |
| GET `/health` | Public | État du serveur et connexion PostgreSQL ; ne prouve pas la configuration Google/universitaire. |
| GET `/books` | Public | `q`, `category`, `available=true`, `sort=title\|recent\|year`, `page`, `pageSize` ; `{items,total,page,pageSize,categories}`. |
| GET `/books/:id` | Public | Métadonnées, auteurs, catégories, exemplaires et compteurs ; aucune identité d'emprunteur. |
| GET `/categories` | Public | `{items:[{id,name}]}`. |
| GET `/auth/me` | Public/session | `{user,csrfToken,demo,googleClientId,universityConfigured}` ; user peut être null. |
| GET `/auth/google/nonce` | Préauth | Crée un défi/nonce à usage unique, renvoie `{nonce,csrfToken}`. |
| POST `/auth/google` | Préauth CSRF | `{credential,nonce}` ; vérifie Google, crée une session sécurisée. |
| POST `/auth/demo` | Démo hors production | `{role:"STUDENT"\|"LIBRARIAN"\|"ADMIN",scenario?:"ONBOARDING"}` ; scénario seulement avec STUDENT, sélectionne exclusivement les comptes fictifs prédéfinis. ONBOARDING ouvre Samir non vérifié, aucun id arbitraire. |
| POST `/auth/logout` | Session/CSRF | Détruit la session et efface le cookie. |
| POST `/onboarding/verify` | Étudiant | `{studentNumber}` ; appelle le connecteur, jamais l'OCR comme preuve. |
| POST `/onboarding/review` | Étudiant | `{reason,studentNumber?}` ; motif de 10 à 500 caractères, numéro une lettre puis 8 à 11 chiffres si renseigné. |

## Espace personnel et circulation

| Méthode / route | Droits | Corps / résultat |
| --- | --- | --- |
| GET `/me/dashboard` | STUDENT | Statistiques, demandes, notifications et prochaines échéances personnelles. |
| GET `/me/requests` | STUDENT | `{items}` avec ouvrage et réservation éventuelle. |
| GET `/me/loans` | STUDENT | `{items}` avec `copy.book`, infractions et historique. |
| GET `/me/sanctions` | STUDENT | `{items}` personnels uniquement. |
| GET `/me/recommendations` | STUDENT | Livres et raison fondée sur catégories des prêts ; sélection récente si aucun historique. |
| POST `/requests` | STUDENT | `{bookId}` ; vérifications et réservation atomiques ; demande ACCEPTED ou REFUSED motivée. |
| POST `/requests/:id/cancel` | Propriétaire STUDENT | Annule une réservation encore active et libère l'exemplaire. |
| GET `/notifications` | Session | Notifications du destinataire courant. |
| POST `/notifications/:id/read` | Propriétaire | Marque la notification lue. |
| GET `/acquisitions` | Session | Étudiant : ses propositions ; personnel : toutes. |
| POST `/acquisitions` | STUDENT | `{title,author,category,referenceUrl?,reason?}` ; bloque doublons personnels et titre déjà présent. |

## Personnel

LIBRARIAN et ADMIN sont autorisés ; STUDENT reçoit 403 même s'il fabrique directement la requête.

| Méthode / route | Corps / résultat |
| --- | --- |
| GET `/staff/dashboard` | Compteurs d'inventaire, circulation, retards et propositions. |
| GET `/staff/requests` | Demandes récentes avec étudiant et réservation, limitées à 200. |
| GET `/staff/loans` | Prêts avec étudiant et exemplaire, limités à 200. |
| GET `/staff/students?q=` | Identifiant exact ou recherche par nom, 30 résultats maximum. |
| POST `/staff/reservations/:id/handover` | `{studentNumber,barcode}` ; recontrôle puis crée le prêt et marque la réservation COLLECTED. |
| POST `/staff/loans/:id/return` | `{condition:"GOOD"\|"DAMAGED"\|"LOST",damageSeverity?:"MINOR"\|"SEVERE"}` ; gravité obligatoire uniquement pour DAMAGED. |
| GET `/staff/books` | Catalogue du personnel, y compris ouvrages archivés. |
| POST `/staff/books` | Métadonnées : `title,authors:string[],categories:string[],priceDh,isbn?,publisher?,year?,description?,coverColor?,archived?`. |
| PATCH `/staff/books/:id` | Même schéma de métadonnées validé ; archive plutôt que supprimer. |
| POST `/staff/books/:id/copies` | `{count:1..50}` ; crée des codes uniques. |
| PATCH `/staff/copies/:id` | `{condition,status,reason}` ; refuse modification d'un exemplaire affecté, seuls AVAILABLE/WITHDRAWN par ce parcours. |
| PATCH `/staff/acquisitions/:id` | `{status,comment?,bookId?}` ; ACQUIRED exige livre et exemplaire sain disponible. |
| GET `/staff/sanctions` | Liste avec étudiant et cause. |
| POST `/staff/sanctions/:id/settle` | `{reason}` ; enregistre le règlement d'une amende ACTIVE, sans paiement bancaire. |
| POST `/staff/books/:id/cover` | Corps binaire JPEG/PNG/WebP, `Content-Type` image correspondant, maximum 2 Mo et 25 millions de pixels ; réencode WebP, retire les métadonnées, renvoie `{coverUrl}`. |

GET `/covers/:filename.webp` sert les couvertures validées. Cette route ne sert pas à téléverser des cartes étudiantes. Le cookie, Origin et le jeton CSRF restent obligatoires pour le téléversement.

## Administration

| Méthode / route | Corps / résultat |
| --- | --- |
| GET `/admin/settings` | Paramètres singleton. |
| PATCH `/admin/settings` | `{maxLoans,loanDays,pickupHours,lateSuspensionDays,minorDamageDays}` dans les bornes validées. |
| GET `/admin/users` | Utilisateurs et rôles. |
| PATCH `/admin/users/:id` | `{role?,active?}` ; protège le dernier admin, invalide les sessions affectées et journalise. |
| GET `/admin/audit` | Événements d'audit. |
| POST `/admin/sanctions/:id/revoke` | `{reason}` ; correction administrative auditée. |
| GET `/admin/identity-reviews` | Dossiers de vérification administrative. |
| POST `/admin/students/:id/verify` | `{studentNumber,reason,physicalConfirmed:true}` ; raison de 20 à 500 caractères et contrôle physique explicite ; fournisseur ADMIN_REVIEW. |

## Exemple de scénario HTTP

1. GET `/auth/me` pour obtenir le cookie préauth et le CSRF.
2. POST `/auth/demo` dans l'environnement fictif avec Origin, cookie et CSRF ; conserver le nouveau cookie/token.
3. GET `/books?available=true` puis POST `/requests` avec un bookId réellement disponible.
4. Vérifier `status` et, si ACCEPTED, `reservation.expiresAt` ; le prêt n'existe pas encore.
5. Avec une session de personnel distincte, POST `/staff/reservations/:id/handover` avec le numéro et le code attendus.
6. GET `/me/loans` avec la session étudiant ; vérifier le prêt ACTIVE.
7. Avec la session personnel, POST `/staff/loans/:id/return` `{condition:"GOOD"}` ; vérifier le prêt CLOSED et la disponibilité du catalogue.

Ne pas réutiliser les cookies et jetons CSRF d'une autre session ou d'un autre rôle. Les tests d'intégration automatisent ce parcours sur une base dédiée.
