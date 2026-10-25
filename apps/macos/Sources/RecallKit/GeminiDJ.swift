import Foundation

public struct GeminiDJ: DJLanguageModel {
  public let key: String
  public let model: String
  public init(key: String, model: String) {
    self.key = key
    self.model = model
  }
  public var historyWindow: (messages: Int, characters: Int) { (12, 2000) }
  public func plan(instructions: String, input: String) async throws -> DJPlan {
    let object = try await complete(instructions: instructions, input: input)
    return DJPlan(
      queries: (object["queries"] as? [String] ?? []).filter { $0.count <= 500 },
      named: object["named"] as? Bool ?? false,
      includeQueued: object["includeQueued"] as? Bool ?? false)
  }
  public func select(instructions: String, input: String, candidateIDs: [String]) async throws
    -> DJSelection
  {
    let object = try await complete(instructions: instructions, input: input)
    guard let reply = object["reply"] as? String, reply.count <= 1500 else {
      throw RecallError.message("La sélection du DJ est illisible.")
    }
    return DJSelection(
      reply: reply, trackIds: object["trackIds"] as? [String] ?? [],
      append: object["append"] as? Bool ?? false)
  }
  /// Gemini through its OpenAI-compatible endpoint, in JSON mode.
  private func complete(instructions: String, input: String) async throws -> [String: Any] {
    var body: [String: Any] = [
      "model": model,
      "messages": [
        ["role": "system", "content": instructions], ["role": "user", "content": input],
      ],
      "max_completion_tokens": model == "gemini-4-argon" ? 32768 : 8192,
      "response_format": ["type": "json_object"],
    ]
    if model == "gemini-3.8-flash" || model == "gemini-4-argon" {
      body["reasoning_effort"] = "low"
    }
    let result = try await HTTPClient().json(
      url: URL(
        string: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")!,
      body: body, headers: ["Authorization": "Bearer " + key])
    guard let choices = result["choices"] as? [[String: Any]],
      let answer = choices.first?["message"] as? [String: Any],
      let text = answer["content"] as? String, let data = text.data(using: .utf8),
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw RecallError.message("Le DJ a renvoyé une réponse illisible.") }
    return object
  }
  public func speech(_ text: String) async throws -> Data {
    let body: [String: Any] = [
      "contents": [
        [
          "role": "user",
          "parts": [
            [
              "text": String(text.prefix(600)),
              "speech_metadata": [
                "style": "Parle en français, avec chaleur et naturellement, comme un DJ posé."
              ],
            ]
          ],
        ]
      ],
      "generationConfig": [
        "responseModalities": ["AUDIO"], "speechConfig": ["voiceConfig": ["voice": "Kore"]],
      ],
    ]
    let result = try await HTTPClient().json(
      url: URL(
        string:
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent"
      )!, body: body, headers: ["x-goog-api-key": key])
    guard let candidates = result["candidates"] as? [[String: Any]],
      let content = candidates.first?["content"] as? [String: Any],
      let parts = content["parts"] as? [[String: Any]],
      let audio = parts.compactMap({ $0["inlineData"] as? [String: Any] }).first,
      let encoded = audio["data"] as? String, encoded.count <= 8 * 1024 * 1024,
      let data = Data(base64Encoded: encoded)
    else { throw RecallError.message("La voix du DJ est indisponible.") }
    if data.prefix(4) == Data("RIFF".utf8) { return data }
    guard let mime = audio["mimeType"] as? String,
      mime.hasPrefix("audio/L16") || mime.hasPrefix("audio/pcm")
    else { throw RecallError.message("Format vocal non reconnu.") }
    return Self.wav(data)
  }
  public static func wav(_ pcm: Data) -> Data {
    var data = Data("RIFF".utf8)
    func number<T: FixedWidthInteger>(_ n: T) {
      var value = n.littleEndian
      withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
    }
    number(UInt32(pcm.count + 36))
    data.append(Data("WAVEfmt ".utf8))
    number(UInt32(16))
    number(UInt16(1))
    number(UInt16(1))
    number(UInt32(24000))
    number(UInt32(48000))
    number(UInt16(2))
    number(UInt16(16))
    data.append(Data("data".utf8))
    number(UInt32(pcm.count))
    data.append(pcm)
    return data
  }
}
