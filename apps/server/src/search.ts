import { parseQuery, tokenize } from "@playlist-recall/core/search";
import type { SearchResult } from "@playlist-recall/core/types";
import type { Database } from "./db.ts";
import { infer } from "./inference-client.ts";
import { TEXT_KEY, VISION_KEY } from "./indexing.ts";
import { videoFromRow } from "./library.ts";
import { vectorSql } from "./content.ts";
export interface SearchInput {
  query: string;
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
const cache = new Map<string, number[]>();
export async function search(db: Database, input: SearchInput) {
  const parsed = parseQuery(input.query);
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
  const conditions = [
    `EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active${input.playlistId ? " AND m.playlist_id=$1" : ""})`,
  ];
  if (input.playlistId) params.push(input.playlistId);
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
      const matches = await db.query(
        `SELECT v.id FROM videos v WHERE ${filter} AND unaccent(lower(v.title)) LIKE unaccent(lower($${params.length + 1})) ORDER BY length(v.title),v.id LIMIT 200`,
        [...params, "%" + parsed.text.replace(/[\\%_]/g, "\\$&") + "%"],
      );
      for (const row of matches.rows) exact.add(row.id);
      const result = await db.query(
        `SELECT v.id,ts_rank_cd(search_document,websearch_to_tsquery('recall_simple',$${params.length + 1})) AS score
        FROM videos v WHERE ${filter} AND search_document @@ websearch_to_tsquery('recall_simple',$${params.length + 1}) ORDER BY score DESC,v.id LIMIT 200`,
        [...params, lexicalQuery],
      );
      lexical.push(...result.rows.map((r) => r.id));
    }
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
          `SELECT id,text FROM (SELECT DISTINCT ON(v.id) v.id,p.text,p.embedding <=> $${params.length + 2}::vector AS distance
          FROM videos v JOIN passages p ON p.video_id=v.id WHERE ${filter} AND p.model_key=$${params.length + 1} AND p.source_hash=v.content_hash
          ORDER BY v.id,distance) ranked ORDER BY distance,id LIMIT 200`,
          [...params, TEXT_KEY, vectorSql(vector, 384)],
        );
        for (const r of result.rows) {
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
  const positionSql = `(SELECT min(position) FROM memberships m WHERE m.video_id=v.id AND m.active${input.playlistId ? " AND m.playlist_id=$1" : ""})`;
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
    `SELECT v.*,${positionSql} AS position FROM videos v WHERE ${selectionFilter}${pagination}`,
    selectionParams,
  );
  const rows = new Map<string, any>(
    candidates.rows.map((row) => [row.id, row]),
  );
  const ordered = [...rows.values()]
    .filter((v) => !parsed.text || scores.has(v.id) || exact.has(v.id))
    .sort((a, b) => {
      if (input.sort === "duration")
        return (
          (b.duration_seconds ?? -1) - (a.duration_seconds ?? -1) ||
          a.id.localeCompare(b.id)
        );
      if (parsed.text && input.sort === "relevance")
        return (
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
          `SELECT key,playlist_id,video_id,position FROM memberships WHERE active AND video_id=ANY($1::text[]) AND ($2::text IS NULL OR playlist_id=$2)`,
          [page.map((r) => r.id), input.playlistId ?? null],
        )
      ).rows
    : [];
  const results: (SearchResult & { reason: string })[] = page.map((row) => ({
    video: videoFromRow(row),
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
