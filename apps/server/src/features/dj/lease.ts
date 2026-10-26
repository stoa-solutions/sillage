/**
 * Turn leases: at most one DJ turn per account, and a bounded number of turns
 * across accounts. The leases live in memory because one API process serves
 * every turn (see docs/architecture.md, « Volume et évolution »).
 *
 * - A typed request supersedes the account's running turn: the client only
 *   sends one while a turn runs when the listener forces it.
 * - A refill never supersedes a typed request; it gives way instead.
 * - When every slot is taken, a request waits for one, typed requests first.
 *   The turn's deadline starts once it holds its slot.
 */

export type LeaseTrigger = "user" | "continuation";

export class TurnRefused extends Error {
  constructor(
    readonly reason: "busy" | "saturated",
    message: string,
  ) {
    super(message);
  }
}

/** Why a lease's signal was aborted, as recorded in the journal. */
export class TurnSuperseded extends Error {
  constructor() {
    super("Une demande plus récente a remplacé ce tour.");
  }
}
export class TurnDeadline extends Error {
  constructor() {
    super("Le DJ a dépassé son temps de réflexion.");
  }
}

export interface Lease {
  /** Aborted when superseded, past the deadline, or when the client leaves. */
  readonly signal: AbortSignal;
  release(): void;
}

interface Active {
  trigger: LeaseTrigger;
  controller: AbortController;
  released: Promise<void>;
}
interface Waiter {
  account: string;
  trigger: LeaseTrigger;
  grant: () => void;
  refuse: (error: TurnRefused) => void;
}

export interface LeaseOptions {
  capacity?: number;
  deadlineMs?: number;
  maxWaitMs?: number;
}

export class TurnLeases {
  private readonly active = new Map<string, Active>();
  private readonly waiting: Waiter[] = [];
  readonly capacity: number;
  readonly deadlineMs: number;
  readonly maxWaitMs: number;

  constructor({
    capacity = 2,
    deadlineMs = 180_000,
    maxWaitMs = 30_000,
  }: LeaseOptions = {}) {
    this.capacity = Math.max(1, capacity);
    this.deadlineMs = deadlineMs;
    this.maxWaitMs = maxWaitMs;
  }

  /** Whether an account currently runs a turn (used by the settings check). */
  busy(account: string) {
    return this.active.has(account);
  }

  async acquire(
    account: string,
    trigger: LeaseTrigger,
    client?: AbortSignal,
  ): Promise<Lease> {
    const queued = this.waiting.find((waiter) => waiter.account === account);
    if (queued) {
      if (trigger === "continuation" && queued.trigger === "user")
        throw new TurnRefused(
          "busy",
          "Ta demande passe avant la suite automatique.",
        );
      this.waiting.splice(this.waiting.indexOf(queued), 1);
      queued.refuse(
        new TurnRefused("busy", "Une demande plus récente a pris la main."),
      );
    }
    const running = this.active.get(account);
    if (running) {
      if (trigger === "continuation" && running.trigger === "user")
        throw new TurnRefused(
          "busy",
          "Ta demande passe avant la suite automatique.",
        );
      running.controller.abort(new TurnSuperseded());
      await running.released;
    }
    // A request superseded while it was itself waiting for its predecessor.
    if (this.active.has(account) || client?.aborted)
      throw new TurnRefused("busy", "Une demande plus récente a pris la main.");
    if (this.active.size >= this.capacity) await this.wait(account, trigger);
    return this.grant(account, trigger, client);
  }

  private wait(account: string, trigger: LeaseTrigger) {
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        account,
        trigger,
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
        refuse: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(waiter), 1);
        reject(
          new TurnRefused(
            "saturated",
            "Le DJ est très demandé. Réessaie dans un instant ; ta musique continue.",
          ),
        );
      }, this.maxWaitMs);
      // Typed requests wait ahead of refills, each group in arrival order.
      const after = this.waiting.findIndex(
        (other) => trigger === "user" && other.trigger === "continuation",
      );
      this.waiting.splice(after < 0 ? this.waiting.length : after, 0, waiter);
    });
  }

  private grant(
    account: string,
    trigger: LeaseTrigger,
    client?: AbortSignal,
  ): Lease {
    const controller = new AbortController();
    const deadline = setTimeout(
      () => controller.abort(new TurnDeadline()),
      this.deadlineMs,
    );
    const onClientGone = () => controller.abort(client?.reason);
    // The client may have left while this request waited for a slot.
    if (client?.aborted) onClientGone();
    else client?.addEventListener("abort", onClientGone, { once: true });
    let finish!: () => void;
    const released = new Promise<void>((resolve) => (finish = resolve));
    const entry: Active = { trigger, controller, released };
    this.active.set(account, entry);
    let done = false;
    return {
      signal: controller.signal,
      release: () => {
        if (done) return;
        done = true;
        clearTimeout(deadline);
        client?.removeEventListener("abort", onClientGone);
        if (this.active.get(account) === entry) this.active.delete(account);
        finish();
        this.next();
      },
    };
  }

  private next() {
    while (this.active.size < this.capacity) {
      const index = this.waiting.findIndex(
        (waiter) => !this.active.has(waiter.account),
      );
      if (index < 0) return;
      const [waiter] = this.waiting.splice(index, 1);
      // Reserve the slot synchronously so two releases cannot both grant it.
      this.active.set(waiter.account, {
        trigger: waiter.trigger,
        controller: new AbortController(),
        released: Promise.resolve(),
      });
      waiter.grant();
    }
  }
}
