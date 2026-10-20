import type { CompatMode } from './config'
import { toVertexModelId } from './models'

const VERTEX_VERSION = 'vertex-2023-10-16'

/**
 * Betas Vertex is known to accept. In "safe" mode, other betas are dropped
 * instead of risking a 400 on every request.
 */
const SAFE_BETAS = new Set([
  'interleaved-thinking-2025-05-14',
  'fine-grained-tool-streaming-2025-05-14',
  'context-1m-2025-08-07',
])

/** 400 messages that indicate Vertex rejected an optional field or beta. */
const COMPAT_ERROR = /anthropic-beta|beta|eager_input_streaming|strict|extra inputs|not permitted|unknown (field|parameter)|unrecognized/i

/** Set after Vertex rejects an optional feature; later requests skip it for this pi process. */
let downgradedToMinimal = false

export function resetVertexDowngrade(): void {
  downgradedToMinimal = false
}

export interface VertexFetchOptions {
  project: string
  region: string
  baseUrl: string
  compatMode: CompatMode
  getToken: (forceRefresh?: boolean) => Promise<string>
  baseFetch?: typeof fetch
}

type Prepared = { url: string; init: RequestInit }

function filterBetas(headers: Headers, mode: CompatMode): void {
  const raw = headers.get('anthropic-beta')
  if (!raw || mode === 'full') return
  const kept =
    mode === 'minimal'
      ? []
      : raw
          .split(',')
          .map((b) => b.trim())
          .filter((b) => SAFE_BETAS.has(b))
  if (kept.length > 0) headers.set('anthropic-beta', kept.join(','))
  else headers.delete('anthropic-beta')
}

function stripOptionalFields(body: Record<string, any>): void {
  if (!Array.isArray(body.tools)) return
  for (const tool of body.tools) {
    if (tool && typeof tool === 'object') {
      delete tool.eager_input_streaming
      delete tool.strict
    }
  }
}

/**
 * Rewrite an Anthropic Messages request into Vertex's wire shape, mirroring
 * @anthropic-ai/vertex-sdk: model moves from the body into the URL, the body
 * gains anthropic_version, and Google OAuth replaces Anthropic API-key auth.
 */
function prepare(
  input: string | URL | Request,
  init: RequestInit | undefined,
  opts: VertexFetchOptions,
  token: string,
  mode: CompatMode,
): Prepared {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  let bodyText = typeof init?.body === 'string' ? init.body : undefined

  const prefix = `${opts.baseUrl}/projects/${opts.project}/locations/${opts.region}/publishers/anthropic/models`

  if (url.pathname.endsWith('/v1/messages') && bodyText !== undefined) {
    const body = JSON.parse(bodyText)
    const modelId = toVertexModelId(String(body.model))
    delete body.model
    body.anthropic_version ??= VERTEX_VERSION
    if (mode === 'minimal') stripOptionalFields(body)
    const specifier = body.stream ? 'streamRawPredict' : 'rawPredict'
    bodyText = JSON.stringify(body)
    return finish(`${prefix}/${modelId}:${specifier}`)
  }

  if (url.pathname.endsWith('/v1/messages/count_tokens') && bodyText !== undefined) {
    const body = JSON.parse(bodyText)
    if (body.model) body.model = toVertexModelId(String(body.model))
    body.anthropic_version ??= VERTEX_VERSION
    bodyText = JSON.stringify(body)
    return finish(`${prefix}/count-tokens:rawPredict`)
  }

  throw new Error(`vertex-anthropic: unsupported request path ${url.pathname}`)

  function finish(target: string): Prepared {
    // Never forward Anthropic credentials to Google; use Google OAuth only.
    headers.delete('x-api-key')
    headers.delete('authorization')
    headers.set('authorization', `Bearer ${token}`)
    headers.set('content-type', 'application/json')
    filterBetas(headers, mode)
    return { url: target, init: { ...init, method: 'POST', headers, body: bodyText } }
  }
}

/**
 * A fetch implementation for pi's built-in Anthropic client that sends requests
 * to Claude on Vertex AI instead of api.anthropic.com.
 */
export function createVertexFetch(opts: VertexFetchOptions): typeof fetch {
  const baseFetch = opts.baseFetch ?? globalThis.fetch

  const vertexFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const mode: CompatMode = downgradedToMinimal && opts.compatMode !== 'full' ? 'minimal' : opts.compatMode

    let token = await opts.getToken()
    let req = prepare(input, init, opts, token, mode)
    let res = await baseFetch(req.url, req.init)

    // Expired or revoked cached token: refresh once.
    if (res.status === 401) {
      token = await opts.getToken(true)
      req = prepare(input, init, opts, token, mode)
      res = await baseFetch(req.url, req.init)
    }

    // Vertex rejected an optional feature: retry without it, and remember for this session.
    if (res.status === 400 && mode === 'safe') {
      const text = await res.clone().text()
      if (COMPAT_ERROR.test(text)) {
        downgradedToMinimal = true
        req = prepare(input, init, opts, token, 'minimal')
        res = await baseFetch(req.url, req.init)
      }
    }

    return res
  }

  return vertexFetch as typeof fetch
}
