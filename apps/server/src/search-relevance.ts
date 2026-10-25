import { normalizeMusic, versionPenalty } from "./music-matching.ts";

const filler = new Set("de du des par et the a un une moi stp la le les of and".split(" "));
export function lookupTokens(query: string): string[] {
  return [...new Set(normalizeMusic(query).split(" ").filter(w => w && !filler.has(w)))];
}
export function isDescriptiveQuery(query: string): boolean {
  if (/^(jazz|classique|classical|reggae|metal|techno)$/.test(normalizeMusic(query))) return true;
  return /\b(ambiance|mood|doux|douce|calme|soiree|soir|relax|chill|energi\w*|triste|joyeux|romantique|romantic|melancolique|pour|ressemble|similaire|cherche|souvenir|souviens|avec|dans|qui|dont|ou|quiet|evening|relaxing|happy|sad|with|about|remember)\b/.test(normalizeMusic(query));
}
function nearWord(a: string, b: string): boolean {
  if (a === b || (a.length >= 4 && b.startsWith(a))) return true;
  // One insertion, deletion or substitution on words of at least four letters.
  if (Math.min(a.length, b.length) < 3 || Math.max(a.length,b.length) < 4 || Math.abs(a.length-b.length)>1) return false;
  let i=0,j=0,edits=0;
  while(i<a.length && j<b.length) {
    if(a[i]===b[j]) { i++;j++;continue; }
    if(++edits>1) return false;
    if(a.length>=b.length)i++;
    if(b.length>=a.length)j++;
  }
  return edits+(a.length-i)+(b.length-j)<=1;
}
export function matchesLookup(query: string, track: {title: string; channel?: string | null}): boolean {
  const tokens = lookupTokens(query);
  const metadata = lookupTokens(track.title + " " + (track.channel ?? ""));
  return tokens.length > 0 && tokens.every(t => metadata.some(w => nearWord(t,w)));
}
/** Avoid treating an artist's name as evidence of a requested musical genre. */
export function genreNameCollision(query: string, track: {title: string; channel?: string | null; description?: string | null}): boolean {
  const genre = lookupTokens(query).find(t => ["jazz", "classique", "classical", "reggae", "metal", "techno"].includes(t));
  if (!genre) return false;
  const parts = track.title.split(/\s+[-–—]\s+/);
  if (parts.length < 2) return false;
  const artist = normalizeMusic(parts[0]);
  if (!artist.split(" ").includes(genre)) return false;
  const evidence = normalizeMusic(parts.slice(1).join(" ") + " " + (track.description ?? "")).replaceAll(artist, "");
  return !evidence.split(" ").includes(genre);
}
export function descriptiveRank(query: string, track: {title: string}): number {
  // Metadata coverage is not a genre classifier. Semantic order leads mood searches.
  return -versionPenalty(query, track.title);
}

export function hasGenreEvidence(query: string, track: {title: string; channel?: string | null; description?: string | null}): boolean {
  const genre = lookupTokens(query).find(t => ["jazz", "classique", "classical", "reggae", "metal", "techno"].includes(t));
  if (!genre) return true;
  if (genreNameCollision(query, track)) return false;
  if (genre === "jazz" && /\b(rap|hip hop|trap|boom bap)\b/.test(normalizeMusic(track.title))
    && !/\b(rap|hip hop|trap|boom bap)\b/.test(normalizeMusic(query))) return false;
  return normalizeMusic(track.title + " " + (track.description ?? "") + " " + (track.channel ?? "")).split(" ").includes(genre);
}
