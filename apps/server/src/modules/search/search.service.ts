import { parseQuery, tokenize } from "@sillage/core/search";
import type { MusicMetadata, SearchResult } from "@sillage/core/types";
import type { Database, videos } from "../../db/index.ts";
import { infer } from "../../integrations/inference/index.ts";
import { TEXT_KEY, VISION_KEY } from "../indexing/index.ts";
import { videoFromRecord } from "../library/index.ts";
import { musicMatchRank, normalizeMusic } from "./music-matching.ts";
import {
  albumTracks,
  approximateLookup,
  candidateVideos,
  containingAll,
  countInScope,
  entriesOf,
  hasAlbumNamed,
  lexicalRanking,
  nearestImages,
  nearestPassages,
  preciseLookup,
  scopeFilter,
  titleMatches,
  type SearchScope,
} from "./search.repository.ts";
import {
  approximateLookupPatterns,
  descriptiveRank,
  hasGenreEvidence,
  isDescriptiveQuery,
  lookupTokens,
  matchesLookup,
} from "./search.relevance.ts";

export interface SearchInput {
  query: string;
  fuzzy?: boolean | undefined;
  playlistId?: string | undefined;
  excludeIds?: string[] | undefined;
  availableOnly?: boolean | undefined;
  minDuration?: number | undefined;
  maxDuration?: number | undefined;
  channel?: string | undefined;
  publishedAfter?: string | undefined;
  mode: "text" | "image";
  sort: "relevance" | "position" | "duration";
  offset: number;
  limit: number;
}

type Lookup = {
  title: string | null;
  channel: string | null;
  musicMetadata: unknown;
};
const metadataOf = (row: { musicMetadata: unknown }) =>
  row.musicMetadata as MusicMetadata | null;
/** Title, channel and, when matched, MusicBrainz credits: what lookup matching reads. */
function enrichedLookup(row: Lookup) {
  const metadata = metadataOf(row);
  return {
    title:
      (row.title ?? "") +
      " " +
      (metadata?.status === "matched" ? metadata.searchText : ""),
    channel: row.channel,
  };
}
function enrichedGenreEvidence(
  query: string,
  row: Lookup & { description: string },
) {
  const metadata = metadataOf(row);
  const genres = metadata?.status === "matched" ? (metadata.genres ?? []) : [];
  return hasGenreEvidence(query, {
    title: row.title ?? "",
    channel: row.channel,
    description: row.description + " " + genres.join(" "),
  });
}

// Query embeddings of recent searches: a repeated query needs no model call.
const cache = new Map<string, number[]>();

/**
 * Library search for one account: exact identities first (album, complete names, titles),
 * full-text ranking, typo tolerance, then E5 or SigLIP 2 vectors only when nothing matched
 * directly. Ranking works on identifiers; descriptions are read for the bounded candidates.
 */
