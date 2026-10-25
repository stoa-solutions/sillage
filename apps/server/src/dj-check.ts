import type { DjConfig } from "./dj-config.ts";
import { djSpeech } from "./dj-voice.ts";
import type { Database } from "./db.ts";
export async function checkDj(
  db: Database,
  config: DjConfig,
  user: string,
  voice = false,
) {
  if (!config.configured)
    return {
      ok: false,
      voice: false,
      message: "Renseigne une clé Gemini pour tester le DJ.",
    };
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: "user", content: "Réponds uniquement OK." }],
        max_completion_tokens: 256,
        ...(["gemini-4-argon", "gemini-3.8-flash"].includes(config.model ?? "")
          ? { reasoning_effort: "low" }
          : {}),
      }),
    });
    if (!response.ok)
      return {
        ok: false,
        voice: false,
        message:
          response.status === 429
            ? "Google refuse cette demande : quota atteint ou service occupé. Vérifie la facturation et le quota du projet de cette clé."
            : [401, 403].includes(response.status)
              ? "Google refuse cette clé ou son accès au modèle choisi. Vérifie la clé et ses restrictions."
              : "Le modèle Gemini choisi ne répond pas. Essaie un autre modèle.",
      };
    const data = (await response.json()) as any;
    if (!data.choices?.[0]?.message?.content)
      return {
        ok: false,
        voice: false,
        message: "Gemini a renvoyé une réponse vide. Réessaie.",
      };
    if (voice) {
      try {
        await djSpeech(db, "Ton DJ est prêt.", undefined, config, user);
      } catch {
        return {
          ok: true,
          voice: false,
          message:
            "Le DJ répond. La voix Gemini est indisponible ; vérifie son quota Google.",
        };
      }
    }
    return {
      ok: true,
      voice,
      message: voice
        ? "Le DJ et la voix Gemini répondent avec cette clé."
        : "Clé et modèle vérifiés. La voix n’a pas été testée.",
    };
  } catch {
    return {
      ok: false,
      voice: false,
      message: "Impossible de joindre Gemini. Réessaie dans un instant.",
    };
  }
}
