import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  SiglipTextModel,
  SiglipVisionModel,
  env,
  type DataType,
  type DeviceType,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
  type Tensor,
} from "@huggingface/transformers";
import type { Embedder, ImageInput, Vector } from "../types.js";
import { configureNodeCacheDir } from "./node-cache-dir.js";

export interface EmbedderConfig {
  /** A SigLIP or CLIP model id (must contain "siglip" or "clip"). */
  modelId?: string;
  /** Expected output dimension. Must match modelId's actual tower output — mismatches throw on first embed call. */
  dim?: number;
  dtype?: DataType;
  device?: DeviceType;
}

const DEFAULT_MODEL_ID = "Xenova/siglip-base-patch16-224";
const DEFAULT_DIM = 768;
const DEFAULT_DTYPE: DataType = "q8";

type Architecture = "siglip" | "clip";

function resolveArchitecture(modelId: string): Architecture {
  const id = modelId.toLowerCase();
  if (id.includes("siglip")) return "siglip";
  if (id.includes("clip")) return "clip";
  throw new Error(
    `createEmbedder: unrecognized modelId "${modelId}" — expected a SigLIP or CLIP model id (containing "siglip" or "clip").`,
  );
}

interface VisionTower {
  model: PreTrainedModel;
  processor: Processor;
}

interface TextTower {
  model: PreTrainedModel;
  tokenizer: PreTrainedTokenizer;
}

function tensorToVectors(tensor: Tensor, expectedDim: number): Vector[] {
  const [batchSize, tensorDim] = tensor.dims;
  if (batchSize === undefined || tensorDim === undefined) {
    throw new Error(`createEmbedder: unexpected output tensor shape [${tensor.dims.join(", ")}]`);
  }
  if (tensorDim !== expectedDim) {
    throw new Error(
      `createEmbedder: model produced ${tensorDim}-dim vectors but embedder is configured for dim=${expectedDim} — pass a matching \`dim\` in the config.`,
    );
  }
  tensor.normalize_(); // L2-normalize each row in place (defaults: p=2, dim=1)
  const data = tensor.data as Float32Array;
  const vectors: Vector[] = [];
  for (let i = 0; i < batchSize; i++) {
    vectors.push(Float32Array.from(data.subarray(i * tensorDim, (i + 1) * tensorDim)));
  }
  return vectors;
}

class TransformersEmbedder implements Embedder {
  readonly modelId: string;
  readonly dim: number;
  private readonly architecture: Architecture;
  private readonly dtype: DataType;
  private readonly device: DeviceType | undefined;

  private visionTower: Promise<VisionTower> | undefined;
  private textTower: Promise<TextTower> | undefined;

  constructor(
    config: Required<Pick<EmbedderConfig, "modelId" | "dim" | "dtype">> &
      Pick<EmbedderConfig, "device">,
  ) {
    this.modelId = config.modelId;
    this.dim = config.dim;
    this.dtype = config.dtype;
    this.device = config.device;
    this.architecture = resolveArchitecture(config.modelId);
  }

  // Vision and text towers load independently and lazily — a caller that
  // only ever calls embedTexts (e.g. a browser text-search client) never
  // pulls down the vision tower's weights.
  private loadVisionTower(): Promise<VisionTower> {
    this.visionTower ??= (async () => {
      await configureNodeCacheDir(env);
      const VisionModel =
        this.architecture === "siglip" ? SiglipVisionModel : CLIPVisionModelWithProjection;
      const [model, processor] = await Promise.all([
        VisionModel.from_pretrained(this.modelId, { dtype: this.dtype, device: this.device }),
        AutoProcessor.from_pretrained(this.modelId),
      ]);
      return { model, processor };
    })();
    return this.visionTower;
  }

  private loadTextTower(): Promise<TextTower> {
    this.textTower ??= (async () => {
      await configureNodeCacheDir(env);
      const TextModel =
        this.architecture === "siglip" ? SiglipTextModel : CLIPTextModelWithProjection;
      const [model, tokenizer] = await Promise.all([
        TextModel.from_pretrained(this.modelId, { dtype: this.dtype, device: this.device }),
        AutoTokenizer.from_pretrained(this.modelId),
      ]);
      return { model, tokenizer };
    })();
    return this.textTower;
  }

  async embedImages(images: ImageInput[]): Promise<Vector[]> {
    if (images.length === 0) return [];
    const { model, processor } = await this.loadVisionTower();
    const rawImages = await Promise.all(images.map((image) => RawImage.read(image)));
    const inputs = await processor(rawImages);
    const output = await model(inputs);
    const key = this.architecture === "siglip" ? "pooler_output" : "image_embeds";
    return tensorToVectors(output[key] as Tensor, this.dim);
  }

  async embedTexts(texts: string[]): Promise<Vector[]> {
    if (texts.length === 0) return [];
    const { model, tokenizer } = await this.loadTextTower();
    // SigLIP requires fixed-length padding; CLIP just needs same-length batches.
    const padding = this.architecture === "siglip" ? "max_length" : true;
    const inputs = tokenizer(texts, { padding, truncation: true });
    const output = await model(inputs);
    const key = this.architecture === "siglip" ? "pooler_output" : "text_embeds";
    return tensorToVectors(output[key] as Tensor, this.dim);
  }
}

/**
 * Creates an `Embedder` backed by a two-tower SigLIP (default) or CLIP model
 * via transformers.js. Vision and text towers each load lazily on first use.
 *
 * To A/B against CLIP, pass both `modelId` and the matching `dim` — e.g.
 * `createEmbedder({ modelId: 'Xenova/clip-vit-base-patch32', dim: 512 })`.
 */
export function createEmbedder(config: EmbedderConfig = {}): Embedder {
  const modelId = config.modelId ?? DEFAULT_MODEL_ID;
  const dim = config.dim ?? DEFAULT_DIM;
  const dtype = config.dtype ?? DEFAULT_DTYPE;
  return new TransformersEmbedder({ modelId, dim, dtype, device: config.device });
}
