# Sillage — AI SDK et fournisseurs personnels

## Périmètre accepté

Suite à l’audit d’ouverture du 26 octobre, remplacer le transport IA artisanal par un package reconnu : AI SDK de Vercel, avec les connecteurs directs Google et Anthropic. Aucun hébergement Vercel requis. Premier lot de l’ouverture : ne pas publier le dépôt, choisir une licence, annoncer une application notariée ni lancer une bêta publique dans ce lot.

## Comportements attendus

1. Conserver la clé Gemini et le modèle choisi à la migration, notamment gemini-3.8-flash. Aucun basculement silencieux vers un autre fournisseur, modèle facturé ou quota. Les anciennes requêtes sans provider restent Google.
2. Proposer Gemini et Claude avec clé personnelle propre à chaque compte. Changer de fournisseur conserve la clé et le modèle de l’autre. Remplacer, tester ou supprimer une clé agit uniquement sur le fournisseur explicite ; la suppression globale historique reste possible via `{}`.
3. Le Mac propose fournisseur et modèle dans l’accueil et Réglages, obtention de clé, test et enregistrement. Vérifier avant remplacement ; ne pas annoncer de clé ou d’appels gratuits. L’accès au compte reste Google OAuth, indépendant du fournisseur IA.
4. Claude utilise la voix macOS et ne demande ni n’appelle une clé Google. Gemini conserve la voix cloud optionnelle et le repli local.
5. Conserver les outils MCP existants, la recherche et la composition, les vérifications de propriété et d’identifiants, le plafond de cinq tours et les limites existantes. Le SDK effectue un seul tour de transport ; le DJ exécute ses outils. Préserver les métadonnées opaques du fournisseur entre appels.
6. Annulation transmise au transport, zéro retry SDK caché, erreurs sûres sans clé ni corps d’erreur fournisseur ; les erreurs ne changent pas la lecture. La configuration globale compatible OpenAI reste disponible pour les anciens déploiements.
7. Contrats Swagger/Postman, documentation de compte et Mac, changelog et notes Obsidian suivent l’implémentation. Clés chiffrées côté serveur ; jamais incluses dans le build, le statut ou l’export.

## Frontières de test confirmées par Samuel

- API de configuration : conservation, migration, suppression et isolation des clés ; aucune évaluation du modèle réel.
- Demandes DJ : serveur et SDK réels devant réponses HTTP Google/Claude simulées ; outils, erreurs et validation de sélection, sans juger la qualité musicale.
- App Mac : parcours fournisseur, modèle, clé et voix macOS dans une instance QA séparée ; données et connexion de Samuel préservées.

## Références

- Revue depuis c99424e, dernière main avant ce lot, point confirmé par Samuel.
- Architecture : le SDK et ses connecteurs restent dans apps/server ; packages/core ne contient que les contrats et le catalogue. Les clients utilisent HTTP.
- Tests reproductibles et limites : postman/simulations/ai-providers.context.md.
- Audit initial : docs/research/2026-10-26-open-source-readiness.md.


## Recette et revue du 26 octobre

Instance native QA distincte (`solutions.stoa.sillage.ai-qa`), données jetables via RECALL_DATA_DIR : activation Claude depuis l’accueil, ajout Gemini, retour Claude avec clé conservée, affichage Voix macOS, retrait de la clé factice Claude, redémarrage et réactivation Gemini depuis l’accueil sans nouvelle saisie. Aucun accès à la bibliothèque ou aux clés de Samuel pendant cette recette.

Revue Standards et Spec indépendantes : la réactivation du secret global du compte historique après suppression, le contrôle de son ancien transport et la reprise de clé conservée à l’accueil ont été corrigés. L’état historique est désormais explicite ; enregistrer une configuration personnelle le quitte et aucune suppression ne le réactive. Régressions HTTP sur transport Google natif et compatible historique. Les relectures ciblées ne signalent plus de point ouvert.

Les contrôles de fournisseurs restent synthétiques. Ni les droits d’une clé Claude réelle, ni la qualité musicale comparative, ni une distribution publique notariée ne sont démontrés par ces tests.
