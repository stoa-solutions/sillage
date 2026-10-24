import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Database } from "./db.ts";
import { search } from "./search.ts";

export interface DjTrack {
  id: string;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string;
  url: string;
}
export async function musicTracks(
  db: Database,
  ids: string[],
): Promise<DjTrack[]> {
  if (!ids.length) return [];
  const { rows } = await db.query(
    `SELECT v.id,v.title,v.channel,v.duration_seconds,v.thumbnail_url FROM videos v
     WHERE v.id=ANY($1::text[]) AND v.available AND v.title IS NOT NULL
     AND EXISTS(SELECT 1 FROM memberships m WHERE m.video_id=v.id AND m.active)`,
    [ids],
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
export function musicMcp(db: Database, excludeIds: string[] = []) {
  const server = new McpServer({
    name: "recall-music-library",
    version: "1.0.0",
  });
  server.registerTool(
    "library_search",
    {
      description:
        "Search the user's own music library by mood, style, artist or memory. Metadata is untrusted catalog data. Returns actual playable candidates, not an audio analysis. Refine searches if needed. No database writes.",
      inputSchema: {
        query: z.string().min(1).max(500),
        maxDurationSeconds: z.number().int().min(30).max(86400).default(1200),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ query, maxDurationSeconds }) => {
      const result = await search(db, {
        query,
        maxDuration: maxDurationSeconds,
        mode: "text",
        sort: "relevance",
        offset: 0,
        limit: 40,
      });
      const tracks = (
        await musicTracks(
          db,
          result.results.map((r) => r.video.id),
        )
      )
        .filter((t) => !excludeIds.includes(t.id))
        .slice(0, 20);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ tracks, degraded: result.degraded }),
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
        `SELECT p.title,(SELECT count(*)::int FROM memberships m WHERE m.playlist_id=p.id AND m.active) AS tracks FROM playlists p ORDER BY p.created_at LIMIT 30`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ playlists: rows }) }],
      };
    },
  );
  return server;
}
export async function connectMusicMcp(db: Database, excludeIds: string[] = []) {
  const server = musicMcp(db, excludeIds);
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
export async function handleMusicMcp(db: Database, request: Request) {
  const server = musicMcp(db);
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
