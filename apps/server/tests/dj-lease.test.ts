import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  TurnDeadline,
  TurnLeases,
  TurnRefused,
  TurnSuperseded,
} from "../src/features/dj/lease.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("lets a forced message supersede the account's running turn", async () => {
  const leases = new TurnLeases();
  const first = await leases.acquire("alice", "user");
  const second = leases.acquire("alice", "user");
  expect(first.signal.reason).toBeInstanceOf(TurnSuperseded);
  first.release();
  const lease = await second;
  expect(lease.signal.aborted).toBe(false);
  expect(leases.busy("alice")).toBe(true);
});

it("never lets a refill interrupt a typed request", async () => {
  const leases = new TurnLeases();
  const typed = await leases.acquire("alice", "user");
  await expect(leases.acquire("alice", "continuation")).rejects.toMatchObject({
    reason: "busy",
  });
  expect(typed.signal.aborted).toBe(false);
});

it("replaces a refill with a typed request", async () => {
  const leases = new TurnLeases();
  const refill = await leases.acquire("alice", "continuation");
  const typed = leases.acquire("alice", "user");
  expect(refill.signal.reason).toBeInstanceOf(TurnSuperseded);
  refill.release();
  await expect(typed).resolves.toBeDefined();
});

it("waits for a free slot, serving typed requests before refills", async () => {
  const leases = new TurnLeases({ capacity: 1 });
  const running = await leases.acquire("alice", "user");
  const order: string[] = [];
  const refill = leases
    .acquire("bob", "continuation")
    .then((lease) => (order.push("bob"), lease));
  const typed = leases
    .acquire("carol", "user")
    .then((lease) => (order.push("carol"), lease));
  running.release();
  (await typed).release();
  await refill;
  expect(order).toEqual(["carol", "bob"]);
});

it("gives up waiting after the bounded delay", async () => {
  const leases = new TurnLeases({ capacity: 1, maxWaitMs: 30_000 });
  await leases.acquire("alice", "user");
  const waiting = leases.acquire("bob", "user");
  vi.advanceTimersByTime(30_000);
  await expect(waiting).rejects.toMatchObject({ reason: "saturated" });
});

it("starts the deadline once the slot is held, not while waiting", async () => {
  const leases = new TurnLeases({ capacity: 1, deadlineMs: 1_000 });
  const running = await leases.acquire("alice", "user");
  const waiting = leases.acquire("bob", "user");
  vi.advanceTimersByTime(900);
  running.release();
  const lease = await waiting;
  vi.advanceTimersByTime(900);
  expect(lease.signal.aborted).toBe(false);
  vi.advanceTimersByTime(100);
  expect(lease.signal.reason).toBeInstanceOf(TurnDeadline);
});

it("ends the turn when the client leaves", async () => {
  const leases = new TurnLeases();
  const client = new AbortController();
  const lease = await leases.acquire("alice", "user", client.signal);
  client.abort();
  expect(lease.signal.aborted).toBe(true);
  lease.release();
  expect(leases.busy("alice")).toBe(false);
});

it("drops a queued request when the same account sends a newer one", async () => {
  const leases = new TurnLeases({ capacity: 1 });
  const running = await leases.acquire("alice", "user");
  const older = leases.acquire("bob", "user");
  const newer = leases.acquire("bob", "user");
  await expect(older).rejects.toBeInstanceOf(TurnRefused);
  running.release();
  await expect(newer).resolves.toBeDefined();
});

it("cancels a waiting request whose client left before it got a slot", async () => {
  const leases = new TurnLeases({ capacity: 1 });
  const running = await leases.acquire("alice", "user");
  const client = new AbortController();
  const waiting = leases.acquire("bob", "user", client.signal);
  client.abort();
  running.release();
  expect((await waiting).signal.aborted).toBe(true);
});
