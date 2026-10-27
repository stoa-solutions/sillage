import { expect, it } from "vitest";
import { checkEnvironment } from "../src/config.ts";

const base = { DATABASE_URL: "postgres://user:secret@db:5432/sillage" };

it("accepts a minimal API environment and treats empty values as unset", () => {
  expect(() =>
    checkEnvironment("api", { ...base, SEARXNG_URL: "", PORT: "3001" }),
  ).not.toThrow();
});

it("names every invalid variable without echoing its value", () => {
  let message = "";
  try {
    checkEnvironment("api", {
      ...base,
      DJ_SETTINGS_ENCRYPTION_KEY: "not-hex-secret-value",
      ALLOWED_ORIGINS: "https://ok.example,not a url",
      GOOGLE_CLIENT_ID: "only-the-id",
    });
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain("DJ_SETTINGS_ENCRYPTION_KEY");
  expect(message).toContain("ALLOWED_ORIGINS");
  expect(message).toContain("GOOGLE_CLIENT_SECRET");
  expect(message).not.toContain("not-hex-secret-value");
});

it("requires the database for the API, the worker and migrations, not for inference", () => {
  expect(() => checkEnvironment("worker", {})).toThrow("DATABASE_URL");
  expect(() => checkEnvironment("migrate", {})).toThrow("DATABASE_URL");
  expect(() => checkEnvironment("inference", { PORT: "3002" })).not.toThrow();
});
