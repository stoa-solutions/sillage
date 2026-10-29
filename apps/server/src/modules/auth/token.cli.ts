import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { pool, tokens } from "../../db/index.ts";
import { hash } from "../../shared/content.ts";

/**
 * Personal tokens for scripts and the MCP endpoint, from inside the API container:
 * `create <private file>` writes the connection once; `revoke <id>` ends it.
 */
const [action, argument] = process.argv.slice(2);
try {
  if (action === "create" && argument) {
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    await pool.orm.insert(tokens).values({
      id,
      name: process.env["TOKEN_NAME"] ?? "Jeton personnel",
      hash: hash(token),
    });
    await writeFile(
      argument,
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
      "Usage: token-cli.ts create /chemin/prive.json | revoke UUID",
    );
} finally {
  await pool.end();
}
