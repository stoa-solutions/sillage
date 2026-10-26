# Sillage pour Mac

Application SwiftUI, macOS 14+, Apple Silicon et Intel. La version de préparation 1.8.1 (72) dispose d’un DMG universel.

## Première utilisation

1. Glisser Sillage.app dans Applications depuis le DMG.
2. Ouvrir l’app et choisir « Continuer avec Google ».
3. Choisir Gemini ou Claude ; le lien « Obtenir une clé » ouvre le fournisseur. La vérification précède l’enregistrement chiffré de la clé sur son compte serveur.
4. Importer une playlist YouTube publique ou non répertoriée, ou rechercher un morceau.

Les appels au fournisseur utilisent son propre quota et peuvent être payants. La connexion Google ne donne pas accès aux playlists YouTube privées. La voix macOS est disponible avec Claude ; la disponibilité des clips YouTube n’est pas garantie.

## Développement

`npm run verify:macos` compile les vues, exécute les tests natifs et les règles de packaging. Les essais doivent utiliser un `RECALL_DATA_DIR` temporaire et un identifiant de bundle distinct ; ne pas partager la session d’une app habituelle.

[Distribution et validation Apple](distribution.md). Aucun certificat ou identifiant de notarisation n’est conservé dans le dépôt. Le DMG local n’est pas une version publique notarisée.
