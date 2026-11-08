# Règles métier et invariants

Les règles ci-dessous constituent les hypothèses du projet universitaire. Elles ne doivent pas être présentées comme le règlement officiel de l'USMBA sans validation de l'établissement.

## Identités

- Une identité Google est unique par `sub`. L'email universitaire vérifié doit appartenir exactement au domaine `usmba.ac.ma` pour une inscription étudiant.
- Un profil Student est associé à un seul User et son numéro universitaire est unique.
- L'OCR est une extraction, jamais une preuve autonome d'identité. Le fournisseur universitaire détermine la vérification.
- Un étudiant ne peut modifier ni son rôle ni son statut de vérification.
- Un compte désactivé ne peut plus effectuer d'opérations protégées, même si une session antérieure existe.

## Catalogue et inventaire

- Un Book contient les métadonnées bibliographiques, plusieurs Author, plusieurs Category et zéro à plusieurs Copy.
- Chaque Copy a un code-barres unique. `status` exprime la circulation ; `condition` exprime l'état physique.
- Un exemplaire DAMAGED ou LOST ne peut être réservé ou remis.
- Un livre archivé n'est plus proposé à l'emprunt ; son historique est conservé.
- Aucun catalogue public ou détail d'exemplaire n'expose l'emprunteur.
- Les prix sont des montants décimaux positifs en DH ; jamais des flottants binaires pour la persistance financière.

## Demande et réservation

L'ordre de contrôle côté serveur est le suivant : session valide ; rôle étudiant ; compte actif ; profil vérifié ; absence de bannissement ou suspension en cours ; quota disponible ; ouvrage actif ; absence de demande active incompatible ; exemplaire GOOD et AVAILABLE.

Le quota compte **prêts non terminés + réservations actives**. Cela empêche la réservation massive d'exemplaires en attendant la remise physique. Une réservation expirée n'occupe plus le quota après son traitement serveur ; le service peut exécuter le rattrapage des expirations avant la vérification.

Une demande est créée puis résolue automatiquement dans la transaction. En cas de refus métier, la demande REFUSED et son motif sont persistés et notifiés. Une entrée malformée ou un accès non autorisé est une erreur HTTP et ne doit pas être présenté comme une demande métier ordinaire.

L'acceptation crée une Reservation ACTIVE, fixe `expiresAt = maintenant + pickupHours` et passe Copy de AVAILABLE à RESERVED. Aucun Loan n'est créé à ce stade. Les identifiants et dates sont produits côté serveur.

Concurrence : verrou Student d'abord, puis verrou Copy, puis écritures. La recherche utilise `FOR UPDATE SKIP LOCKED` afin que deux étudiants obtiennent deux exemplaires différents s'ils existent. Les contraintes PostgreSQL restent une seconde ligne de défense. Les conflits de sérialisation doivent être réessayés de façon bornée ou retournés clairement comme conflit, jamais transformés en succès.

## Guichet et prêt

La remise requiert un acteur LIBRARIAN/ADMIN, une réservation ACTIVE non expirée, le code de l'exemplaire attendu et l'identifiant de l'étudiant présenté. Le personnel vérifie visuellement la carte physique. Les contrôles d'état et de sanctions sont revalidés au moment de la remise.

La transaction passe Reservation à COLLECTED, crée Loan ACTIVE avec `handedAt = maintenant` et `dueAt = handedAt + loanDays`, et passe Copy à LOANED. Il ne peut exister qu'un Loan non clos par Copy et qu'un Loan par Reservation. Deux confirmations de remise ne créent pas deux prêts.

L'annulation d'une réservation ou son expiration libère Copy si l'exemplaire est sain, clôture l'occupation, met à jour la demande et notifie l'étudiant. Une réservation COLLECTED ne peut plus être annulée ni expirée.

## Retour et retards

Un retour est réservé au personnel. Il porte sur un prêt non terminé et enregistre son état physique. La date réelle de retour ne provient pas d'une date arbitraire choisie par l'étudiant. Un Loan CLOSED reste dans la base et ne peut être retourné une seconde fois.

