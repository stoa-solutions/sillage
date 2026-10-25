/** Source selection never decides whether playback should be interrupted. */
export type DJIntent = "replace" | "append" | "browse";
export function djIntent(message: string): DJIntent {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // Deferred listening wins over an imperative such as "joue après ce titre".
  if (/\b(a la suite|dans la (file|queue)|en (file|queue)|apres (ce|le|la) (titre|morceau|chanson)|plus tard|sans (couper|interrompre|changer))\b/.test(text)
    || /\b(continue|poursuis|prolonge|prepare(?:r)? la suite|ajoute|rajoute|enqueue)\b/.test(text))
    return "append";
  if (/\b(joue|jouer|mets|met|lance|lancer|ecouter|ecoute|passe|remplace|play)\b/.test(text))
    return "replace";
  if (/\b(cherche|chercher|recherche|trouve|trouver|montre|propose|decouvre)\b/.test(text))
    return "browse";
  // A bare musical wish ("du jazz", "Mac Miller stp") changes the music.
  // The model can still return keep/empty for discussion or ambiguity.
  return "replace";
}
export function playbackAction(intent: DJIntent, proposed: "replace" | "append" | "keep") {
  return intent === "browse" || proposed === "keep" ? "keep" : intent;
}
