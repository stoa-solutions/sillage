import type { DjTrack } from "@sillage/core/dj";
import type { DiscoveryEvidence } from "./evidence.ts";

/**
 * The visible text of a turn. Operations are announced by the server from what
 * it actually executes, never from a provider's promise the queue may contradict.
 */

const quoted = (titles: string[]) => titles.map((title) => `« ${title} »`);

/** A sentence that addresses the listener formally or in the third person is not the DJ's voice. */
const OFF_VOICE = /\b(?:vous|votre|vos)\b|l[’']utilisat(?:eur|rice)/i;

/** The agent's own words, without the sentences a small model writes in the wrong register. */
export function ownVoice(explanation?: string) {
  const kept = (explanation ?? "")
    .trim()
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => sentence && !OFF_VOICE.test(sentence));
  return kept.length ? kept.join(" ") : undefined;
}

const withExplanation = (text: string, explanation?: string) => {
  const voice = ownVoice(explanation);
  return voice ? `${text} ${voice}` : text;
};

/** YouTube packaging that says nothing about the music: « (Official Video) », « [CLIP OFFICIEL] »… */
const PACKAGING =
  /\s*[(\[][^()\[\]]*?\b(?:official|officiel(?:le)?|clip|video|vidéo|audio|lyrics?|paroles|visuali[sz]er|hd|hq|4k)\b[^()\[\]]*[)\]]/gi;
const ANNOUNCED_LENGTH = 70;

/** A title as a person would say it: packaging dropped, very long names cut at a word. */
export function spokenTitle(title: string) {
  const plain = title
    .replace(PACKAGING, "")
    .replace(/\s*\|\s*(?:hd|hq|4k)\s*\|/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-–—|:]+$/, "")
    .trim();
  const spoken = plain || title.trim();
  if (spoken.length <= ANNOUNCED_LENGTH) return spoken;
  const cut = spoken.slice(0, ANNOUNCED_LENGTH);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trim()}…`;
}

/**
 * A few openings, so successive answers do not all start alike. The choice depends only on
 * the tracks, so the same selection is always announced the same way.
 */
const OPENINGS = {
  replace: ["C’est parti : ", "On lance ", "Place à ", "Je te mets "],
  append: ["J’ajoute à la suite : ", "À suivre : ", "Je glisse ensuite "],
} as const;

function opening(action: "replace" | "append", tracks: DjTrack[]) {
  const seed = [...(tracks[0]?.id ?? "")].reduce(
    (sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  const choices = OPENINGS[action];
  return choices[seed % choices.length]!;
}

export function playReply(
  action: "replace" | "append",
  tracks: DjTrack[],
  targetCount?: number,
  explanation?: string,
  { brief = false }: { brief?: boolean | undefined } = {},
): string {
  const titles = tracks
    .slice(0, brief ? 1 : 3)
    .map((t) => spokenTitle(t.title))
    .join(", puis ");
  const shown = brief ? 1 : 3;
  const rest =
    tracks.length > shown
      ? ` et ${tracks.length - shown} autre${tracks.length === shown + 1 ? " titre" : "s titres"}`
      : "";
  const partial =
    targetCount && tracks.length < targetCount
      ? ` Je n’ai trouvé que ${tracks.length} nouveau${tracks.length === 1 ? " titre compatible" : "x titres compatibles"} sur les ${targetCount} demandés.`
      : "";
  // A brief agent (Focus) is announced in a few words, without its own sentence.
  if (brief)
    return `${action === "append" ? "À suivre : " : "Lecture : "}${titles}${rest}.${action === "append" ? partial : ""}`;
  const operation = `${opening(action, tracks)}${titles}${rest}.${action === "append" ? partial : ""}`;
  return withExplanation(operation, explanation);
}

/** Name every card, so the announced count always matches what is shown. */
export function proposalReply(
  cards: DiscoveryEvidence[],
  explanation?: string,
): string {
  const titles = quoted(cards.map(({ video }) => spokenTitle(video.title)));
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
  failureSummary?: string | undefined;
  currentTitle?: string | undefined;
  visualUnsupported?: boolean | undefined;
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
