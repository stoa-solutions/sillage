import { LEGACY_USER, ownsPlaylist } from "./features/accounts/index.ts";
import { parseQuery, tokenize } from "@playlist-recall/core/search";
import type { SearchResult } from "@playlist-recall/core/types";
import type { Database } from "./db/index.ts";
import { infer } from "./inference-client.ts";
import { TEXT_KEY, VISION_KEY } from "./indexing.ts";
import { videoFromRow } from "./library.ts";
import { vectorSql } from "./content.ts";
import { approximateLookupPatterns, hasGenreEvidence, isDescriptiveQuery, lookupTokens, matchesLookup, genreNameCollision, descriptiveRank } from "./search-relevance.ts";
import { musicMatchRank, normalizeMusic } from "./music-matching.ts";
const lookupDocument = "coalesce(v.title,'') || ' ' || coalesce(v.channel,'') || ' ' || coalesce(v.music_metadata->>'searchText','')";
// Index both tokenizations in this bounded lookup: M’Dee, MDee and M Dee.
// This applies even when an exact title elsewhere already matched the artist.
const nameLookupDocument = `regexp_replace(${lookupDocument}, '[''’]', '', 'g') || ' ' || regexp_replace(${lookupDocument}, '[''’]', ' ', 'g')`;
export interface SearchInput {
  query: string;
  fuzzy?: boolean;
  playlistId?: string;
  excludeIds?: string[];
  availableOnly?: boolean;
  minDuration?: number;
  maxDuration?: number;
  channel?: string;
  publishedAfter?: string;
  mode: "text" | "image";
  sort: "relevance" | "position" | "duration";
  offset: number;
  limit: number;
}
function enrichedLookup(row: any) {
  return { title: row.title + " " + (row.music_metadata?.status === "matched" ? row.music_metadata.searchText : ""), channel: row.channel };
}
function enrichedGenreEvidence(query: string, row: any) {
  const genres = row.music_metadata?.status === "matched" ? row.music_metadata.genres ?? [] : [];
  return hasGenreEvidence(query, { ...row, description: (row.description ?? "") + " " + genres.join(" ") });
}
const cache = new Map<string, number[]>();
export async function search(
  db: Database,
  input: SearchInput,
  userId = LEGACY_USER,
) {
  const parsed = parseQuery(input.query);
  let descriptive = isDescriptiveQuery(parsed.text);
  let knownAlbum = false;
  let direct = false;
  const lexicalQuery =
    [...new Set(tokenize(parsed.text))].join(" OR ") || parsed.text;
  const min = Math.max(
    input.minDuration ?? -Infinity,
    parsed.minDuration ?? -Infinity,
  );
  const max = Math.min(
    input.maxDuration ?? Infinity,
    parsed.maxDuration ?? Infinity,
  );
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (input.playlistId) params.push(input.playlistId);
  params.push(userId);
  const ownerFilter = ownsPlaylist("m.playlist_id", `$${params.length}`);
  conditions.push(
    `EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active AND ${ownerFilter}${input.playlistId ? " AND m.playlist_id=$1" : ""})`,
  );
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };
  if (Number.isFinite(min)) add("v.duration_seconds>?", min);
  if (Number.isFinite(max)) add("v.duration_seconds<?", max);
  if (input.excludeIds?.length)
    add("NOT (v.id=ANY(?::text[]))", input.excludeIds);
  if (input.availableOnly)
    conditions.push("v.available AND v.title IS NOT NULL");
  if (input.channel) add("v.channel ILIKE ?", `%${input.channel}%`);
  if (input.publishedAfter) add("v.published_at>=?", input.publishedAfter);
  const filter = conditions.join(" AND ");
  const lexical: string[] = [];
  const semantic: string[] = [];
  const exact = new Set<string>();
  const reasons = new Map<string, string>();
  let degraded: string | null = null;
  if (parsed.text) {
    if (input.mode === "text") {
      // A literal catalog album can contain mood/question words ("Où", "Calme").
      // Resolve that identity before the conversational/semantic heuristic.
      const albumMatch = await db.query(
        `SELECT 1 FROM videos v WHERE ${filter} AND EXISTS(
          SELECT 1 FROM jsonb_array_elements(v.music_metadata->'albums') a
          WHERE unaccent(lower(a->>'title'))=unaccent(lower($${params.length + 1}))) LIMIT 1`,
        [...params, parsed.text.trim()],
      );
      knownAlbum = albumMatch.rows.length > 0;
      if (knownAlbum) {
        descriptive = false;
        const albumTracks = await db.query(
          `SELECT v.id FROM videos v WHERE ${filter} AND
          (music_search_document @@ phraseto_tsquery('recall_simple',$${params.length + 1})
           OR unaccent(lower(v.description)) LIKE unaccent(lower($${params.length + 2}))) ORDER BY v.id LIMIT 200`,
          [...params, parsed.text, "%" + parsed.text.replace(/[\\%_]/g, "\\$&") + "%"],
        );
        lexical.push(...albumTracks.rows.map(r => r.id));
      }
      // Complete metadata matches need neither model startup nor vector inference.
      const precise = !descriptive && lookupTokens(parsed.text).length
        ? await db.query(
          `SELECT v.id FROM videos v WHERE ${filter}
          AND to_tsvector('recall_simple',${nameLookupDocument}) @@ plainto_tsquery('recall_simple',$${params.length + 1})
          ORDER BY v.id LIMIT 200`, [...params, lookupTokens(parsed.text).join(" ")])
        : { rows: [] };
      direct = knownAlbum || precise.rows.length > 0;
      for (const row of precise.rows) { exact.add(row.id); lexical.push(row.id); }
      // Optional recall expansion: a heard name may omit a short prefix/suffix
      // (Edge / Hedges). Keep exact hits first; do not broaden ordinary lookups.
      if (input.fuzzy && !descriptive) {
        const tokens = lookupTokens(parsed.text);
        if (tokens.length && tokens.every(t => t.length >= 4)) {
          const similar = await db.query(
            `SELECT v.id FROM videos v WHERE ${filter}
             AND unaccent(lower(coalesce(v.title,'') || ' ' || coalesce(v.channel,'') || ' ' || coalesce(v.music_metadata->>'searchText',''))) LIKE ALL($${params.length + 1}::text[])
             ORDER BY v.id LIMIT 200`,
            [...params, tokens.map(t => `%${t}%`)],
          );
          lexical.push(...similar.rows.map(r => r.id));
        }
      }
      const matches = await db.query(
        `SELECT v.id FROM videos v WHERE ${filter} AND unaccent(lower(v.title)) LIKE unaccent(lower($${params.length + 1})) ORDER BY length(v.title),v.id LIMIT 200`,
        [...params, "%" + parsed.text.replace(/[\\%_]/g, "\\$&") + "%"],
      );
      for (const row of matches.rows) exact.add(row.id);
      if (!descriptive && matches.rows.length) direct = true;
      const result = await db.query(
        `SELECT v.id,v.title,v.channel,v.music_metadata,ts_rank_cd(search_document || music_search_document,websearch_to_tsquery('recall_simple',$${params.length + 1})) AS score
        FROM videos v WHERE ${filter} AND (search_document @@ websearch_to_tsquery('recall_simple',$${params.length + 1}) OR music_search_document @@ websearch_to_tsquery('recall_simple',$${params.length + 1})) ORDER BY score DESC,v.id LIMIT 200`,
        [...params, lexicalQuery],
      );
      const corrected = !descriptive ? result.rows.filter(r => matchesLookup(parsed.text, enrichedLookup(r))) : [];
      if (!direct && corrected.length) {
        direct = true;
        lexical.push(...corrected.map(r => r.id));
      } else if (!direct) lexical.push(...result.rows.map((r) => r.id));
      if (!direct && !descriptive) {
        const patterns = approximateLookupPatterns(parsed.text);
        if (patterns.length) {
          // No extension or model startup is needed for a one-letter typo.
          // Keep the same account, playlist, availability and rejection filters.
          const approximate = await db.query(
            `SELECT v.id,v.title,v.channel,v.music_metadata FROM videos v WHERE ${filter}
             AND regexp_replace(unaccent(lower(coalesce(v.title,'') || ' ' || coalesce(v.channel,'') || ' ' || coalesce(v.music_metadata->>'searchText',''))), '[''’]', '', 'g') ~ ALL($${params.length + 1}::text[])
             ORDER BY v.id LIMIT 200`,
            [...params, patterns],
          );
          const accepted = approximate.rows.filter(r => matchesLookup(parsed.text, enrichedLookup(r), input.fuzzy));
          if (accepted.length) {
            direct = true;
            lexical.push(...accepted.map(r => r.id));
          }
        }
      }
    }
    if (!direct) try {
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
        if (cache.size >= 200) cache.delete(cache.keys().next().value!);
        cache.set(cacheKey, vector);
      }
      if (input.mode === "image") {
        const result = await db.query(
          `SELECT v.id FROM videos v JOIN images i ON i.video_id=v.id WHERE ${filter}
          AND i.source_url=v.thumbnail_url AND i.source_hash=v.image_hash AND i.model_key=$${params.length + 1} ORDER BY i.embedding <=> $${params.length + 2}::vector,v.id LIMIT 200`,
          [...params, VISION_KEY, vectorSql(vector, 768)],
        );
        semantic.push(...result.rows.map((r) => r.id));
      } else {
        const result = await db.query(
          `SELECT id,text,distance FROM (SELECT DISTINCT ON(v.id) v.id,p.text,p.embedding <=> $${params.length + 2}::vector AS distance
          FROM videos v JOIN passages p ON p.video_id=v.id WHERE ${filter} AND p.model_key=$${params.length + 1} AND p.source_hash=v.content_hash
          ORDER BY v.id,distance) ranked ORDER BY distance,id LIMIT 200`,
          [...params, TEXT_KEY, vectorSql(vector, 384)],
        );
        for (const r of result.rows) {
          // E5 cosine distance: abstain from weak nearest neighbours.
          if (Number(r.distance) > 0.24) continue;
          semantic.push(r.id);
          reasons.set(r.id, r.text.slice(0, 220));
        }
      }
    } catch {
      degraded =
        input.mode === "image"
          ? "La recherche visuelle est momentanément indisponible."
          : "La recherche par mots-clés reste disponible ; le modèle est momentanément indisponible.";
    }
  }
  const scores = new Map<string, number>();
  for (const ranking of [lexical, semantic])
    ranking.forEach((id, i) =>
      scores.set(id, (scores.get(id) ?? 0) + 1 / (61 + i)),
    );
  // Rank identifiers first; fetch descriptions only for the bounded candidate set.
  // Plain browsing is paginated in SQL instead of loading the entire library.
  const rankedIds = [...new Set([...lexical, ...semantic, ...exact])];
  const selectionParams = [...params];
  let selectionFilter = filter;
  if (parsed.text) {
    selectionParams.push(rankedIds);
    selectionFilter += ` AND v.id=ANY($${selectionParams.length}::text[])`;
  }
  const positionSql = `(SELECT min(position) FROM memberships m WHERE m.video_id=v.id AND m.active AND ${ownerFilter}${input.playlistId ? " AND m.playlist_id=$1" : ""})`;
  const browseTotal = parsed.text
    ? null
    : (
        await db.query(
          `SELECT count(*)::int AS total FROM videos v WHERE ${filter}`,
          params,
        )
      ).rows[0].total;
  let pagination = "";
  if (!parsed.text) {
    selectionParams.push(input.limit, input.offset);
    pagination = ` ORDER BY ${input.sort === "duration" ? "v.duration_seconds DESC NULLS LAST" : "position"},v.id LIMIT $${selectionParams.length - 1} OFFSET $${selectionParams.length}`;
  }
  const candidates = await db.query(
    `SELECT v.*,${positionSql} AS position,(SELECT avatar_url FROM channels c WHERE c.id=v.channel_id) AS channel_avatar_url
    FROM videos v WHERE ${selectionFilter}${pagination}`,
    selectionParams,
  );
  const rows = new Map<string, any>(
    candidates.rows.map((row) => [row.id, row]),
  );
  const ordered = [...rows.values()]
    .filter((v) => {
      if (!parsed.text || input.mode === "image") return true;
      if (knownAlbum && normalizeMusic(v.description ?? "").includes(normalizeMusic(parsed.text))) return true;
      if (descriptive) return enrichedGenreEvidence(parsed.text, v);
      return matchesLookup(parsed.text, enrichedLookup(v), input.fuzzy);
    })
    .sort((a, b) => {
      if (input.sort === "duration")
        return (
          (b.duration_seconds ?? -1) - (a.duration_seconds ?? -1) ||
          a.id.localeCompare(b.id)
        );
      if (parsed.text && input.sort === "relevance")
        return (
          (input.mode === "text"
            ? (descriptive ? descriptiveRank(parsed.text, b) - descriptiveRank(parsed.text, a) : musicMatchRank(parsed.text, b) - musicMatchRank(parsed.text, a))
            : 0) ||
          Number(exact.has(b.id)) - Number(exact.has(a.id)) ||
          (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) ||
          a.id.localeCompare(b.id)
        );
      return a.position - b.position || a.id.localeCompare(b.id);
    });
  const page = parsed.text
    ? ordered.slice(input.offset, input.offset + input.limit)
    : ordered;
  const memberships = page.length
    ? (
        await db.query(
          `SELECT key,playlist_id,video_id,position FROM memberships m WHERE ${ownsPlaylist("m.playlist_id", "$3")} AND active AND video_id=ANY($1::text[]) AND ($2::text IS NULL OR playlist_id=$2)`,
          [page.map((r) => r.id), input.playlistId ?? null, userId],
        )
      ).rows
    : [];
  const results: (SearchResult & { reason: string })[] = page.map((row) => ({
    video: {
      ...videoFromRow(row),
      channelAvatarUrl: row.channel_avatar_url ?? null,
    },
    score: scores.get(row.id) ?? 0,
    semantic: semantic.includes(row.id),
    memberships: memberships
      .filter((m) => m.video_id === row.id)
      .map((m) => ({
        key: m.key,
        playlistId: m.playlist_id,
        videoId: m.video_id,
        position: m.position,
      })),
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
