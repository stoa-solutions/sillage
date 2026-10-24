import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { restoreConnection, saveConnection, storedConnection } from "../src/server-client";
const key = "playlist-recall-server-v2";
const connection = { url: "https://recall.stoa.solutions", token: "personal-installation-token" };
let local: Map<string, string>;
let durable: Record<string, unknown>;
beforeEach(() => {
  local = new Map(); durable = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => local.set(k, v),
    removeItem: (k: string) => local.delete(k),
  });
  vi.stubGlobal("chrome", { storage: { local: {
    get: async (k: string) => ({ [k]: durable[k] }),
    set: async (value: Record<string, unknown>) => Object.assign(durable, value),
    remove: async (k: string) => { delete durable[k]; },
  } } });
});
afterEach(() => vi.unstubAllGlobals());
it("migrates the existing connection and restores it when page storage is empty", async () => {
  local.set(key, JSON.stringify(connection));
  expect(await restoreConnection()).toEqual(connection);
  local.clear();
  expect(await restoreConnection()).toEqual(connection);
  expect(storedConnection()).toEqual(connection);
});
it("removes both copies on explicit disconnection", async () => {
  await saveConnection(connection);
  await saveConnection(null);
  expect(await restoreConnection()).toBeNull();
});
it("does not restore a connection to an unexpected server", async () => {
  durable[key] = { ...connection, url: "https://example.com" };
  expect(await restoreConnection()).toBeNull();
});
