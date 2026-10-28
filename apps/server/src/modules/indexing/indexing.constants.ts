import { MODEL_KEY } from "@sillage/core/model";

/** Text passages: E5 multilingual, chunked with context. A new key re-indexes everything. */
export const TEXT_KEY = `${MODEL_KEY}:chunks-v2`;
/** Thumbnails and visual queries: SigLIP 2, pinned revision, int8, L2-normalised. */
export const VISION_ID = "onnx-community/siglip2-base-patch16-224-ONNX";
export const VISION_REVISION = "ba1f3b0843f24bc5417d38e19c37b287d719b2f4";
export const VISION_KEY = `${VISION_ID}@${VISION_REVISION}:q8:l2:v1`;
