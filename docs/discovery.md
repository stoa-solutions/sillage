# Découvrir — fonctionnement actuel

État relu dans le code le 28 octobre 2026. Le serveur sélectionne les contenus ; le Mac affiche les rayons, lance la lecture ou ajoute à la file. L’accueil « Pour toi » et la recherche explicite sont deux circuits distincts.

## Ce qu’est Découvrir

Un onglet consacré à ce que tu n’as jamais écouté. La barre latérale propose **Pour toi**, **Tes scènes** (tes genres précis les plus écoutés : digital cumbia, alternative R&B…) et **Tes artistes** (tes favoris puis les plus écoutés). Chaque rayon affiche ses artistes : un clic ouvre la page de l’artiste, d’où l’on repart vers ses voisins. « Retour » ramène au lieu précédent. Chercher dans tes playlists relève de Bibliothèque : la recherche de Découvrir ne montre que ce qui n’est pas chez toi.

Les titres d’un artiste viennent de **YouTube Music** (titres crédités à l’artiste, sans mix ni reprise), puis l’API YouTube vérifie chaque vidéo. Ils sont gardés une journée. SearXNG reste réservé à la recherche et au DJ.

## Une scène

Les artistes que MusicBrainz range dans ce genre et que tu n’as pas, avec leurs titres.

## Un artiste

Ses titres absents de ta bibliothèque, ses voisins d’écoute ListenBrainz, les artistes avec qui il a enregistré (MusicBrainz), puis un pas plus loin.

## Quand tu ouvres Découvrir

« Pour toi » cherche d’abord **des artistes que tu ne connais pas encore**, puis des titres neufs de tes propres artistes.

1. **Ton profil.** Le serveur relit toutes les vidéos de ta bibliothèque et de ton historique, avec leur nombre d’écoutes : artistes connus (nom et identifiant MusicBrainz), genres pondérés par les écoutes. Les points de départ sont les artistes de Mon goût, puis tes artistes les plus écoutés.
2. **Les voisins.** Pour chaque point de départ, il demande à ListenBrainz les artistes écoutés dans les mêmes sessions, jusqu’à remplir 6 rayons. Un artiste sans identifiant MusicBrainz est cherché par son nom (6 recherches par page au plus, mises en cache 30 jours). Beaucoup d’artistes confidentiels n’ont aucun voisin : ils sont passés. Tout artiste déjà présent dans ta bibliothèque ou ton historique est écarté, par identifiant comme par nom.
3. **Les titres.** Chaque voisin est cherché sur YouTube Music ; seuls les titres crédités à cet artiste sont gardés (une chaîne « X - Topic » d’un autre artiste ou un simple titre homonyme ne comptent pas), sans mix ni compilation, une version par chanson, la version studio avant les lives. Deux artistes par rayon, trois titres par artiste ; un voisin sans titre utilisable est remplacé.
4. **Artistes confidentiels.** Quand ListenBrainz ne connaît aucun voisin inconnu d’un artiste, Sillage regarde dans MusicBrainz, données libres et sourcées : d’abord les artistes qui ont enregistré avec lui (rayon « Avec X », par exemple Jäde ou Josman pour Squidji), sinon les artistes de son genre le plus précis (rayon « Scène digital cumbia » pour Acid Coco). Les genres trop larges (pop, hip hop…) ne font pas une scène. Au plus 8 requêtes MusicBrainz nouvelles par page ; les réponses sont gardées 30 jours. Wikidata a été évalué : trop peu renseigné pour ces artistes. LB Radio demande désormais un jeton ListenBrainz.
5. **Plus loin.** Les voisins des premières découvertes, pour sortir encore un peu de tes habitudes.
6. **Tes artistes.** Un dernier rayon propose des titres de tes artistes récents absents de ta bibliothèque.

YouTube bride le moteur de recherche après une rafale, et la recherche comme le DJ en pâtiraient. Une page fait donc au plus 10 recherches nouvelles et s’arrête après deux réponses vides ; la page d’un artiste est gardée une journée et ne coûte plus rien ensuite. La page se complète ainsi d’une visite à l’autre.

« D’autres propositions » tire d’autres voisins dans une réserve de 10. Le serveur garde la page 20 minutes par compte ; ListenBrainz est mis en cache une journée. Ce circuit n’appelle aucun modèle d’IA. Sans écoute ni bibliothèque, l’accueil invite à écouter quelques morceaux.

## La recherche (aussi utilisée par le DJ)

