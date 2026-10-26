# Modèles IA — contrats natifs

But : exécuter le vrai serveur Sillage et AI SDK devant les protocoles HTTP natifs Google et Anthropic. Aucun modèle réel, aucune clé réelle, aucun appel externe.

Sources de contrat : https://ai.google.dev/api/generate-content et https://platform.claude.com/docs/en/api/messages ; adaptateurs épinglés dans apps/server/package.json. Google renvoie functionCall/thoughtSignature, Anthropic tool_use/tool_result. Les clés factices distinctes sont vérifiées par chaque mock.

Lancer : `postman simulation run postman/simulations/ai-providers.sim.yaml --port 4917 --output ndjson`. Puis, sur une base PostgreSQL jetable dont le nom finit par `_test`, `AI_SIMULATION_URL=http://127.0.0.1:4917 TEST_DATABASE_URL=… npx vitest run apps/server/tests/ai-settings.integration.test.ts`.

Membres : `/google/v1beta/models/:model:generateContent` et `/anthropic/v1/messages`. Un contrôle historique compatible est aussi servi sur `/google/v1/chat/completions`. Un endpoint inconnu renvoie 501. Clé incorrecte : 401. Le marqueur SIMULATE_NATIVE produit un appel music_search puis une sélection issue de son résultat ; la signature Google et la corrélation des identifiants Anthropic sont contrôlées. SIMULATE_QUOTA renvoie 429, sans nouvelle tentative SDK.

Observé le 26 octobre 2026 : les deux membres ont reçu les demandes réelles du serveur ; configurations isolées, passage entre clés enregistrées, suppression ciblée, migration Gemini rejouée, outils MCP et sélection vérifiée passent. Ce test ne valide ni la qualité musicale ni les droits/quota d’une véritable clé. La voix cloud existante reste un flux séparé ; Claude utilise la voix macOS.
