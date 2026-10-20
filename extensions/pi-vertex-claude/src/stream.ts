import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  TranscriptContext,
} from '@earendil-works/pi-ai'
import { lazyStream } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'

import { clearTokenCache, getAccessToken } from './auth'
import { resolveConfig } from './config'
import { createVertexFetch } from './vertex-fetch'

type StreamSimple = (
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream

let anthropicStreamSimple: StreamSimple | undefined

/** Pi's own Anthropic Messages implementation (request building, tools, thinking, caching). */
function getAnthropicStreamSimple(): StreamSimple {
  if (!anthropicStreamSimple) {
    const provider = builtinProviders().find((p) => p.id === 'anthropic')
    if (!provider) throw new Error('vertex-anthropic: pi has no built-in Anthropic provider')
    anthropicStreamSimple = provider.streamSimple.bind(provider) as StreamSimple
  }
  return anthropicStreamSimple
}

/**
 * Stream Claude on Vertex AI by delegating to pi's built-in Anthropic implementation
 * with a fetch that rewrites requests for Vertex. Pi's Anthropic code reads the
 * system prompt and tools from the transcript, maps thinking levels to adaptive
 * thinking and effort, applies prompt caching, and calls onPayload/onResponse.
 */
export function streamVertexAnthropic(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  return lazyStream(model, async () => {
    const config = resolveConfig()
    if (!config.project) {
      throw new Error(
        'vertex-anthropic: no GCP project configured. Set ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT, or run /login.',
      )
    }

    const vertexFetch = createVertexFetch({
      ...config,
      baseFetch: options?.fetch,
      getToken: async (forceRefresh) => {
        if (forceRefresh) clearTokenCache()
        try {
          return await getAccessToken()
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          throw new Error(`vertex-anthropic: could not get a Google access token: ${msg}\nRun: gcloud auth application-default login`)
        }
      },
    })

    // The placeholder key satisfies the Anthropic client; the Vertex fetch strips it
    // and sends a Google OAuth bearer token instead.
    return getAnthropicStreamSimple()(model, context, {
      ...options,
      apiKey: 'vertex-oauth',
      fetch: vertexFetch,
    })
  })
}
