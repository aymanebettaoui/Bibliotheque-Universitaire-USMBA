# Rôles, sécurité et protection des données

## Matrice d'autorisations

« Ses données » signifie une restriction serveur sur l'identifiant issu de la session, et non un filtre d'affichage facultatif.

| Opération | Public | STUDENT | LIBRARIAN | ADMIN |
| --- | --- | --- | --- | --- |
| Catalogue et détail sans emprunteur | Oui | Oui | Oui | Oui |
| Demander/réserver un ouvrage | Non | Oui, pour soi | Non | Non |
| Demandes, prêts et sanctions personnels | Non | Ses données | Via back-office | Via back-office |
| Notifications | Non | Ses données | Ses données | Ses données |
| Proposer une acquisition | Non | Oui | Non | Non |
| Étudier les propositions | Non | Non | Oui | Oui |
| Ajouter/archiver un livre, gérer exemplaires | Non | Non | Oui | Oui |
| Remise physique et retour | Non | Non | Oui | Oui |
| Consulter étudiants et sanctions | Non | Non | Oui | Oui |
| Enregistrer un règlement d'amende | Non | Non | Oui, motif obligatoire | Oui, motif obligatoire |
| Révoquer une sanction | Non | Non | Non | Oui, motif obligatoire |
| Paramètres, comptes et rôles | Non | Non | Non | Oui |
| Journal d'audit | Non | Non | Non | Oui |

Un administrateur garde les droits opérationnels du personnel. Le dernier administrateur actif ne peut pas être supprimé ou rétrogradé. Les changements de rôle ou désactivations invalident les sessions concernées.

## Authentification réelle et mode de démonstration

La production utilise Google Identity Services et la bibliothèque officielle `google-auth-library` côté serveur. `verifyIdToken` vérifie cryptographiquement le jeton ; la logique applicative contrôle ensuite issuer, audience, dates, sub, email vérifié et nonce. Le domaine étudiant est comparé exactement à `usmba.ac.ma`, et non à une sous-chaîne. Le champ `hd` du client n'est pas une preuve.

La session est un jeton opaque aléatoire, distinct du jeton Google. Son empreinte SHA-256 est conservée en base, pas sa valeur brute. Le cookie est HttpOnly, SameSite=Lax, `Secure` en production et limité à `/api`. La session expire après huit heures et la déconnexion supprime la session. Le chargement de chaque session revalide l'état du compte.

Un défi de préauthentification conserve nonce/jeton/CSRF sous forme contrôlée, une échéance et une marque d'utilisation. Il empêche la réutilisation d'un jeton de connexion dans le même mécanisme. Les défis expirés sont purgés par les jobs.

`POST /auth/demo` n'existe comme possibilité utilisable que lorsque `DEMO_MODE=true` et `NODE_ENV` n'est pas `production`. Il sélectionne des comptes fictifs prédéfinis, pas un email ni un rôle arbitraire à attribuer à un utilisateur réel. Le démarrage en production refuse la configuration démo. Les sessions de comptes `demo:*` sont également refusées lorsque le mode démo est désactivé, même si le cookie avait été émis auparavant. Les réponses authentifiées portent `Cache-Control: no-store`.

## Autorisations et mutations

Les middleware imposent la session et le rôle avant les endpoints protégés. Les endpoints personnels dérivent l'étudiant de la session. L'annulation de demande et la lecture de notification contrôlent la propriété et masquent les ressources absentes ou appartenant à un tiers.

Chaque mutation exige une origine exacte `APP_ORIGIN` et un jeton `X-CSRF-Token` associé à la session ou au défi de préauthentification. Le token s'obtient par `GET /api/auth/me`. CORS est limité à l'origine déclarée. Les entrées sont validées avec Zod ; Prisma et les requêtes SQL paramétrées empêchent l'interpolation d'entrées utilisateur dans le SQL.

Les opérations sensibles ont des limites de débit. Helmet configure les en-têtes de sécurité et les erreurs de production ne renvoient pas les stacks. React échappe le texte affiché. Les liens de référence sont restreints à HTTP(S). Les fichiers de couverture sont décodés et validés avant conservation selon les règles du routeur de couvertures ; aucune photo de carte n'est transmise comme couverture.

Ces protections doivent être revalidées dans votre configuration HTTPS/reverse proxy : les flags de cookie, origines et politiques du serveur frontal ne peuvent pas être prouvés par une compilation locale.

## Audit et corrections

Les modifications du catalogue, transitions de circulation, décisions d'acquisition, attributions de rôle, changements de paramètres et opérations sur sanctions créent des événements d'audit. `StatusHistory` conserve les états de circulation. Une correction ne supprime pas l'événement d'origine ; le motif et l'acteur restent disponibles.

Une amende peut être enregistrée comme réglée au guichet. Cela ne correspond pas à un appel bancaire. ADMIN peut révoquer une sanction active avec motif ; cette fonctionnalité permet la correction administrative, sans prétendre constituer un portail juridique complet de contestation.

## Données minimales

Le système conserve le nom, l'email universitaire, l'identifiant Google et le numéro universitaire nécessaires aux opérations. Les photos de cartes sont traitées temporairement dans le navigateur et ne sont pas stockées comme justificatifs durables. L'OCR ne suffit pas à activer un vrai compte ; le connecteur officiel non configuré refuse l'opération.

Les recommandations se fondent sur les catégories de l'historique privé des prêts de l'utilisateur ; aucun suivi publicitaire ni partage de cet historique n'est prévu. Les notifications sont internes.

Avant un usage institutionnel réel, définir les durées de conservation, procédures d'anonymisation, sauvegardes/restauration, habilitations de l'équipe et validation juridique au regard de la législation marocaine applicable. Cette documentation n'atteste ni d'une homologation universitaire ni d'une conformité juridique certifiée.
