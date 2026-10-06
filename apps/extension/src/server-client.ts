export interface Connection {
  url: string;
  token: string;
}
const KEY = "playlist-recall-server-v2";
export function validateConnection(value: unknown): Connection {
  if (!value || typeof value !== "object")
    throw new Error("Fichier de connexion invalide.");
  const { url, token } = value as Connection;
  if (
    typeof url !== "string" ||
    typeof token !== "string" ||
    token.length < 20 ||
    token.length > 256
  )
    throw new Error("URL ou jeton invalide.");
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname)
    )
  )
    throw new Error("Une adresse HTTPS est requise.");
  if (
    !["https://recall.stoa.solutions", "http://127.0.0.1:3001"].includes(
      parsed.origin,
    )
  )
    throw new Error(
      "Cette extension est configurée pour recall.stoa.solutions.",
    );
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/"
  )
    throw new Error("Utilisez uniquement l’adresse du serveur.");
  return { url: parsed.origin, token };
}
export function storedConnection(): Connection | null {
  try {
    const value = localStorage.getItem(KEY);
    return value ? validateConnection(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}
export function saveConnection(connection: Connection | null) {
  if (connection) localStorage.setItem(KEY, JSON.stringify(connection));
  else localStorage.removeItem(KEY);
}
export async function api<T>(
  connection: Connection,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${connection.url}/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal ?? AbortSignal.timeout(180000),
    credentials: "omit",
  });
  const value = await response
    .json()
    .catch(() => ({ error: "Réponse serveur illisible." }));
  if (!response.ok)
    throw new Error(
      value.error ?? `Serveur indisponible (${response.status}).`,
    );
  return value as T;
}
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
