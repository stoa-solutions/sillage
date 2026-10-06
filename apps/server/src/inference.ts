import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { fork, type ChildProcess } from "node:child_process";
let child: ChildProcess | undefined;
let childKind = "";
let childRss = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
function release() {
  child?.kill("SIGKILL");
  child = undefined;
  childKind = "";
  childRss = 0;
}
async function execute(task: string, data: unknown): Promise<unknown> {
  if (idleTimer) clearTimeout(idleTimer);
  const kind = ["query", "passages"].includes(task) ? "text" : task;
  if (child && childKind !== kind) {
    const previous = child;
    release();
    await new Promise<void>((resolve) => {
      if (previous.exitCode !== null || previous.signalCode !== null) resolve();
      else previous.once("exit", () => resolve());
    });
  }
  if (!child) {
    child = fork(new URL("./model-process.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    childKind = kind;
  }
  const process = child;
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        release();
        reject(new Error("Model timed out"));
      }, 150000);
      const cleanup = () => {
        clearTimeout(timeout);
        process.removeListener("message", message);
        process.removeListener("exit", exit);
        process.removeListener("error", error);
      };
      const message = (response: any) => {
        cleanup();
        childRss = response.rss ?? 0;
        if (response.error) reject(new Error(response.error));
        else resolve(response.result);
      };
      const exit = () => {
        cleanup();
        if (child === process) {
          child = undefined;
          childKind = "";
          childRss = 0;
        }
        reject(new Error("Model process stopped"));
      };
      const error = (e: Error) => {
        cleanup();
        release();
        reject(e);
      };
      process.once("message", message);
      process.once("exit", exit);
      process.once("error", error);
      process.send({ task, data });
    });
  } finally {
    idleTimer = setTimeout(() => release(), 60000);
  }
}
process.on("SIGTERM", () => {
  release();
  process.exit(0);
});
type Pending = {
  task: string;
  data: unknown;
  interactive: boolean;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};
const queue: Pending[] = [];
let running = false;
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    queue.sort((a, b) => Number(b.interactive) - Number(a.interactive));
    const item = queue.shift()!;
    try {
      item.resolve(await execute(item.task, item.data));
    } catch (error) {
      item.reject(
        error instanceof Error ? error : new Error("Inference failed"),
      );
    }
  }
  running = false;
}
const app = new Hono();
app.use("*", bodyLimit({ maxSize: 3 * 1024 * 1024 }));
app.get("/health", (c) =>
  c.json({
    ok: true,
    vision: process.env.VISION_ENABLED === "true",
    loaded: childKind || null,
    rss: process.memoryUsage().rss + childRss,
    queue: queue.length,
  }),
);
app.post("/:task", async (c) => {
  const task = c.req.param("task");
  if (!["query", "passages", "image", "visual-query"].includes(task))
    return c.json({ error: "Unknown task" }, 404);
  if (queue.length >= 20) return c.json({ error: "Busy" }, 503);
  const schema =
    task === "image"
      ? z.object({ base64: z.string().min(1).max(2800000) })
      : z.object({
          text: z
            .string()
            .min(1)
            .max(task === "passages" ? 30000 : 1000),
        });
  const data = schema.safeParse(await c.req.json());
  if (!data.success) return c.json({ error: "Invalid input" }, 400);
  try {
    const result = await new Promise((resolve, reject) => {
      queue.push({
        task,
        data: data.data,
        interactive: c.req.header("X-Priority") === "interactive",
        resolve,
        reject,
      });
      void drain();
    });
    return c.json(result);
  } catch (error) {
    console.error(
      "Inference:",
      error instanceof Error ? error.message : "failed",
    );
    return c.json({ error: "Model unavailable" }, 503);
  }
});
serve({
  fetch: app.fetch,
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 3002),
});
