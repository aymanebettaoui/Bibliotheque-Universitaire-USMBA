# Bilan de réalisation par phase

Date : 9 novembre 2026. Ce document distingue les fichiers implémentés et les validations réellement exécutées. Le projet livré est local, exécutable après installation/configuration ; il ne constitue pas une mise en production universitaire validée.

| Phase | Réalisations et fichiers principaux | Commandes et validation | Limites / état |
| --- | --- | --- | --- |
| 1 — Analyse/conception | `docs/architecture`, quatre `.puml` et quatre `.svg`, modèle PostgreSQL, endpoints et matrice de traçabilité | PlantUML officiel : rendu réussi, XML valides ; comparaison au schéma réel | Conception livrée ; extensions externes explicitement signalées. |
| 2 — Architecture | Monorepo npm, React/Vite/TS, Express/Prisma, PostgreSQL16, `docker-compose.yml`, `.env.example`, schema et migration SQL | `npm ci`, `db:generate`, `db:migrate`, `db:seed`, `typecheck`, `build` | Installation, migration/peuplement, types et builds validés ; configuration locale reproductible. |
| 3 — Authentification | GIS, vérification Google, sessions opaques/CSRF, nonce à usage unique, RBAC, provision personnel | 26 tests auth réussis ; rejet réel d’un JWT malformé | **Intégration externe non validée** : aucun Client ID/compte réel fourni. Phase non déclarée entièrement terminée. |
| 4 — Inscription | `features/auth.tsx`, caméra/Tesseract, connecteur explicite, fixture ONBOARDING reproductible et revue physique habilitée | Tests serveur, OCR réel et parcours import OCR Playwright réussi | **Partielle** : API officielle absente ; caméra matérielle non exercée ici. |
| 5 — Catalogue | Recherche, filtres/tri/pagination, fiches et exemplaires publics, back-office et couverture validée | Suites HTTP12 et gestion5 réussies, dont couverture réellement réencodée | Contrôle visuel navigateur à réaliser. |
| 6 — Emprunts | `services/circulation.ts`, demandes atomiques, réservation, annulation, expiration, remise, retour ; contraintes PostgreSQL | 31 tests circulation et parcours Playwright complet réussis | Fonctionnel côté serveur et dans Chromium sur la base isolée. |
| 7 — Gestion bibliothécaire | Inventaire, retards/sanctions, acquisition, paramètres, comptes/audit et permissions explicites | Suites métier, HTTP, permissions et parcours navigateur réussis | Pas de paiement bancaire ; revue physique distincte d'une vérification officielle. |
| 8 — Compléments | Notifications internes, jobs serveur, recommandations par catégories d'emprunts, statistiques et historique | Déduplication/idempotence, notifications et listes validées par suites serveur | Catégories seulement consultées non suivies ; aucun email externe. |
| 9 — Validation/documentation | README Windows, API, sécurité, configuration, UML/code, tests automatisés et scénarios Playwright | Bilan final ci-dessous | **Partielle** : validations Google réel, caméra matérielle et production institutionnelle restent ouvertes. |

## Résultats globaux

- `npm test` : **74/74 réussis** sur PostgreSQL réel isolé, exécution séquentielle, 24,29 s (auth 26, circulation 31, HTTP 12, gestion 5).
- `npm run typecheck` : backend et frontend réussis.
- OCR réel : `npm run test:ocr` réussi, `R202400003`, confiance 92 ; import OCR Playwright réussi ; caméra matérielle non testée.
- Base de tests et copie restaurée : réconciliation, baseline et migration de rôle exécutés ; conservation des identifiants, identités Google et audits, puis conversion de l'ancien compte `ADMIN` validée.
- Base locale principale : sauvegarde restaurée et vérifiée, réconciliation appliquée, baseline Prisma enregistré et trois migrations à jour ; identifiants métier et Google conservés.
- UML : 4 sources et 4 SVG, rendu PlantUML 1.2026.8/Smetana réussi, XML valides.
- Builds finaux backend et frontend : réussis, TypeScript et Vite inclus.
- Playwright Chromium : **4/4 réussis en 48,6 secondes** sur les ports isolés 5174/3002 et `library_test`.
- Google réel, connecteur officiel et caméra matérielle : **non validés**, limites détaillées dans `testing.md`.

Les validations API ne sont pas présentées comme une validation de tous les écrans ou services externes.

## Ajustements du modèle pendant l'implémentation

- Ajout `AuthChallenge` pour CSRF/nonce préauth et prévention de réutilisation.
- `googleSub` et `studentNumber` sont nullables avant l'association/vérification ; ils restent uniques quand renseignés.
- Couverture réelle : `Book.coverUrl` et `coverColor`.
- `Loan.reservationId` nullable pour données historiques importées ; le parcours de remise normal crée toujours le lien.
- `Infraction(loanId,type)` unique permet retard et incident distincts sur le même prêt sans double compter chaque type.
- `AuditLog` utilise `userId` et `entity` ; `StatusHistory` utilise `entity` et `actorId`.
- `LibrarySettings` est le singleton `singleton` et expose les cinq limites/durées effectivement paramétrables. Le seuil de trois retards et les taux financiers sont codifiés dans cette version. Le compteur reste à trois pendant la suspension pour retard et est réinitialisé après son échéance (ou révocation) ; les retards supplémentaires pendant la suspension sont historisés sans ouvrir un nouveau cycle.
- Les méthodes du diagramme sont les exports réels des modules de service ; le connecteur réel porte le nom `UniversityConnector`.
- La remise reste une action de personnel ; le diagramme de circulation n'autorise pas le retrait direct d'un exemplaire déjà affecté.

Les sources et SVG ont été régénérés après alignement. Toute extension future doit maintenir cette correspondance.

## À prévoir avant usage institutionnel

Configurer Google, intégrer un fournisseur universitaire autorisé ou formaliser la procédure de contrôle physique, exercer la caméra et l'OCR sur les cartes réelles, valider les règles de sanctions avec l'établissement et préparer HTTPS, sauvegardes/restauration, conservation des données et exploitation du serveur. Aucun de ces accès ou validations n'est prétendu fourni par le mode fictif.
