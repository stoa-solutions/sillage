import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pool } from "../../db.ts";
import { hash } from "../../content.ts";

/**
 * Personal tokens for the extension and scripts, from inside the API container:
 * `create <private file>` writes the connection once; `revoke <id>` ends it.
 */
const [action, argument] = process.argv.slice(2);
try {
  if (action === "create" && argument) {
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    await pool.prisma.sessionToken.create({
      data: {
        id,
        name: process.env.TOKEN_NAME ?? "Extension personnelle",
        hash: hash(token),
      },
    });
    await writeFile(
      argument,
      JSON.stringify(
        {
          url: process.env.PUBLIC_URL ?? "https://recall.stoa.solutions",
          token,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    console.log(`Jeton créé : ${id}. Connexion écrite dans le fichier privé.`);
  } else if (action === "revoke" && argument) {
    const { count } = await pool.prisma.sessionToken.updateMany({
      where: { id: argument },
      data: { revokedAt: new Date() },
    });
    console.log(`${count} jeton révoqué.`);
  } else
    throw new Error(
      "Usage: token-cli.ts create /chemin/prive.json | revoke UUID",
    );
} finally {
  await pool.prisma.$disconnect();
  await pool.end();
}
