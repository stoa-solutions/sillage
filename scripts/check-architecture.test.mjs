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
test("shared core cannot reach server code or Node through dynamic imports", () => {
  assert.equal(
    violations(
      "packages/core/src/leak.ts",
      'import("../../../apps/server/src/dj-settings.ts")',
    ).length,
    1,
  );
  assert.equal(
    violations("packages/core/src/leak.ts", 'import fs from "node:fs"').length,
    1,
  );
});
test("pure policy allows type-only adapter references, but rejects runtime imports and effects", () => {
  const file = "apps/server/src/modules/dj/decision.ts";
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
test("DJ internals cannot import their own index or use untyped boundaries", () => {
  assert.equal(
    violations(
      "apps/server/src/modules/dj/dj-turn.service.ts",
      'import { reserveDj } from "./index.ts"',
    ).length,
    1,
  );
  assert.equal(
    violations("apps/server/src/modules/dj/turn.ts", "const data: any = {};")
      .length,
    1,
  );
  assert.equal(
    violations(
      "apps/server/src/modules/dj/turn.ts",
      "// any fetch process.env\nconst data: unknown = {};",
    ).length,
    0,
  );
});

test("checks bare Node/workspace imports and permits type-only re-exports", () => {
  const core = "packages/core/src/leak.ts";
  assert.equal(violations(core, 'import fs from "fs"').length, 1);
  assert.equal(
    violations(core, 'import "@playlist-recall/server"').length,
    1,
  );
  assert.equal(
    violations(
      "apps/server/src/modules/dj/decision.ts",
      'export { type ChatMessage } from "./provider.ts"',
    ).length,
    0,
  );
});
test("a module reaches another module only through its index", () => {
  const file = "apps/server/src/modules/accounts/routes.ts";
  assert.equal(
    violations(file, 'import { revokeSession } from "../auth/auth.repository.ts"').length,
    1,
  );
  assert.equal(
    violations(file, 'import { revokeSession } from "../auth/index.ts"').length,
    0,
  );
  assert.equal(
    violations(
      "apps/server/src/app.ts",
      'import { sessionGuard } from "./modules/auth/session.guard.ts"',
    ).length,
    1,
  );
  assert.equal(
    violations(file, 'import { claimLibraryInput } from "./accounts.schemas.ts"').length,
    0,
  );
});
