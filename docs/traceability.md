# Traçabilité UML ↔ implémentation

Les quatre diagrammes sont identifiés U1 (cas d'utilisation), U2 (classes), U3 (activité d'emprunt), U4 (états exemplaire). Les services du diagramme U2 représentent des **modules TypeScript** exposant des fonctions, pas des tables Prisma ni des classes instanciées artificiellement.

Les chemins ci-dessous sont relatifs à la racine du projet. Les entrées externes non configurées sont signalées ; aucune présence dans le diagramme ne vaut preuve de validation d'une intégration externe.

| Fonction / UML | Modèles / transitions | Backend et endpoint principal | Frontend réel |
| --- | --- | --- | --- |
| Catalogue public (U1 Catalog) | Book, Author, Category, Copy | `repositories/catalogue.ts`, `routes/catalogue.ts` ; GET `/books`, `/books/:id`, `/categories` | `features/catalogue.tsx` : Catalogue `/`, BookDetail `/ouvrages/:id` |
| Connexion Google (U1 Login) | User, Session, AuthChallenge | `services/google.ts`, `routes/auth.ts`, `middleware/auth.ts` ; GET `/auth/google/nonce`, POST `/auth/google` | `features/auth.tsx` : Login `/connexion` ; accès Google à configurer |
| Sessions / déconnexion | Session → suppression ou expiration | `middleware/auth.ts`, `routes/auth.ts` ; GET `/auth/me`, POST `/auth/logout` | `app/context.tsx`, `services/api.ts`, navigation `app/App.tsx` |
| Rôles démo explicitement fictifs | User prédéfini, Session | `routes/auth.ts` ; POST `/auth/demo`, bloqué production | Login `/connexion`, bannière `app/App.tsx`, scénario ONBOARDING pour profil fictif non vérifié |
| Première vérification (U1 Verify/OCR) | Student, IdentityVerification | `routes/onboarding.ts`, `integrations/university.ts` ; POST `/onboarding/verify` | Onboarding `/verification`, caméra réelle et Tesseract.js dans `features/auth.tsx` |
| Fournisseur officiel | UniversityConnector | `UnconfiguredUniversityConnector` renvoie 503 ; interface réelle, accès officiel absent | Erreur explicite, aucun succès simulé pour vrai Google |
| Revue physique habilitée | IdentityVerification REVIEW_REQUESTED → RESOLVED ; Student.verified | `routes/onboarding.ts` ; POST `/onboarding/review`, GET `/staff/identity-reviews`, POST `/staff/students/:id/verify` ; `canManageUsers` | Onboarding `/verification`, gestion `/gestion/verifications` ; fournisseur LIBRARIAN_REVIEW |
| Demande automatique (U1 Request/Reserve, U3) | BorrowRequest PENDING → ACCEPTED ou REFUSED ; Reservation ACTIVE ; Copy AVAILABLE → RESERVED | `services/circulation.ts::requestBorrow`, `routes/circulation.ts` ; POST `/requests` | BookDetail, Requests `/demandes` |
| Annulation propriétaire (U4) | Reservation CANCELLED ; demande CANCELLED ; Copy RESERVED → AVAILABLE | `circulation.ts::cancelRequest` ; POST `/requests/:id/cancel` | Requests `/demandes` |
| Expiration autonome (U3/U4) | Reservation ACTIVE → EXPIRED ; demande EXPIRED ; Copy → AVAILABLE | `circulation.ts::expireReservations`, `jobs/scheduler.ts` ; aucune action navigateur requise | Statuts/échéances dans demandes et guichet |
| Remise physique (U1 Handover, U3/U4) | Reservation COLLECTED ; création Loan ACTIVE ; Copy RESERVED → LOANED | `circulation.ts::handover` ; POST `/staff/reservations/:id/handover` | Counter `/gestion/reservations`, champs numéro carte/code exemplaire |
| Retour physique (U1 Return, U3/U4) | Loan CLOSED ; Copy LOANED → AVAILABLE/WITHDRAWN selon condition | `circulation.ts::returnLoan` ; POST `/staff/loans/:id/return` | Counter `/gestion/emprunts` |
| Retards et sanctions (U1 Sanction) | Loan ACTIVE → OVERDUE ; Infraction unique ; Sanction | `circulation.ts::processOverdue`, `services/sanctions.ts::applyInfraction/resetExpiredLateCycle`, `jobs/scheduler.ts::resetExpiredLateCycles` | Loans `/emprunts`, Sanctions `/sanctions`, StaffSanctions `/gestion/sanctions` |
| Règlement/correction sanction | Sanction ACTIVE → PAID/REVOKED ; AuditLog | `services/management.ts::settleSanction` ; POST `/staff/sanctions/:id/settle`, `/staff/sanctions/:id/revoke` ; révocation avec `canRevokeSanctions` | StaffSanctions `/gestion/sanctions` ; aucun paiement bancaire |
| Livres et exemplaires (U1 Inventory) | Book archivable, Copy créé GOOD/AVAILABLE ; retrait/réparation explicite | `management.ts::saveBook/addCopies/updateCopy`, `routes/management.ts` ; `/staff/books`, `/staff/books/:id/copies`, `/staff/copies/:id` | Inventory `/gestion/catalogue` |
| Couverture réelle | Book.coverUrl ; fichier WebP réencodé | `routes/covers.ts` ; POST `/staff/books/:id/cover`, GET `/covers/:filename` | Inventory ; sélection de fichier valide |
| Propositions (U1 Propose/Review) | Acquisition SUBMITTED/REVIEW/ACCEPTED/REFUSED/ACQUIRED ; REFUSED → REVIEW autorisé | `services/student.ts::proposeAcquisition`, `management.ts::reviewAcquisition` ; `/acquisitions`, `/staff/acquisitions/:id` | Acquisitions `/acquisitions` et `/gestion/acquisitions` |
| Notifications | Notification.readAt, dedupeKey | `routes/student.ts`, services et `generateReminders` ; GET `/notifications`, POST `/notifications/:id/read` | Notifications `/notifications`, icône avec compteur |
| Recommandations explicables | Book, Category, Loan historique privé | `student.ts::recommendations` ; GET `/me/recommendations` | Recommendations `/recommandations` ; pas de suivi des consultations dans cette version |
| Tableaux de bord | Agrégats des tables persistantes | `student.ts::studentDashboard`, `management.ts::staffDashboard` ; `/me/dashboard`, `/staff/dashboard` | StudentDashboard `/espace`, StaffDashboard `/gestion` |
| Règles et comptes (U1 Settings) | LibrarySettings singleton, User, Session, permissions | `routes/management.ts`, `management.ts::updateUserActivation` ; `/staff/settings`, `/staff/users/:id` | Gestion `/gestion/parametres`, `/gestion/utilisateurs` |
| Audit (U1 Audit) | AuditLog, StatusHistory | Services transactionnels ; GET `/staff/audit` avec `canViewAudit` | Gestion `/gestion/audit` |
| Contraintes physiques (U4) | Copy, Reservation, Loan | `prisma/migrations/20261108000000_initial/migration.sql` : index partiels, garde intertables, contrainte différée | Erreurs API affichées, aucune protection reposant sur bouton masqué |

