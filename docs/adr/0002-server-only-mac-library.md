# 0002 — Bibliothèque du Mac exclusivement sur le serveur

Statut : accepté le 25 octobre 2026, choix de Samuel. Remplace [0001](0001-native-local-library.md).

L’app Mac ne conserve plus de bibliothèque : vidéos, playlists, recherche, imports YouTube et tours de DJ passent par le serveur privé, avec un compte Google qui isole bibliothèque et clé Gemini. L’app garde seulement la page affichée, la file de lecture en mémoire et un fichier de session privé.

Raison : une seule source de vérité. La bibliothèque locale, son cache serveur, l’import par clé YouTube personnelle et le DJ exécuté sur le Mac (Gemini direct ou Apple) dupliquaient le serveur avec des règles divergentes. Avant le passage en 1.3.0, les 2 813 vidéos des copies locales ont été comparées au serveur : aucune n’était exclusivement locale. L’ancien dossier `Application Support/Sillage` a été déplacé dans la Corbeille, récupérable.

Conséquences : pas de mode hors ligne ; Internet et le serveur sont nécessaires. Le code local est retiré de `SillageKit` (SQLite et FTS5, `LibraryStore`, `LibraryDocument`, import YouTube avec reprise, `LocalDJ`, adapters Gemini et Apple, recherche locale). Les règles du tour de DJ (exclusion de la file, imitations, vérification des choix) relèvent désormais du serveur (`apps/server/src/dj.ts`). Le format d’import/export Sillage n’est plus lu que par TypeScript. Revenir à une bibliothèque locale demanderait une nouvelle décision ; l’historique Git conserve l’implémentation.
