import type { Database } from "../../db/index.ts";
import type { JobHandler } from "../jobs/index.ts";
import { indexImage, indexText } from "./indexing.service.ts";

const videoId = (payload: Record<string, string>) => {
  const id = payload["videoId"];
  if (!id) throw new Error("Tâche sans vidéo.");
  return id;
};

export function indexingJobHandlers(
  db: Database,
): Record<"text" | "image", JobHandler> {
  return {
    text: (job) => indexText(db, videoId(job.payload)),
    image: (job) => indexImage(db, videoId(job.payload)),
  };
}
