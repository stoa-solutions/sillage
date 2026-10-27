import type { DjConfig } from "./dj-config.ts";
import { djSpeech } from "./dj-voice.ts";
import type { Database } from "./db/index.ts";
import { checkModel, providerHttpStatus } from "./features/dj/ai-model.ts";
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
      message: "Renseigne une clé de ce fournisseur pour tester le DJ.",
    };
  try {
    if (!await checkModel(config))
      return {
        ok: false,
        voice: false,
        message: "Le modèle a renvoyé une réponse vide. Réessaie.",
      };
    const cloudVoice = voice && config.provider !== "anthropic";
    if (cloudVoice) {
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
      voice: cloudVoice,
      message: cloudVoice
        ? "Le DJ et la voix Gemini répondent avec cette clé."
        : "Clé et modèle vérifiés. La voix n’a pas été testée.",
    };
  } catch (error) {
    const status = providerHttpStatus(error);
    return {
      ok: false,
      voice: false,
      message: status === 429
        ? "Le fournisseur refuse cette demande : quota atteint ou service occupé. Vérifie le quota de cette clé."
        : status && [400, 401, 403, 404].includes(status)
          ? "Le fournisseur refuse cette clé ou ce modèle. Vérifie la clé, ses restrictions et le modèle."
          : "Impossible de joindre ce fournisseur. Réessaie dans un instant.",
    };
  }
}
