# Providers, models & pricing

Sprixy is **BYOK**: each user stores their own provider keys (Settings → Provider keys). Keys are validated against
the provider, encrypted with AES-256-GCM and never returned to the browser. Generation is billed by the provider on
the user’s own account; Sprixy records estimated and actual costs per job and enforces budgets.

## fal.ai

Queue REST API (`https://queue.fal.run/{endpoint}`), `Authorization: Key …`. Input images are uploaded to fal storage
(fallback: data URIs). Status and result URLs returned by the submit call are stored so jobs can resume after a restart.
Unit prices are refreshed from fal’s Platform API (`GET https://api.fal.ai/v1/models/pricing`) when a key is
available; otherwise the list prices below are used (marked “list price” in the UI).

| Sprixy id | Endpoint(s) | Capabilities | List price |
| --- | --- | --- | --- |
| `fal:z-image-turbo` | `fal-ai/z-image/turbo`, `…/lora` | txt2img, up to 3 LoRAs | $0.005/MP, LoRA $0.0085/MP |
| `fal:z-image-turbo-i2i` | `fal-ai/z-image/turbo/image-to-image`, `…/lora` | img2img (variants) | $0.005/MP, LoRA $0.0085/MP |
| `fal:flux2-klein-4b` | `fal-ai/flux-2/klein/4b`, `/lora`, `/edit`, `/edit/lora` | txt2img, multi-reference edit | $0.005/MP (edit $0.01/MP) |
| `fal:flux2-klein-9b` | `fal-ai/flux-2/klein/9b`, `/lora`, `/edit`, `/edit/lora` | txt2img, edit, directions | $0.006/MP (edit $0.011/MP in+out) |
| `fal:flux1-dev-lora` | `fal-ai/flux-lora` | txt2img with FLUX.1 LoRAs | ≈ $0.035/MP |
| `fal:wan-2.2-i2v` | `fal-ai/wan/v2.2-a14b/image-to-video` | animation (frames & fps control) | $0.04–0.08/s (16 fps billing) |
| `fal:wan-2.6-i2v` | `wan/v2.6/image-to-video` | animation (5 s clips) | $0.10–0.15/s |
| `fal:birefnet-v2` | `fal-ai/birefnet/v2` | AI background removal | from pricing API |
| `fal:z-image-trainer` | `fal-ai/z-image-trainer` | LoRA training (z-image family) | $2.26 / 1000 steps |
| `fal:flux2-klein-9b-trainer` | `fal-ai/flux-2-klein-9b-base-trainer` | LoRA training (flux2-klein-9b) | $4.30 / 1000 steps |
| `fal:flux1-fast-trainer` | `fal-ai/flux-lora-fast-training` | LoRA training (flux1) | ≈ $2 / run |

Prices change: always rely on the in-app estimate (which shows whether it comes from the live pricing API) and on your
fal dashboard.

## OpenRouter

Image-capable models are discovered dynamically (`GET /api/v1/models?output_modalities=image`, cached 1 h) and appear
in model pickers once an OpenRouter key is configured: Google Gemini image models, OpenAI GPT-image, FLUX.2,
Seedream, Qwen-Image, Recraft, Grok… Models accepting image input get the `edit` capability (variants, directions,
references, sprite-sheet animations).

Calls use the Images API (`POST /api/v1/images`) with a fallback to chat completions with `modalities: ["image","text"]`.
The **exact cost** returned by OpenRouter (`usage.cost`) is recorded; pre-run estimates are approximations
(≈ 1290 output tokens per image).

## LoRA families

A LoRA only works with the base model it was trained for. Sprixy tags every LoRA with a family and silently skips
(with a visible warning) LoRAs that don’t match the selected model.

| Family | Models | Trainer |
| --- | --- | --- |
| `z-image` | Z-Image Turbo (txt2img, img2img) | `fal:z-image-trainer` |
| `flux2-klein-4b` | FLUX.2 klein 4B | — (import) |
| `flux2-klein-9b` | FLUX.2 klein 9B | `fal:flux2-klein-9b-trainer` |
| `flux1` | FLUX.1 dev | `fal:flux1-fast-trainer` |

Preset community LoRAs (Hugging Face): `tarn59/pixel_art_style_lora_z_image_turbo`,
`reverentelusarca/elusarca-pixel-art-style-lora-zimage-turbo`, `limbicnation/pixel-art-lora`. Check each license.

Training requires a dataset whose images are all confirmed as owned/authorized. Pixel art is upscaled with
nearest-neighbour before upload so trainers see crisp pixels. The cost estimate must be accepted before training starts.

## Adding a provider

1. Create `apps/server/src/providers/<name>.ts` implementing `ProviderAdapter` (`types.ts`):
   `validateKey`, `listModels`, `estimate`, `run` (and optionally `resume`).
2. Map Sprixy tasks (`txt2img`, `edit`, `img2img`, `animate`, `removeBg`, `train`) to the provider’s API and return
   `TaskResult` (`images[]` as URLs or buffers, `video`, `lora`, optional real `cost`).
3. Register it in `providers/registry.ts` and add its id to the `provider` enums (keys route, models route).

Everything else — jobs, budgets, cost display, UI pickers, REST and MCP — works unchanged.
