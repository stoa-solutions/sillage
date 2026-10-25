# Recall — vocabulaire

- **Vidéo** : fiche YouTube identifiée par ses onze caractères ; une seule fiche par bibliothèque et identifiant.
- **Playlist** : liste nommée et ordonnée d’appartenances à des vidéos. Une même vidéo peut apparaître dans plusieurs playlists ou plusieurs positions.
- **Bibliothèque locale** : vidéos et playlists conservées sur ce Mac dans SQLite, indépendantes du serveur privé.
- **Cache serveur** : copie séparée de la bibliothèque du serveur choisi ; une synchronisation ne peut pas écrire dans la bibliothèque locale.
- **Import** : acquisition complète d’une playlist ou d’un fichier, puis écriture transactionnelle. Un import incomplet ne remplace pas la playlist existante.
- **Reprise** : continuation des pages YouTube déjà récupérées, avec le même lien, pendant 24 h ; aucun secret dans le point de reprise.
- **Tour de DJ** : une demande traitée de bout en bout. Le modèle propose des recherches, la bibliothèque renvoie des candidats sans les morceaux déjà en file (sauf redemande), le modèle choisit, et seuls des candidats atteignent la file. Mêmes règles quel que soit le modèle (Gemini, Apple).
- **File** : morceaux à jouer, dans l’ordre ; une même vidéo peut y figurer plusieurs fois.
