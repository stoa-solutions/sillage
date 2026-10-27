/** Thumbnails are fetched only from YouTube's image hosts, size-bounded, never redirected. */
export class ThumbnailUnavailable extends Error {}

export async function fetchThumbnail(
  url: string,
  request: typeof fetch = fetch,
): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["i.ytimg.com", "i9.ytimg.com"].includes(parsed.hostname) ||
    parsed.port
  )
    throw new Error("Hôte de miniature interdit.");
  const response = await request(parsed, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404 || response.status === 410)
    throw new ThumbnailUnavailable("Miniature indisponible sur YouTube.");
  if (!response.ok) throw new Error(`Miniature HTTP ${response.status}`);
  if (
    !/^image\/(jpeg|png|webp)(;|$)/.test(
      response.headers.get("content-type") ?? "",
    )
  )
    throw new Error("Type de miniature invalide.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Miniature vide.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024)
        throw new Error("Miniature trop volumineuse.");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!size) throw new Error("Miniature vide.");
  return Buffer.concat(parts);
}