export async function search(
  db: Database,
  input: SearchInput,
  userId: string,
) {
  const orm = db.orm;
  const parsed = parseQuery(input.query);
  let descriptive = isDescriptiveQuery(parsed.text);
  let knownAlbum = false;
  let direct = false;
  const lexicalQuery =
    [...new Set(tokenize(parsed.text))].join(" OR ") || parsed.text;
  const scope: SearchScope = {
    userId,
    playlistId: input.playlistId,
    minDuration: Math.max(
      input.minDuration ?? -Infinity,
      parsed.minDuration ?? -Infinity,
    ),
    maxDuration: Math.min(
      input.maxDuration ?? Infinity,
      parsed.maxDuration ?? Infinity,
    ),
    excludeIds: input.excludeIds,
    availableOnly: input.availableOnly,
    channel: input.channel,
    publishedAfter: input.publishedAfter,
  };
  const filter = scopeFilter(orm, scope);
  const lexical: string[] = [];
  const semantic: string[] = [];
  const exact = new Set<string>();
  const reasons = new Map<string, string>();
  let degraded: string | null = null;
  if (parsed.text) {
    if (input.mode === "text") {
      // A literal catalog album can contain mood/question words ("Où", "Calme").
      // Resolve that identity before the conversational/semantic heuristic.
      knownAlbum = await hasAlbumNamed(orm, filter, parsed.text.trim());
      if (knownAlbum) {
        descriptive = false;
        lexical.push(...(await albumTracks(orm, filter, parsed.text)));
      }
      // Complete metadata matches need neither model startup nor vector inference.
      const precise =
        !descriptive && lookupTokens(parsed.text).length
          ? await preciseLookup(orm, filter, lookupTokens(parsed.text))
          : [];
      direct = knownAlbum || precise.length > 0;
      for (const id of precise) {
        exact.add(id);
        lexical.push(id);
      }
      // Optional match expansion: a heard name may omit a short prefix/suffix
      // (Edge / Hedges). Keep exact hits first; do not broaden ordinary lookups.
      if (input.fuzzy && !descriptive) {
        const tokens = lookupTokens(parsed.text);
        if (tokens.length && tokens.every((t) => t.length >= 4))
          lexical.push(...(await containingAll(orm, filter, tokens)));
      }
      const matches = await titleMatches(orm, filter, parsed.text);
      for (const id of matches) exact.add(id);
      if (!descriptive && matches.length) direct = true;
      const ranked = await lexicalRanking(orm, filter, lexicalQuery);
      const corrected = !descriptive
        ? ranked.filter((r) => matchesLookup(parsed.text, enrichedLookup(r)))
        : [];
      if (!direct && corrected.length) {
        direct = true;
        lexical.push(...corrected.map((r) => r.id));
      } else if (!direct) lexical.push(...ranked.map((r) => r.id));
      if (!direct && !descriptive) {
        const patterns = approximateLookupPatterns(parsed.text);
        if (patterns.length) {
          // No model startup is needed for a one-letter typo; same account filters.
          const approximate = await approximateLookup(orm, filter, patterns);
          const accepted = approximate.filter((r) =>
            matchesLookup(parsed.text, enrichedLookup(r), input.fuzzy),
          );
          if (accepted.length) {
            direct = true;
            lexical.push(...accepted.map((r) => r.id));
          }
        }
      }
    }
    if (!direct)
      try {
        const cacheKey = `${input.mode}:${parsed.text}`;
        let vector = cache.get(cacheKey);
        if (!vector) {
          vector = (
            await infer<{ vector: number[] }>(
              input.mode === "image" ? "visual-query" : "query",
              { text: parsed.text },
              "interactive",
            )
          ).vector;
          const oldest = cache.keys().next();
          if (cache.size >= 200 && !oldest.done) cache.delete(oldest.value);
          cache.set(cacheKey, vector);
        }
        if (input.mode === "image")
          semantic.push(...(await nearestImages(orm, filter, VISION_KEY, vector)));
        else
          for (const r of await nearestPassages(orm, filter, TEXT_KEY, vector)) {
            // E5 cosine distance: abstain from weak nearest neighbours.
            if (Number(r.distance) > 0.24) continue;
            semantic.push(r.id);
            reasons.set(r.id, r.text.slice(0, 220));
          }
      } catch {
        degraded =
          input.mode === "image"
            ? "La recherche visuelle est momentanément indisponible."
            : "La recherche par mots-clés reste disponible ; le modèle est momentanément indisponible.";
      }
  }
  // Reciprocal rank fusion of the lexical and semantic rankings.
  const scores = new Map<string, number>();
  for (const ranking of [lexical, semantic])
    ranking.forEach((id, i) =>
      scores.set(id, (scores.get(id) ?? 0) + 1 / (61 + i)),
    );
  const rankedIds = [...new Set([...lexical, ...semantic, ...exact])];
  const browseTotal = parsed.text ? null : await countInScope(orm, filter);
  const candidates = await candidateVideos(
    orm,
    filter,
    scope,
    parsed.text
      ? { ids: rankedIds }
      : { sort: input.sort, limit: input.limit, offset: input.offset },
  );
  type Candidate = typeof videos.$inferSelect & {
    position: number | null;
    channelAvatarUrl: string | null;
  };
  const rows: Candidate[] = candidates.map((row) => ({
    ...row.video,
    position: row.position,
    channelAvatarUrl: row.channelAvatarUrl,
  }));
  const ordered = rows
    .filter((v) => {
      if (!parsed.text || input.mode === "image") return true;
      if (
        knownAlbum &&
        normalizeMusic(v.description).includes(normalizeMusic(parsed.text))
      )
        return true;
      if (descriptive) return enrichedGenreEvidence(parsed.text, v);
      return matchesLookup(parsed.text, enrichedLookup(v), input.fuzzy);
    })
    .sort((a, b) => {
      if (input.sort === "duration")
        return (
          (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1) ||
          a.id.localeCompare(b.id)
        );
      if (parsed.text && input.sort === "relevance") {
        const track = (v: Candidate) => ({ title: v.title ?? "", channel: v.channel });
        return (
          (input.mode === "text"
            ? descriptive
              ? descriptiveRank(parsed.text, track(b)) -
                descriptiveRank(parsed.text, track(a))
              : musicMatchRank(parsed.text, track(b)) -
                musicMatchRank(parsed.text, track(a))
            : 0) ||
          Number(exact.has(b.id)) - Number(exact.has(a.id)) ||
          (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) ||
          a.id.localeCompare(b.id)
        );
      }
      return (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id);
    });
  const page = parsed.text
    ? ordered.slice(input.offset, input.offset + input.limit)
    : ordered;
  const entries = page.length
    ? await entriesOf(
        orm,
        scope,
        page.map((row) => row.id),
      )
    : [];
  const results: (SearchResult & { reason: string })[] = page.map((row) => ({
    video: {
      ...videoFromRecord(row),
      channelAvatarUrl: row.channelAvatarUrl,
    },
    score: scores.get(row.id) ?? 0,
    semantic: semantic.includes(row.id),
    memberships: entries.filter((m) => m.videoId === row.id),
    reason:
      input.mode === "image"
        ? "Rapprochement visuel"
        : (reasons.get(row.id) ??
          (parsed.text ? "Correspondance dans les métadonnées" : "")),
  }));
  return {
    results,
    total: browseTotal ?? ordered.length,
    degraded,
    mode: input.mode,
  };
}
