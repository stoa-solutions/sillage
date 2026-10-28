import type { Database } from "../../db/index.ts";
import {
  feedbackOf,
  heardTracks,
  saveDislikeDays,
  saveFeedback,
  signalsFor,
  storedDislikeDays,
} from "./taste.repository.ts";
import {
  artistName,
  artistTastes,
  CATEGORY_TITLES,
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

const thresholds = {
  listenMs: TASTE_RULES.listenMs,
  earlySkipMs: TASTE_RULES.earlySkipMs,
};

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
     * listener's history says about it. A failure leaves the incoming order untouched.
     */
    async rank<T extends Candidate>(
      owner: string,
      items: T[],
      options: { targeted?: boolean; now?: Date } = {},
    ): Promise<T[]> {
      if (!items.length) return items;
      const now = options.now ?? new Date();
      try {
        const [signals, days] = await Promise.all([
          signalsFor(
            db.orm,
            owner,
            items.map((item) => item.video.id),
            thresholds,
          ),
          dislikeDays(owner),
        ]);
        const tastes = new Map(
          items.map((item) => [
            item.video.id,
            tasteOf(signals.get(item.video.id) ?? NO_SIGNALS, now, days),
          ]),
        );
        return rankByTaste(items, (item) => tastes.get(item.video.id)!, {
          targeted: options.targeted ?? false,
        }).map((item) => {
          const label = tastes.get(item.video.id)?.label;
          return label ? { ...item, video: { ...item.video, taste: label } } : item;
        });
      } catch {
        console.warn("Taste unavailable, search order kept");
        return items;
      }
    },

    /** Tracks the listener likes or plays most, best first: what « ce que j’aime » asks for. */
    async favourites(owner: string, limit: number) {
      const { tracks } = await this.overview(owner);
      return tracks
        .filter((track) => ["favourite", "frequent", "heard"].includes(track.category))
        .slice(0, limit)
        .map((track) => track.id);
    },

    /** What the listener's plays and opinions say: totals, artists, and every heard track. */
    async overview(owner: string, now = new Date()) {
      const [tracks, days] = await Promise.all([
        heardTracks(db.orm, owner),
        dislikeDays(owner),
      ]);
      const signals = await signalsFor(
        db.orm,
        owner,
        tracks.map((track) => track.id),
        thresholds,
      );
      const scored = tracks.map((track) => {
        const trackSignals = signals.get(track.id) ?? NO_SIGNALS;
        const metadata = track.music_metadata as Parameters<typeof artistName>[0]["musicMetadata"];
        return {
          track,
          artist: artistName({ channel: track.channel, musicMetadata: metadata }),
          signals: trackSignals,
          taste: tasteOf(trackSignals, now, days),
        };
      });
      scored.sort(
        (a, b) =>
          b.taste.score - a.taste.score ||
          b.signals.listens - a.signals.listens ||
          (a.track.title ?? "").localeCompare(b.track.title ?? "", "fr"),
      );
      const count = (test: (entry: (typeof scored)[number]) => boolean) =>
        scored.filter(test).length;
      return {
        dislikeDays: days,
        summary: {
          tracks: count((entry) => entry.signals.listens > 0),
          listens: scored.reduce((total, entry) => total + entry.signals.listens, 0),
          liked: count((entry) => entry.signals.feedback?.value === "like"),
          hidden: count((entry) => entry.taste.hidden),
        },
        artists: artistTastes(scored).slice(0, 12),
        tracks: scored
          .filter((entry) => entry.taste.category !== "unknown")
          .map(({ track, artist, signals: trackSignals, taste }) => ({
            id: track.id,
            title: track.title ?? "",
            channel: track.channel,
            durationSeconds: track.duration_seconds,
            ...(artist ? { artist } : {}),
            category: taste.category,
            categoryTitle: CATEGORY_TITLES[taste.category],
            affinity: taste.affinity,
            listens: trackSignals.listens,
            opinion: trackSignals.feedback?.value ?? null,
            ...(taste.daysLeft === undefined ? {} : { daysLeft: taste.daysLeft }),
            ...(taste.label ? { label: taste.label } : {}),
          })),
      };
    },
  };
}
