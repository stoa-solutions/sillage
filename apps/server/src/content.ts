import { createHash } from "node:crypto";
import type { Video } from "@playlist-recall/core/types";
export const hash = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");
export function documentText(
  v: Pick<Video, "title" | "channel" | "tags" | "description">,
) {
  if (!v.title) return "";
  const description = v.description
    .replace(/https?:\/\/\S+/g, "")
    .split("\n")
    .filter(
      (line) =>
        !/^\s*(subscribe|follow us|all rights reserved|copyright|business inquiries)\b/i.test(
          line,
        ),
    )
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  return [
    v.title,
    v.channel ? `Channel: ${v.channel}` : "",
    v.tags.length ? `Tags: ${v.tags.join(", ")}` : "",
    description,
  ]
    .filter(Boolean)
    .join("\n");
}
export function parsePlaylistId(value: string) {
  let id = value.trim();
  if (id.startsWith("http")) {
    const url = new URL(id);
    if (
      url.protocol !== "https:" ||
      !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
        url.hostname,
      )
    )
      throw new Error("Utilisez un lien de playlist YouTube.");
    id = url.searchParams.get("list") ?? "";
  }
  if (!/^[a-zA-Z0-9_-]{10,160}$/.test(id))
    throw new Error("Identifiant de playlist invalide.");
  return id;
}
export function isoDuration(value?: string): number | null {
  const m = value?.match(
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/,
  );
  return m
    ? Number(m[1] ?? 0) * 86400 +
        Number(m[2] ?? 0) * 3600 +
        Number(m[3] ?? 0) * 60 +
        Number(m[4] ?? 0)
    : null;
}
export function vectorSql(values: number[], dimensions: number) {
  if (
    values.length !== dimensions ||
    values.some((v) => !Number.isFinite(v)) ||
    values.every((v) => v === 0)
  )
    throw new Error("Invalid embedding vector");
  return `[${values.join(",")}]`;
}
