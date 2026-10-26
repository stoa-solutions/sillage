// Provider wire contracts from the official Google/Anthropic docs, never live keys.
const http = require("node:http");
http
  .createServer(async (req, res) => {
    let body = req.body;
    if (!body) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
    }
    const google = /^\/v1beta\/models\/[^/]+:generateContent$/.test(req.url);
    const anthropic = req.url === "/v1/messages";
    const compatible = req.url === "/v1/chat/completions";
    const json = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (!google && !anthropic && !compatible)
      return json(501, { error: { message: "Unmodelled provider endpoint" } });
    if (compatible) {
      if (req.headers.authorization !== "Bearer fixture-google-key-never-real")
        return json(401, { error: { message: "Invalid synthetic key" } });
      return json(200, {
        choices: [
          {
            message: { role: "assistant", content: "OK" },
            finish_reason: "stop",
            index: 0,
          },
        ],
      });
    }
    const valid = google
      ? req.headers["x-goog-api-key"] === "fixture-google-key-never-real"
      : req.headers["x-api-key"] === "fixture-anthropic-key-never-real";
    if (!valid)
      return json(401, {
        error: {
          type: "authentication_error",
          message: "Synthetic invalid key",
        },
      });
    const serialized = JSON.stringify(body);
    if (serialized.includes("SIMULATE_QUOTA"))
      return json(429, {
        error: { type: "rate_limit_error", message: "private-fixture-detail" },
      });
    let text = "OK";
    const musical = serialized.includes("SIMULATE_NATIVE");
    const parts = google
      ? body.contents.flatMap((item) => item.parts)
      : body.messages.flatMap((item) =>
          Array.isArray(item.content) ? item.content : [],
        );
    const result = parts.find((part) =>
      google ? part.functionResponse : part.type === "tool_result",
    );
    if (result) {
      const call = parts.find((part) =>
        google ? part.functionCall : part.type === "tool_use",
      );
      if (google && call?.thoughtSignature !== "opaque-synthetic-signature")
        return json(400, { error: { message: "Missing Google signature" } });
      if (!google && call?.id !== result.tool_use_id)
        return json(400, {
          error: {
            type: "invalid_request_error",
            message: "Mismatched tool result",
          },
        });
      const returned = google
        ? result.functionResponse.response
        : JSON.parse(result.content);
      const evidence = returned.content ?? returned;
      const tracks =
        evidence.tracks || evidence.results?.map((item) => item.video) || [];
      text = JSON.stringify({
        reply: "Du jazz de ta bibliothèque.",
        trackIds: tracks.slice(0, 1).map((item) => item.id),
        action: "replace",
      });
    } else if (musical) {
      const call = google
        ? {
            functionCall: {
              id: "search-1",
              name: "music_search",
              args: { query: "jazz" },
            },
            thoughtSignature: "opaque-synthetic-signature",
          }
        : {
            type: "tool_use",
            id: "search-1",
            name: "music_search",
            input: { query: "jazz" },
          };
      if (google)
        return json(200, {
          candidates: [
            {
              content: { role: "model", parts: [call] },
              finishReason: "STOP",
              index: 0,
            },
          ],
        });
      return json(200, {
        id: "msg_tool",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [call],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 1 },
      });
    }
    if (google)
      return json(200, {
        candidates: [
          {
            content: { role: "model", parts: [{ text }] },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 1,
          totalTokenCount: 6,
        },
      });
    return json(200, {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 1 },
    });
  })
  .listen(process.env.PORT);
