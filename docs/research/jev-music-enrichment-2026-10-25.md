# Jev et enrichissement musical — 25 octobre 2026

Recherche Exa : produit Jev identifié chez TypeSafe, documentation officielle vérifiée. Aucune intégration payante ni mesure de performance Recall réalisée.

## Jev : usage ciblé, après mesure

Jev renvoie des choix, scores et probabilités sur du texte. Il ne génère ni dialogue, ni code, ni voix ; il ne lit pas les images/audio/vidéos. Sa calibration ne garantit pas une réponse correcte. Source : https://docs.typesafe.ai/concepts/system-one et https://docs.typesafe.ai/api

Utilité possible pour Recall : classer une intention ambiguë (jouer maintenant / ajouter / proposer), ordonner un petit lot de candidats, décider s’il faut élargir une recherche. Les commandes exactes pause/next restent déterministes et locales. Gemini conserve la conversation et la composition ; SigLIP conserve la recherche visuelle. Ne pas ajouter un appel réseau aux commandes de lecture.

Évaluer Jev derrière une interface de classement, avec délai borné et repli vers le classement existant. Comparer un corpus annoté de demandes Recall (dont Edge/HEDGES, fragments de titres, souvenirs visuels, exclusions et demandes ordonnées) : précision top-5, fausses lectures automatiques, p50/p95 et coût. Ne l’activer que si le gain est mesuré. Besoin d’une clé TypeSafe distincte ; aucune clé recherchée ou configurée pour cette étude.

La documentation annonce jev-1.14.0 et 0,042 $/million de tokens entrants, sorties gratuites, limites par organisation. Ce prix et ces limites sont à revalider avant activation : https://docs.typesafe.ai/models. Les gains de vitesse marketing ne sont pas un benchmark de notre application.

## Enrichir avant de multiplier les modèles

MusicBrainz propose enregistrements, crédits d’artistes, albums, ISRC, genres et tags ; lecture sans clé pour les données publiques, User-Agent identifié et au plus une requête par seconde. API gratuite pour usage non commercial ; vérifier les conditions commerciales avant distribution payante : https://musicbrainz.org/doc/MusicBrainz_API

Les données centrales MusicBrainz sont CC0 ; les genres/tags et autres données supplémentaires relèvent de CC BY-NC-SA 3.0. Ne pas confondre accès API sans clé et licence commerciale libre. Sources : https://musicbrainz.org/doc/About/Data_License et https://musicbrainz.org/doc/Development/JSON_Data_Dumps

Cover Art Archive fournit les pochettes rattachées aux releases MusicBrainz : https://musicbrainz.org/doc/Cover_Art_Archive/API. Une pochette n’est pas automatiquement l’image du clip YouTube ; garder les deux sources distinctes. Accessibilité technique ne signifie pas liberté de redistribution de toutes les images.

Proposition de V1 (non implémentée) :
1. Worker asynchrone après import : normaliser titre/artiste, chercher des candidats par nom/durée, conserver séparément version live/remix/reprise.
2. N’attacher un MBID qu’avec une correspondance suffisamment sûre ; sinon conserver des candidats et le statut à confirmer. Ne jamais écraser les métadonnées YouTube originales.
3. Stocker chaque enrichissement avec fournisseur, identifiant, date, score de correspondance et provenance. Genre de l’artiste et genre du morceau sont deux faits distincts ; une ambiance inférée reste une suggestion.
4. Dédupliquer par vidéo/enregistrement, cache et reprise des échecs, cadence globale MusicBrainz bornée. Aucune dépendance externe sur le chemin d’une recherche interactive.
5. Réindexer le texte enrichi et exposer des indices lisibles (artiste invité confirmé, album, tag de communauté), puis ajouter filtres de genre/album et cartes « Pourquoi ce résultat ? ».

Le pilote devrait couvrir quelques dizaines de morceaux représentatifs, dont « Incapable (feat. HEDGES) », avant les milliers de vidéos. Contrôler surtout les mauvaises associations, pas seulement le taux de remplissage. Aucun genre ne doit être inventé pour remplir une case.
