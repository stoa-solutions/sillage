# Recall MixLab — essai isolé

Petit exécutable macOS utilisant **AudioKit 5.7.2**, épinglé dans son propre `Package.resolved`. Il n’est ni lié au paquet principal, ni inclus dans l’app installée. Aucune connexion, clé, préférence Recall ou donnée serveur n’est lue. Il ne capture pas le micro et rend les fichiers hors ligne, sans les jouer.

```sh
# Signaux synthétiques reproductibles : 44,1 et 48 kHz.
swift run --package-path apps/macos/Experiments/MixLab MixLab /tmp/recall-mix-demo

# Deux extraits WAV stéréo ou mono d’au moins 12 secondes.
swift run --package-path apps/macos/Experiments/MixLab MixLab /tmp/recall-mix-demo extrait-a.wav extrait-b.wav
```

Résultats : `cut.wav` (24 s), `fade.wav` (20 s) et `bassSwap.wav` (20 s), plus `results.json`. Les deux derniers superposent les extraits pendant quatre secondes. Les gains suivent une enveloppe cosinus/sinus ; le transfert de basses ajoute une atténuation progressive de 0 à −18 dB sous 180 Hz. Une réserve de volume fixe évite d’additionner deux pics à plein niveau. Ce pilote ne normalise pas la sonie et n’est pas un limiteur true peak.

Le contrôle exécute le vrai graphe AudioKit avec deux lecteurs et filtres. Il vérifie la puissance de l’enveloppe, les échantillons finis, les durées, l’absence de dépassement numérique et la présence d’énergie au début et à la fin. Les signaux synthétiques testent aussi la conversion de fréquence et l’atténuation effective des basses. Une sortie ne peut pas remplacer l’un de ses fichiers sources.

**Ce qui n’est pas intégré** : analyse BPM/mesures, ajustement du tempo, choix intelligent des points d’entrée/sortie, synchronisation de deux clips ou des paroles, commandes Next/pause pendant un mix, mode temps réel. Les fichiers rendus servent à comparer la technique ; ils ne prouvent pas encore un mix musical réussi entre des titres quelconques.

## Bibliothèque et licence

- [AudioKit](https://github.com/AudioKit/AudioKit/tree/5.7.2), licence MIT : utilisé comme dépendance SwiftPM, sans copier son code dans Recall.
- [Cookbook](https://github.com/AudioKit/Cookbook) : exemples officiels pour approfondir les effets et l’automation.
- Le paquet principal conserve uniquement Sparkle : retirer ce dossier retire tout le pilote. Les compilations et résultats générés sont ignorés par Git.

## Retour arrière

L’app installée reste la 1.7.3 (52). Aucun redémarrage ni migration n’est nécessaire pour cet essai. Une sauvegarde du paquet 1.7.3 est conservée avant toute intégration future. Le commit du pilote peut être annulé seul, indépendamment du correctif d’information sur les clips natifs. Aucun rollback de base ou de clé n’est requis.
