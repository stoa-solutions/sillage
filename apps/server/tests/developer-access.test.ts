import { it, expect } from "vitest";
import { mkdtemp, chmod, stat, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activeDeveloperConnection,
  readDeveloperConnection,
  writeDeveloperConnection,
} from "../src/api-docs/developer-access.ts";

const access = {
  id: "00000000-0000-4000-8000-000000000002",
  token: "sillage_dev_" + "a".repeat(43),
  url: "https://api.example.test",
  email: "dev@example.test",
  provisioned: true,
};

it("stores the separate developer session privately, and binds it to the exact API origin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sillage-dev-test-"));
  const filename = join(dir, "private", "developer.json");
  try {
    expect(await readDeveloperConnection(filename)).toBeNull();
    await writeDeveloperConnection(access, filename);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, "private"))).mode & 0o777).toBe(0o700);
    expect(await activeDeveloperConnection(access.url, filename)).toEqual(
      access,
    );
    await expect(
      activeDeveloperConnection("https://other.test", filename),
    ).rejects.toThrow("autre serveur");
    await writeDeveloperConnection({ ...access, provisioned: false }, filename);
    expect(await activeDeveloperConnection(access.url, filename)).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("refuses readable or symlinked credential files without returning their contents in errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sillage-dev-test-"));
  const filename = join(dir, "developer.json");
  try {
    await writeDeveloperConnection(access, filename);
    await chmod(filename, 0o644);
    await expect(readDeveloperConnection(filename)).rejects.toThrow("privé");
    await chmod(filename, 0o600);
    await symlink(filename, join(dir, "link.json"));
    await expect(
      readDeveloperConnection(join(dir, "link.json")),
    ).rejects.toThrow("ouvert");
    await writeFile(filename, access.token);
    try {
      await readDeveloperConnection(filename);
      throw new Error("Expected refusal");
    } catch (error) {
      expect(String(error)).not.toContain(access.token);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