## Correspondance des noms

Les noms français du cahier des charges correspondent à `Utilisateur → User`, `Étudiant → Student`, `Bibliothécaire → User(role=LIBRARIAN)`, `Livre → Book`, `Auteur → Author`, `Genre → Category`, `Exemplaire → Copy`, `DemandeEmprunt → BorrowRequest`, `Réservation → Reservation`, `Emprunt → Loan`, `PropositionAcquisition → Acquisition`. `Bibliothecaire` est une vue métier du diagramme, sans table vide dédiée.

Le diagramme conserve l'état physique séparé de la circulation. Le retard concerne Loan.status, jamais une valeur supplémentaire de Copy.status. Une demande ACCEPTED peut rester ACCEPTED après remise, tandis que sa réservation passe COLLECTED et son prêt devient ACTIVE : ces trois objets décrivent des faits distincts.

## Écarts et extensions explicitement ouverts

- Google réel : code cryptographique présent, client OAuth et session réelle à configurer/valider avec l'établissement.
- Université officielle : interface fournie, fournisseur non configuré ; la revue administrative n'est pas une API officielle.
- Caméra/OCR : code réel, essais matériels et qualité sur vos cartes à exécuter.
- Recommandations : catégories des prêts historiques ; catégories simplement consultées non enregistrées.
- Comptabilité : montants et règlement manuel audités ; pas de passerelle de paiement.
- Déploiement institutionnel : sauvegardes, supervision, disponibilité et validation juridique à préparer.
- Interface navigateur : scénarios Playwright fournis, exécution navigateur non attestée dans cet environnement ; voir bilan de tests.
