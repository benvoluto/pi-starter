# pi-vertex-claude

Claude on Google Cloud Vertex AI for pi 1.x. Replaces `pi-provider-vertex-anthropic`, which predates pi 1.0 and silently drops pi's system prompt and tools.

The provider id is still `vertex-anthropic`, so existing `/login` settings, defaults and `vertex-anthropic/...` model references keep working.

## How it works

Instead of its own request and streaming code, this extension hands each request to pi's built-in Anthropic implementation with a `fetch` that rewrites it for Vertex, the same way Anthropic's official `@anthropic-ai/vertex-sdk` does: the model moves into the URL, `anthropic_version: vertex-2023-10-16` is added, and a Google OAuth token replaces the Anthropic API key.

So you get pi's own handling of the system prompt, tools, adaptive thinking and effort levels, thinking replay, prompt caching, and extension hooks. The model list comes from pi's Anthropic catalog, so new Claude models appear when you update pi.

## Install

```bash
pi remove npm:pi-provider-vertex-anthropic
mkdir -p ~/.pi/agent/extensions
unzip ~/Downloads/pi-vertex-claude.zip -d ~/.pi/agent/extensions/
```

Restart pi. No `npm install` needed; it has no dependencies.

## Configuration

| Setting | Variables (first match wins) | Default |
| --- | --- | --- |
| Project | `ANTHROPIC_VERTEX_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT`, `/login` | none |
| Region | `CLOUD_ML_REGION`, `VERTEX_LOCATION`, `VERTEXAI_LOCATION`, `/login` | `global` |
| Auth | `GOOGLE_APPLICATION_CREDENTIALS` (service account), ADC file, `gcloud auth print-access-token` | |

Regions `global`, `us`, `eu` and any `<region>` (e.g. `us-east5`) are supported.

### Optional

- `VERTEX_ANTHROPIC_COMPAT=safe|minimal|full` (default `safe`)
  - `safe`: pi's catalog settings, minus 2026 betas Vertex may not accept. If Vertex rejects an optional feature with a 400, the request is retried once without optional features, and the rest of the session stays in `minimal`.
  - `minimal`: no beta headers, no `strict` or `eager_input_streaming` on tools.
  - `full`: everything pi sends to Anthropic's own API.
- `VERTEX_ANTHROPIC_EXTRA_MODELS=claude-new-model,...`: add models Vertex serves before pi's catalog has them.
- `ANTHROPIC_VERTEX_BASE_URL`: override the endpoint, as in Anthropic's SDK.
- `VERTEX_ANTHROPIC_ACCESS_TOKEN`: use this bearer token instead of looking one up.

## Notes

- Model ids are pi's ids, e.g. `claude-opus-5`, `claude-opus-4-5`. Older dated ids such as `claude-opus-4-5@20251101` are mapped internally; update any `enabledModels` entries that use the `@date` form.
- A model only works if it is enabled in Model Garden and your project has quota for it in the region you call.
- Pricing shown in pi is Anthropic's list price. Vertex regional endpoints cost about 10% more than `global`.
