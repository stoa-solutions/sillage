import type { MusicMetadata } from "./types.ts";
// Wire contracts shared by the API and clients. No credentials or runtime APIs.
/** Most tracks or cards one DJ answer may hold; a longer list from a model is cut, not refused. */
export const DJ_SELECTION_LIMIT = 20;
export const DJ_MODELS = [
  "gemini-4-argon",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
] as const;
export type DjModel = (typeof DJ_MODELS)[number];
export const AI_PROVIDER_IDS = ["google", "anthropic"] as const;
export type AiProvider = (typeof AI_PROVIDER_IDS)[number];
export const AI_PROVIDERS = [
  {
    id: "google",
    name: "Gemini",
    defaultModel: "gemini-3.5-flash-lite",
    keyUrl: "https://aistudio.google.com/api-keys",
    models: [...DJ_MODELS].map((id) => ({ id, name: id })),
  },
  {
    id: "anthropic",
    name: "Claude",
    defaultModel: "claude-sonnet-5-5",
    keyUrl: "https://platform.claude.com/settings/keys",
    models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"].map(
      (id) => ({ id, name: id }),
    ),
  },
] as const;
export interface DjTrack {
  musicMetadata?: MusicMetadata | null;
  id: string;
  title: string;
  channel: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string;
  url: string;
}
export interface DjMessage {
  role: "user" | "assistant";
  content: string;
}
export interface DjResponse {
  reply: string;
  sources?: { id: number; title: string; url: string }[];
  action: "replace" | "append" | "keep";
  tracks: DjTrack[];
}
export interface DjStatus {
  configured: boolean;
  voice: boolean;
  model: string | null;
  personal: boolean;
  settingsAvailable: boolean;
}
