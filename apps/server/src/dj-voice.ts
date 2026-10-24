import { djConfig, DjUnavailable, reserveDj } from "./dj.ts";
import type { Database } from "./db.ts";
export function djVoiceConfigured() {
  return (
    djConfig().configured &&
    djConfig().baseUrl ===
      "https://generativelanguage.googleapis.com/v1beta/openai"
  );
}
export function pcmToWav(pcm: Buffer, rate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
export async function djSpeech(
  db: Database,
  text: string,
  signal?: AbortSignal,
) {
  if (!djVoiceConfigured())
    throw new DjUnavailable("La voix du DJ n’est pas configurée.");
  await reserveDj(db);
  const config = djConfig();
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent",
      {
        method: "POST",
        signal: AbortSignal.any([
          AbortSignal.timeout(45000),
          ...(signal ? [signal] : []),
        ]),
        headers: {
          "x-goog-api-key": config.key!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text,
                  speech_metadata: {
                    style:
                      "Parle en français naturellement, comme un DJ chaleureux et posé. Ne chante pas.",
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { voice: "Kore" } },
          },
        }),
      },
    );
    if (!response.ok) throw new Error("Voice provider unavailable");
    const data = (await response.json()) as any;
    const audio = data.candidates?.[0]?.content?.parts?.find(
      (part: any) => part.inlineData?.data,
    )?.inlineData;
    if (
      !audio ||
      typeof audio.data !== "string" ||
      audio.data.length > 8 * 1024 * 1024
    )
      throw new Error("Missing audio");
    let bytes: Buffer = Buffer.from(audio.data, "base64");
    if (bytes.subarray(0, 4).toString() !== "RIFF") {
      if (!/^audio\/(L16|pcm)/i.test(audio.mimeType ?? ""))
        throw new Error("Unsupported voice format");
      bytes = pcmToWav(bytes);
    }
    return { audio: bytes.toString("base64"), mimeType: "audio/wav" };
  } catch {
    throw new DjUnavailable(
      "La voix du DJ est momentanément indisponible. Sa réponse reste dans le chat.",
      502,
    );
  }
}