| Source choisie | Ce que fait le Mac |
| --- | --- |
| Mes playlists | Recherche hybride dans ta bibliothèque, avec filtre de playlist facultatif. |
| YouTube | Recherche dans le catalogue externe. |
| Partout | Bibliothèque **puis** YouTube, en deux étapes aujourd’hui. Le DJ peut effectuer ses recherches en parallèle ; l’écran Découvrir n’utilise pas encore cette optimisation. |

La recherche commence après **450 ms sans frappe**, à partir de deux caractères. Les réponses tardives d’une ancienne recherche ou d’un ancien compte sont ignorées. Le résultat de bibliothèque charge une première page de **25 titres** ; le bouton « Tout voir » déroule cette page, il ne charge pas toutes les pages de la bibliothèque. Les résultats YouTube disposent d’une pagination par jeton.

Le serveur utilise SearXNG privé pour trouver les vidéos lorsqu’il est configuré, sinon la recherche officielle YouTube. Il vérifie ensuite les vidéos via YouTube. Cela réduit l’usage de `search.list`, mais ne supprime pas tous les appels ni quotas Google. Les recherches publiques sont mises en cache cinq minutes ; l’appartenance à ta bibliothèque est recalculée pour ton compte, y compris lorsqu’un autre utilisateur a fait la même recherche.

La pagination externe dépend de la source : YouTube fournit un curseur, tandis que l’adaptateur SearXNG actuel retourne un premier lot de 50 vidéos au maximum, sans curseur de continuation. Dans ce cas, il faut affiner la recherche ; l’interface ne doit pas afficher une fausse page suivante.

## Ce que font les cartes

- **Écouter** lance le titre selon le contrat du lecteur ; ce n’est pas un enregistrement dans la bibliothèque.
- **À suivre** conserve le titre en cours et ajoute à la file de session.
- **Ajouter à ma bibliothèque** vérifie la vidéo et l’enregistre dans **Mes découvertes**, une collection privée Sillage, puis actualise la bibliothèque.
- Les tâches d’indexation texte et image sont programmées à l’ajout si les fonctions sont activées. MusicBrainz est ensuite traité progressivement par le worker pour les comptes activés.

Les métadonnées publiques d’une vidéo sont communes, mais les comptes ont leurs propres playlists et historique. Ajouter un morceau à Mes découvertes n’écrit rien dans une playlist YouTube : la connexion Google actuelle ne possède pas cette permission.

## Limites à améliorer en priorité

1. **Mieux apprendre les goûts.** `replaced` est actuellement un signal positif, même si l’utilisateur a changé très vite de morceau. L’historique ne contient pas encore la durée réellement écoutée. Il faudrait distinguer écoute appréciée, saut rapide et refus explicite.
2. **Retenir ce qui a déjà été proposé.** Une suggestion ignorée plusieurs fois devrait céder sa place ; « Moins comme ça » sur un artiste voisin reste à faire.
3. **Couvrir les artistes confidentiels.** ListenBrainz connaît mal certains artistes ; un repli par crédits ou label sourcé serait utile.
4. **Accélérer la recherche Partout.** Interroger bibliothèque et YouTube en parallèle, afficher chaque bloc dès sa réponse et permettre la vraie pagination des deux sources.
5. **Améliorer le départ sans historique.** Quelques artistes ou genres choisis une fois suffiraient pour un premier accueil utile.

Ces évolutions doivent conserver l’isolation des comptes et le design actuel. La pertinence se teste sur des scénarios réels : changement de source, fautes de frappe, artistes homonymes, titres déjà connus, absence de résultat d’une seule source et ajout sans interruption de la lecture.

## Carte du code

| Fichier | Responsabilité |
| --- | --- |
| `apps/macos/Sources/SillageMac/DiscoverView.swift` | Écran, barre latérale, rayons « Pour toi » et résultats. |
| `apps/macos/Sources/SillageMac/DiscoveryModel.swift` | Requêtes, annulation, pagination YouTube et cache d’accueil. |
| `apps/server/src/modules/discovery/controllers/discovery.controller.ts` | Routes, cache public de recherche, cache « Pour toi », vérification et ajout par compte. |
| `apps/server/src/modules/discovery/services/discovery-home.service.ts` | Profil d’écoute, voisins, rayons et exclusions de « Pour toi ». |
| `apps/server/src/integrations/listenbrainz/client.ts` | Artistes voisins ListenBrainz, avec cache d’une journée. |
| `apps/server/src/searxng.ts` | Recherche externe ; fichiers associés pour la vérification des vidéos. |
| `apps/server/src/musicbrainz/rollout.ts` | Activation progressive de l’enrichissement et compteurs. |

Contrats HTTP et parcours de connexion : [api.md](api.md). Architecture des comptes : [accounts.md](accounts.md).
