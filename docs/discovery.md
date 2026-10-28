# Découvrir — fonctionnement actuel

État relu dans le code le 26 octobre 2026. Le serveur sélectionne les contenus ; le Mac affiche les cartes, lance la lecture ou ajoute à la file. L’accueil et la recherche explicite sont deux circuits distincts.

## Quand tu ouvres Découvrir

1. Le serveur relit les **80 dernières écoutes** de ton compte.
2. Parmi les 20 plus récentes marquées `finished` ou `replaced`, il extrait jusqu’à **3 pistes de recherche** : genre MusicBrainz certain si disponible, puis artiste crédité ou chaîne YouTube.
3. Il cherche ces pistes en parallèle, écarte les vidéos déjà dans ta bibliothèque et celles des 80 dernières écoutes, ainsi que les doublons de titre et certains contenus parasites.
4. Il entrelace jusqu’à **12 suggestions**, avec une raison telle que « Parce que tu as écouté… ».

Ce circuit n’appelle pas Gemini et ne fabrique pas une playlist via un modèle. C’est une sélection par règles sur des métadonnées et ton historique. Les genres d’un artiste sont un indice lorsque le morceau n’a pas son propre genre ; ils ne garantissent pas le style de chaque titre.

Le Mac conserve l’accueil en mémoire **5 minutes**. « Actualiser » force le rafraîchissement. Sans historique exploitable, il invite à écouter quelques morceaux ; il n’existe pas encore de sélection initiale de goûts à l’inscription.

## Quand tu saisis une recherche

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
2. **Faire découvrir d’autres artistes.** Le mélange actuel peut favoriser le même artiste et des genres trop larges. Ajouter une mesure de diversité et une exclusion plus durable des titres déjà proposés serait plus utile qu’un simple accroissement du nombre de cartes.
3. **Rendre l’intention visible.** Trois directions simples : « Proche de mes goûts », « Artistes voisins », « Surprends-moi », avec une raison courte et « Moins comme ça ». Ce sont des propositions, pas des fonctions déjà présentes.
4. **Accélérer la recherche Partout.** Interroger bibliothèque et YouTube en parallèle, afficher chaque bloc dès sa réponse et permettre la vraie pagination des deux sources.
5. **Améliorer le départ sans historique.** Quelques artistes ou genres choisis une fois suffiraient pour un premier accueil utile.

Ces évolutions doivent conserver l’isolation des comptes et le design actuel. La pertinence se teste sur des scénarios réels : changement de source, fautes de frappe, artistes homonymes, titres déjà connus, absence de résultat d’une seule source et ajout sans interruption de la lecture.

## Carte du code

| Fichier | Responsabilité |
| --- | --- |
| `apps/macos/Sources/SillageMac/DiscoverView.swift` | Écran, sections et actions de carte. |
| `apps/macos/Sources/SillageMac/DiscoveryModel.swift` | Requêtes, annulation, pagination YouTube et cache d’accueil. |
| `apps/server/src/discovery.ts` | Routes, cache public de recherche, vérification et ajout par compte. |
| `apps/server/src/discovery-home.ts` | Historique, pistes de recherche et sélection de suggestions. |
| `apps/server/src/searxng.ts` | Recherche externe ; fichiers associés pour la vérification des vidéos. |
| `apps/server/src/musicbrainz/rollout.ts` | Activation progressive de l’enrichissement et compteurs. |

Contrats HTTP et parcours de connexion : [api.md](api.md). Architecture des comptes : [accounts.md](accounts.md).
