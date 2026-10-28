import { it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseRoutes as macosReleases } from "../src/modules/releases/index.ts";
it("serves an empty feed until a release is published and excludes other files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sillage-mac-"));
  vi.stubEnv("MAC_RELEASES_DIR", directory);
  try {
    const app = macosReleases();
    const feed = await app.request("/appcast.xml");
    expect(feed.status).toBe(200);
    expect(await feed.text()).toContain("<channel>");
    expect((await app.request("/application.env")).status).toBe(404);
    expect(
      (await app.request("/Sillage-1.0.0-universal.zip")).status,
    ).toBe(404);
    await writeFile(
      join(directory, "Sillage-1.0.0-universal.zip"),
      "signed-test-archive",
    );
    const archive = await app.request("/Sillage-1.0.0-universal.zip");
    expect(archive.status).toBe(200);
    expect(await archive.text()).toBe("signed-test-archive");
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
