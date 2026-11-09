# Analyse et décisions d'architecture

Ce document décrit la cible de conception initiale du projet. La matrice de traçabilité et le bilan des phases distinguent ensuite les éléments implémentés et vérifiés des intégrations à configurer. Les diagrammes ont été rédigés avant l'implémentation.

## Périmètre fonctionnel

La bibliothèque gère des ouvrages physiques. Le catalogue public expose les références, auteurs, catégories et disponibilités ; il n'expose aucune identité d'emprunteur et aucun fichier de livre numérique. La fiche bibliographique et l'exemplaire sont deux objets distincts. Chaque exemplaire possède un code unique, un état physique et un statut de circulation.

Deux rôles contrôlés côté serveur sont prévus. STUDENT gère exclusivement ses demandes, prêts, notifications et propositions. LIBRARIAN gère le catalogue, le guichet de remise/retour, les propositions et les règlements autorisés. Les comptes, paramètres, audits et corrections exceptionnelles exigent en plus une permission explicite du bibliothécaire. Le rôle d'un utilisateur n'est jamais accepté depuis un formulaire public.

La demande d'emprunt ordinaire est acceptée ou refusée automatiquement. Une acceptation bloque un exemplaire jusqu'à une date limite, sans créer de prêt. Le prêt naît lors de la remise physique confirmée par le personnel après vérification de l'étudiant et du code exemplaire. Le retour clôture le prêt, conserve l'historique et remet l'exemplaire en circulation uniquement si son état le permet.

## Exigences non fonctionnelles et critères d'acceptation

| Exigence | Critère observable |
| --- | --- |
| Persistance | Une demande et un prêt survivent au redémarrage du serveur et sont retrouvés en PostgreSQL. |
| Concurrence | Deux demandes simultanées ne peuvent recevoir le même exemplaire ; deux demandes du même étudiant ne dépassent pas son quota. |
| Isolation | Un étudiant ne peut ni lire ni modifier la ressource privée d'un autre, même en appelant directement l'API. |
| RBAC | Les endpoints du personnel répondent 403 à une session étudiant. |
| Authentification | Le serveur vérifie signature, issuer, audience, expiration, email_verified et domaine exact du jeton Google ; sub identifie le compte. |
| Sessions | Le navigateur reçoit un cookie HttpOnly, SameSite et Secure en production ; toute mutation authentifiée exige la protection CSRF. |
| Disponibilité | L'expiration des réservations, rappels et détection des retards s'exécutent côté serveur, sans navigateur ouvert. |
| Accessibilité | Navigation au clavier, libellés explicites, états de chargement/erreur et disposition adaptée au mobile. |
| Vérité fonctionnelle | Aucun contrôle n'annonce une action exécutée si l'API échoue ; toute intégration absente est indiquée. |
| Reproductibilité | Migrations, peuplement fictif, configuration exemple et commandes d'installation documentées. |
| Cohérence | Chaque cas d'utilisation est relié à une classe, un service, une table, un endpoint et une page. |

## Architecture des couches

Le frontend React/TypeScript/Vite communique uniquement avec les endpoints REST Express. TanStack Query gère l'état serveur, React Router les pages, React Hook Form et Zod la validation ergonomique. Cette validation ne remplace jamais la validation serveur.

Le backend reçoit les requêtes dans les routes/controllers, valide les entrées avec Zod et applique authentification, CSRF, limites de débit et RBAC dans les middleware. Les services orchestrent les règles métier et les transactions. Les repositories/Prisma réalisent les accès PostgreSQL. Les erreurs sont centralisées, avec message utile et sans fuite de secrets ou de stack en production.

Les jobs appellent les mêmes services métier que les endpoints. Les services d'identité universitaire et de recommandation sont des frontières remplaçables. L'OCR extrait uniquement du texte ; l'activation du profil reste une décision backend fondée sur le fournisseur universitaire configuré.

## Authentification et inscription

Google OIDC est la seule authentification de production. Aucun mot de passe n'est créé. Le paramètre frontend `hd` aide l'interface, mais le serveur valide l'adresse vérifiée et le domaine exact `usmba.ac.ma`. Le compte est associé au `sub` stable Google. Un personnel autorisé est préattribué administrativement ; la première authentification ne peut promouvoir un étudiant.

