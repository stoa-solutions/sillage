import type { Database } from "../../db/index.ts";
import {
  feedbackOf,
  saveDislikeDays,
  saveFeedback,
  signalsFor,
  storedDislikeDays,
} from "./taste.repository.ts";
import {
  clampDislikeDays,
  NO_SIGNALS,
  rankByTaste,
  TASTE_RULES,
  tasteOf,
  type TasteValue,
} from "./taste.rules.ts";

interface Candidate {
  video: { id: string };
}

export function tasteService(db: Database) {
  const dislikeDays = async (owner: string) =>
    (await storedDislikeDays(db.orm, owner)) ?? TASTE_RULES.dislikeDays.default;
  return {
    feedback(owner: string, videoId: string) {
      return feedbackOf(db.orm, owner, videoId);
    },
    setFeedback(owner: string, videoId: string, value: TasteValue | null) {
      return saveFeedback(db.orm, owner, videoId, value);
    },
    async settings(owner: string) {
      return { dislikeDays: await dislikeDays(owner) };
    },
    async saveSettings(owner: string, days: number) {
      const dislikeDays = clampDislikeDays(days);
      await saveDislikeDays(db.orm, owner, dislikeDays);
      return { dislikeDays };
    },

    /**
     * Candidates for the DJ in taste order (see rankByTaste), each video labelled with what the
     * listener's history says about it. A failure leaves the search's own order untouched.
     */
    async rank<T extends Candidate>(owner: string, items: T[], now = new Date()): Promise<T[]> {
      if (!items.length) return items;
      try {
        const [signals, days] = await Promise.all([
          signalsFor(
            db.orm,
            owner,
            items.map((item) => item.video.id),
            TASTE_RULES.earlySkipMs,
          ),
          dislikeDays(owner),
        ]);
        const tastes = new Map(
          items.map((item) => [
            item.video.id,
            tasteOf(signals.get(item.video.id) ?? NO_SIGNALS, now, days),
          ]),
        );
        return rankByTaste(items, (item) => tastes.get(item.video.id)!).map((item) => {
          const label = tastes.get(item.video.id)?.label;
          return label ? { ...item, video: { ...item.video, taste: label } } : item;
        });
      } catch {
        console.warn("Taste unavailable, search order kept");
        return items;
      }
    },
  };
}
