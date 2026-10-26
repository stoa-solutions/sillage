# Pilote du connecteur Google AI SDK

Essai indépendant du serveur, sans clé ni réseau vers un fournisseur. Il teste le SDK réel avec un transport Google synthétique. Aucun jugement de qualité d’un modèle n’en découle.

Avec Node 24, depuis ce dossier :

```sh
npm ci --ignore-scripts --no-audit --no-fund
node pilot.mjs
```

Résultat attendu : quatre cas `passed: true` — aller-retour outil et signature, réponse naturelle, absence de relance cachée sur 429, annulation. Dépendances et verrou séparés ; ne pas les ajouter au serveur avant le comparatif réel décrit dans la recherche.
