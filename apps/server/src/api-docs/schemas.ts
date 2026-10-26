import { z } from "zod";
import { authExchangeInput, authStartInput } from "../auth.ts";
import { discoveryAddInput, discoveryInput } from "../discovery.ts";
import { djSettingsInput } from "../dj-settings.ts";
import {
  journalPage,
  journalEventPage,
  journalUpload,
} from "../features/dj/journal/contracts.ts";
import { djInput } from "../features/dj/contracts.ts";
import { historyEvent, historyPage, historyUpload } from "../history.ts";
import { librarySearchInput } from "../library-contracts.ts";

export type Schema = Record<string, unknown>;
export const ref = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
export const string = (description?: string): Schema => ({
  type: "string",
  ...(description ? { description } : {}),
});
export const integer: Schema = { type: "integer" };
export const boolean: Schema = { type: "boolean" };
export const nullable = (schema: Schema): Schema => ({
  anyOf: [schema, { type: "null" }],
});
export const array = (items: Schema): Schema => ({ type: "array", items });
export const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({ type: "object", properties, required });
const date: Schema = { type: "string", format: "date-time" };
const uuid: Schema = { type: "string", format: "uuid" };
const videoId: Schema = { type: "string", pattern: "^[A-Za-z0-9_-]{11}$" };

/** Request constraints come from the validators used by the running routes. */
export function jsonSchema(schema: z.ZodType): Schema {
  const { $schema: _dialect, ...result } = z.toJSONSchema(schema, {
    io: "input",
  });
  return result;
}

