export async function infer<T>(
  task: string,
  input: Record<string, unknown>,
  priority = "background",
): Promise<T> {
  const response = await fetch(
    `${process.env.INFERENCE_URL ?? "http://127.0.0.1:3002"}/${task}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Priority": priority },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180000),
    },
  );
  if (!response.ok)
    throw new Error(`Calcul ${task} indisponible (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}
