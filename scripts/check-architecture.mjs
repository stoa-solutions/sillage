import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
// Policy modules: deterministic, testable without a network, database or clock.
const pureDj = new Set([
  "dj.contracts.ts",
  "plan.ts",
  "prompt.ts",
  "messages.ts",
  "memory.ts",
  "decision.ts",
  "reply.ts",
  "errors.ts",
  "evidence.ts",
  "composition.ts",
]);
const pureDjImports = new Set([
  "zod",
  ...[...pureDj].map((file) => `./${file}`),
]);

/** Inspect syntax, not text matches: comments and type-only dependencies are harmless. */
export function violations(file, source) {
  const errors = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const core = file.startsWith("packages/core/src/");
  const server = file.startsWith("apps/server/src/");
  const dj = file.startsWith("apps/server/src/modules/dj/");
  const pure = core || (dj && pureDj.has(path.basename(file)));
  const report = (node, reason) => {
    const line =
      tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    errors.push(`${file}:${line}: ${reason}`);
  };
  const checkImport = (node, specifier, typeOnly = false) => {
    const target = specifier.startsWith(".")
      ? path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier),
        )
      : specifier;
    if (core && !target.startsWith("packages/core/src/"))
      report(node, "core must not import an app, adapter or external runtime");
    if (server && target.startsWith("apps/macos/"))
      report(node, "the server must not depend on a client application");
    const feature = (name) =>
      name.match(/^apps\/server\/src\/modules\/([^/]+)\//)?.[1];
    const from = feature(file),
      to = feature(target);
    if (
      server &&
      to &&
      from !== to &&
      !target.endsWith(`modules/${to}/index.ts`)
    )
      report(
        node,
        `a module is used through its index.ts, not modules/${to} internals`,
      );
    if (dj && target === "apps/server/src/modules/dj/index.ts")
      report(
        node,
        "DJ internals must not import their own index (circular dependency)",
      );
    if (
      dj &&
      pure &&
      !typeOnly &&
      !pureDjImports.has(specifier) &&
      !specifier.startsWith("@sillage/core/")
    )
      report(node, "pure DJ policy must not import an effect adapter");
  };
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly));
      checkImport(node, node.moduleSpecifier.text, Boolean(onlyTypes));
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const bindings = node.exportClause;
      const onlyTypes =
        node.isTypeOnly ||
        (bindings &&
          ts.isNamedExports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly));
      checkImport(node, node.moduleSpecifier.text, Boolean(onlyTypes));
    }
    if (ts.isCallExpression(node)) {
      const dynamic =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require");
      if (dynamic && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
        checkImport(node, node.arguments[0].text);
      if (
        pure &&
        dynamic &&
        (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0]))
      )
        report(
          node,
          "pure modules cannot hide runtime dependencies behind computed imports",
        );
      if (
        pure &&
        ts.isIdentifier(node.expression) &&
        ["fetch", "WebSocket"].includes(node.expression.text)
      )
        report(node, "pure modules must not perform network effects");
    }
    if (
      pure &&
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["process", "window", "document", "chrome", "globalThis"].includes(
        node.expression.text,
      )
    )
      report(node, "pure modules must receive runtime state as arguments");
    if (dj && node.kind === ts.SyntaxKind.AnyKeyword)
      report(node, "DJ boundaries use unknown and validation, not any");
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return errors;
}

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.posix.join(directory, entry.name);
      return entry.isDirectory()
        ? walk(file)
        : /\.(ts|tsx)$/.test(file)
          ? [file]
          : [];
    }),
  );
  return nested.flat();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const files = (
    await Promise.all(
      [
        "packages/core/src",
        "apps/server/src",
      ].map(walk),
    )
  ).flat();
  const errors = (
    await Promise.all(
      files.map(async (file) =>
        violations(file, await readFile(path.join(root, file), "utf8")),
      ),
    )
  ).flat();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Architecture boundaries checked in ${files.length} source files.`,
    );
}