export const schemas: Record<string, Schema> = {
  JournalPage: jsonSchema(journalPage),
  JournalEventPage: jsonSchema(journalEventPage),
  JournalUpload: jsonSchema(journalUpload),
  JournalConversation: object({
    id: uuid,
    createdAt: date,
    updatedAt: date,
    turns: integer,
    messages: integer,
  }),
  JournalTurnSummary: object({
    id: uuid,
    requestId: nullable(uuid),
    scope: { enum: ["library", "youtube", "all"] },
    requestedScope: nullable(string()),
    trigger: { enum: ["user", "continuation"] },
    status: { enum: ["running", "completed", "error", "canceled", "busy"] },
    model: nullable(string()),
    startedAt: date,
    completedAt: nullable(date),
    journalComplete: boolean,
    action: nullable(string()),
    reply: nullable(string()),
    stale: boolean,
  }),
  JournalEvent: object({
    sequence: string("Curseur bigint renvoyé en chaîne, à conserver tel quel."),
    id: uuid,
    turnId: nullable(uuid),
    scope: { enum: ["library", "youtube", "all"] },
    origin: { enum: ["client", "server"] },
    kind: string(),
    payload: { type: "object", additionalProperties: true },
    clientSequence: nullable(integer),
    occurredAt: nullable(date),
    receivedAt: date,
  }),
  JournalTurn: object({
    id: uuid,
    user_id: uuid,
    conversation_id: uuid,
    installation_id: nullable(uuid),
    request_id: nullable(uuid),
    scope: string(),
    requested_scope: nullable(string()),
    trigger: string(),
    status: string(),
    input: ref("DjRequest"),
    plan: { type: "object", additionalProperties: true },
    response: nullable({ type: "object", additionalProperties: true }),
    model: nullable(string()),
    prompt_hash: string(),
    release_sha: string(),
    started_at: date,
    completed_at: nullable(date),
    journal_complete: boolean,
  }),
  AuthStart: jsonSchema(authStartInput),
  AuthExchange: jsonSchema(authExchangeInput),
  LibrarySearch: jsonSchema(librarySearchInput),
  DiscoverySearch: jsonSchema(discoveryInput),
  DiscoveryAdd: jsonSchema(discoveryAddInput),
  DjRequest: jsonSchema(djInput),
  DjSettings: jsonSchema(djSettingsInput),
  DjCheck: jsonSchema(
    djSettingsInput.extend({ voice: z.boolean().default(false) }),
  ),
  SpeechRequest: {
    ...object({ text: { type: "string", minLength: 1, maxLength: 600 } }),
    description: "Le texte est nettoyé des espaces aux extrémités.",
  },
  HistoryEvent: jsonSchema(historyEvent),
  HistoryUpload: jsonSchema(historyUpload),
  HistoryPage: {
    ...jsonSchema(historyPage),
    properties: {
      ...(jsonSchema(historyPage).properties as Schema),
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
  },
  Error: object(
    { error: string(), source: string(), reason: string(), retryAt: date },
    ["error"],
  ),
  Saved: object({ saved: { const: true } }),
  Health: object({ ok: boolean, version: string(), release: string() }),
  Account: object({
    id: uuid,
    email: nullable(string()),
    name: nullable(string()),
    google: boolean,
  }),
  DjStatus: object({
    configured: boolean,
    voice: boolean,
    model: nullable(string()),
    personal: boolean,
    settingsAvailable: boolean,
  }),
  CheckResult: object({ ok: boolean, voice: boolean, message: string() }),
  SpeechResult: object({
    audio: {
      type: "string",
      contentEncoding: "base64",
      description: "Fichier WAV encodé en base64.",
    },
    mimeType: { const: "audio/wav" },
  }),
  MusicMetadata: object(
    {
      source: { const: "MusicBrainz" },
      status: { enum: ["matched", "ambiguous", "not_found"] },
      checkedAt: date,
      recordingId: string(),
      confidence: { type: "number" },
      reason: string(),
      artists: array(
        object({
          id: string(),
          name: string(),
          role: { enum: ["primary", "featured"] },
        }),
      ),
      albums: array(object({ id: string(), title: string() })),
      genres: array(string()),
      artistGenres: {
        ...array(string()),
        description: "Genres de l’artiste, pas nécessairement ceux du morceau.",
      },
      searchText: string(),
    },
    [
      "source",
      "status",
      "checkedAt",
      "artists",
      "albums",
      "genres",
      "artistGenres",
      "searchText",
    ],
  ),
  Video: object(
    {
      id: videoId,
      title: nullable(string()),
      channel: nullable(string()),
      durationSeconds: nullable(integer),
      description: string(),
      tags: array(string()),
      thumbnailUrl: string(),
      url: string(),
      publishedAt: nullable(string()),
      channelAvatarUrl: nullable(string()),
      musicMetadata: nullable(ref("MusicMetadata")),
    },
    [
      "id",
      "title",
      "channel",
      "durationSeconds",
      "description",
      "tags",
      "thumbnailUrl",
      "url",
      "publishedAt",
    ],
  ),
  DjTrack: object(
    {
      id: videoId,
      title: string(),
      channel: nullable(string()),
      durationSeconds: nullable(integer),
      url: string(),
      thumbnailUrl: string(),
      musicMetadata: nullable(ref("MusicMetadata")),
    },
    ["id", "title"],
  ),
  Membership: object({
    key: string(),
    playlistId: string(),
    videoId,
    position: integer,
  }),
  SearchResult: object({
    video: ref("Video"),
    score: { type: "number" },
    semantic: boolean,
    memberships: array(ref("Membership")),
    reason: string(),
  }),
  SearchPage: object({
    results: array(ref("SearchResult")),
    total: integer,
    degraded: nullable(string()),
    mode: { enum: ["text", "image"] },
  }),
  DiscoveryItem: object({ video: ref("DjTrack"), inLibrary: boolean }),
  DiscoveryPage: object({
    results: array(ref("DiscoveryItem")),
    nextPageToken: nullable(string()),
  }),
  DiscoveryHome: object({
    suggestions: array({
      allOf: [ref("DiscoveryItem"), object({ reason: string() })],
    }),
    basedOn: array(string()),
    notice: nullable(string()),
    emptyReason: nullable(string()),
  }),
  DiscoverySaved: object({
    saved: { const: true },
    playlistId: string(),
    video: ref("Video"),
  }),
  InformationSource: object(
    { id: integer, title: string(), url: string(), snippet: string() },
    ["id", "title", "url"],
  ),
  DjResponse: object(
    {
      reply: string(),
      action: { enum: ["replace", "append", "keep"] },
      tracks: array(ref("DjTrack")),
      discoveries: array(ref("DiscoveryItem")),
      sources: array(ref("InformationSource")),
      source: string(),
    },
    ["reply", "action", "tracks"],
  ),
  Playlist: {
    ...object(
      {
        id: string(),
        title: string(),
        source_url: string(),
        created_at: date,
        status: string(),
        sync_enabled: boolean,
        next_sync_at: nullable(date),
        entries: integer,
      },
      ["id", "title", "source_url", "entries"],
    ),
    description:
      "Les champs de cette route historique utilisent snake_case. Les champs additionnels du suivi de synchronisation restent possibles.",
  },
  Job: object({
    id: uuid,
    status: { enum: ["pending", "running", "done", "failed"] },
  }),
  SyncAccepted: object({ job: ref("Job") }),
  PlaylistAccepted: object({ id: string(), job: ref("Job") }),
  LibraryStatus: object({
    counts: object({
      videos: integer,
      titled: integer,
      descriptions: integer,
      text_indexed: integer,
      images: integer,
    }),
    jobs: array(object({ kind: string(), status: string(), count: integer })),
    syncEnabled: boolean,
    youtubeConfigured: boolean,
    visionEnabled: boolean,
  }),
  Enrichment: object(
    Object.fromEntries([
      ...[
        "total",
        "processed",
        "matched",
        "ambiguous",
        "not_found",
        "unavailable",
        "awaiting_youtube",
        "queued",
        "running",
        "retrying",
        "failed",
        "batchSize",
      ].map((k) => [k, integer]),
      ["enabled", boolean],
      ["checkedAt", date],
    ]),
  ),
  Lyrics: object({
    status: {
      enum: ["synced", "plain", "instrumental", "missing", "unavailable"],
    },
    lines: array(object({ startMs: integer, endMs: integer, text: string() })),
    text: nullable(string()),
    offsetMs: integer,
    durationDeltaMs: nullable(integer),
    source: nullable(object({ name: { const: "LRCLIB" }, id: integer })),
  }),
  ExportVideo: object(
    {
      id: videoId,
      title: nullable(string()),
      channel: nullable(string()),
      duration_seconds: nullable({ type: "number" }),
      description: string(),
      tags: array(string()),
      upload_date: nullable(string()),
      position: integer,
    },
    ["id"],
  ),
  ExportCollection: object(
    {
      playlist: object({ id: string(), title: string() }),
      videos: { ...array(ref("ExportVideo")), maxItems: 50000 },
    },
    ["videos"],
  ),
  LibraryImport: {
    description:
      "Export Recall, playlist normalisée ou playlist plate yt-dlp. Au plus 100 playlists et 50 000 entrées au total ; max. 30 Mio. Réservé à la maintenance historique.",
    anyOf: [
      object({ collections: array(ref("ExportCollection")) }),
      ref("ExportCollection"),
      object(
        {
          id: string(),
          title: string(),
          entries: array(
            object(
              {
                id: videoId,
                duration: nullable({ type: "number" }),
                title: nullable(string()),
              },
              ["id"],
            ),
          ),
        },
        ["entries"],
      ),
    ],
  },
  LibraryExport: {
    ...object({
      format: { const: "playlist-recall" },
      version: { const: 1 },
      collections: array(ref("ExportCollection")),
    }),
    description:
      "Export Recall normalisé ; aucune clé ni session n’est exportée.",
  },
  RpcRequest: object(
    {
      jsonrpc: { const: "2.0" },
      id: { anyOf: [string(), integer] },
      method: string(),
      params: { type: "object", additionalProperties: true },
    },
    ["jsonrpc", "method"],
  ),
  RpcResponse: {
    type: "object",
    description:
      "Enveloppe JSON-RPC 2.0 : result ou error, selon la méthode MCP.",
    properties: {
      jsonrpc: { const: "2.0" },
      id: { anyOf: [string(), integer, { type: "null" }] },
      result: {},
      error: object({ code: integer, message: string(), data: {} }, [
        "code",
        "message",
      ]),
    },
    required: ["jsonrpc", "id"],
  },
};
