import { test } from "node:test";
import assert from "node:assert/strict";
import { violations } from "./check-architecture.mjs";

test("shared contracts cannot import server implementations, even through re-exports", () => {
  assert.equal(
    violations(
      "packages/core/src/leak.ts",
      'export { pool } from "../../../apps/server/src/db.ts"',
    ).length,
    1,
  );
  assert.equal(
    violations(
      "packages/core/src/types.ts",
      'import type { Video } from "./model.ts"',
    ).length,
    0,
  );
});
test("client bundles cannot import server code or Node via dynamic imports", () => {
  assert.equal(
    violations(
      "apps/extension/src/leak.ts",
      'import("../../server/src/dj-settings.ts")',
    ).length,
    1,
  );
  assert.equal(
    violations("apps/extension/src/leak.ts", 'import fs from "node:fs"').length,
    1,
  );
});
test("pure policy allows type-only adapter references, but rejects runtime imports and effects", () => {
  const file = "apps/server/src/features/dj/decision.ts";
  assert.equal(
    violations(file, 'import type { ChatMessage } from "./provider.ts"').length,
    0,
  );
  assert.equal(
    violations(file, 'import { type ChatMessage } from "./provider.ts"').length,
    0,
  );
  assert.equal(
    violations(file, 'import { completeTurn } from "./provider.ts"').length,
    1,
  );
  assert.equal(violations(file, 'fetch("url"); process.env.KEY;').length, 2);
  assert.equal(violations(file, "import(adapterPath)").length, 1);
});
test("DJ internals cannot introduce facade cycles or untyped boundaries", () => {
  assert.equal(
    violations(
      "apps/server/src/features/dj/turn.ts",
      'import { reserveDj } from "../../dj.ts"',
    ).length,
    1,
  );
  assert.equal(
    violations("apps/server/src/features/dj/turn.ts", "const data: any = {};")
      .length,
    1,
  );
  assert.equal(
    violations(
      "apps/server/src/features/dj/turn.ts",
      "// any fetch process.env\nconst data: unknown = {};",
    ).length,
    0,
  );
});

test("checks bare Node/workspace imports and permits type-only re-exports", () => {
  const extension = "apps/extension/src/leak.ts";
  assert.equal(violations(extension, 'import fs from "fs"').length, 1);
  assert.equal(
    violations(extension, 'import "@playlist-recall/server"').length,
    1,
  );
  assert.equal(
    violations(
      "apps/server/src/features/dj/decision.ts",
      'export { type ChatMessage } from "./provider.ts"',
    ).length,
    0,
  );
});
test("a feature reaches another feature only through its index", () => {
  const file = "apps/server/src/features/accounts/routes.ts";
  assert.equal(
    violations(file, 'import { revokeSession } from "../auth/store.ts"').length,
    1,
  );
  assert.equal(
    violations(file, 'import { revokeSession } from "../auth/index.ts"').length,
    0,
  );
  assert.equal(
    violations(
      "apps/server/src/app.ts",
      'import { sessionGuard } from "./features/auth/session.ts"',
    ).length,
    1,
  );
  assert.equal(
    violations(file, 'import { claimLibraryInput } from "./contracts.ts"').length,
    0,
  );
});
