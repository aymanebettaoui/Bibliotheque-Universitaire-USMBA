# Diagrammes UML

Les sources ont été créées avant le code applicatif. Chaque fichier `.puml` possède un rendu `.svg` produit par PlantUML ; le diagramme et le modèle relationnel doivent évoluer avec le code.

| Source | Explication |
| --- | --- |
| `01-use-cases.puml` | Deux acteurs métier : Étudiant et Bibliothécaire. Le bibliothécaire porte les fonctions de gestion ; les fonctions sensibles indiquent l'habilitation supplémentaire requise. |
| `02-classes.puml` | Entités persistantes, cardinalités et services métier. `Role` contient uniquement STUDENT/LIBRARIAN, les permissions sensibles sont portées par `User`, et `Bibliothecaire` est une vue métier sans table dédiée. Le contrat de `cancelRequest` renvoie `{ok:Boolean}`. |
| `03-borrow-activity.puml` | Recherche, contrôles automatiques, refus, réservation, expiration, remise physique, retour et sanctions dans les couloirs Étudiant, Système et Bibliothécaire. |
| `04-copy-states.puml` | Machine de circulation AVAILABLE/RESERVED/LOANED/WITHDRAWN avec événements et gardes. Le retard appartient au prêt ; GOOD/DAMAGED/LOST restent un attribut physique séparé. |

Le fournisseur universitaire officiel est une interface à configurer, jamais une connexion présentée comme opérationnelle. Les opérations de cible qui restent à réaliser sont indiquées dans le bilan et la traçabilité ; la présence d'un cas d'utilisation n'atteste pas à elle seule d'une fonctionnalité disponible.

## Correspondance UML ↔ code

| Élément UML | Implémentation principale |
| --- | --- |
| Étudiant / Bibliothécaire | `User.role` et profil `Student` dans `backend/prisma/schema.prisma` ; guards dans `backend/src/middleware/auth.ts`. |
| Habilitations sensibles | Champs `canManageUsers`, `canManageSettings`, `canViewAudit`, `canRevokeSanctions` et middleware `requirePermission`. |
| Demande → réservation → remise → prêt → retour | `backend/src/services/circulation.ts` et routes `/requests`, `/staff/reservations`, `/staff/loans`. |
| États d'exemplaire | `Copy.status`, `Copy.condition`, contraintes PostgreSQL et historique `StatusHistory`. |
| Sanctions et infractions | `backend/src/services/sanctions.ts`, modèles `Infraction` et `Sanction`. |
| Proposition d'acquisition | `reviewAcquisition` dans `backend/src/services/management.ts`, dont `REFUSED → REVIEW`. |
| Vérification OCR / connecteur | `frontend/src/features/auth.tsx` et `backend/src/integrations/university.ts`. |

Pour régénérer après installation de Java et téléchargement du JAR officiel PlantUML :

```sh
java -jar plantuml.jar -tsvg docs/uml/*.puml
```

La commande doit réussir avant de remplacer les SVG livrés. Graphviz peut être nécessaire pour le diagramme de classes et de cas d'utilisation.
