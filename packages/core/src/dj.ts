import type { MusicMetadata } from "./types.ts";
// Wire contracts shared by the API and clients. No credentials or runtime APIs.
export const DJ_MODELS = [
  "gemini-4-argon",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
] as const;
export type DjModel = (typeof DJ_MODELS)[number];
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
