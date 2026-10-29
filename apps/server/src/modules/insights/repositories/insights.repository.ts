import { and, eq, inArray, sql } from "drizzle-orm";
import { insightsCache, videos, type Database } from "../../../db/index.ts";
import { inLibraryOf } from "../../library/index.ts";

/** A kept answer younger than `days`, as { value } so that a kept absence (null) is a hit. */
export async function kept(db: Database, key: string, days: number) {
  const [row] = await db.orm
    .select({ value: insightsCache.value })
    .from(insightsCache)
    .where(sql`${insightsCache.key} = ${key} and ${insightsCache.fetchedAt} > now() - make_interval(days => ${days})`);
  return row ? { value: row.value } : null;
}

export async function keep(db: Database, key: string, value: unknown) {
  await db.orm
    .insert(insightsCache)
    .values({ key, value })
    .onConflictDoUpdate({ target: insightsCache.key, set: { value, fetchedAt: sql`now()` } });
}

export async function forget(db: Database, key: string) {
  await db.orm.delete(insightsCache).where(eq(insightsCache.key, key));
}

/** Which of these videos are in the account's library. */
export async function ownedAmong(db: Database, userId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.orm
    .select({ id: videos.id })
    .from(videos)
    .where(and(inArray(videos.id, ids), inLibraryOf(db.orm, userId, videos.id)));
  return new Set(rows.map((row) => row.id));
}
