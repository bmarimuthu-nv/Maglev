# NVFP4 Runtime Library: Problem, Gap Analysis, and Product Pitch

## Executive Summary

We want a very simple user experience:

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
import mylib

model = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype="bfloat16")
model = mylib.load_nvfp4_checkpoint(model, checkpoint_path)
tokenizer = AutoTokenizer.from_pretrained(model_id)

out = model.generate(**tokenizer("Hello", return_tensors="pt").to("cuda"))
```

Or even:

```python
model = mylib.from_pretrained_nvfp4(model_id, checkpoint_path)
out = model.generate(...)
```

That is the product.

Not:

- "here is an NVFP4 kernel"
- "here is a quantization recipe"
- "here is a checkpoint export tool"
- "here is a low-level quantization framework"

The real user problem is:

- take a standard PyTorch or Hugging Face model
- take an NVFP4 checkpoint
- load it correctly
- adapt the model correctly
- preserve normal generation APIs
- run inference with minimal user changes

No existing component fully owns that end-to-end workflow.

## Problem Statement

The problem we are solving is simple to state:

> Given a normal `torch.nn.Module` or Hugging Face Transformers model, and a quantized NVFP4 checkpoint, how do we make it trivial to run generation?

This implies five concrete requirements:

1. Model compatibility
2. Checkpoint compatibility
3. Runtime adaptation
4. Generation integration
5. Minimal user friction

The user should not need to:

- rewrite model code by hand
- manually replace every module with backend-specific layers
- understand low-level quantization internals
- custom-wire checkpoint metadata
- maintain a forked inference stack just to use NVFP4

## Existing Landscape

## Transformer Engine

Transformer Engine already provides major low-level pieces:

- optimized Transformer building blocks
- `te.Linear`, `te.LayerNorm`, `te.LayerNormMLP`, `te.TransformerLayer`
- `autocast(...)`
- NVFP4 support on Blackwell GPUs

Official docs position TE as:

- highly optimized building blocks
- AMP-like API
- support for FP8 and NVFP4

Sources:

- <https://docs.nvidia.com/deeplearning/transformer-engine/user-guide/getting_started/index.html>
- <https://docs.nvidia.com/deeplearning/transformer-engine/index.html>
- <https://docs.nvidia.com/deeplearning/transformer-engine/user-guide/examples/fp8_primer.html>

## ModelOpt

ModelOpt already provides strong quantization/export capabilities:

- PTQ/QAT workflows
- quantization APIs
- export of unified Hugging Face checkpoints
- NVFP4 and NVFP4_AWQ among supported formats

Official docs say unified HF export includes:

- safetensors with quantized weights and scaling factors
- `hf_quant_config.json`
- metadata files
- deployment support for TensorRT-LLM / vLLM / SGLang

Sources:

- <https://nvidia.github.io/TensorRT-Model-Optimizer/getting_started/3_quantization.html>
- <https://nvidia.github.io/TensorRT-Model-Optimizer/deployment/3_unified_hf.html>

## Hugging Face Transformers

Transformers already provides the best top-level user surface:

- model classes
- tokenizer ecosystem
- `generate()`
- multiple quantization integrations
- extension point via `HfQuantizer`

Official docs list support for methods like:

- bitsandbytes
- GPTQ
- AWQ
- Quanto

and say unsupported methods can be integrated with `HfQuantizer`.

Sources:

- <https://huggingface.co/docs/transformers/en/main_classes/quantization>
- <https://huggingface.co/docs/transformers/quantization/overview>
- <https://huggingface.co/docs/transformers/en/quantization/contribute>

## torchao

torchao already provides:

- native PyTorch quantization building blocks
- quantized tensor abstractions
- inference/training quantization workflows
- HF integration via `TorchAoConfig`

Official docs present torchao as:

- library for custom dtypes and optimizations
- quantization of weights / activations / gradients / optimizers
- supported inference workflows around float8, int8, int4

Sources:

- <https://docs.pytorch.org/ao/stable/>
- <https://docs.pytorch.org/ao/stable/workflows/inference.html>
- <https://docs.pytorch.org/ao/stable/torchao_hf_integration.html>
- <https://docs.pytorch.org/ao/stable/api_reference/api_ref_quantization.html>

## PyTorch Core Quantization

PyTorch's own docs now explicitly say quantization development is being centralized into torchao.

Source:

- <https://docs.pytorch.org/docs/stable/quantization.html>

## Why Existing Options Fall Short

## 1. Transformer Engine is the engine, not the product

Transformer Engine gives us the low-level execution capability.

But the documented TE workflow is still fundamentally:

- replace standard modules with TE modules
- use TE-native building blocks
- wrap execution in `autocast(...)`

That means TE assumes the model adaptation work is already being done.

TE does not present itself as:

- load an arbitrary HF model
- ingest an NVFP4 checkpoint
- automatically patch the model
- preserve `generate()` with near-zero code changes

TE is necessary backend technology, but insufficient end-user product surface.

## 2. ModelOpt solves checkpoint production, not eager runtime enablement

ModelOpt is strong at:

- quantization
- calibration
- checkpoint export
- metadata/scaling export
- deployment-oriented output formats

But ModelOpt docs frame the exported checkpoints as inputs to deployment frameworks such as:

- TensorRT-LLM
- vLLM
- SGLang

That is not the same as:

- take an arbitrary in-memory HF/PyTorch model
- adapt modules eagerly in PyTorch
- load the NVFP4 checkpoint
- run ordinary `model.generate()`

ModelOpt gives us a producer format. It does not fully own the generic eager PyTorch/HF runtime bridge.

## 3. Transformers owns user UX, not NVFP4 runtime adaptation

Transformers already owns the ideal user API:

- `from_pretrained`
- `AutoModelForCausalLM`
- `generate()`

It also provides extension points like `HfQuantizer`.

But Transformers is not, by itself, a complete NVFP4 runtime for:

- ModelOpt-exported NVFP4 checkpoints
- TE-backed eager execution
- architecture-aware automatic module adaptation

Transformers gives us the best host surface, but not the missing execution bridge.

## 4. torchao is a quantization framework, not the missing NVFP4 runtime

torchao gives:

- tensor/runtime abstractions
- inference and training quantization workflows
- integration into the PyTorch ecosystem

But the published torchao docs and examples center on:

- float8
- int8
- int4

Based on the published materials, torchao does not currently present the full answer for:

- loading ModelOpt NVFP4 checkpoints
- adapting arbitrary HF models for TE-backed eager execution
- preserving generation with minimal user changes

torchao is useful infrastructure and maybe an important fallback substrate, but it does not close the exact NVFP4 eager-generation gap we care about.

## 5. PyTorch core quantization is not the strategic center

PyTorch core docs now direct users toward torchao. That means legacy `torch.ao.quantization` should not be the center of this product strategy.

## The Actual Gap

No single existing piece gives all of this together:

- standard PyTorch/HF model input
- ModelOpt NVFP4 checkpoint input
- automatic model adaptation
- checkpoint-to-module mapping
- TE-backed execution
- generation-ready behavior
- minimal-friction user experience

This is the gap.

That gap is not "new kernels."

That gap is "runtime enablement."

## Our Product Pitch

We build the adapter and runtime-enablement layer for NVFP4 inference.

Positioning:

- Transformer Engine: low-level execution backend
- ModelOpt: quantization and checkpoint producer
- Transformers: user-facing model and generation API
- torchao/PyTorch: foundational runtime/tensor infrastructure
- Our library: the glue that makes a standard model plus an NVFP4 checkpoint actually runnable

One-sentence pitch:

> We make NVFP4 checkpoints usable on ordinary PyTorch and Hugging Face models with near-native `generate()` UX.

## What Our Library Owns

## 1. Checkpoint ingestion

We should own:

- reading ModelOpt unified HF checkpoint layouts
- parsing quantization metadata and scaling tensors
- validating checkpoint/model compatibility
- handling tied weights, fused projections, lm head quirks, sharded layouts
- producing clear diagnostics when checkpoint and model disagree

Checkpoint format without a reliable loader is not a product.

## 2. Model adaptation

We should own:

- mapping standard model modules to runtime-compatible NVFP4-capable implementations
- replacing or wrapping linear / attention / MLP paths as needed
- preserving model semantics
- architecture-specific transforms for Llama/Qwen/Mistral/etc.
- selective preservation of higher precision where needed

This is likely the hardest and most important part.

## 3. Precision policy

We should own:

- which modules run in NVFP4
- which modules remain BF16/FP16/FP32
- sensitive-path policy for embeddings / output heads / residual-critical blocks
- prefill vs decode policy
- safe fallback rules for unsupported ops or shapes

Transformer Engine exposes recipes. We need to own the model-level policy.

## 4. HF-native generation integration

We should preserve:

- `AutoModelForCausalLM`
- tokenizer/config workflows
- standard generation config
- `generate()`
- attention/cache behavior as much as possible

This is critical leverage. Users already know this surface.

## 5. Architecture plugins

We should support models through architecture-specific enablement:

- Llama family
- Qwen family
- Mistral family
- MoE variants
- multimodal variants later

We should not pretend one generic rewrite works equally well for everything.

## 6. Validation and observability

We should expose:

- layer-by-layer quantization plans
- fallback reasons
- checkpoint/model mismatch diagnostics
- baseline vs NVFP4 comparison tools
- backend/kernel verification
- generation-quality regression harnesses

This is necessary for trust and rollout.

## Competitor / Alternative Analysis

| Option | What it does well | Why it falls short for our problem |
| --- | --- | --- |
| Transformer Engine | NVFP4 kernels, TE modules, autocast, optimized transformer building blocks | Does not own arbitrary HF model adaptation plus ModelOpt checkpoint ingestion plus generation-ready runtime UX |
| ModelOpt | Quantization, PTQ/QAT, unified HF export, NVFP4 checkpoint production | Produces/export checkpoints; does not provide the generic eager PyTorch/HF runtime bridge |
| Hugging Face Transformers | Best user UX, `generate()`, model ecosystem, quantization integration surface via `HfQuantizer` | Not a complete NVFP4 + TE runtime out of the box; needs a backend-specific adaptation layer |
| torchao | Native PyTorch quantization stack, tensor abstractions, HF integration, inference/training flows | Published workflows focus on float8/int8/int4; not the documented end-to-end answer for ModelOpt NVFP4 checkpoints |
| PyTorch core quantization | Legacy quantization APIs | Strategic direction is to move users to torchao |

## How We Leverage Existing Pieces Instead of Rebuilding Them

This should not be a "replace everything" effort.

We should compose.

## Use ModelOpt for

- quantization
- checkpoint export
- upstream checkpoint metadata conventions

## Use Transformer Engine for

- NVFP4 execution
- optimized kernels
- TE-native module implementations
- hardware capability checks

## Use Transformers for

- model definitions
- tokenizer/config ecosystem
- `from_pretrained`
- `generate()`
- distribution through familiar APIs

## Use torchao / PyTorch for

- core tensor/runtime interoperability
- fallback paths where TE is not the right mechanism
- future alternative backends if needed
- native PyTorch friendliness

## Use our library for

- checkpoint ingestion
- module adaptation
- execution policy
- architecture support
- runtime validation
- unified user API

That is the clean story.

## Proposed API Shape

Minimum viable product:

```python
model = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.bfloat16)
model = nvfp4.enable(model, checkpoint=checkpoint_dir)
out = model.generate(**inputs)
```

Better product:

```python
model = nvfp4.from_pretrained(model_id, checkpoint=checkpoint_dir)
out = model.generate(**inputs)
```

Debuggable variant:

```python
model = nvfp4.from_pretrained(
    model_id,
    checkpoint=checkpoint_dir,
    policy="safe",
    explain=True,
)
print(model.nvfp4_plan())
```

## Strategic Value

If we build this well, the value is not "we also have quantization."

The value is:

- fastest path from checkpoint to usable generation
- lowest-friction adoption of NVFP4
- leverage of the existing HF ecosystem
- reuse of NVIDIA's best low-level backend
- consistent user workflow across model families
- controllable, debuggable rollout in production

In short:

We are not competing with Transformer Engine or ModelOpt.

We are productizing them for the actual user workflow.

## Recommended Positioning Statement

> Our library is the runtime-enablement layer that turns ModelOpt NVFP4 checkpoints into generation-ready PyTorch/Hugging Face models, using Transformer Engine underneath and preserving familiar Transformers workflows.

## Non-goals

We should be explicit about what we are not trying to do:

- not reimplement NVFP4 kernels
- not replace Transformer Engine numerics
- not replace ModelOpt quantization/export
- not replace Hugging Face model ecosystem
- not replace torchao as a general quantization research/runtime framework

We are filling the missing layer between them.
