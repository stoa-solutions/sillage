# Distribution : état réel

Référence source : Sillage 1.8.0 (71), premier instantané public du code.

## Ce qui est fourni

Client SwiftUI, extension Chrome, API TypeScript / Hono, contrats, migrations et tests.
Le serveur intègre Gemini et Claude via AI SDK. Les clés personnelles sont gérées par compte.
L’application installée chez le développeur utilise une signature locale ; elle n’est pas un
installateur public Apple notarisé. Aucune clé ni session n’est incluse dans ce dépôt.

## Points à terminer pour une installation autonome

- Configurer PostgreSQL, OAuth Google, YouTube et le chiffrement des réglages avec des valeurs propres au déploiement.
- Remplacer les origines Stoa du lecteur WebKit et de la connexion Google dans le client ; elles ne sont pas encore centralisées dans une configuration de distribution.
- Recréer la configuration de déploiement et les secrets. La composition privée du serveur Stoa n’est volontairement pas publiée.
- Préparer un Developer ID Apple, la notarisation, les permissions OAuth et une vraie validation sur un second Mac vierge.
- Valider les limites de lecture YouTube, les quotas des fournisseurs et les conditions applicables à votre usage.

Une compilation réussie ne valide ni la connexion d’un nouvel utilisateur ni la disponibilité d’un clip YouTube.
Le mode Studio dépend de la disponibilité du média et des outils optionnels présents sur le Mac.

Les mises à jour automatiques Stoa sont désactivées dans le constructeur public. Une construction locale utilise `--skip-update-signature` ; ne pas distribuer cette archive comme mise à jour signée.
