/** Source selection never decides whether playback should be interrupted. */
export type DJIntent = "replace" | "append" | "browse";
export interface ParsedDJIntent {
  intent: DJIntent;
  timing: "now" | "later" | "unspecified";
  reference: "current" | "named" | "none";
  /** An explicit bounded selection size; defaults belong to the turn planner. */
  count?: number;
}

function normalizeIntent(message: string): string {
  return message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[’']/g, " ").replace(/[-‐‑]/g, " ");
}
const playbackVerb = /\b(joue|jouer|mets|met|mettre|lance|lancer|ecouter|ecoute|passe|remplace|play)\b/;
const immediate = /\b(maintenant|directement|tout de suite|immediatement)\b/;
const deferred = /\b(a la suite|a suivre|dans la (file|queue)|en (file|queue)|apres (ce|le|la) (titre|morceau|chanson)|plus tard|sans (couper|interrompre|changer))\b/;
const appendVerb = /\b(continue|poursuis|prolonge|prepare(?:r)?|ajoute|rajoute|enqueue)\b/;
const browseVerb = /\b(cherche|chercher|recherche|trouve|trouver|montre|propose|decouvre)\b/;
const numbers: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20,
};

/** Polite prefixes do not change a prohibition into a musical wish. */
function isNegatedOperation(clause: string): boolean {
  const command = clause.replace(
    /^(?:(?:non|surtout|stp)\s+)*(?:(?:tu peux|peux tu|tu pourrais|pourrais tu|est ce que tu peux|merci de)\s+)?/,
    "",
  );
  return /^(?:ne|n)\s+(?:(?:le|la|les|me|moi|lui|en|y)\s+)*(?:joue|jouer|mets|met|mettre|lance|lancer|ajoute|rajoute|prepare|continue|change|coupe|interromps)\b.*\b(?:pas|plus|jamais|rien)\b/.test(command)
    || /^(?:ne|n)\s+(?:pas|plus|jamais)\s+(?:(?:le|la|les|me|moi|lui|en|y)\s+)*(?:jouer|mettre|lancer|ajouter|rajouter|preparer|continuer|changer|couper|interrompre)\b/.test(command)
    || /^(?:joue|jouer|mets|met|mettre|lance|lancer|ajoute|rajoute)(?:\s+(?:le|la|les|moi))?\s+pas\b/.test(command)
    || /^pas\b/.test(command);
}

/**
 * Parse controls separately from musical clues. Negation is scoped to a clause:
 * "sans live" must not cancel "joue maintenant", nor "ne mets pas en file"
 * override the affirmative correction that follows it.
 */
export function parseDJIntent(message: string): ParsedDJIntent {
  const text = normalizeIntent(message);
  const clauses = text.split(/[,;:.!?]+|\bmais\b|\bet (?=(?:ne |n |joue|mets|met |lance|ajoute|rajoute|cherche|prepare))/)
    .map((part) => part.trim()).filter(Boolean);
  const affirmative = clauses.filter((part) => !isNegatedOperation(part));
  // "Sans jouer" is a prohibition, not an affirmative playback request.
  const active = affirmative.map((part) => part.replace(
    /\bsans (?:(?:le|la|les|l|en)\s+)?(?:jouer|lancer|ecouter|ajouter|mettre)(?:\s+\S+){0,3}/g, ""));
  const now = active.some((part) => playbackVerb.test(part) && immediate.test(part));
  const later = active.some((part) => deferred.test(part) || appendVerb.test(part));
  let intent: DJIntent;
  if (now) intent = "replace";
  else if (later) intent = "append";
  else if (active.some((part) => playbackVerb.test(part))) intent = "replace";
  else if (active.some((part) => browseVerb.test(part))
    || /\b(d autres?|autre chose|autres? propositions?|autres? morceaux|autres? titres)\b/.test(text)) intent = "browse";
  else if (!active.length || /\b(pochette|miniature|couverture|couleur|dans le titre|dont le titre|souviens|souvenir)\b/.test(text)
    || /\b(un|une) (morceau|musique|titre|chanson)\b/.test(text) && /\b(feat|featuring|duo)\b/.test(text)) intent = "browse";
  else intent = "replace";

  const named = /\b(?:meme (?:style|ambiance|vibe|esprit|genre|veine) que|comme (?!ca\b|celle ci\b|celui ci\b|ce morceau\b|ce titre\b)\S+)/.test(text);
  const current = /\b(meme (style|ambiance|vibe|esprit|genre|veine)|comme (ca|celle ci|celui ci|ce morceau|ce titre)|dans (cet esprit|cette ambiance|cette veine))\b/.test(text);
  // Up to DJ_SELECTION_LIMIT (20): digits, or the single-word French numbers.
  const count = active.join(" ").match(/\b(20|1[0-9]|[1-9]|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt)\s+(?:nouveaux?\s+|nouvelles?\s+)?(?:morceaux?|titres?|sons?|chansons?)\b/)?.[1];
  return {
    intent,
    timing: now ? "now" : later ? "later" : "unspecified",
    reference: named ? "named" : current ? "current" : "none",
    ...(count ? { count: numbers[count] ?? Number(count) } : {}),
  };
}

export function djIntent(message: string): DJIntent {
  return parseDJIntent(message).intent;
}
export function playbackAction(intent: DJIntent, proposed: "replace" | "append" | "keep") {
  return intent === "browse" || proposed === "keep" ? "keep" : intent;
}
/** Relative requests refer to actual playback, never an old assistant announcement. */
export function followsCurrent(message: string): boolean {
  return parseDJIntent(message).reference === "current";
}
