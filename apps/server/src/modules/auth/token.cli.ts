import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, eq, isNotNull } from "drizzle-orm";
import { pool, tokens, users } from "../../db/index.ts";
import { hash } from "../../shared/content.ts";

/**
 * Personal tokens for scripts and the MCP endpoint, from inside the API container:
 * `create <account email> <private file>` writes the connection once; `revoke <id>` ends it.
 * The account must have signed in with Google at least once.
 */
const [action, argument, file] = process.argv.slice(2);
try {
  if (action === "create" && argument && file) {
    const [account] = await pool.orm
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, argument), isNotNull(users.googleSub)));
    if (!account)
      throw new Error(`Aucun compte Google pour ${argument} : se connecter d’abord depuis l’app.`);
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    await pool.orm.insert(tokens).values({
      id,
      name: process.env["TOKEN_NAME"] ?? "Jeton personnel",
      hash: hash(token),
      userId: account.id,
    });
    await writeFile(
      file,
      JSON.stringify(
        {
          url: process.env["PUBLIC_URL"] ?? "https://sillage.stoa.solutions",
          token,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    console.log(`Jeton créé : ${id}. Connexion écrite dans le fichier privé.`);
  } else if (action === "revoke" && argument) {
    const revoked = await pool.orm
      .update(tokens)
      .set({ revokedAt: new Date() })
      .where(eq(tokens.id, argument))
      .returning({ id: tokens.id });
    console.log(`${revoked.length} jeton révoqué.`);
  } else
    throw new Error(
      "Usage: token.cli.ts create email@exemple.fr /chemin/prive.json | revoke UUID",
    );
} finally {
  await pool.end();
}
