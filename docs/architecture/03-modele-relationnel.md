# Modèle relationnel PostgreSQL

Ce modèle est la spécification initiale. Le fichier `backend/prisma/schema.prisma` et les migrations SQL sont la définition exécutable ; toute différence finale doit être reflétée ici et dans le diagramme de classes. Les noms ci-dessous sont les identifiants techniques anglais ; les interfaces utilisateur emploient le français.

## Conventions et cardinalités

Les clés primaires sont UUID, sauf les paramètres singleton (`id = 'singleton'`). Les instants sont des DateTime Prisma sérialisés en ISO 8601 UTC ; la base utilise le type horodatage PostgreSQL produit par la migration. Les dates calculées sont toujours interprétées comme UTC côté serveur. Les prix et amendes utilisent `numeric(10,2)`. Les index sur FK fréquemment parcourues évitent les balayages complets. Les listes d'états sont des enums ou des CHECK contraints ; aucun état arbitraire issu du client n'est accepté.

| Table / modèle | Attributs principaux et contraintes | Relations |
| --- | --- | --- |
| User | id PK, googleSub UNIQUE nullable, email UNIQUE, name, role, active, createdAt, updatedAt | 0..1 Student ; 0..N Session, IdentityVerification, Notification |
| Student | id PK, userId UNIQUE FK, studentNumber UNIQUE nullable avant vérification, verified, lateCycle ≥ 0, suspensions ≥ 0 | N demandes, réservations, prêts, sanctions, acquisitions |
| IdentityVerification | id PK, userId FK, studentNumber, provider, status, verifiedAt?, createdAt | traces minimales, aucune image de carte |
| Session | id PK, userId FK, tokenHash UNIQUE, csrfToken, expiresAt, createdAt | session détruite/révoquée sans modifier le compte |
| AuthChallenge | id PK, tokenHash UNIQUE, nonceHash UNIQUE nullable, csrfToken, credentialHash UNIQUE nullable, expiresAt, usedAt?, createdAt | défi préauthentification et prévention de réutilisation |
| Book | id PK, isbn UNIQUE nullable, title, publisher?, year?, description, priceDh ≥ 0, coverUrl?, coverColor, archived, createdAt, updatedAt | auteurs et catégories N:N ; 0..N Copy |
| Author | id PK, name UNIQUE | N:N Book via table de jointure |
| Category | id PK, name UNIQUE | N:N Book via table de jointure |
| Copy | id PK, bookId FK, barcode UNIQUE, status, condition, createdAt | N Reservation et Loan historiques |
| BorrowRequest | id PK, studentId FK, bookId FK, status, reason?, createdAt | 0..1 Reservation |
| Reservation | id PK, requestId UNIQUE FK, studentId FK, copyId FK, status, expiresAt, createdAt | 0..1 Loan |
| Loan | id PK, reservationId UNIQUE FK nullable (historique importé), studentId FK, copyId FK, status, handedAt, dueAt, returnedAt? | N Infraction |
| Infraction | id PK, studentId FK, loanId FK, type, createdAt ; UNIQUE(loanId,type) | N Sanction ; une infraction par type et prêt |
| Sanction | id PK, studentId FK, infractionId FK nullable, type, status, amountDh?, startsAt, endsAt?, reason, createdAt | lien explicite à la cause ; historique conservé |
| Acquisition | id PK, studentId FK, title, author, category, referenceUrl?, reason?, status, comment?, bookId FK nullable, createdAt, updatedAt | origine étudiante, décision du personnel |
| Notification | id PK, userId FK, type, content, readAt?, dedupeKey UNIQUE nullable, createdAt | accès réservé au destinataire |
| AuditLog | id PK, userId FK nullable, action, entity, entityId?, details JSONB nullable, createdAt | acteur null pour tâche système |
| StatusHistory | id PK, entity, entityId, fromStatus?, toStatus, actorId?, reason?, createdAt | historique polymorphe contrôlé par service |
| LibrarySettings | id PK singleton, loanDays > 0, pickupHours > 0, maxLoans > 0, lateSuspensionDays > 0, minorDamageDays > 0 | paramètres versionnés par audit |

Les jointures Book–Author et Book–Category ont une PK composite sur les deux FK. Prisma peut générer les tables implicites équivalentes. La relation de profil User–Student exprime une composition logique sans nécessiter de sous-classe Bibliothecaire vide : le rôle du User représente le personnel.

## États persistés

