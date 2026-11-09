# Contrat de réalisation — version initiale

Application locale React/Vite → Express → Prisma/PostgreSQL. Le cahier des charges demande la création des fichiers exécutables dans l’environnement, et non une substitution du backend par un service Worker. Pas de publication d’une façade dépourvue de son backend.

## Conventions

- Toutes les routes commencent par `/api`. JSON en camelCase, identifiants UUID sauf paramètres singleton; dates ISO 8601 UTC, affichées en français avec Africa/Casablanca. Montants DH en Decimal, sérialisés en chaînes.
- Erreur: `{error:{code,message}}`. Liste livres: `{items,total,page,pageSize,categories}`; détail livre avec authors, categories et copies publiques sans emprunteurs. Autres listes: `{items}`. Mutation: objet créé/modifié ou `{ok:true}`.
- Cookies de session HttpOnly, jeton CSRF exposé par `GET /auth/me` et transmis dans `X-CSRF-Token` sur mutations authentifiées. Contrôle exact Origin des mutations; Google nonce et CSRF préauth. Pas de mots de passe.
- États anglais dans les API et la base, libellés français dans l’interface.

## Authentification

`GET /auth/me` → `{user:null|{id,name,email,role,active,student:null|{id,studentNumber,verified}},csrfToken,demo,googleClientId,universityConfigured}`.
`POST /auth/demo` `{role:"STUDENT"|"LIBRARIAN",scenario?:"ONBOARDING"}` → session fictive clairement signalée, seulement si DEMO_MODE=true ET NODE_ENV!=production; `{user,csrfToken}`. Le scénario ONBOARDING exige STUDENT et sélectionne exclusivement `demo:onboarding` (Samir Exemple, `inscription.demo@usmba.ac.ma`, CNE `R202400003`). Après vérification, la reconnexion ne demande aucun scan. Le lanceur E2E remet seulement cette fixture en état initial dans `library_test`, sans reset global. Jamais de rôle libre en production.
`GET /auth/google/nonce` → `{nonce,csrfToken}`; `POST /auth/google` `{credential,nonce}` Google ID token vérifié serveur.
`POST /auth/logout`.
`POST /onboarding/verify` `{studentNumber}` → vérification connecteur, pas confiance en l’OCR. Auth requise. Fournisseur officiel non configuré → 503 en production.
`POST /onboarding/review` `{reason,studentNumber?}` → demande de contrôle physique manuel enregistrée, sans activation automatique.
`GET /staff/identity-reviews` → `{items}` demandes de contrôle physique, LIBRARIAN avec `canManageUsers`.
`POST /staff/students/:id/verify` `{studentNumber,reason,physicalConfirmed:true}` → vérification physique justifiée et auditée; fournisseur `LIBRARIAN_REVIEW`, jamais présentée comme une vérification par l’API universitaire.

## Catalogue et étudiant

`GET /books?q=&category=&available=true&sort=title|recent|year&page=1&pageSize=12`.
`GET /books/:id`. Livre: `id,title,isbn,publisher,year,description,priceDh,coverColor,authors:[{id,name}],categories:[{id,name}],copies:[{id,barcode,status,condition}],availableCount,totalCount,loanedCount`.
`GET /categories` → `{items:[{id,name}]}`.
`POST /requests` `{bookId}` → demande avec réservation automatiquement acceptée ou refus motivé.
`GET /me/dashboard` → statistiques et échéances.
`GET /me/requests` → `{items}` avec book, reservation(copy,expiresAt,status).
`POST /requests/:id/cancel` (propriétaire étudiant).
`GET /me/loans` → `{items}` avec copy.book.
`GET /me/sanctions` → `{items}`.
`GET /me/recommendations` → `{items:[livres avec reason]}` méthode par catégories empruntées, aucun suivi externe.
`GET /notifications` et `POST /notifications/:id/read` (propriétaire).
`GET /acquisitions` (étudiant: les siennes; personnel: toutes), `POST /acquisitions` `{title,author,category,referenceUrl?,reason?}`.

## Bibliothécaire

Personnel = LIBRARIAN. Les opérations sensibles exigent les permissions explicites exposées dans la session.

`GET /staff/dashboard` → `{books,copies,available,reserved,loaned,overdue,damaged,lost,recentRequests,acquisitions}`.
`GET /staff/requests` → `{items}` avec student.user, book et reservation.copy.
`GET /staff/loans` → `{items}` avec student.user, copy.book.
`GET /staff/students?q=` → recherche de numéro étudiant exact ou nom (personnel seulement).
`POST /staff/reservations/:id/handover` `{studentNumber,barcode}` → Loan. Identité carte et exemplaire vérifiés côté serveur, réévaluation éligibilité, aucune remise étudiant.
`POST /staff/loans/:id/return` `{condition:"GOOD"|"DAMAGED"|"LOST",damageSeverity?:"MINOR"|"SEVERE"}` → Loan. Constat, sanctions, audit atomiques.
`POST /staff/books` et `PATCH /staff/books/:id` `{title,authors:string[],categories:string[],isbn?,publisher?,year?,description?,priceDh,coverColor?,archived?}`.
`POST /staff/books/:id/copies` `{count:1..50}` → `{items}` codes uniques générés.
`PATCH /staff/copies/:id` `{condition,status,reason}` contrôles circulation et audit.
`PATCH /staff/acquisitions/:id` `{status,comment?,bookId?}`; ACQUIRED exige une fiche avec exemplaire réel.
`GET /staff/sanctions` → `{items}`; `POST /staff/sanctions/:id/settle` `{reason}`; `POST /staff/sanctions/:id/revoke` `{reason}` avec `canRevokeSanctions`.
`GET /staff/settings`, `PATCH /staff/settings` `{maxLoans,loanDays,pickupHours,lateSuspensionDays,minorDamageDays}` avec `canManageSettings`.
`GET /staff/users` → `{items}`; `PATCH /staff/users/:id` `{active}` avec `canManageUsers`; aucune promotion HTTP.
`GET /staff/audit` → `{items}` avec `canViewAudit`.

## Règles critiques

Réservation/actif comptés ensemble dans la limite. Une demande acceptée n’est pas un emprunt. Verrouiller étudiant puis exemplaire en transaction; SKIP LOCKED pour choisir exemplaire disponible; contraintes partielles et trigger inter-table empêchent toute double affectation. Contraintes sur prix et délais positifs. Les expirations/rappels/retards tournent côté serveur chaque minute et sont idempotents; éligibilité vérifie aussi les dates de retour même avant le prochain job.

Retard = un événement par emprunt dépassé, Infraction(loanId,type) unique. 1er/2e: avertissement; 3e: suspension 7j et cycle remis à zéro; deuxième suspension de retard: interdiction permanente. Perte: prix >100 → 75%, sinon 100%. Dégât mineur: suspension 15j, grave: 50%. L’état DAMAGED ou LOST implique WITHDRAWN au retour. Aucun paiement bancaire simulé; règlement manuel audité, correction administrative motivée.
