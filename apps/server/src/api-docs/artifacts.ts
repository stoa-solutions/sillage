import { openapi, type Operation } from "./openapi.ts";

interface PostmanItem {
  name: string;
  request: {
    method: string;
    description: string;
    header: { key: string; value: string }[];
    url: {
      raw: string;
      host: string[];
      path: string[];
      query: {
        key: unknown;
        value: string;
        disabled: boolean;
        description: unknown;
      }[];
      variable: { key: string; value: string }[];
    };
    auth?: { type: string };
    body?: {
      mode: string;
      raw: string;
      options: { raw: { language: string } };
    };
  };
  response: unknown[];
  event: { listen: string; script: { type: string; exec: string[] } }[];
}

/** OpenAPI is the only operation catalogue; desktop Postman is a derived export. */
export function postmanCollection() {
  const groups = new Map<string, PostmanItem[]>();
  for (const [path, methods] of Object.entries(openapi.paths))
    for (const [method, operation] of Object.entries(methods)) {
      const op = operation as Operation;
      const variables = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
        key: match[1],
        value: `{{${match[1] === "id" ? "playlist_id" : match[1] === "videoId" ? "video_id" : match[1]}}}`,
      }));
      const requestPath = path.replace(/\{([^}]+)\}/g, ":$1");
      const parameters = (op.parameters ?? [])
        .filter((p) => p.in === "query")
        .map((p) => {
          const schema = p.schema as Record<string, unknown>;
          return {
            key: p.name,
            value: String(schema.default ?? `{{${p.name}}}`),
            disabled: !p.required,
            description: p.description ?? "",
          };
        });
      const suffix = parameters
        .filter((p) => !p.disabled)
        .map((p) => `${p.key}=${p.value}`)
        .join("&");
      const header = [
        { key: "Accept", value: op["x-sillage-accept"] ?? "application/json" },
      ];
      if (op.requestBody)
        header.push({ key: "Content-Type", value: "application/json" });
      const success = Object.keys(op.responses).filter(
        (code) =>
          /^[23]/.test(code) ||
          (op.operationId.endsWith("MusicMcp") && code === "405"),
      );
      const request = {
        method: method.toUpperCase(),
        header,
        url: {
          raw: `{{base_url}}${requestPath}${suffix ? `?${suffix}` : ""}`,
          host: ["{{base_url}}"],
          path: requestPath.slice(1).split("/"),
          query: parameters,
          variable: variables,
        },
        description: `${op.description}\n\nEffet : ${op["x-sillage-effect"]}. Les opérations d’écriture et les appels fournisseur sont volontaires ; ne pas lancer toute la collection sur son compte.`,
        ...(op.security?.length === 0 || op["x-sillage-effect"] === "browser"
          ? { auth: { type: "noauth" } }
          : {}),
        ...(op.requestBody
          ? {
              body: {
                mode: "raw",
                raw: JSON.stringify(op["x-sillage-example"] ?? {}, null, 2),
                options: { raw: { language: "json" } },
              },
            }
          : {}),
      };
      const item = {
        name: op.operationId,
        request,
        response: [],
        event: [
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: [
                `pm.test("Réponse réussie", function () { pm.expect(pm.response.code).to.be.oneOf(${JSON.stringify(success.map(Number))}); });`,
                ...(op.operationId === "getHealth"
                  ? [
                      'pm.test("Serveur disponible", function () { pm.expect(pm.response.json().ok).to.eql(true); });',
                    ]
                  : []),
              ],
            },
          },
        ],
      };
      const tag = op.tags[0];
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push(item);
    }
  return {
    info: {
      name: "Sillage — API développeur",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      description:
        "Export local dérivé d’OpenAPI. Ne pas exécuter toute la collection : elle contient des suppressions, déconnexions et appels fournisseur. Choisir Local ou Serveur privé et renseigner api_token uniquement dans la valeur locale de Postman. Les secrets ne sont jamais fournis dans cet export.",
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{api_token}}", type: "string" }],
    },
    variable: [
      { key: "base_url", value: "http://127.0.0.1:3001", type: "string" },
      ...[
        "api_token",
        "video_id",
        "playlist_id",
        "archive",
        "challenge",
        "app_state",
        "auth_code",
        "pkce_verifier",
        "legacy_token",
      ].map((key) => ({ key, value: "", type: "string" })),
    ],
    item: [...groups].map(([name, item]) => ({ name, item })),
  };
}

export function postmanEnvironment(name: string, baseUrl: string) {
  return {
    name,
    values: [
      { key: "base_url", value: baseUrl, enabled: true, type: "default" },
      ...["api_token", "gemini_api_key"].map((key) => ({
        key,
        value: "",
        enabled: true,
        type: "secret",
      })),
    ],
    _postman_variable_scope: "environment",
  };
}

/** Native Git/Postman v3 mirrors the same requests, with no inferred random samples. */
export function postmanNativeFiles(): Record<string, unknown> {
  const collection = postmanCollection();
  const directory = "postman/collections/sillage";
  const files: Record<string, unknown> = {
    [`${directory}/.resources/definition.yaml`]: {
      $kind: "collection",
      name: collection.info.name,
      description: collection.info.description,
      variables: Object.fromEntries(
        collection.variable.map((v) => [v.key, v.value]),
      ),
      auth: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          type: "bearer",
          name: "Session Sillage",
          credentials: { token: "{{api_token}}" },
        },
      ],
    },
  };
  collection.item.forEach((folder, folderIndex) => {
    files[`${directory}/${folder.name}/.resources/definition.yaml`] = {
      $kind: "collection",
      order: (folderIndex + 1) * 1000,
    };
    folder.item.forEach((item, index) => {
      const r = item.request;
      files[`${directory}/${folder.name}/${item.name}.request.yaml`] = {
        $kind: "http-request",
        description: r.description,
        url: r.url.raw,
        method: r.method,
        headers: Object.fromEntries(r.header.map((h) => [h.key, h.value])),
        ...(r.url.variable.length
          ? {
              pathVariables: Object.fromEntries(
                r.url.variable.map((v) => [v.key, v.value]),
              ),
            }
          : {}),
        ...(r.url.query.length
          ? {
              queryParams: r.url.query.map((p) => ({
                key: p.key,
                value: p.value,
                disabled: p.disabled,
              })),
            }
          : {}),
        ...(r.auth ? { auth: r.auth } : {}),
        ...(r.body ? { body: { type: "json", content: r.body.raw } } : {}),
        scripts: item.event.map((e) => ({
          type: "afterResponse",
          code: e.script.exec.join("\n"),
          language: "text/javascript",
        })),
        order: (index + 1) * 1000,
      };
    });
  });
  for (const [name, baseUrl] of [
    ["Local", "http://127.0.0.1:3001"],
    ["Serveur privé", "https://recall.stoa.solutions"],
  ]) {
    files[`postman/environments/${name}.environment.yaml`] = {
      name: `Sillage — ${name}`,
      values: postmanEnvironment(name, baseUrl).values,
    };
  }
  return files;
}

export const artifacts = () => ({
  "postman/specs/sillage.openapi.json": openapi,
  "postman/exports/Sillage.postman_collection.json": postmanCollection(),
  "postman/exports/Local.postman_environment.json": postmanEnvironment(
    "Sillage — Local",
    "http://127.0.0.1:3001",
  ),
  "postman/exports/Serveur.postman_environment.json": postmanEnvironment(
    "Sillage — Serveur privé",
    "https://recall.stoa.solutions",
  ),
  ...postmanNativeFiles(),
});
