import type { LibraryImport } from "@playlist-recall/core/types";
import type { Database } from "../../db/index.ts";
import { enqueueMissing } from "../../indexing.ts";
import { importIntoLegacyLibrary } from "./store.ts";

/** Maintenance import of a backup into the historical account, then its missing indexes. */
export async function importLibrary(db: Database, library: LibraryImport) {
  await importIntoLegacyLibrary(db.orm, library);
  await enqueueMissing(db);
}
