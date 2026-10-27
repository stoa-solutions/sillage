import { provisionDeveloperToken } from "./developer-provision.ts";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import {
  developerFile,
  readDeveloperConnection,
  writeDeveloperConnection,
} from "./developer-access.ts";

// Only the token hash leaves this Mac during provisioning. The API already supports
// account-scoped sessions, so no global administrator credential or migration is needed.

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

async function main() {
  const existing = await readDeveloperConnection();
  if (process.argv.includes("--revoke")) {
    if (!existing?.provisioned)
      throw new Error("Aucun accès de développement actif.");
    const response = await fetch(existing.url + "/v1/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${existing.token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (
      response.status !== 401 &&
      (!response.ok || !(await response.json()).saved)
    )
      throw new Error(
        "La révocation n’a pas pu être confirmée ; le fichier privé est conservé.",
      );
    await rm(developerFile());
    console.log(
      "Accès de développement révoqué. La connexion de l’app reste active.",
    );
    return;
  }
  const email = process.argv
    .find((argument) => argument.startsWith("--email="))
    ?.slice(8);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error(
      "Indique le compte Google existant : npm run docs:connect -- --email=adresse@example.com",
    );
  if (existing && existing.email.toLowerCase() !== email.toLowerCase())
    throw new Error(
      "Révoque l’accès de développement existant avant de changer de compte.",
    );
  const draft = existing ?? {
    id: randomUUID(),
    token: "sillage_dev_" + randomBytes(32).toString("base64url"),
    email,
    url: "https://recall.stoa.solutions",
    provisioned: false,
  };
  // Persist the draft first: an interrupted SSH response can be retried with the same ID.
  if (!existing) await writeDeveloperConnection(draft);
  const host = process.env["SILLAGE_DEV_SSH_HOST"] ?? "root@109.199.114.247";
  const port = process.env["SILLAGE_DEV_SSH_PORT"] ?? "7544";
  const container =
    process.env["SILLAGE_DEV_CONTAINER"] ?? "playlist-recall-app-wvpmwu-api-1";
  const command = [
    "docker",
    "exec",
    "-i",
    container,
    "node",
    "--input-type=module",
    "-e",
    provisionDeveloperToken,
  ]
    .map(quote)
    .join(" ");
  const result = spawnSync(
    "ssh",
    ["-p", port, "-o", "ConnectTimeout=15", host, command],
    {
      input: JSON.stringify({
        id: draft.id,
        email,
        hash: createHash("sha256").update(draft.token).digest("hex"),
      }),
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 32_768,
    },
  );
  if (result.status !== 0)
    throw new Error(
      "L’autorisation SSH du serveur n’a pas abouti. Relance la même commande ; aucun nouveau jeton ne sera créé en double.",
    );
  const metadata = JSON.parse(result.stdout) as {
    userId: string;
    expiresAt: string;
  };
  await writeDeveloperConnection({ ...draft, ...metadata, provisioned: true });
  console.log(
    `Accès de développement prêt pour ${email}. Identifiant révocable : ${draft.id}.`,
  );
  console.log(
    "Le jeton reste dans ~/.config/sillage/developer.json. Swagger et Postman l’utilisent via http://127.0.0.1:3030/proxy ; aucune clé à recopier.",
  );
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Configuration de développement impossible.",
  );
  process.exitCode = 1;
});
