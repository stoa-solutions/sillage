# 0001 — Bibliothèque native locale et import YouTube

Statut : remplacée le 25 octobre 2026 par [0002](0002-server-only-mac-library.md) (bibliothèque exclusivement sur le serveur). Acceptée initialement le même jour, demande explicite de Samuel : base locale puis import par lien, redistribution simple.

SQLite livré par macOS assure la persistance, les transactions et la recherche FTS5. Aucun processus de base de données, paquet de vecteurs ou compte Stoa n’est requis pour conserver/rechercher les vidéos. `LibraryStore` possède migrations, fiches, playlists, appartenance ordonnée et source explicite. Une connexion SQLite est détenue par opération, sans handle partagé entre tâches. Les imports et recherches longs s’exécutent hors du thread de l’interface.

Les fichiers JSON préexistants restent intacts. Leur migration est marquée dans la même transaction que les données ; elle ne se répète pas à chaque démarrage. Une source `server` séparée reçoit les synchronisations. Une réponse tardive ne décide jamais de sa destination selon l’état courant de l’interface.

`YouTubePlaylistImporter` récupère les pages de l’API officielle et conserve un point de reprise privé après chaque page. La playlist existante reste visible jusqu’à la validation complète. Réimporter un identifiant existant remplace ses appartenances et conserve les autres playlists. Les fiches non référencées ne sont pas purgées automatiquement : une vidéo peut rester retrouvable après retrait d’une playlist.

La première version accepte playlists publiques/non répertoriées avec clé YouTube personnelle dans le Trousseau ; OAuth pour playlists privées est différé. La clé n’est ni dans les URL ni dans les exports/points de reprise. Le paquet ne contient ni bibliothèque ni clé personnelle. Les redirections réseau sont refusées.

La recherche locale indexée ne remplace pas la recherche sémantique/visuelle du serveur. Le chat Gemini, la voix Google et YouTube restent en ligne. Le lecteur HTTPS Stoa reste une dépendance publique distincte du serveur privé facultatif. Ne pas annoncer une lecture YouTube hors ligne ou une autonomie réseau totale.

La distribution publique sans avertissement nécessite toujours Developer ID et notarisation. La signature locale persistante permet les essais sans identité changeante entre compilations ; Sparkle ne publie pas les archives de test non signées pour les mises à jour.
