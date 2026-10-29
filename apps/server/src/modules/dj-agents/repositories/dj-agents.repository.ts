import {
  and,
  asc,
  count,
  eq,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { djAgents, users, type Orm } from "../../../db/index.ts";

const columns = {
  id: djAgents.id,
  baseKey: djAgents.baseKey,
  name: djAgents.name,
  instructions: djAgents.instructions,
  updatedAt: djAgents.updatedAt,
};
export type AgentRow = {
  id: string;
  baseKey: string | null;
  name: string;
  instructions: string;
  updatedAt: Date;
};

/** Base agents and the account's own, oldest first; the service orders the base ones. */
export function listAgents(orm: Orm, owner: string): Promise<AgentRow[]> {
  return orm
    .select(columns)
    .from(djAgents)
    .where(or(isNull(djAgents.userId), eq(djAgents.userId, owner)))
    .orderBy(asc(djAgents.createdAt), asc(djAgents.id));
}

export async function findBaseAgent(orm: Orm, key: string) {
  const [row] = await orm
    .select(columns)
    .from(djAgents)
    .where(eq(djAgents.baseKey, key));
  return row;
}

export async function findOwnAgent(orm: Orm, owner: string, id: string) {
  const [row] = await orm
    .select(columns)
    .from(djAgents)
    .where(and(eq(djAgents.id, id), eq(djAgents.userId, owner)));
  return row;
}

/**
 * Inserts an agent unless the account already has `limit`. The account's row is locked first,
 * so concurrent creations count one after another instead of all seeing the same free place.
 */
export async function insertAgentWithin(
  orm: Orm,
  owner: string,
  agent: { name: string; instructions: string },
  limit: number,
): Promise<AgentRow | null> {
  return orm.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, owner))
      .for("update");
    const [owned] = await tx
      .select({ value: count() })
      .from(djAgents)
      .where(eq(djAgents.userId, owner));
    if ((owned?.value ?? 0) >= limit) return null;
    const [row] = await tx
      .insert(djAgents)
      .values({ userId: owner, ...agent })
      .returning(columns);
    if (!row) throw new Error("Agent not inserted");
    return row;
  });
}

export async function updateOwnAgent(
  orm: Orm,
  owner: string,
  id: string,
  agent: { name: string; instructions: string },
) {
  const [row] = await orm
    .update(djAgents)
    .set({ ...agent, updatedAt: new Date() })
    .where(and(eq(djAgents.id, id), eq(djAgents.userId, owner)))
    .returning(columns);
  return row;
}

export async function deleteOwnAgent(orm: Orm, owner: string, id: string) {
  const deleted = await orm
    .delete(djAgents)
    .where(and(eq(djAgents.id, id), eq(djAgents.userId, owner)))
    .returning({ id: djAgents.id });
  return deleted.length > 0;
}

/** Writes the base agents as given and removes those no longer in code, in one transaction. */
export async function writeBaseAgents(
  orm: Orm,
  agents: readonly { key: string; name: string; instructions: string }[],
) {
  await orm.transaction(async (tx) => {
    const keys = agents.map((agent) => agent.key);
    await tx
      .delete(djAgents)
      .where(
        and(
          isNull(djAgents.userId),
          isNotNull(djAgents.baseKey),
          notInArray(djAgents.baseKey, keys),
        ),
      );
    for (const agent of agents)
      await tx
        .insert(djAgents)
        .values({
          baseKey: agent.key,
          name: agent.name,
          instructions: agent.instructions,
        })
        .onConflictDoUpdate({
          target: djAgents.baseKey,
          set: {
            name: agent.name,
            instructions: agent.instructions,
            // An unchanged text keeps its date, so a client cache stays valid across restarts.
            updatedAt: sql`CASE WHEN ${djAgents.name} = ${agent.name} AND ${djAgents.instructions} = ${agent.instructions} THEN ${djAgents.updatedAt} ELSE now() END`,
          },
        });
  });
}
