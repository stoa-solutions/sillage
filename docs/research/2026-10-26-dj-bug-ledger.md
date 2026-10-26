# Défauts du DJ remontés par Samuel

Ce relevé distingue les observations de l’app des correctifs et essais automatiques. Un test simulé réussi ne valide pas la compréhension du modèle réel, ni le lecteur installé. Le mix reste une expérience hors du produit.

| Priorité | Cas observé | Comportement attendu | État du contrôle |
| --- | --- | --- | --- |
| Haute | « voilà, ça y’a M’Dee et c’est basqany » produit encore « aucune sélection compatible » après la bonne carte | Reconnaître la confirmation, réutiliser les crédits vérifiés et conserver la lecture | Correctif serveur : réponse de conversation distincte ; testé avec boucle DJ réelle, fournisseur simulé et isolation des comptes. Modèle de production à vérifier après déploiement. |
| Haute | « basquany » échoue ; le bon titre « basqany :( » apparaît seulement après insistance | Retrouver une graphie proche dès la première recherche | Chemin lexical ajouté ; PostgreSQL réel vérifié sur insertion, inversion et crédit M’Dee/Madee, sans inférence. La transcription phonétique générale reste à évaluer. |
| Haute | « Mets-moi une musique de Maddy/MADEE… Kazakhstan » déclenche une recherche d’information | Traiter les noms et le pays comme indices de morceau | Priorité clarifiée dans le prompt ; résultat réel non encore observé. Aucun alias d’artiste particulier ajouté. |
| Haute | « ajoute à la file » interrompt parfois le titre ; « joue maintenant » reste parfois en file | Action cohérente avec la demande, annonce conforme à l’opération | Contrat et tests replace/append/browse existants conservés et repassés. Tester chaque chemin séparément avec le modèle et le lecteur réels. |
| Haute | « prépare la suite » répète un titre, ajoute trop peu de morceaux ou s’arrête en fin de file | Respecter le nombre demandé, l’ordre, la direction et les exclusions ; renouveler la suite sans boucle infinie | Tests automatiques de cinq successeurs, exclusions, sélection partielle et annulation repassés. Le long enchaînement natif reste une vérification distincte. |
| Haute | Partout revient aux deux titres de la bibliothèque malgré « d’autres » / « sauf ces deux-là » | Explorer les sources choisies et ne pas reproposer les refus | Routage et exclusions couverts par les tests existants. Les pannes et quotas sont des limites de fournisseur, pas une preuve d’absence de morceaux. |
| Moyenne | La sélection d’un autre artiste ne respecte pas toujours « même style » ou « artistes différents » | Utiliser le titre actuel et la direction récente plutôt qu’un ancien artiste du chat | Contexte courant testé ; qualité musicale à juger sur cas réels, pas à partir d’une réponse simulée. |
| Moyenne | Boutons/titre/« plus de vidéos » YouTube visibles en Studio, parfois vérification antirobot | Clip propre et erreur explicite sans sauter toute la file | Limite distincte du moteur DJ. Le cache natif et sa préparation ont un correctif antérieur ; cela ne garantit pas l’absence de blocage YouTube. |
| Moyenne | Paroles, synchronisation, clic temporel et styles parfois incohérents | Présentation stable, position temporelle précise | Refonte et tests natifs précédents conservés ; pas de nouveau contrôle manuel pendant que Samuel utilise l’app. |
| Moyenne | Boutons écrasés et fenêtres trop petites ; fonds noirs en haut | Tailles minimales et commandes lisibles, fondu cohérent | Correctifs natifs précédents, à revérifier sur le build exact installé. Aucun changement de design dans ce lot serveur. |

## Prochain comparatif réel

Rejouer d’abord trois conversations courtes : souvenir imprécis → graphie → confirmation ; demande d’ajout de cinq titres ; passage Mes playlists → Partout avec refus explicites. Vérifier réponse, action et IDs retournés, puis seulement le comportement de lecture dans l’app. Les requêtes d’évaluation HTTP n’altèrent pas la file native ; elles consomment néanmoins le quota du fournisseur.

La [recherche sur les adaptateurs IA](2026-10-26-agent-provider.md) et son pilote isolé documentent la suite d’architecture proposée. Changer de SDK ne remplace pas ces vérifications.
