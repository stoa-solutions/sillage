import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  min,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import { vectorSql } from "../../content.ts";
import {
  channels,
  images,
  memberships,
  passages,
  userPlaylists,
  videos,
  type Executor,
} from "../../db/index.ts";

/** Everything that restricts a search before ranking; the account is always part of it. */
export interface SearchScope {
  userId: string;
  playlistId?: string | undefined;
  minDuration: number;
  maxDuration: number;
  excludeIds?: string[] | undefined;
  availableOnly?: boolean | undefined;
  channel?: string | undefined;
  publishedAfter?: string | undefined;
}

const LIMIT = 200;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
// Title, channel and MusicBrainz credits: what a listener names.
const lookupDocument = sql`coalesce(${videos.title},'') || ' ' || coalesce(${videos.channel},'') || ' ' || coalesce(${videos.musicMetadata}->>'searchText','')`;
// Both tokenizations: M’Dee, MDee and M Dee.
const nameLookupDocument = sql`regexp_replace(${lookupDocument}, '[''’]', '', 'g') || ' ' || regexp_replace(${lookupDocument}, '[''’]', ' ', 'g')`;

/** Active in one of the account's playlists (or the requested one). */
function ownedEntry(db: Executor, scope: SearchScope) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(memberships)
      .innerJoin(userPlaylists, eq(userPlaylists.playlistId, memberships.playlistId))
      .where(
        and(
          eq(memberships.videoId, videos.id),
          eq(memberships.active, true),
          eq(userPlaylists.userId, scope.userId),
          scope.playlistId ? eq(memberships.playlistId, scope.playlistId) : undefined,
        ),
      ),
  );
}

/** The condition every search query shares: ownership first, then the listener's filters. */
export function scopeFilter(db: Executor, scope: SearchScope): SQL {
  const filter = and(
    ownedEntry(db, scope),
    Number.isFinite(scope.minDuration)
      ? gt(videos.durationSeconds, scope.minDuration)
      : undefined,
    Number.isFinite(scope.maxDuration)
      ? lt(videos.durationSeconds, scope.maxDuration)
      : undefined,
    scope.excludeIds?.length ? notInArray(videos.id, scope.excludeIds) : undefined,
    scope.availableOnly
      ? and(eq(videos.available, true), isNotNull(videos.title))
      : undefined,
    scope.channel ? ilike(videos.channel, `%${scope.channel}%`) : undefined,
    scope.publishedAfter ? gte(videos.publishedAt, scope.publishedAfter) : undefined,
  );
  if (!filter) throw new Error("Search scope without ownership");
  return filter;
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

/** A literal catalogue album named exactly like the query. */
export async function hasAlbumNamed(db: Executor, filter: SQL, text: string) {
  const rows = await db
    .select({ id: videos.id })
    .from(videos)
    .where(
      and(
        filter,
        sql`EXISTS(SELECT 1 FROM jsonb_array_elements(${videos.musicMetadata}->'albums') a
          WHERE unaccent(lower(a->>'title')) = unaccent(lower(${text})))`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Tracks of that album, by MusicBrainz credits or the description. */
export async function albumTracks(db: Executor, filter: SQL, text: string) {
  return ids(
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(
          filter,
          sql`(${videos.musicSearchDocument} @@ phraseto_tsquery('sillage_simple', ${text})
            OR unaccent(lower(${videos.description})) LIKE unaccent(lower(${"%" + escapeLike(text) + "%"})))`,
        ),
      )
      .orderBy(asc(videos.id))
      .limit(LIMIT),
  );
}

/** Every token found in title, channel or credits: no model needed. */
export async function preciseLookup(db: Executor, filter: SQL, tokens: string[]) {
  return ids(
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(
          filter,
          sql`to_tsvector('sillage_simple', ${nameLookupDocument}) @@ plainto_tsquery('sillage_simple', ${tokens.join(" ")})`,
        ),
      )
      .orderBy(asc(videos.id))
      .limit(LIMIT),
  );
}

/** Every token contained somewhere, for a heard name missing a prefix or suffix. */
export async function containingAll(db: Executor, filter: SQL, tokens: string[]) {
  return ids(
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(
          filter,
          sql`unaccent(lower(${lookupDocument})) LIKE ALL(${sql.param(tokens.map((t) => `%${t}%`))}::text[])`,
        ),
      )
      .orderBy(asc(videos.id))
      .limit(LIMIT),
  );
}

/** Titles containing the whole query, shortest first. */
export async function titleMatches(db: Executor, filter: SQL, text: string) {
  return ids(
    await db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(
          filter,
          sql`unaccent(lower(${videos.title})) LIKE unaccent(lower(${"%" + escapeLike(text) + "%"}))`,
        ),
      )
      .orderBy(sql`length(${videos.title})`, asc(videos.id))
      .limit(LIMIT),
  );
}

