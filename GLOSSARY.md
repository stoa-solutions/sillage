# Sillage — vocabulaire

- **Vidéo** : fiche YouTube identifiée par ses onze caractères ; une seule fiche par bibliothèque et identifiant.
- **Playlist** : liste nommée et ordonnée d’appartenances à des vidéos. Une même vidéo peut apparaître dans plusieurs playlists ou plusieurs positions.
- **Import** : ajout d’une playlist YouTube par son lien ou d’un fichier Sillage ; le serveur acquiert toutes les entrées puis les écrit en une transaction. Un import incomplet ne remplace pas la playlist existante.
- **Tour de DJ** : une demande traitée de bout en bout par le serveur. Il cherche des candidats sans les morceaux déjà en file (sauf redemande explicite), le modèle choisit, et seuls des candidats atteignent la file.
- **Décision du Tour** : l’issue unique d’une réponse du modèle (répondre, proposer des cartes, lancer ou ajouter, ne rien changer, relancer une fois, échouer), avec sa raison écrite au journal.
- **Bail de Tour** : au plus un Tour actif par compte, et un nombre borné de Tours simultanés tous comptes confondus. Une demande tapée et forcée remplace le Tour du compte ; une suite automatique cède toujours la place à une demande tapée.
- **Tour remplacé** : Tour interrompu par un message que la personne a forcé (statut `superseded`). Un Tour coupé par un redémarrage du serveur est `interrupted`.
- **Message en attente** : demande tapée pendant que le DJ répond. Elle part à la suite, dans l’ordre ; « Envoyer maintenant » la force. Elle vit seulement dans l’app.
- **Mémoire de conversation** : ce que le serveur transmet au Tour depuis le journal (20 derniers échanges, un rappel compact au-delà, et ce qu’un Tour interrompu avait déjà exploré). Jamais le raisonnement privé du modèle.
- **Suite structurée** : demande de N nouveaux titres après le morceau en cours, envoyée comme `continuation: {count, broaden}` plutôt qu’en phrase.
- **File** : morceaux à jouer, dans l’ordre ; une même vidéo peut y figurer plusieurs fois.
- **Paroles** : texte d’une vidéo, venu de LRCLIB par le serveur ; synchronisé par ligne (et parfois par mot), simple texte, instrumental ou introuvable.
- **Calage** : décalage propre à un compte entre les paroles et une vidéo, par exemple pour l’intro d’un clip ; positif, il retarde les paroles.
- **Session d’écoute** : la File, la direction musicale et la suite automatique d’un compte, du premier titre à la déconnexion. Tous les gestes (clics, chat, fin d’un titre) y passent, pour que la suite reste synchronisée.
- **Historique d’écoute** : les lectures finies d’un compte (vidéo, issue, date), enregistrées sur le serveur. Distinct de l’Historique affiché dans le panneau DJ, qui ne couvre que la session en cours.