À la première connexion d'un étudiant, le profil reste non vérifié. Le navigateur demande la caméra réelle, capture une image temporaire et utilise un moteur OCR réel. Le numéro universitaire extrait doit être confirmé et transmis au serveur. Un OCR vide ou ambigu déclenche une nouvelle capture ou un traitement administratif ; il ne génère jamais de données plausibles fictives. Le flux caméra est arrêté lors de la capture, du changement de page et de l'abandon.

L'interface `UniversityConnector.verify(identity)` permet un fournisseur officiel futur. Sans accès officiel autorisé, la production reste non configurée et refuse l'activation automatique. Le fournisseur démo traite uniquement les profils fictifs connus et affiche « Vérification simulée — environnement de démonstration ». Les images de cartes ne sont pas conservées comme pièces d'identité.

## Dépendances externes et limites réelles

| Dépendance | Configuration requise | Comportement sans accès |
| --- | --- | --- |
| Google Identity Services | Client OAuth, origine autorisée et audience serveur | Authentification de production indisponible ; aucune fausse connexion Google. |
| PostgreSQL | URL de connexion et migrations | API de données indisponible ; pas de remplacement silencieux par mémoire/localStorage. |
| Université | Contrat API, accès et validation institutionnelle | Connecteur production non configuré ; mode démo explicitement fictif. |
| OCR | Bibliothèque et données linguistiques | Afficher erreur de lecture si moteur/image indisponible. |
| Caméra | HTTPS ou localhost, matériel et permission navigateur | Message d'erreur et possibilité de recommencer ; aucun flux simulé. |
| Email | Fournisseur externe non requis | Notifications internes uniquement, aucun email annoncé. |
| Paiement | Aucun prestataire bancaire prévu | Enregistrement administratif d'un règlement, aucune transaction bancaire annoncée. |

## Principaux risques et réponses

1. **Double affectation** : transaction PostgreSQL, verrou de l'exemplaire, unicités partielles et contrainte de cohérence entre réservation et prêt.
2. **Dépassement du quota** : verrouiller la ligne Student avant de compter réservations actives et prêts non clos ; même ordre de verrouillage dans les opérations concurrentes.
3. **Retard compté plusieurs fois** : unicité `(loanId, type)` des infractions et traitement idempotent des jobs.
4. **Privilèges publics** : aucune entrée publique de rôle ; bootstrap administratif explicite ; mutations du personnel journalisées.
5. **Compte activé sur OCR seul** : refuser l'activation production si le fournisseur universitaire n'est pas configuré.
6. **Fausse conformité universitaire** : les sanctions de démonstration sont les hypothèses du projet, pas un règlement officiel validé.
7. **Données sensibles** : profils minimaux, absence de stockage durable des photos, logs sans jetons, accès privé contrôlé. Une validation juridique reste nécessaire avant usage réel au regard du cadre marocain applicable.
8. **Jobs interrompus** : calculer à partir des échéances persistées et rattraper les événements dus au redémarrage ; dédupliquer les notifications.
9. **Diagrammes obsolètes** : mettre à jour sources PlantUML, SVG et traçabilité lorsque le code diffère ; ne pas déclarer la cible comme réalisée.

## Structure du monorepo

```text
library-management/
  frontend/
    src/
      app/               # routage et fournisseurs
      components/        # composants accessibles partagés
      features/          # auth, onboarding, catalogue, circulation, personnel
      hooks/
      services/          # client HTTP
      types/
      utils/
  backend/
    src/
      config/
      controllers/
      middleware/
      routes/
      services/
      repositories/
      integrations/
      jobs/
      tests/
    prisma/
      schema.prisma
      migrations/
      seed.ts
  docs/
    uml/                 # sources PlantUML et rendus SVG
    architecture/
    api/
  README.md
  docker-compose.yml
  .env.example
```

Les noms des dossiers peuvent être regroupés si une couche est très petite, à condition de conserver la séparation entre règles métier et transport HTTP. La matrice finale mentionne les chemins réels.
