import { createHash } from "node:crypto";
import type { Database } from "../../db/index.ts";
import { BASE_AGENTS, DEFAULT_AGENT } from "./base-agents.ts";
import {
  countOwnAgents,
  deleteOwnAgent,
  findBaseAgent,
  findOwnAgent,
  insertAgent,
  listAgents,
  updateOwnAgent,
  writeBaseAgents,
  type AgentRow,
} from "./dj-agents.repository.ts";

/** Enough for a few moods; keeps a runaway client from filling the table. */
export const MAX_CUSTOM_AGENTS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const baseOrder = new Map<string, number>(
  BASE_AGENTS.map((agent, index) => [agent.key, index]),
);

/** The profile a DJ turn adds to its rules; the default agent adds none. */
export interface ResolvedAgent {
  profile?: { name: string; instructions: string };
  /** What the journal keeps: the text may change later, its hash tells which one was used. */
  trace: {
    id: string;
    name?: string;
    instructionsHash?: string;
    fallback?: true;
  };
}

const publicAgent = (row: AgentRow) => ({
  id: row.baseKey ?? row.id,
  name: row.name,
  instructions: row.instructions,
  base: row.baseKey !== null,
  updatedAt: row.updatedAt.toISOString(),
});

/** Writes the base agents of this release; run at every start, after the migrations. */
export function syncBaseAgents(db: Database) {
  return writeBaseAgents(db.orm, BASE_AGENTS);
}

export function djAgentsService(db: Database) {
  return {
    async list(owner: string) {
      const rows = await listAgents(db.orm, owner);
      const base = rows
        .filter((row) => row.baseKey !== null)
        .sort(
          (a, b) =>
            (baseOrder.get(a.baseKey ?? "") ?? 0) -
            (baseOrder.get(b.baseKey ?? "") ?? 0),
        );
      const own = rows.filter((row) => row.baseKey === null);
      return {
        defaultId: DEFAULT_AGENT,
        agents: [...base, ...own].map(publicAgent),
      };
    },
    async create(owner: string, agent: { name: string; instructions: string }) {
      if ((await countOwnAgents(db.orm, owner)) >= MAX_CUSTOM_AGENTS)
        return "limit" as const;
      return publicAgent(await insertAgent(db.orm, owner, agent));
    },
    async update(
      owner: string,
      id: string,
      agent: { name: string; instructions: string },
    ) {
      const row = await updateOwnAgent(db.orm, owner, id, agent);
      return row ? publicAgent(row) : null;
    },
    remove(owner: string, id: string) {
      return deleteOwnAgent(db.orm, owner, id);
    },

    /**
     * The agent of a DJ turn. An unknown, foreign or deleted agent falls back to the default
     * one instead of failing: a refill sent with a stale selection must still play.
     */
    async resolve(owner: string, requested?: string): Promise<ResolvedAgent> {
      if (!requested || requested === DEFAULT_AGENT)
        return { trace: { id: DEFAULT_AGENT } };
      let row: AgentRow | undefined;
      try {
        row = UUID.test(requested)
          ? await findOwnAgent(db.orm, owner, requested)
          : await findBaseAgent(db.orm, requested);
      } catch {
        console.warn("DJ agent unavailable, default agent used");
      }
      if (!row) return { trace: { id: requested, fallback: true } };
      const trace = {
        id: row.baseKey ?? row.id,
        name: row.name,
        instructionsHash: createHash("sha256")
          .update(row.instructions)
          .digest("hex"),
      };
      return row.instructions
        ? {
            profile: { name: row.name, instructions: row.instructions },
            trace,
          }
        : { trace };
    },
  };
}
