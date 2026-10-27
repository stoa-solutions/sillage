import type { DjTrack } from "@playlist-recall/core/dj";

/** A catalogue row of the fixtures (SQL column names), as the MCP repository returns it. */
export type CatalogRow = {
  id: string;
  title: string;
  channel?: string | null;
  duration_seconds?: number | null;
  thumbnail_url?: string;
  music_metadata?: unknown;
};

/** The owned tracks among `ids`, in the order asked and without duplicates. */
export function ownedAmong(rows: CatalogRow[], ids: string[]): DjTrack[] {
  const tracks = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        musicMetadata: (row.music_metadata ?? null) as DjTrack["musicMetadata"],
        title: row.title,
        channel: row.channel ?? null,
        durationSeconds: row.duration_seconds ?? null,
        thumbnailUrl: row.thumbnail_url ?? "",
        url: `https://www.youtube.com/watch?v=${row.id}`,
      } as DjTrack,
    ]),
  );
  return [...new Set(ids)].flatMap((id) => {
    const track = tracks.get(id);
    return track ? [track] : [];
  });
}
