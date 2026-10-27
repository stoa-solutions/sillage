import { constants } from "node:fs";
import { open, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export const developerFile = () =>
  process.env["SILLAGE_DEV_CONNECTION"] ??
  join(homedir(), ".config", "sillage", "developer.json");
export const developerConnection = z.object({
  id: z.string().uuid(),
  token: z.string().regex(/^sillage_dev_[A-Za-z0-9_-]{43}$/),
  url: z.string().url(),
  email: z.string().email(),
  provisioned: z.boolean(),
  userId: z.string().uuid().optional(),
  expiresAt: z.string().optional(),
});
export type DeveloperConnection = z.infer<typeof developerConnection>;

/** Separate development credential; never reads the installed app's private session. */
export async function readDeveloperConnection(
  filename = developerFile(),
): Promise<DeveloperConnection | null> {
  const file = await open(
    filename,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw new Error("Le fichier de développement ne peut pas être ouvert.");
  });
  if (!file) return null;
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > 16_384 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      throw new Error(
        "Le fichier de développement doit être privé (600) et appartenir au compte macOS courant.",
      );
    return developerConnection.parse(JSON.parse(await file.readFile("utf8")));
  } catch {
    throw new Error(
      "Le fichier de développement est invalide ou n’est pas privé.",
    );
  } finally {
    await file.close();
  }
}

export async function writeDeveloperConnection(
  value: DeveloperConnection,
  filename = developerFile(),
) {
  const checked = developerConnection.parse(value);
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  const file = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      await file.writeFile(JSON.stringify(checked));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function activeDeveloperConnection(
  target: string,
  filename = developerFile(),
) {
  const connection = await readDeveloperConnection(filename);
  if (!connection?.provisioned) return null;
  if (connection.url !== target)
    throw new Error("Ce jeton de développement appartient à un autre serveur.");
  return connection;
}
