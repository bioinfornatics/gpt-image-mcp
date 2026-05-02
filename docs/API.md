# MCP Tools API Reference

**Project:** gpt-image-mcp  
**Protocol:** Model Context Protocol (MCP) — JSON-RPC 2.0  
**Version:** 1.0  
**Date:** 2026-04-22  
**Status:** Active

---

## Table of Contents

1. [Overview](#1-overview)
2. [Common Conventions](#2-common-conventions)
3. [Tools Reference](#3-tools-reference)
   - [image_generate](#31-image_generate)
   - [image_edit](#32-image_edit)
   - [image_variation](#33-image_variation)
   - [provider_list](#34-provider_list)
   - [provider_validate](#35-provider_validate)
4. [MCP Protocol Features](#4-mcp-protocol-features)
   - [Elicitation](#41-elicitation)
   - [Sampling](#42-sampling)
   - [Roots](#43-roots)
5. [Error Reference](#5-error-reference)

---

## 1. Overview

`gpt-image-mcp` exposes **5 MCP tools** that provide structured access to OpenAI's image generation, editing, and variation APIs, as well as provider introspection utilities.

### Exposed Tools

| Tool | Category | Description |
|------|----------|-------------|
| `image_generate` | Generation | Create images from a text prompt |
| `image_edit` | Editing | Edit an existing image using a prompt (and optional mask) |
| `image_variation` | Variation | Generate variations of an existing image |
| `provider_list` | Introspection | List all configured image providers and their models |
| `provider_validate` | Introspection | Validate that a specific provider is correctly configured |

### Transport Modes

| Mode | Description |
|------|-------------|
| `stdio` | Standard I/O — used with Claude Desktop, VS Code MCP extensions |
| `http` | HTTP/SSE or Streamable HTTP — used with remote MCP clients and agents |

### Protocol

All tools are invoked via MCP's `tools/call` method, which wraps a standard **JSON-RPC 2.0** request. The server negotiates capabilities during the `initialize` handshake.

---

## 2. Common Conventions

### 2.1 response_format Enum

Every tool that returns image data accepts a `response_format` parameter controlling the shape of the tool result:

| Value | Description |
|-------|-------------|
| `markdown` | Returns a human-readable Markdown string with embedded image data and metadata (default) |
| `json` | Returns a structured JSON object — preferred for agent pipelines that need to process image data programmatically |

### 2.2 Error Format

When a tool call fails, the MCP server returns a tool result with `isError: true`:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error [ERROR_CODE]: Human-readable description of the error."
    }
  ],
  "isError": true
}
```

For JSON `response_format`, errors are also returned as structured objects — see §5 for all error codes.

### 2.3 Base64 Image Encoding

Generated images are returned as base64-encoded strings within MCP `image` content blocks:

```json
{
  "type": "image",
  "data": "<base64-encoded image bytes>",
  "mimeType": "image/png"
}
```

The `mimeType` reflects the requested `output_format` (e.g., `image/png`, `image/jpeg`, `image/webp`).

### 2.4 Workspace File Saving

When `save_to_workspace` is provided, the generated image is saved to the specified relative path within the MCP-granted workspace root. The tool response includes the resolved absolute file path. If the path already exists, it is overwritten.

### 2.5 Units & Limits

| Parameter | Unit | Notes |
|-----------|------|-------|
| `output_compression` | Integer 0–100 | 0 = lossless / maximum size; 100 = maximum compression |
| `n` | Integer | Number of images to generate in one call |
| Prompt length | Characters | Maximum 32 000 characters |
| Image payload | Bytes | Maximum 20 MB decoded |

---

## 3. Tools Reference

---

### 3.1 `image_generate`

#### Description

Generates one or more images from a text prompt using OpenAI or Azure OpenAI `gpt-image-*` models. `gpt-image-2` is the recommended default.

**When to use:**
- Creating new images from scratch based on a text description.
- Generating multiple images in a single call (`n` up to 10).
- Producing images in specific formats, sizes, or with transparent backgrounds.

#### Input Schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | ✅ Yes | — | Text description of the image to generate. Max 32 000 chars. |
| `model` | string | No | `gpt-image-2` | Model to use. OpenAI: `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini`, `gpt-image-1`. Azure: same list. `dall-e-2` for variations only; `dall-e-3` retired 2026-03-04. |
| `n` | integer | No | `1` | Number of images to generate (1–10). All `gpt-image-*` models support up to 10. |
| `size` | string | No | `auto` | Image dimensions. See model-specific size table below. |
| `quality` | string | No | `auto` | Quality setting. `auto`\|`high`\|`medium`\|`low` (gpt-image-* models). |
| `background` | string | No | `auto` | Background transparency. `transparent`\|`opaque`\|`auto`. Supported on `gpt-image-*` with `png` or `webp` output. |
| `output_format` | string | No | `png` | Output image format. `png`\|`jpeg`\|`webp` |
| `output_compression` | integer | No | `100` | Compression level 0–100 for `jpeg` and `webp` output formats |
| `moderation` | string | No | `auto` | Content moderation level. `auto`\|`low`. Only `gpt-image-1`. |
| `save_to_workspace` | string | No | — | Relative path within workspace root to save the generated image (e.g., `images/hero.png`) |
| `response_format` | string | No | `markdown` | Tool response format. `markdown`\|`json` |

**Size options by model:**

| Model | Supported Sizes |
|-------|----------------|
| `gpt-image-2` | `1024x1024`, `1536x1024`, `1024x1536`, up to `4096x4096`, `auto` |
| `gpt-image-1.5` | `1024x1024`, `1536x1024`, `1024x1536`, `auto` |
| `gpt-image-1-mini` | `1024x1024`, `1536x1024`, `1024x1536`, `auto` |
| `gpt-image-1` | `1024x1024`, `1536x1024`, `1024x1536`, `auto` |
| `dall-e-2` | `256x256`, `512x512`, `1024x1024` — variations only |
| ~~`dall-e-3`~~ | ⛔ Retired 2026-03-04 |

#### Output Schema

**`response_format: markdown` (default):**

```markdown
## Generated Image

**Model:** gpt-image-1  
**Size:** 1024x1024  
**Quality:** high  
**Format:** png  
**Prompt:** A photorealistic sunset over a mountain range

![Generated Image](data:image/png;base64,iVBORw0KGgo...)

*Saved to: /workspace/images/sunset.png*
```

**`response_format: json`:**

```json
{
  "success": true,
  "model": "gpt-image-1",
  "provider": "openai",
  "images": [
    {
      "index": 0,
      "data": "iVBORw0KGgo...",
      "mimeType": "image/png",
      "size": "1024x1024",
      "savedTo": "/workspace/images/sunset.png",
      "revisedPrompt": null
    }
  ],
  "usage": {
    "total_tokens": 1250,
    "input_tokens": 50,
    "output_tokens": 1200,
    "input_tokens_details": {
      "image_tokens": 0,
      "text_tokens": 50
    }
  },
  "metadata": {
    "quality": "high",
    "background": "auto",
    "output_format": "png",
    "output_compression": 100,
    "n": 1
  }
}
```

> **Note:** `revisedPrompt` is always `null` — `dall-e-3` (the only model that auto-revised prompts) was retired 2026-03-04. `usage` token counts are available for all `gpt-image-*` models.

#### Error Cases

| Error Code | HTTP Equiv | Condition |
|------------|-----------|-----------|
| `MISSING_REQUIRED_PARAM` | 400 | `prompt` not provided |
| `INVALID_PARAM` | 400 | `size` not valid for the selected model |
| `INVALID_PARAM` | 400 | `n` > 10 |
| `INVALID_PARAM` | 400 | `background: transparent` with `jpeg` output |
| `INVALID_PARAM` | 400 | `output_compression` out of range 0–100 |
| `PATH_TRAVERSAL` | 400 | `save_to_workspace` attempts to escape workspace root |
| `OPENAI_ERROR` | 502 | OpenAI API returned an error (content policy, quota, etc.) |
| `PROVIDER_NOT_CONFIGURED` | 503 | `OPENAI_API_KEY` is not set |
| `RATE_LIMIT_EXCEEDED` | 429 | Client has exceeded per-minute rate limit |

#### Example MCP Call

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "tools/call",
  "params": {
    "name": "image_generate",
    "arguments": {
      "prompt": "A photorealistic landscape painting of misty mountains at dawn, oil on canvas style",
      "model": "gpt-image-1",
      "size": "1536x1024",
      "quality": "high",
      "output_format": "png",
      "background": "opaque",
      "save_to_workspace": "outputs/mountain_dawn.png",
      "response_format": "json"
    }
  }
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\":true,\"model\":\"gpt-image-1\",\"images\":[{\"index\":0,\"data\":\"iVBORw0KGgo...\",\"mimeType\":\"image/png\",\"size\":\"1536x1024\",\"savedTo\":\"/workspace/outputs/mountain_dawn.png\"}]}"
      }
    ],
    "isError": false
  }
}
```

---

### 3.2 `image_edit`

#### Description

Edits an existing image based on a text prompt. Optionally accepts a mask image to restrict edits to specific regions. Useful for inpainting, background replacement, and targeted modifications.

**When to use:**
- Modifying a specific region of an existing image.
- Adding, removing, or replacing elements in an image.
- Changing the style or content of selected areas using a transparency mask.

**Model support:** All `gpt-image-*` models (full support). `dall-e-2` (limited — mask required, PNG only, square images only). `dall-e-3` was retired 2026-03-04.

#### Input Schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image` | string | ✅ Yes | — | Base64-encoded image data or HTTPS URL of the image to edit. PNG, JPEG, or WebP. Max 20 MB. |
| `mask` | string | No | — | Base64-encoded mask image or HTTPS URL. Transparent areas indicate regions to edit. Must be same dimensions as `image`. PNG only. |
| `prompt` | string | ✅ Yes | — | Description of the desired edit. Max 32 000 chars. |
| `model` | string | No | `gpt-image-2` | Model to use. Any `gpt-image-*` model or `dall-e-2` (limited). |
| `n` | integer | No | `1` | Number of edited images to generate (1–10). |
| `size` | string | No | `1024x1024` | Output image dimensions. See model size table in §3.1. |
| `quality` | string | No | `auto` | Quality setting. See model quality options in §3.1. |
| `output_format` | string | No | `png` | Output format. `png`\|`jpeg`\|`webp` |
| `output_compression` | integer | No | `100` | Compression level 0–100 for `jpeg`/`webp` |
| `save_to_workspace` | string | No | — | Relative path within workspace root to save the result |
| `response_format` | string | No | `markdown` | Tool response format. `markdown`\|`json` |

#### Output Schema

**`response_format: markdown`:**

```markdown
## Edited Image

**Model:** gpt-image-1  
**Size:** 1024x1024  
**Prompt:** Remove the person from the background and replace with a park bench

![Edited Image](data:image/png;base64,iVBORw0KGgo...)

*Saved to: /workspace/edits/result.png*
```

**`response_format: json`:**

```json
{
  "success": true,
  "model": "gpt-image-1",
  "provider": "openai",
  "images": [
    {
      "index": 0,
      "data": "iVBORw0KGgo...",
      "mimeType": "image/png",
      "size": "1024x1024",
      "savedTo": "/workspace/edits/result.png"
    }
  ],
  "usage": {
    "total_tokens": 2100,
    "input_tokens": 900,
    "output_tokens": 1200,
    "input_tokens_details": {
      "image_tokens": 850,
      "text_tokens": 50
    }
  },
  "metadata": {
    "quality": "auto",
    "output_format": "png",
    "output_compression": 100,
    "n": 1,
    "mask_provided": true
  }
}
```

#### Error Cases

| Error Code | Condition |
|------------|-----------|
| `MISSING_REQUIRED_PARAM` | `image` or `prompt` not provided |
| `INVALID_PARAM` | Image URL uses non-HTTPS scheme |
| `INVALID_PARAM` | Image exceeds 20 MB |
| `INVALID_PARAM` | Mask dimensions differ from image dimensions |
| `INVALID_PARAM` | `dall-e-2` used with non-PNG or non-square image |
| `INVALID_PARAM` | `n` > 1 with `gpt-image-1` |
| `PATH_TRAVERSAL` | `save_to_workspace` path escapes workspace root |
| `OPENAI_ERROR` | OpenAI API error (content policy, format error, etc.) |
| `PROVIDER_NOT_CONFIGURED` | `OPENAI_API_KEY` not set |

#### Example MCP Call

```json
{
  "jsonrpc": "2.0",
  "id": "req-002",
  "method": "tools/call",
  "params": {
    "name": "image_edit",
    "arguments": {
      "image": "https://example.com/original.png",
      "mask": "iVBORw0KGgo...",
      "prompt": "Replace the cloudy sky with a bright blue sky with a few white clouds",
      "model": "gpt-image-1",
      "size": "1024x1024",
      "quality": "high",
      "output_format": "png",
      "save_to_workspace": "edits/clear_sky.png",
      "response_format": "json"
    }
  }
}
```

---

### 3.3 `image_variation`

#### Description

Generates one or more variations of an existing image without a text prompt. Useful for exploring creative alternatives to a reference image.

**⚠️ `dall-e-2` only.** This endpoint is not supported by any `gpt-image-*` model. Calls to this tool always use `dall-e-2`. `dall-e-3` was retired 2026-03-04.

**When to use:**
- Generating creative alternatives to an existing image.
- Exploring visual variations of a design concept.
- Producing multiple style variants from a reference.

#### Input Schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `image` | string | ✅ Yes | — | Base64-encoded PNG image or HTTPS URL. Must be square. Max 20 MB. |
| `n` | integer | No | `1` | Number of variations to generate. Range: 1–10. |
| `size` | string | No | `1024x1024` | Output size. One of: `256x256`, `512x512`, `1024x1024` |
| `save_to_workspace` | string | No | — | Relative path within workspace root to save the first generated variation |
| `response_format` | string | No | `markdown` | Tool response format. `markdown`\|`json` |

> **Note:** `output_format`, `quality`, `background`, and `prompt` are not accepted by this tool. DALL-E 2 always returns PNG at the requested size.

#### Output Schema

**`response_format: markdown`:**

```markdown
## Image Variations

**Model:** dall-e-2  
**Size:** 1024x1024  
**Variations:** 3

### Variation 1
![Variation 1](data:image/png;base64,iVBORw0KGgo...)

### Variation 2
![Variation 2](data:image/png;base64,iVBORw0KGgo...)

### Variation 3
![Variation 3](data:image/png;base64,iVBORw0KGgo...)

*First variation saved to: /workspace/variations/v1.png*
```

**`response_format: json`:**

```json
{
  "success": true,
  "model": "dall-e-2",
  "provider": "openai",
  "images": [
    {
      "index": 0,
      "data": "iVBORw0KGgo...",
      "mimeType": "image/png",
      "size": "1024x1024",
      "savedTo": "/workspace/variations/v1.png"
    },
    {
      "index": 1,
      "data": "iVBORw0KGgo...",
      "mimeType": "image/png",
      "size": "1024x1024",
      "savedTo": null
    },
    {
      "index": 2,
      "data": "iVBORw0KGgo...",
      "mimeType": "image/png",
      "size": "1024x1024",
      "savedTo": null
    }
  ],
  "metadata": {
    "n": 3,
    "size": "1024x1024"
  }
}
```

> **Note:** When `n` > 1, only the first image (`index: 0`) is saved to workspace if `save_to_workspace` is provided.

#### Error Cases

| Error Code | Condition |
|------------|-----------|
| `MISSING_REQUIRED_PARAM` | `image` not provided |
| `INVALID_PARAM` | Image is not square (DALL-E 2 requirement) |
| `INVALID_PARAM` | Image is not PNG format |
| `INVALID_PARAM` | Image exceeds 20 MB |
| `INVALID_PARAM` | `n` outside range 1–10 |
| `INVALID_PARAM` | `size` not one of `256x256`, `512x512`, `1024x1024` |
| `PATH_TRAVERSAL` | `save_to_workspace` path escapes workspace root |
| `OPENAI_ERROR` | OpenAI API error |
| `PROVIDER_NOT_CONFIGURED` | `OPENAI_API_KEY` not set |

#### Example MCP Call

```json
{
  "jsonrpc": "2.0",
  "id": "req-003",
  "method": "tools/call",
  "params": {
    "name": "image_variation",
    "arguments": {
      "image": "iVBORw0KGgo...",
      "n": 4,
      "size": "512x512",
      "save_to_workspace": "variations/reference_v1.png",
      "response_format": "json"
    }
  }
}
```

---

### 3.4 `provider_list`

#### Description

Returns a list of all image generation providers known to the server, including their configuration status, available models, and health status. Use this tool to discover what capabilities are available before invoking generation tools.

**When to use:**
- Checking which providers are configured and available.
- Discovering the list of supported models.
- Diagnosing configuration issues before attempting generation.

#### Input Schema

This tool accepts **no parameters**.

#### Output Schema

**`response_format: markdown` (default):**

```markdown
## Available Image Providers

### ✅ openai
- **Status:** configured
- **Models:** gpt-image-2, gpt-image-1.5, gpt-image-1-mini, gpt-image-1, dall-e-2 (variations only)
- **API Key:** Configured (sk-pro…REDACTED)

---

*1 of 1 providers configured.*
```

**`response_format: json`:**

```json
{
  "providers": [
    {
      "name": "openai",
      "configured": true,
      "status": "available",
      "models": [
        {
          "id": "gpt-image-1",
          "capabilities": ["generate", "edit"],
          "default": true
        },
        {
          "id": "gpt-image-1.5",
          "capabilities": ["generate", "edit"],
          "default": false
        },
        {
          "id": "gpt-image-1-mini",
          "capabilities": ["generate", "edit"],
          "default": false
        },
        {
          "id": "gpt-image-1",
          "capabilities": ["generate", "edit"],
          "default": false
        },
        {
          "id": "dall-e-2",
          "capabilities": ["variation"],
          "default": false
        }
      ],
      "apiKeyPrefix": "sk-pro…REDACTED"
    }
  ],
  "summary": {
    "total": 1,
    "configured": 1,
    "unavailable": 0
  }
}
```

> **Note:** API key values are always masked — only the first 6 characters are shown, followed by `…REDACTED`. Full key values are never returned.

#### Example MCP Call

```json
{
  "jsonrpc": "2.0",
  "id": "req-004",
  "method": "tools/call",
  "params": {
    "name": "provider_list",
    "arguments": {}
  }
}
```

**Response (JSON):**

```json
{
  "jsonrpc": "2.0",
  "id": "req-004",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "## Available Image Providers\n\n### ✅ openai\n- **Status:** configured\n- **Models:** gpt-image-2, gpt-image-1.5, gpt-image-1-mini, gpt-image-1, dall-e-2 (variations only)\n"
      }
    ],
    "isError": false
  }
}
```

---

### 3.5 `provider_validate`

#### Description

Validates that a specific provider is correctly configured and reachable. Performs a lightweight API connectivity check (not a full image generation) to verify the API key is valid and the service is accessible.

**When to use:**
- Diagnosing authentication failures before attempting image generation.
- Health-checking a provider after key rotation.
- Confirming a provider is reachable from the current environment.

#### Input Schema

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `provider` | string | ✅ Yes | — | Provider name to validate. Currently supported: `openai` |

#### Output Schema

**`response_format: markdown`:**

```markdown
## Provider Validation: openai

✅ **Valid** — Provider is correctly configured and reachable.

- **API Key:** Configured (sk-pro…REDACTED)
- **Connectivity:** OK
- **Models available:** gpt-image-2, gpt-image-1.5, gpt-image-1-mini, gpt-image-1, dall-e-2 (variations only)
```

**On failure:**

```markdown
## Provider Validation: openai

❌ **Invalid** — Provider validation failed.

- **Error:** `invalid_api_key` — Incorrect API key provided.
- **Resolution:** Check that OPENAI_API_KEY is set correctly in your environment.
```

**`response_format: json`:**

```json
{
  "provider": "openai",
  "valid": true,
  "error": null,
  "details": {
    "connectivity": "ok",
    "apiKeyPrefix": "sk-pro…REDACTED",
    "modelsAccessible": ["gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini", "gpt-image-1", "dall-e-2"]
  }
}
```

**On failure:**

```json
{
  "provider": "openai",
  "valid": false,
  "error": "invalid_api_key: Incorrect API key provided.",
  "details": {
    "connectivity": "failed",
    "apiKeyPrefix": "sk-pro…REDACTED",
    "modelsAccessible": []
  }
}
```

#### Error Cases

| Error Code | Condition |
|------------|-----------|
| `MISSING_REQUIRED_PARAM` | `provider` not provided |
| `UNKNOWN_PROVIDER` | Provider name not recognised |
| `PROVIDER_NOT_CONFIGURED` | Named provider has no API key configured |
| `OPENAI_ERROR` | OpenAI returned an error during validation (e.g., invalid key) |
| `NETWORK_ERROR` | Could not reach the provider API endpoint |

#### Example MCP Call

```json
{
  "jsonrpc": "2.0",
  "id": "req-005",
  "method": "tools/call",
  "params": {
    "name": "provider_validate",
    "arguments": {
      "provider": "openai"
    }
  }
}
```

---

## 4. MCP Protocol Features

This server implements optional MCP protocol features beyond basic tool invocation. The following sections describe when and how each feature is used.

---

### 4.1 Elicitation

**Capability:** `elicitation` (negotiated during `initialize`)

#### When Triggered

Elicitation is used when a required parameter is missing from a tool call and cannot be reasonably inferred. The server sends an `elicitation/create` request to the MCP host, which presents a form to the user.

| Trigger Condition | Tool | Fields Requested |
|-------------------|------|-----------------|
| `prompt` is missing or empty | `image_generate`, `image_edit` | `prompt` (required text) |
| `image` is missing | `image_edit`, `image_variation` | `image` (base64 or URL) |
| `save_to_workspace` confirmation | Any generation tool | `save_path` (optional text), `confirm` (boolean) |

#### Example `elicitation/create` Request

The server sends this to the MCP host when `prompt` is missing from an `image_generate` call:

```json
{
  "jsonrpc": "2.0",
  "id": "elicit-001",
  "method": "elicitation/create",
  "params": {
    "message": "Please provide a description of the image you'd like to generate.",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "title": "Image Description",
          "description": "Describe the image you want to create. Be specific about style, subject, and composition.",
          "minLength": 1,
          "maxLength": 32000
        }
      },
      "required": ["prompt"]
    }
  }
}
```

**Elicitation response (from host):**

```json
{
  "jsonrpc": "2.0",
  "id": "elicit-001",
  "result": {
    "action": "submit",
    "content": {
      "prompt": "A serene Japanese garden with a koi pond, cherry blossom trees, and a wooden bridge at sunset"
    }
  }
}
```

**Security note:** Elicitation must never request secrets, API keys, passwords, or any sensitive credentials. See SECURITY.md §6.1.

---

### 4.2 Sampling

**Capability:** `sampling` (negotiated during `initialize`)

#### When Triggered

Sampling is used when the server needs to make an LLM call to assist with a task, such as improving a vague prompt or suggesting appropriate parameters.

| Trigger Condition | Purpose |
|-------------------|---------|
| User prompt is very short (< 10 chars) | Server asks LLM to expand/clarify the prompt |
| Model-specific parameter optimisation | Server asks LLM to recommend `size` and `quality` for the use case |

#### Example `sampling/createMessage` Request

Sent when the server wants LLM assistance expanding a terse prompt:

```json
{
  "jsonrpc": "2.0",
  "id": "sample-001",
  "method": "sampling/createMessage",
  "params": {
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Expand this brief image prompt into a detailed, descriptive prompt for an AI image generator. Return only the improved prompt text, nothing else.\n\nOriginal prompt: \"cat\""
        }
      }
    ],
    "modelPreferences": {
      "hints": [{ "name": "claude-3-5-haiku" }],
      "intelligencePriority": 0.3,
      "speedPriority": 0.9
    },
    "systemPrompt": "You are a helpful assistant that improves image generation prompts. Be specific, descriptive, and artistic. Do not include any harmful or sensitive content.",
    "maxTokens": 256
  }
}
```

**Sampling response (from host):**

```json
{
  "jsonrpc": "2.0",
  "id": "sample-001",
  "result": {
    "role": "assistant",
    "content": {
      "type": "text",
      "text": "A majestic orange tabby cat sitting on a sun-drenched windowsill, looking out at a lush garden, soft natural light illuminating its fur, photorealistic style, shallow depth of field"
    },
    "model": "claude-3-5-haiku-20241022",
    "stopReason": "end_turn"
  }
}
```

**Security note:** Sampling responses are treated as untrusted data and validated before use. See SECURITY.md §6.2.

---

### 4.3 Roots

**Capability:** `roots` (negotiated during `initialize`)

#### When Triggered

The server requests the list of workspace roots when:

1. A tool call includes `save_to_workspace` and the server needs to determine the allowed save locations.
2. At server startup (if `listChanged` notifications are enabled) to cache the initial roots.

#### Example `roots/list` Request

```json
{
  "jsonrpc": "2.0",
  "id": "roots-001",
  "method": "roots/list",
  "params": {}
}
```

**Roots response (from host):**

```json
{
  "jsonrpc": "2.0",
  "id": "roots-001",
  "result": {
    "roots": [
      {
        "uri": "file:///home/user/projects/my-project",
        "name": "my-project"
      },
      {
        "uri": "file:///home/user/workspace",
        "name": "workspace"
      }
    ]
  }
}
```

The server uses these roots to validate `save_to_workspace` paths. All save paths must resolve to within one of these roots. If no roots are returned and `save_to_workspace` is requested, the tool returns an error.

**Security note:** All paths are validated against roots before any file I/O. See SECURITY.md §6.3.

---

## 5. Error Reference

### 5.1 Tool Error Codes

The following error codes appear in tool result `content[0].text` when `isError: true`:

| Error Code | Description | Common Causes |
|------------|-------------|---------------|
| `MISSING_REQUIRED_PARAM` | A required parameter was not provided | `prompt` or `image` omitted |
| `INVALID_PARAM` | A parameter value is invalid or out of range | Wrong `size` for model, `n` out of range, invalid URL scheme |
| `PATH_TRAVERSAL` | `save_to_workspace` path escapes workspace root | `../` sequences, absolute paths outside root |
| `INVALID_FILE_EXTENSION` | File extension not in allowlist | Trying to save as `.exe`, `.sh`, etc. |
| `NULL_BYTE_IN_PATH` | Path contains a null byte character | Potential injection attempt |
| `IMAGE_TOO_LARGE` | Image payload exceeds 20 MB limit | Large base64 input |
| `UNSUPPORTED_IMAGE_FORMAT` | Image format not supported by the selected operation | Non-PNG mask, non-square image for DALL-E 2 variation |
| `UNKNOWN_PROVIDER` | Named provider does not exist | Typo in `provider` field |
| `PROVIDER_NOT_CONFIGURED` | Provider API key is not set | `OPENAI_API_KEY` missing from environment |
| `OPENAI_ERROR` | OpenAI API returned an error | Content policy violation, quota exceeded, invalid key, server error |
| `NETWORK_ERROR` | Network request to provider API failed | DNS failure, timeout, TLS error |
| `NO_WORKSPACE_ROOTS` | `save_to_workspace` requested but no roots granted | MCP host did not grant any workspace roots |
| `SAVE_OUTSIDE_ROOTS` | Save path is not within any granted workspace root | Path resolves outside all root directories |
| `RATE_LIMIT_EXCEEDED` | Client has exceeded the per-minute rate limit | Too many requests from one IP |
| `INTERNAL_ERROR` | Unexpected server error | Bug, unhandled exception — check server logs |

### 5.2 MCP Protocol-Level Errors

These errors are returned at the JSON-RPC level (not inside tool results) and indicate protocol or server issues:

| JSON-RPC Error Code | Message | Description |
|--------------------|---------|-------------|
| `-32700` | Parse error | Request body is not valid JSON |
| `-32600` | Invalid Request | JSON-RPC request structure is malformed |
| `-32601` | Method not found | Requested MCP method does not exist |
| `-32602` | Invalid params | Tool arguments fail schema validation |
| `-32603` | Internal error | Unhandled server-side error |
| `-32001` | Unauthorized | Missing or invalid `MCP_API_KEY` bearer token (HTTP mode) |
| `-32002` | Rate limited | Rate limit exceeded at transport level |
| `-32003` | Tool not found | `tools/call` references a tool name that does not exist |

### 5.3 HTTP Status Codes (HTTP Transport Mode)

| Status | Meaning |
|--------|---------|
| `200 OK` | Request processed (check `isError` in tool result for tool-level errors) |
| `400 Bad Request` | Malformed JSON-RPC request or invalid Host header |
| `401 Unauthorized` | Missing or invalid `Authorization: Bearer` header |
| `429 Too Many Requests` | Rate limit exceeded; see `Retry-After` response header |
| `500 Internal Server Error` | Unhandled server error |
| `503 Service Unavailable` | Server starting up or shutting down |

---

## Appendix A: Tool Capability Matrix

| Feature | `image_generate` | `image_edit` | `image_variation` | `provider_list` | `provider_validate` |
|---------|:-:|:-:|:-:|:-:|:-:|
| Text prompt | ✅ | ✅ | ❌ | ❌ | ❌ |
| Image input | ❌ | ✅ | ✅ | ❌ | ❌ |
| Mask input | ❌ | ✅ | ❌ | ❌ | ❌ |
| Multiple outputs (`n`) | ✅ (1–10) | ✅ (1–10) | ✅ (1–10) | ❌ | ❌ |
| Quality control | ✅ | ✅ | ❌ | ❌ | ❌ |
| Background transparency | ✅ | ❌ | ❌ | ❌ | ❌ |
| Output format selection | ✅ | ✅ | ❌ (PNG only) | ❌ | ❌ |
| Workspace save | ✅ | ✅ | ✅ | ❌ | ❌ |
| Usage tokens returned | ✅ | ✅ | ❌ | ❌ | ❌ |
| Revised prompt returned | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Appendix B: Model Feature Support

| Feature | `gpt-image-2` | `gpt-image-1.5` | `gpt-image-1-mini` | `gpt-image-1` | `dall-e-2` |
|---------|:-:|:-:|:-:|:-:|:-:|
| `image_generate` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `image_edit` | ✅ | ✅ | ✅ | ✅ | ✅ (PNG, square) |
| `image_variation` | ❌ | ❌ | ❌ | ❌ | ✅ |
| Transparent background | ✅ | ✅ | ✅ | ✅ | ❌ |
| `quality: high/medium/low` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `quality: hd/standard` | ❌ | ❌ | ❌ | ❌ | ❌ |
| Moderation control | ✅ | ✅ | ✅ | ✅ | ❌ |
| Usage token reporting | ✅ | ✅ | ✅ | ✅ | ❌ |
| Auto prompt revision | ❌ | ❌ | ❌ | ❌ | ❌ |
| `n` up to 10 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Azure availability | ✅ Public Preview | ⚠️ Limited Access | ⚠️ Limited Access | ⚠️ Limited Access | ❌ |

> ~~`dall-e-3`~~ was **retired 2026-03-04** and is no longer available on any provider.

---

*This document is auto-generated from tool schemas and maintained alongside the source code. For discrepancies between this document and actual tool behaviour, the source code is authoritative.*
