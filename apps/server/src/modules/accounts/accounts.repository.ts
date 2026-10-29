import { eq, sql } from "drizzle-orm";
import { users, type Orm } from "../../db/index.ts";

export interface AccountProfile {
  id: string;
  email: string | null;
  name: string | null;
  /** Always true since every account signs in with Google; kept for installed clients. */
  google: boolean;
}

export async function accountProfile(
  orm: Orm,
  userId: string,
): Promise<AccountProfile | null> {
  const [profile] = await orm
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      google: sql<boolean>`${users.googleSub} IS NOT NULL`,
    })
    .from(users)
    .where(eq(users.id, userId));
  return profile ?? null;
}