| Type | Valeurs |
| --- | --- |
| Role | STUDENT, LIBRARIAN, ADMIN |
| CopyStatus | AVAILABLE, RESERVED, LOANED, WITHDRAWN |
| PhysicalCondition | GOOD, DAMAGED, LOST |
| RequestStatus | PENDING, ACCEPTED, REFUSED, EXPIRED, CANCELLED |
| ReservationStatus | ACTIVE, COLLECTED, EXPIRED, CANCELLED |
| LoanStatus | ACTIVE, OVERDUE, CLOSED |
| InfractionType | LATE, LOSS, DAMAGE_MINOR, DAMAGE_SEVERE |
| SanctionType | WARNING, SUSPENSION, BAN, FINE |
| SanctionStatus | ACTIVE, PAID, REVOKED |
| AcquisitionStatus | SUBMITTED, REVIEW, ACCEPTED, REFUSED, ACQUIRED |

Les libellés français d'affichage sont des traductions de ces valeurs, pas d'autres états concurrents.

## Contraintes de concurrence indispensables

Les index d’unicité de circulation sont créés par migration SQL complémentaire à Prisma ; l’unicité d’infraction est générée depuis le schéma :

```sql
CREATE UNIQUE INDEX "Reservation_one_active_per_copy"
ON "Reservation" ("copyId") WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "Loan_one_active_per_copy"
ON "Loan" ("copyId") WHERE "status" IN ('ACTIVE', 'OVERDUE');

CREATE UNIQUE INDEX "Infraction_loanId_type_key"
ON "Infraction" ("loanId", "type");
```

Les deux premiers index empêchent les doublons dans chaque table, mais ne suffisent pas à empêcher une réservation ACTIVE et un prêt non clos simultanés sur le même exemplaire. La migration implémente une garde intertables qui verrouille Copy avant les affectations et refuse le chevauchement. Des contraintes différées vérifient aussi la cohérence finale des statuts à COMMIT ; le détail exécutable se trouve dans la migration SQL et fait l’objet de tests de concurrence.

Les invariants de circulation vérifiés à la validation de transaction et les gardes métier sont les suivants :

- AVAILABLE : zéro réservation ACTIVE, zéro prêt non clos, condition GOOD.
- RESERVED : exactement une réservation ACTIVE, zéro prêt non clos, condition GOOD.
- LOANED : exactement un prêt non clos, zéro réservation ACTIVE.
- WITHDRAWN : zéro affectation active ; aucune réservation ou remise possible.
- Un prêt CLOSED possède une date de retour ; un prêt ACTIVE/OVERDUE n'en possède pas.
- Une échéance de prêt est postérieure à la remise (CHECK SQL). Une échéance de réservation est calculée par le service à partir d’une durée positive.
- Les FK d’une réservation active concordent avec son BorrowRequest accepté ; les FK d’un prêt actif concordent avec sa Reservation collectée quand ce lien existe (triggers SQL).

`handover` peut modifier d'abord la réservation, puis créer le prêt, puis le statut Copy : la vérification différée se déclenche à COMMIT pour accepter cet état intermédiaire temporaire dans la même transaction. Aucune lecture publique ne doit observer cet état incomplet.

## Transactions et verrouillage

`requestBorrow` verrouille Student, évalue sanctions et quota, puis choisit un Copy sain disponible via `FOR UPDATE SKIP LOCKED`. La création demande/réservation, les changements de statut, notification et audit sont dans une transaction. Le quota est lu après verrou pour sérialiser les demandes du même étudiant.

`handover` verrouille le profil étudiant et les ressources de circulation, revalide l'échéance et les droits, clôture la réservation ACTIVE puis crée le prêt. `returnLoan` verrouille le prêt/exemplaire, ferme le prêt et applique les infractions et sanctions une fois. Les jobs utilisent les mêmes verrous et clés d'idempotence. Un ordre de verrouillage stable réduit le risque de deadlock ; un conflit transactionnel doit être réessayé de manière bornée.

## Index de lecture et conservation

Index recommandés : Book(title), Book(isbn), Author(name), Category(name), Copy(bookId,status), BorrowRequest(studentId,createdAt), Reservation(status,expiresAt), Loan(studentId,status), Loan(status,dueAt), Notification(userId,readAt,createdAt), Sanction(studentId,status,endsAt), Acquisition(status,createdAt), AuditLog(createdAt).

Les références et historiques de circulation ne sont pas supprimés en cascade lors d'un archivage de livre. Les relations métier utilisent RESTRICT pour les suppressions destructrices. Les tables temporaires de Session peuvent être purgées à expiration. Une procédure distincte doit définir conservation/anonymisation des données avant exploitation réelle.
