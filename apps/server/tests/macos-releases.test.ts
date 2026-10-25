import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { macosReleases } from "../src/macos-releases.ts";
let directory: string;
let previous: string | undefined;
beforeEach(async () => {
  previous = process.env.MAC_RELEASES_DIR;
  directory = await mkdtemp(join(tmpdir(), "recall-releases-test-"));
  process.env.MAC_RELEASES_DIR = directory;
});
afterEach(async () => {
  if (previous === undefined) delete process.env.MAC_RELEASES_DIR;
  else process.env.MAC_RELEASES_DIR = previous;
  await rm(directory, { recursive: true, force: true });
});
test("serves ZIP updates while excluding private files", async () => {
  const app = macosReleases();
  expect((await app.request('/application.env')).status).toBe(404);
  expect((await app.request('/Playlist-Recall-1.0.0-universal.zip')).status).toBe(404);
  await writeFile(join(directory, 'Playlist-Recall-1.0.0-universal.zip'), 'signed-test-archive');
  const archive = await app.request('/Playlist-Recall-1.0.0-universal.zip');
  expect(archive.status).toBe(200);
  expect(archive.headers.get('content-type')).toBe('application/zip');
  expect(await archive.text()).toBe('signed-test-archive');
});
test("only offers downloads when the declared installer exists", async () => {
  const app = macosReleases();
  expect((await app.request('/download')).status).toBe(503);
  expect(await (await app.request('/')).text()).not.toContain('href="/macos/download"');
  await writeFile(join(directory, 'download.json'), JSON.stringify({installer:'../../secret.dmg'}));
  expect((await app.request('/download')).status).toBe(503);
  await writeFile(join(directory, 'download.json'), JSON.stringify({installer:'Playlist-Recall-1.4.3-universal.dmg',notarized:false}));
  expect((await app.request('/download')).status).toBe(503);
  await writeFile(join(directory, 'Playlist-Recall-1.4.3-universal.dmg'), 'installer-test');
  expect((await app.request('/download')).headers.get('location')).toBe('/macos/Playlist-Recall-1.4.3-universal.dmg');
  const page = await (await app.request('/')).text();
  expect(page).toContain('href="/macos/download"');
  expect(page).toContain('pas encore notarisée');
  const file = await app.request('/Playlist-Recall-1.4.3-universal.dmg');
  expect(file.headers.get('content-type')).toBe('application/x-apple-diskimage');
  expect(await file.text()).toBe('installer-test');
  expect((await app.request('/download.json')).status).toBe(404);
  // A locally signed installer must never silently become a Sparkle update.
  expect(await (await app.request('/appcast.xml')).text()).not.toContain('<item>');
});
