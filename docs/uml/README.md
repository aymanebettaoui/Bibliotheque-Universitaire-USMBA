# Diagrammes UML

Les sources ont été créées avant le code applicatif. Chaque fichier `.puml` possède un rendu `.svg` produit par PlantUML ; le diagramme et le modèle relationnel doivent évoluer avec le code.

| Source | Explication |
| --- | --- |
| `01-use-cases.puml` | Acteurs, catalogue public, inscription, emprunt incluant demande/réservation et remise physique ; sanctions comme extension conditionnelle du retour. Le personnel hérite de la consultation publique, ADMIN des fonctions du bibliothécaire. |
| `02-classes.puml` | Entités persistantes avec attributs typés et visibilités, cardinalités et services métier. Student est un profil lié à User ; le personnel est représenté par le rôle. Les méthodes sont portées par les services qui orchestrent les transactions. |
| `03-borrow-activity.puml` | Recherche, contrôles automatiques, refus, réservation, expiration, remise physique, retour et sanctions dans les couloirs Étudiant, Système et Bibliothécaire. |
| `04-copy-states.puml` | Machine de circulation AVAILABLE/RESERVED/LOANED/WITHDRAWN avec événements et gardes. Le retard appartient au prêt ; GOOD/DAMAGED/LOST restent un attribut physique séparé. |

Le fournisseur universitaire officiel est une interface à configurer, jamais une connexion présentée comme opérationnelle. Les opérations de cible qui restent à réaliser sont indiquées dans le bilan et la traçabilité ; la présence d'un cas d'utilisation n'atteste pas à elle seule d'une fonctionnalité disponible.

Pour régénérer après installation de Java et téléchargement du JAR officiel PlantUML :

```sh
java -jar plantuml.jar -tsvg docs/uml/*.puml
```

La commande doit réussir avant de remplacer les SVG livrés. Graphviz peut être nécessaire pour le diagramme de classes et de cas d'utilisation.