Un retard existe dès que `now > dueAt` et que le prêt n'a pas été retourné à temps. Le job ou le retour constate une unique infraction LATE pour le prêt. La contrainte `(loanId, type)` et la transaction empêchent le double comptage entre job et retour. Le passage à OVERDUE n'altère pas Copy.status, qui reste LOANED.

Au retour, Loan passe CLOSED ; Copy passe AVAILABLE si `condition = GOOD`, sinon WITHDRAWN. Une réparation ultérieure est une opération explicite du personnel, justifiée et journalisée.

## Sanctions de démonstration

| Événement | Effet |
| --- | --- |
| Premier retard du cycle | Avertissement / infraction conservée ; aucune suspension. |
| Deuxième retard du cycle | Avertissement / infraction conservée ; aucune suspension. |
| Troisième retard du cycle | Suspension de 7 jours ; compteur maintenu à trois pendant la suspension puis remis à zéro à son échéance, historique conservé. |
| Deuxième suspension pour retard | Interdiction définitive d'emprunt. |
| Perte, prix > 100 DH | Amende de 75 % du prix. |
| Perte, prix ≤ 100 DH | Amende de 100 % du prix. |
| Détérioration légère | Suspension de 15 jours. |
| Détérioration grave | Amende de 50 % du prix ; exemplaire retiré. |

Les durées et limites d’emprunt sont paramétrables par ADMIN. Le seuil de trois retards et le calcul des montants constituent les règles métier explicites de cette version ; leur modification exige une évolution du service et de ses tests. Le système distingue un compteur de cycle et l’historique des suspensions. Pendant la suspension pour retard, les autres retards de prêts déjà actifs sont historisés avec avertissement, sans démarrer un nouveau cycle ni appliquer une deuxième suspension. À l’échéance — ou après révocation administrative de cette suspension — le job remet le compteur à zéro de manière idempotente. Le traitement d’un nouveau retard effectue aussi ce rattrapage si le job n’a pas encore tourné. Le traitement d’une infraction produit un événement unique et une notification dédupliquée.

Les cycles et débuts de sanction sont calculés à la date du constat serveur (job ou retour), et non rétroactivement à la seule date d’échéance. Après une interruption du serveur, le rattrapage historise les événements au moment de leur traitement. Cette convention de démonstration est explicite et doit être validée avec l’établissement.

Les montants sont arrondis au centime. Un règlement enregistré par le personnel passe une amende ACTIVE à PAID et crée une entrée d'audit. Il ne simule pas un paiement bancaire. Une correction exceptionnelle ADMIN exige un motif, conserve la sanction et la passe à REVOKED ; les événements d'origine restent auditables. Une correction ne doit jamais supprimer silencieusement l'historique.

## Propositions et recommandations

Une proposition passe de SUBMITTED à REVIEW, ACCEPTED ou REFUSED selon les transitions autorisées. ACCEPTED signifie « en attente d'acquisition », pas « acheté ». Le statut ACQUIRED requiert une fiche et des exemplaires effectivement créés et contrôlés ; sinon il reste indisponible dans l'interface. Une modification du personnel informe l'étudiant.

Des recommandations explicables utilisent les catégories consultées ou empruntées et les livres similaires. Le motif est affiché. Ce mécanisme est un classement de pertinence transparent, pas une intelligence artificielle avancée. Les préférences privées ne sont pas divulguées aux autres étudiants.

## Jobs, notifications et audit

Les tâches serveur expirent les réservations, détectent les retards, préparent les rappels d'échéance et de récupération. Leur exécution ne dépend pas d'un navigateur. Elles sont idempotentes : unicité d'infraction et clé de déduplication des notifications.

Les notifications sont internes : destinataire, type, contenu, date et statut de lecture. Un endpoint de lecture vérifie le destinataire. Aucun email n'est annoncé sans service configuré.

Les opérations du personnel et changements de statut sensibles conservent acteur, action, type/id de ressource, date et détails minimaux. Les logs n'enregistrent pas les jetons Google, cookies, photos de carte ou secrets.
