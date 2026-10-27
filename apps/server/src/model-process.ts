import {
  env,
  pipeline,
  AutoTokenizer,
  AutoProcessor,
  SiglipTextModel,
  SiglipVisionModel,
  RawImage,
} from "@huggingface/transformers";
import {
  MODEL_ID,
  MODEL_REVISION,
  validateEmbeddingMatrix,
} from "@playlist-recall/core/model";
import { VISION_ID, VISION_REVISION } from "./modules/indexing/index.ts";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath =
  process.env["MODEL_PATH"] ?? "../../.runtime/models/";
let e5: any;
let vision: any;
let visualText: any;
let tokenizer: any;
let processor: any;
let visionTokenizer: any;
const session_options = {
  intraOpNumThreads: Number(process.env["MODEL_THREADS"] ?? 2),
  interOpNumThreads: 1,
};
const opts = { dtype: "q8" as const, device: "cpu" as const, session_options };
async function textModel() {
  if (!e5) {
    e5 = await pipeline("feature-extraction", MODEL_ID, {
      ...opts,
      revision: MODEL_REVISION,
    });
    tokenizer = e5.tokenizer;
  }
  return e5;
}
function normalized(tensor: any): number[] {
  const values = Array.from(tensor.data) as number[];
  const norm = Math.sqrt(values.reduce((n, v) => n + v * v, 0));
  const vector = values.map((v) => v / norm);
  return validateEmbeddingMatrix([vector], 1, 768)[0]!;
}
async function execute(task: string, data: any) {
  if (task === "query" || task === "passages") {
    const extract = await textModel();
    let texts: string[];
    if (task === "query") texts = [data.text];
    else {
      const tokens: number[] = tokenizer.encode(data.text, {
        add_special_tokens: false,
      });
      const context: number[] = tokenizer
        .encode(data.text.split("\n").slice(0, 2).join("\n"), {
          add_special_tokens: false,
        })
        .slice(0, 64);
      texts = [];
      for (let start = 0; start < tokens.length; start += 224) {
        texts.push(
          tokenizer.decode(
            start === 0
              ? tokens.slice(0, 256)
              : [...context, ...tokens.slice(start, start + 256)],
            { skip_special_tokens: true },
          ),
        );
        if (start + 256 >= tokens.length) break;
      }
    }
    const vectors: number[][] = [];
    for (const text of texts) {
      const result = await extract(
        [`${task === "query" ? "query" : "passage"}: ${text}`],
        { pooling: "mean", normalize: true },
      );
      vectors.push(validateEmbeddingMatrix(result.tolist(), 1, 384)[0]!);
    }
    return task === "query" ? { vector: vectors[0] } : { texts, vectors };
  }
  if (process.env["VISION_ENABLED"] !== "true")
    throw new Error("Visual indexing is disabled.");
  if (task === "image") {
    vision ??= await SiglipVisionModel.from_pretrained(VISION_ID, {
      ...opts,
      revision: VISION_REVISION,
    });
    processor ??= await AutoProcessor.from_pretrained(VISION_ID, {
      revision: VISION_REVISION,
    });
    const bytes = Buffer.from(data.base64, "base64");
    const image = await RawImage.fromBlob(new Blob([bytes]));
    const output = await vision(await processor(image));
    return { vector: normalized(output.pooler_output) };
  }
  visualText ??= await SiglipTextModel.from_pretrained(VISION_ID, {
    ...opts,
    revision: VISION_REVISION,
  });
  visionTokenizer ??= await AutoTokenizer.from_pretrained(VISION_ID, {
    revision: VISION_REVISION,
  });
  const output = await visualText(
    visionTokenizer([data.text], {
      padding: "max_length",
      truncation: true,
      max_length: 64,
    }),
  );
  return { vector: normalized(output.pooler_output) };
}

process.on("message", async (message: { task: string; data: unknown }) => {
  try {
    const result = await execute(message.task, message.data);
    process.send?.({ result, rss: process.memoryUsage().rss });
  } catch (error) {
    process.send?.({
      error: error instanceof Error ? error.message : "Inference failed",
      rss: process.memoryUsage().rss,
    });
  }
});
