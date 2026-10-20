import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent'

export const PROVIDER_NAME = 'vertex-anthropic'
export const API_NAME = 'vertex-anthropic-api'

/** Pi model id → Vertex publisher model id (only where they differ). */
const vertexIds = new Map<string, string>()

export function toVertexModelId(id: string): string {
  return vertexIds.get(id) ?? id
}

/**
 * Compat flags that turn on 2026-era Anthropic betas (mid-conversation system messages,
 * effort changes and tool changes, server-side fallback). Vertex support for these is
 * unverified, so they are off unless VERTEX_ANTHROPIC_COMPAT=full.
 */
const UNVERIFIED_COMPAT_KEYS = [
  'supportsMidConvoEffort',
  'supportsMidConvoSystemMessages',
  'supportsMidConvoToolChanges',
  'allowedFallbackModels',
] as const

function vertexCompat(compat: Record<string, unknown> | undefined, full: boolean) {
  if (!compat) return undefined
  if (full) return compat
  const next: Record<string, unknown> = { ...compat }
  for (const key of UNVERIFIED_COMPAT_KEYS) delete next[key]
  return next
}

const DATED_ID = /^(.*)-(\d{8})$/

/** Generic metadata for a Vertex model pi's catalog does not know yet. */
function extraModel(id: string): ProviderModelConfig {
  return {
    id,
    name: `${id} (Vertex)`,
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 64000,
    compat: { forceAdaptiveThinking: true },
  }
}

/**
 * Build the model list from pi's own Anthropic catalog, so every pi update brings new
 * Claude models with correct limits, pricing, and thinking behavior. No hardcoded list.
 */
export function buildVertexModels(fullCompat: boolean): ProviderModelConfig[] {
  vertexIds.clear()
  const catalog = getBuiltinModels('anthropic') as any[]

  // Undated ids that also have a dated sibling (claude-opus-4-5 / claude-opus-4-5-20251101)
  // must be called on Vertex as base@date.
  const datedByBase = new Map<string, string>()
  for (const m of catalog) {
    const match = DATED_ID.exec(m.id)
    if (match) datedByBase.set(match[1], match[2])
  }

  const models: ProviderModelConfig[] = []
  for (const m of catalog) {
    if (m.type && m.type !== 'chat') continue
    if (DATED_ID.test(m.id)) continue
    const date = datedByBase.get(m.id)
    if (date) vertexIds.set(m.id, `${m.id}@${date}`)

    const model: Record<string, unknown> = {
      id: m.id,
      name: `${String(m.name).replace(/\s*\(latest\)\s*$/i, '')} (Vertex)`,
      reasoning: m.reasoning,
      input: m.input,
      cost: m.cost,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
    }
    if (m.thinkingLevelMap) model.thinkingLevelMap = m.thinkingLevelMap
    if (m.promptCache) model.promptCache = m.promptCache
    if (m.inputLimits) model.inputLimits = m.inputLimits
    const compat = vertexCompat(m.compat, fullCompat)
    if (compat) model.compat = compat
    models.push(model as unknown as ProviderModelConfig)
  }

  // Models Vertex serves before pi's catalog knows them: VERTEX_ANTHROPIC_EXTRA_MODELS=id1,id2
  const extras = (process.env.VERTEX_ANTHROPIC_EXTRA_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  for (const id of extras) {
    if (!models.some((m) => m.id === id)) models.push(extraModel(id))
  }

  return models
}
