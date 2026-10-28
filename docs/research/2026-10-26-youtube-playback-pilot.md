# Lecture YouTube — pilote du 25–26 octobre 2026

Décision finale : **aucun proxy ni partage de cookies activé dans la version 1.7.2**. Conserver la lecture immédiate existante, le cache Studio local et le design. Les travaux de service média distant n’ont pas été intégrés.

## Observations

- Sur ce Mac, yt-dlp 2026.10.21 (version stable GitHub vérifiée) et Deno 2.9.8 : Sunshine et Incapable échouaient sans cookies ni proxy avec une demande de vérification humaine.
- Fournisseur BgUtils 2.0.2, conteneur éphémère limité au loopback : trois échecs sur Sunshine, Incapable et Come Back to Earth. Le plugin était chargé, mais les clients étaient bloqués avant la génération du jeton. Conteneur arrêté après le pilote.
- Sunshine se lit dans le profil Chrome habituel ; lecture observée jusqu’à quatre secondes, puis arrêt du test. Aucun cookie exporté.
- Webshare : résolution réussie, puis récupération complète de Sunshine en 1080p H.264 + AAC. 7 479 769 octets, 172,57 secondes de média, 40,7 secondes de préparation. L’IP était stable pour cette récupération. Cela prouve ce clip et ce chemin réseau uniquement, pas une garantie générale ou un démarrage instantané.
- Le propriétaire a ensuite constaté qu’activer NordVPN débloquait la lecture et a demandé de ne pas activer Webshare. Aucun environnement Sillage de production n’a été modifié.

## Corrections retenues

Conserver les codes d’erreur du lecteur ; classer les erreurs du téléchargeur local sans exposer ses diagnostics bruts. Un problème de service ne consomme pas la file. Les signaux tardifs et doublons d’un échec n’entraînent pas plusieurs changements de titre. Un nouvel essai conserve le titre courant ; les demandes manuelles en cours restent utilisables.

## Références

- [yt-dlp : jetons de lecture](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
- [BgUtils POT Provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
- [yt-dlp : session YouTube et rotation des cookies](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies)
- [Chrome : permissions facultatives](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome : communication native](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

Les autorisations de navigateur peuvent être mémorisées ; les cookies ne sont pas valables à vie. Une éventuelle intégration ultérieure nécessite un nouveau choix produit et des essais réels. Les identifiants, cookies et clés du pilote ne figurent ni ici ni dans le dépôt.
