import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { PROVIDER_NAME } from './models'

const AUTH_PATH = join(homedir(), '.pi', 'agent', 'auth.json')

/** Newer Claude models are served first (and often only) on the global endpoint. */
export const DEFAULT_REGION = 'global'

export type CompatMode = 'full' | 'safe' | 'minimal'

export interface VertexConfig {
  project: string
  region: string
  baseUrl: string
  compatMode: CompatMode
}

interface PersistedCredentials {
  project?: string
  region?: string
}

/** Project and region saved by the /login flow in ~/.pi/agent/auth.json. */
function getPersistedCredentials(): PersistedCredentials {
  try {
    const data = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'))
    const cred = data[PROVIDER_NAME]
    if (cred && typeof cred === 'object') {
      return { project: cred.project, region: cred.region }
    }
  } catch {
    // No persisted credentials
  }
  return {}
}

/**
 * Project priority: ANTHROPIC_VERTEX_PROJECT_ID (Claude Code) → GOOGLE_CLOUD_PROJECT → /login.
 */
export function resolveProject(persisted: PersistedCredentials): string {
  return (
    process.env.ANTHROPIC_VERTEX_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    persisted.project ||
    ''
  )
}

/**
 * Region priority: CLOUD_ML_REGION (Claude Code) → VERTEX_LOCATION → VERTEXAI_LOCATION
 * → /login → global.
 */
export function resolveRegion(persisted: PersistedCredentials): string {
  return (
    process.env.CLOUD_ML_REGION ||
    process.env.VERTEX_LOCATION ||
    process.env.VERTEXAI_LOCATION ||
    persisted.region ||
    DEFAULT_REGION
  )
}

/**
 * Vertex base URL (including /v1), matching Anthropic's official Vertex SDK.
 * ANTHROPIC_VERTEX_BASE_URL overrides it, as in the SDK.
 */
export function buildBaseUrl(region: string): string {
  const override = process.env.ANTHROPIC_VERTEX_BASE_URL
  if (override) return override.replace(/\/+$/, '')
  switch (region) {
    case 'global':
      return 'https://aiplatform.googleapis.com/v1'
    case 'us':
      return 'https://aiplatform.us.rep.googleapis.com/v1'
    case 'eu':
      return 'https://aiplatform.eu.rep.googleapis.com/v1'
    default:
      return `https://${region}-aiplatform.googleapis.com/v1`
  }
}

export function resolveCompatMode(): CompatMode {
  const raw = (process.env.VERTEX_ANTHROPIC_COMPAT || '').trim().toLowerCase()
  return raw === 'full' || raw === 'minimal' ? raw : 'safe'
}

export function resolveConfig(): VertexConfig {
  const persisted = getPersistedCredentials()
  const region = resolveRegion(persisted)
  return {
    project: resolveProject(persisted),
    region,
    baseUrl: buildBaseUrl(region),
    compatMode: resolveCompatMode(),
  }
}
