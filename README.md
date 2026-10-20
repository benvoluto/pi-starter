# pi-starter

A starter setup for the [pi coding agent](https://pi.dev): recommended packages, sensible defaults, model providers, and MCP servers (Glean, Asana, Slack).

This repo is public and contains **no secrets or org-specific values**. Those come from a local, gitignored `org.env` that you fill in yourself.

## What you get

| | |
|---|---|
| **Packages** | [`pi-ultracode`](https://www.npmjs.com/package/pi-ultracode) (multi-agent workflows), [`pi-ultracode-verify`](https://github.com/benvoluto/pi-ultracode-verify) (auto-detected test/lint/typecheck gate + workflows), [`pi-vercel`](https://github.com/benvoluto/pi-vercel) (Vercel MCP + CLI tool), `pi-vertex-claude` (Claude on Vertex AI) |
| **Settings** | Vertex AI / Claude Opus as default provider and model, collapsed thinking blocks, VS Code as external editor |
| **Models** | Vertex AI (Claude via Google Cloud), Optional Reflection provider (`Beam-1.0`) |
| **MCP** | Glean, Asana, Slack, Omni (all deferred-exposure, so they don't bloat the prompt) |

## Install

Requires `pi` and Node 18+.

```bash
git clone https://github.com/benvoluto/pi-starter.git
cd pi-starter
cp org.env.example org.env     # fill in the values (ask a teammate / see the internal wiki)
node install.mjs --dry-run     # preview
node install.mjs
```

The installer is **additive and safe to re-run**:

- It only adds settings, providers, and MCP servers you don't already have. Existing entries are never overwritten.
- It backs up any file it changes to `<file>.bak-<timestamp>`.
- If an MCP server or provider is missing its required values in `org.env`, it is skipped with a note. Leave a value blank to opt out.

Options: `--only settings,models,mcp,extensions,packages`, `--skip-packages`, `--dry-run`. Set `PI_CODING_AGENT_DIR` to target a different config dir.

### Runtime secrets

Some values are never written to disk. Pi reads them from your environment each time it runs, so export them in your shell profile (`~/.zshrc`):

```bash
export ASANA_MCP_CLIENT_SECRET=...   # if using Asana
export REFLECTION_API_KEY=...        # if using the Reflection provider
```

For Vertex AI (default), run `/login` inside pi or set `ANTHROPIC_VERTEX_PROJECT_ID` and optionally `CLOUD_ML_REGION`. For direct Anthropic API, set `ANTHROPIC_API_KEY`.

### Sign in to MCP servers

Start `pi`, run `/mcp`, and choose **Sign in** for Glean, Asana, Slack, and Omni. Tokens are stored in `~/.pi/agent/mcp-auth.json` on your machine only.

### Vertex AI setup

The default provider is `vertex-anthropic`, which uses the custom `pi-vertex-claude` package. This package replaces `pi-provider-vertex-anthropic` (which predates pi 1.0 and silently drops pi's system prompt and tools) and uses pi's built-in Anthropic implementation with a custom fetch for Vertex AI.

To configure:
1. Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install) if you haven't already
2. Run `pi` and then `/login`
3. Select the `vertex-anthropic` provider and follow the prompts to authenticate and configure your GCP project and region

Alternatively, set these environment variables in your shell profile:
```bash
export ANTHROPIC_VERTEX_PROJECT_ID=your-gcp-project-id
export CLOUD_ML_REGION=global  # or us, eu, us-east5, etc.
```

The package supports all pi 1.0 features including system prompts, tools, adaptive thinking, prompt caching, and extension hooks.

## Not included

- **TWG / Atlassian skills.** These are licensed by Atlassian and can't be redistributed. Install them from their official source if you have access.
- **Credentials.** Never copy `auth.json`, `mcp-auth.json`, or `models-store.json` from someone else's machine.

## Contributing

Before pushing, run `./scripts/check-no-secrets.sh`. CI also runs it on every push. It flags API keys, literal secrets, org hostnames, numeric OAuth client IDs, and home-directory paths. Put anything org-specific in `org.env.example` as a blank placeholder and reference it as `{{VAR}}` (filled in at install time) or `${VAR}` (read from the environment by pi at runtime).