/** Full-text ranking over YouTube metadata and MusicBrainz credits. */
export async function lexicalRanking(db: Executor, filter: SQL, query: string) {
  const tsquery = sql`websearch_to_tsquery('sillage_simple', ${query})`;
  const score = sql`ts_rank_cd(${videos.searchDocument} || ${videos.musicSearchDocument}, ${tsquery})`;
  return db
    .select({
      id: videos.id,
      title: videos.title,
      channel: videos.channel,
      musicMetadata: videos.musicMetadata,
    })
    .from(videos)
    .where(
      and(
        filter,
        sql`(${videos.searchDocument} @@ ${tsquery} OR ${videos.musicSearchDocument} @@ ${tsquery})`,
      ),
    )
    .orderBy(desc(score), asc(videos.id))
    .limit(LIMIT);
}

/** One-letter typos, as regular expressions over the folded lookup document. */
export async function approximateLookup(
  db: Executor,
  filter: SQL,
  patterns: string[],
) {
  return db
    .select({
      id: videos.id,
      title: videos.title,
      channel: videos.channel,
      musicMetadata: videos.musicMetadata,
    })
    .from(videos)
    .where(
      and(
        filter,
        sql`regexp_replace(unaccent(lower(${lookupDocument})), '[''’]', '', 'g') ~ ALL(${sql.param(patterns)}::text[])`,
      ),
    )
    .orderBy(asc(videos.id))
    .limit(LIMIT);
}

/** Nearest current thumbnails (SigLIP 2) to a visual query. */
export async function nearestImages(
  db: Executor,
  filter: SQL,
  modelKey: string,
  vector: number[],
) {
  return ids(
    await db
      .select({ id: videos.id })
      .from(videos)
      .innerJoin(images, eq(images.videoId, videos.id))
      .where(
        and(
          filter,
          eq(images.sourceUrl, videos.thumbnailUrl),
          sql`${images.sourceHash} = ${videos.imageHash}`,
          eq(images.modelKey, modelKey),
        ),
      )
      .orderBy(sql`${images.embedding} <=> ${vectorSql(vector, 768)}::vector`, asc(videos.id))
      .limit(LIMIT),
  );
}

/** The closest current passage of each video (E5), nearest videos first. */
export async function nearestPassages(
  db: Executor,
  filter: SQL,
  modelKey: string,
  vector: number[],
) {
  const distance = sql<number>`${passages.embedding} <=> ${vectorSql(vector, 384)}::vector`;
  const closest = db
    .selectDistinctOn([videos.id], {
      id: videos.id,
      text: passages.text,
      distance: distance.as("distance"),
    })
    .from(videos)
    .innerJoin(passages, eq(passages.videoId, videos.id))
    .where(
      and(
        filter,
        eq(passages.modelKey, modelKey),
        eq(passages.sourceHash, videos.contentHash),
      ),
    )
    .orderBy(videos.id, distance)
    .as("closest");
  return db
    .select()
    .from(closest)
    .orderBy(closest.distance, closest.id)
    .limit(LIMIT);
}

export async function countInScope(db: Executor, filter: SQL) {
  const [row] = await db.select({ total: count() }).from(videos).where(filter);
  return row?.total ?? 0;
}

/**
 * The videos to show, with their first position in the account's playlists and channel photo.
 * Ranked searches pass their candidate ids; plain browsing is paginated here.
 */
export async function candidateVideos(
  db: Executor,
  filter: SQL,
  scope: SearchScope,
  selection:
    | { ids: string[] }
    | { sort: "relevance" | "position" | "duration"; limit: number; offset: number },
) {
  const position = db
    .select({ position: min(memberships.position) })
    .from(memberships)
    .innerJoin(userPlaylists, eq(userPlaylists.playlistId, memberships.playlistId))
    .where(
      and(
        eq(memberships.videoId, videos.id),
        eq(memberships.active, true),
        eq(userPlaylists.userId, scope.userId),
        scope.playlistId ? eq(memberships.playlistId, scope.playlistId) : undefined,
      ),
    );
  const avatar = db
    .select({ avatarUrl: channels.avatarUrl })
    .from(channels)
    .where(eq(channels.id, videos.channelId));
  const query = db
    .select({
      video: videos,
      position: sql<number | null>`(${position})`,
      channelAvatarUrl: sql<string | null>`(${avatar})`,
    })
    .from(videos);
  if ("ids" in selection)
    return query.where(and(filter, inArray(videos.id, selection.ids)));
  return query
    .where(filter)
    .orderBy(
      selection.sort === "duration"
        ? sql`${videos.durationSeconds} DESC NULLS LAST`
        : sql`(${position})`,
      asc(videos.id),
    )
    .limit(selection.limit)
    .offset(selection.offset);
}

/** The account's active entries of these videos, optionally within one playlist. */
export async function entriesOf(
  db: Executor,
  scope: SearchScope,
  videoIds: string[],
) {
  return db
    .select({
      key: memberships.key,
      playlistId: memberships.playlistId,
      videoId: memberships.videoId,
      position: memberships.position,
    })
    .from(memberships)
    .innerJoin(userPlaylists, eq(userPlaylists.playlistId, memberships.playlistId))
    .where(
      and(
        eq(userPlaylists.userId, scope.userId),
        eq(memberships.active, true),
        inArray(memberships.videoId, videoIds),
        scope.playlistId ? eq(memberships.playlistId, scope.playlistId) : undefined,
      ),
    );
}
