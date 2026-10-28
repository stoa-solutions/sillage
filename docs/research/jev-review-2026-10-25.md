# Jev : décision pour Sillage

Documentation officielle relue via Exa le 25 octobre 2026 (trois résultats, une page complète). Aucun appel d'inférence Jev, aucun ajout de dépendance ni clé configurée.

**Décision : garder la stack actuelle.** Jev accepte du texte et retourne des décisions typées et probabilités (Choice, Score, Noul). Il pourrait classer une intention ambiguë ou réordonner des candidats, mais ne remplace ni le dialogue/voix Gemini ni les vecteurs image. Aucun bénéfice sur nos requêtes n'a été mesuré ; ajouter un service au parcours interactif serait prématuré.

Si les erreurs persistent après enrichissement et amélioration des requêtes, comparer hors production un corpus annoté (Edge/HEDGES, couleur de pochette, titre incomplet, jouer maintenant/ajouter) : précision top-5, erreurs de lecture immédiate, latence p50/p95, coût et repli réseau. Les commandes pause/next restent locales. Le score de confiance n'est pas une garantie de vérité.

Sources : [System One](https://docs.typesafe.ai/concepts/system-one), [API](https://docs.typesafe.ai/api), [exemple de classification et limites empiriques](https://docs.typesafe.ai/cookbooks/classification_using_confidence). Les chiffres publiés du fournisseur ne sont pas un benchmark Sillage.
