import type { DjTrack } from "@playlist-recall/core/dj";
import type { DiscoveryEvidence } from "./evidence.ts";

/**
 * The visible text of a turn. Operations are announced by the server from what
 * it actually executes, never from a provider's promise the queue may contradict.
 */

const quoted = (titles: string[]) => titles.map((title) => `« ${title} »`);
const withExplanation = (text: string, explanation?: string) =>
  explanation?.trim() ? `${text} ${explanation.trim()}` : text;

export function playReply(
  action: "replace" | "append",
  tracks: DjTrack[],
  targetCount?: number,
  explanation?: string,
): string {
  const titles = tracks
    .slice(0, 3)
    .map((t) => t.title)
    .join(", puis ");
  const rest =
    tracks.length > 3
      ? ` et ${tracks.length - 3} autre${tracks.length === 4 ? " titre" : "s titres"}`
      : "";
  const partial =
    targetCount && tracks.length < targetCount
      ? ` Je n’ai trouvé que ${tracks.length} nouveau${tracks.length === 1 ? " titre compatible" : "x titres compatibles"} sur les ${targetCount} demandés.`
      : "";
  const operation =
    action === "append"
      ? `J’ajoute à la suite : ${titles}${rest}.${partial}`
      : `C’est parti : ${titles}${rest}.`;
  return withExplanation(operation, explanation);
}

/** Name every card, so the announced count always matches what is shown. */
export function proposalReply(
  cards: DiscoveryEvidence[],
  explanation?: string,
): string {
  const titles = quoted(cards.map(({ video }) => video.title));
  const list =
    titles.length > 1
      ? `${titles.slice(0, -1).join(", ")} et ${titles.at(-1)}`
      : titles[0];
  const credits = cards
    .flatMap(({ video }) => {
      const metadata = video.musicMetadata;
      const artists =
        metadata?.status === "matched" && Array.isArray(metadata.artists)
          ? metadata.artists
              .filter((artist) => typeof artist?.name === "string")
              .map((artist) => artist.name)
          : [];
      return artists.length
        ? [`« ${video.title} » : ${artists.join(", ")}.`]
        : [];
    })
    .slice(0, 3);
  const creditNote = credits.length
    ? ` Crédits MusicBrainz : ${credits.join(" ")}`.slice(0, 700)
    : "";
  return withExplanation(
    `Je te propose ${cards.length === 1 ? "ce morceau" : `ces ${cards.length} morceaux`} : ${list}.${creditNote} Choisis celui que tu veux écouter.`,
    explanation,
  );
}

export function emptyReply({
  failureSummary = "",
  currentTitle,
  visualUnsupported = false,
}: {
  failureSummary?: string;
  currentTitle?: string;
  visualUnsupported?: boolean;
} = {}) {
  if (visualUnsupported && !failureSummary)
    return "YouTube ne permet pas de chercher par couleur ou détail de pochette. Choisis Mes playlists ou Partout pour explorer les miniatures de ta bibliothèque. Ta lecture reste inchangée.";
  return noSelectionReply(failureSummary, currentTitle);
}

export function noSelectionReply(failureSummary = "", currentTitle?: string) {
  const reference = currentTitle ? ` autour de « ${currentTitle} »` : "";
  return failureSummary
    ? `${failureSummary} Je n’ai pas de nouvelle sélection vérifiée${reference}. Ta lecture et ta file sont conservées.`
    : `Je n’ai pas trouvé de nouvelle sélection compatible${reference} dans les sources choisies. Ta lecture et ta file sont conservées. Tu peux élargir la recherche ou demander une autre ambiance.`;
}

/** Mention degraded sources next to a result built from the remaining ones. */
export function withSourceNote(reply: string, note: string) {
  return note
    ? `${reply} ${note} Je m’appuie sur les résultats disponibles.`
    : reply;
}

export const INFORMATION_UNAVAILABLE =
  "La recherche d’informations sur le Web est momentanément indisponible. Ta lecture continue ; réessaie dans un instant.";
export const INFORMATION_UNSOURCED =
  "Je n’ai pas trouvé de source exploitable pour confirmer cette information. Ta lecture continue.";
