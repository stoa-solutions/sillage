import { randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pool } from "./db.ts";
import { hash } from "./content.ts";
const [action, argument] = process.argv.slice(2);
try {
  if (action === "create" && argument) {
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    await pool.query("INSERT INTO tokens(id,name,hash) VALUES($1,$2,$3)", [
      id,
      process.env.TOKEN_NAME ?? "Extension personnelle",
      hash(token),
    ]);
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
    const r = await pool.query(
      "UPDATE tokens SET revoked_at=now() WHERE id=$1",
      [argument],
    );
    console.log(`${r.rowCount} jeton révoqué.`);
  } else
    throw new Error("Usage: token.ts create /chemin/prive.json | revoke UUID");
} finally {
  await pool.end();
}
