import { z } from "zod";
import { authStartInput } from "../modules/auth/index.ts";
import { discoveryAddInput, discoveryInput } from "../modules/discovery/index.ts";
import { djSettingsInput } from "../dj-settings.ts";
import {
  journalPage,
  journalEventPage,
  journalUpload,
} from "../modules/dj/journal/contracts.ts";
import { djInput } from "../modules/dj/contracts.ts";
import { historyEvent, historyPage, historyUpload } from "../modules/history/index.ts";
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
  LibrarySearch: jsonSchema(librarySearchInput),
  DjRequest: jsonSchema(djInput),
  DjSettings: jsonSchema(djSettingsInput),
  DjReset: jsonSchema(z.object({provider:z.enum(["google","anthropic"]).optional()})),
  DjCheck: jsonSchema(
    djSettingsInput.safeExtend({ voice: z.boolean().default(false) }),
  ),
  SpeechRequest: {
    ...object({ text: { type: "string", minLength: 1, maxLength: 600 } }),
    description: "Le texte est nettoyé des espaces aux extrémités.",
  },
  HistoryPage: {
    ...jsonSchema(historyPage),
    properties: {
      ...(jsonSchema(historyPage)["properties"] as Schema),
      limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
    },
  },
  Health: object({ ok: boolean, version: string(), release: string() }),
  DjStatus: object({
    provider: {type:"string",enum:["google","anthropic"]},
    providers: array(object({
      id: {type:"string",enum:["google","anthropic"]}, name:string(), configured:boolean,
      model:string(), defaultModel:string(), keyUrl:string(), models:array(object({id:string(),name:string()})),
    })),
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
