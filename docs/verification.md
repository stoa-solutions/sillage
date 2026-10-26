# Première publication — vérifications

Le dépôt public démarre avec un historique neuf, sous l’identité Stoa. Les notes privées
d’exploitation, configurations de production, sessions, vidéos et bibliothèques personnelles
ne sont pas incluses.

Vérifié sur cette copie : installation npm, `npm run verify:node`, `npm run verify:macos`.
La CI conserve une base PostgreSQL jetable pour les tests d’intégration ; ce contrôle est distinct
des tests exécutés sans base locale.

Gitleaks 8.30.1 a signalé une occurrence dans la boucle de données fictives de
`apps/server/tests/accounts.integration.test.ts` (identifiants Alice/Bob). Revue : données de test,
pas un accès réel. Aucun résultat de scan ne constitue une garantie absolue de sécurité.

Les paroles des fixtures ont été remplacées par du texte synthétique. Les mises à jour Stoa
sont désactivées dans le constructeur public. Les tests de fournisseur sont simulés : ils ne
mesurent pas la qualité musicale de Gemini ou Claude.
