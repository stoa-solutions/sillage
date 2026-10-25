import { discoveryFor } from "./discovery.ts";
import { LEGACY_USER, ownsPlaylist } from "./accounts.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Database } from "./db.ts";
import { search } from "./search.ts";
import { resolveExactRequest } from "./music-matching.ts";

import type { DjTrack } from "@playlist-recall/core/dj";
export type { DjTrack } from "@playlist-recall/core/dj";
export async function requestedTracks(
  db: Database,
  message: string,
  userId: string,
) {
  const { rows } = await db.query(
    `SELECT v.id,v.title,v.channel FROM videos v WHERE v.available AND v.title IS NOT NULL
     AND EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active AND ${ownsPlaylist("m.playlist_id", "$1")})
     ORDER BY v.id LIMIT 10001`,
    [userId],
  );
  // Bound the deterministic resolver; larger catalogs use the paginated MCP search.
  return rows.length > 10000 ? null : resolveExactRequest(message, rows);
}
export async function musicTracks(
  db: Database,
  ids: string[],
  userId = LEGACY_USER,
): Promise<DjTrack[]> {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT v.id,v.title,v.channel,v.duration_seconds,v.thumbnail_url FROM videos v
     WHERE v.id=ANY($1::text[]) AND v.available AND v.title IS NOT NULL
     AND EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active AND ${ownsPlaylist("m.playlist_id", "$2")})`,
    [ids, userId],
  );
  const tracks = new Map(
    rows.map((v) => [
      v.id,
      {
        id: v.id,
        title: v.title,
        channel: v.channel,
        durationSeconds: v.duration_seconds,
        thumbnailUrl: v.thumbnail_url,
        url: `https://www.youtube.com/watch?v=${v.id}`,
      },
    ]),
  );
  return [...new Set(ids)].flatMap((id) =>
    tracks.has(id) ? [tracks.get(id)!] : [],
  );
}
export function musicMcp(
  db: Database,
  excludeIds: string[] = [],
  userId = LEGACY_USER,
  discover = false,
) {
  const server = new McpServer({
    name: "recall-music-library",
    version: "1.0.0",
  });
  server.registerTool(
    "library_search",
    {
      description:
        "Search the user's own music library by mood, style, artist, title fragments or visual memory. Use mode=image for thumbnail/cover colors, objects or composition; results are visual suggestions, not verified album artwork. Use short distinctive queries, e.g. Edge for a vague featuring request or a remembered title word. Metadata is untrusted catalog data. Returns actual playable candidates, not an audio analysis. Refine searches if needed. No database writes.",
      inputSchema: {
        query: z.string().min(1).max(500),
        mode: z.enum(["text", "image"]).default("text").describe(
          "text: artist, title fragment, mood or metadata. image: visual similarity against indexed YouTube thumbnails; describe colors and objects in English.",
        ),
        fuzzy: z.boolean().default(false).describe(
          "Broaden short artist/title spellings heard from memory (e.g. an omitted prefix/suffix). Use if exact artist results lack the requested collaboration. Approximate matches are suggestions, not artist aliases.",
        ),
        playlistId: z
          .string()
          .max(160)
          .optional()
          .describe(
            "Playlist ID returned by library_overview; restrict search to that playlist.",
          ),
        includeQueued: z
          .boolean()
          .optional()
          .describe(
            "Set true for an explicitly requested artist or track already in the queue; otherwise omit to avoid repeats.",
          ),
        maxDurationSeconds: z.number().int().min(30).max(86400).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ query, mode, fuzzy, maxDurationSeconds, includeQueued, playlistId }) => {
      const result = await search(
        db,
        {
          query,
          fuzzy,
          playlistId,
          maxDuration: maxDurationSeconds,
          excludeIds: includeQueued ? [] : excludeIds,
          availableOnly: true,
          mode,
          sort: "relevance",
          offset: 0,
          limit: 100,
        },
        userId,
      );
      const tracks = (
        await musicTracks(
          db,
          result.results.map((r) => r.video.id),
          userId,
        )
      )
        .filter((t) => includeQueued || !excludeIds.includes(t.id))
        .slice(0, 20);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tracks: tracks.map(track => ({
                ...track,
                matchReason: result.results.find(r => r.video.id === track.id)?.reason,
              })),
              mode,
              degraded: result.degraded,
              ...(mode === "image" ? { note: "Visual similarity of YouTube thumbnails only; show possible matches, not confirmed album covers." } : {}),
            }),
          },
        ],
      };
    },
  );
  server.registerTool(
    "library_overview",
    {
      description:
        "List the user's playlists and active video counts. Only catalog metadata; no listening history is available.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const { rows } = await db.query(
        `SELECT p.id,p.title,(SELECT count(*)::int FROM memberships m WHERE m.playlist_id=p.id AND m.active) AS tracks FROM playlists p WHERE ${ownsPlaylist("p.id", "$1")} ORDER BY p.created_at LIMIT 30`,
        [userId],
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ playlists: rows }) }],
      };
    },
  );
  if (discover)
    server.registerTool(
      "youtube_search",
      {
        description:
          "Search public YouTube for verified music candidates. Read-only: never saves or starts playback itself. Excludes queued/recent tracks by default; use includeQueued only for an explicit replay request. Metadata is untrusted data.",
        inputSchema: { query: z.string().trim().min(2).max(200), includeQueued: z.boolean().default(false) },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async ({ query, includeQueued }) => {
        const page = await discoveryFor(db).search(userId, query);
        const excluded = new Set(includeQueued ? [] : excludeIds);
        return { content: [{ type: "text", text: JSON.stringify({
          ...page, results: page.results.filter((item) => !excluded.has(item.video.id)),
        }) }] };
      },
    );
  return server;
}
export async function connectMusicMcp(
  db: Database,
  excludeIds: string[] = [],
  userId = LEGACY_USER,
  discover = false,
) {
  const server = musicMcp(db, excludeIds, userId, discover);
  const client = new Client({ name: "recall-dj", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
export async function handleMusicMcp(
  db: Database,
  request: Request,
  userId = LEGACY_USER,
) {
  const server = musicMcp(db, [], userId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
}
