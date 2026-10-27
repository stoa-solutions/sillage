import { SearxngError } from "./errors.ts";

export async function boundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new SearxngError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) throw new SearxngError();
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
