export type ProviderId = 'fal' | 'openrouter';

export type Capability = 'txt2img' | 'img2img' | 'edit' | 'animate' | 'removeBg' | 'train';

/** LoRA compatibility family: a LoRA only works with models of the same family. */
export const LORA_FAMILIES = ['z-image', 'flux2-klein-4b', 'flux2-klein-9b', 'flux2-dev', 'qwen-image', 'qwen-image-edit-2511', 'flux1'] as const;
export type LoraFamily = (typeof LORA_FAMILIES)[number];

export type PriceUnit = 'megapixel' | 'image' | 'second' | 'step' | 'request' | 'token';

export interface ModelPricing {
  unit: PriceUnit;
  /** USD per unit. */
  usd: number;
  /** USD per unit when LoRAs are used (separate endpoint on fal). */
  loraUsd?: number;
  /** Edit endpoints that bill input + output megapixels. */
  countsInputMegapixels?: boolean;
  /** Per-resolution price for video models (USD per second). */
  perResolution?: Record<string, number>;
  /** Video models billed on seconds computed at a fixed fps. */
  billingFps?: number;
  note?: string;
}

export interface ModelDef {
  id: string;
  provider: ProviderId;
  name: string;
  description: string;
  capabilities: Capability[];
  endpoint: string;
  loraEndpoint?: string;
  editEndpoint?: string;
  editLoraEndpoint?: string;
  loraFamily?: LoraFamily;
  maxLoras?: number;
  maxRefs?: number;
  pricing: ModelPricing;
  /** 1 (low) – 5 (high), curated guidance. */
  quality: number;
  speed: number;
  tags: string[];
  /** The endpoint returns one image per call (no `num_images`): Sprixy makes one call per requested image. */
  singleImage?: boolean;
  /** Approximate parameter count, shown to help pick a model (e.g. "32B"). */
  size?: string;
  /** Discovered dynamically from the provider's catalog. */
  dynamic?: boolean;
}

export interface ImageInput {
  data: Buffer;
  mime: string;
}

export interface LoraRef {
  path: string;
  scale: number;
}

export type TaskRequest =
  | { task: 'txt2img'; prompt: string; negativePrompt?: string; width: number; height: number; numImages: number; seed?: number; loras?: LoraRef[] }
  | { task: 'edit'; prompt: string; images: ImageInput[]; width?: number; height?: number; numImages: number; seed?: number; loras?: LoraRef[] }
  | { task: 'img2img'; prompt: string; image: ImageInput; strength: number; width?: number; height?: number; numImages: number; seed?: number; loras?: LoraRef[] }
  | { task: 'animate'; prompt: string; image: ImageInput; numFrames: number; fps: number; resolution: string; negativePrompt?: string; seed?: number }
  | { task: 'removeBg'; image: ImageInput }
  | { task: 'train'; zip: Buffer; steps: number; learningRate?: number; defaultCaption?: string; triggerWord?: string; trainingType?: string; isStyle?: boolean };

export interface TaskResult {
  images: { url?: string; data?: Buffer }[];
  video?: { url: string };
  lora?: { url: string; configUrl?: string };
  /** Real cost if the provider reports it. */
  cost?: number;
  seed?: number;
  raw?: unknown;
}

export interface CostEstimate {
  usd: number | null;
  /** 'live' = from provider pricing API, 'catalog' = curated static price, 'unknown'. */
  source: 'live' | 'catalog' | 'unknown';
  breakdown: string;
}

export interface RunContext {
  apiKey: string;
  signal: AbortSignal;
  onProgress(msg: string): void;
  /** Persist upstream request handles so the job can be resumed after a restart. */
  onSubmitted(handle: { requestId: string; statusUrl?: string; responseUrl?: string; endpoint: string }): void;
}

export interface ResumeHandle {
  requestId: string;
  statusUrl?: string | null;
  responseUrl?: string | null;
  endpoint: string;
}

export interface KeyCheck {
  ok: boolean;
  message: string;
  info?: Record<string, unknown>;
}

export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  website: string;
  keyHelpUrl: string;
  validateKey(key: string): Promise<KeyCheck>;
  listModels(key?: string): Promise<ModelDef[]>;
  estimate(model: ModelDef, req: TaskRequest, key?: string): Promise<CostEstimate>;
  run(model: ModelDef, req: TaskRequest, ctx: RunContext): Promise<TaskResult>;
  resume?(model: ModelDef, handle: ResumeHandle, req: TaskRequest, ctx: RunContext): Promise<TaskResult>;
  /** Remaining prepaid balance, when the provider exposes it to this key. */
  getBalance?(key: string): Promise<BalanceCheck>;
}

export type BalanceCheck =
  | { ok: true; usd: number; detail?: string }
  | { ok: false; reason: 'forbidden' | 'unavailable'; message: string };

export function megapixels(w: number, h: number): number {
  return Math.ceil(((w * h) / 1_000_000) * 100) / 100;
}
