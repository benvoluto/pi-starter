import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { findGoogleCloudCliPath } from './auth'
import { resolveConfig } from './config'
import { API_NAME, PROVIDER_NAME, buildVertexModels } from './models'
import { exec, spawn } from './shell'
import { streamVertexAnthropic } from './stream'

const REGION_CHOICES: Record<string, string> = {
  '1': 'global',
  '2': 'us',
  '3': 'eu',
  '4': 'us-east5',
  '5': 'europe-west1',
  '6': 'asia-southeast1',
}

function gcloudOrThrow(): string {
  const path = findGoogleCloudCliPath()
  if (!path) {
    throw new Error('gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install, then run /login again.')
  }
  return path
}

export default function (pi: ExtensionAPI) {
  const config = resolveConfig()

  pi.registerProvider(PROVIDER_NAME, {
    name: 'Claude on Vertex AI',
    // Informational: requests are routed by the Vertex fetch, which builds the real URL.
    baseUrl: config.baseUrl,
    api: API_NAME,
    apiKey: 'vertex-oauth',
    models: buildVertexModels(config.compatMode === 'full'),
    streamSimple: streamVertexAnthropic,

    oauth: {
      name: 'Google Cloud Vertex AI (Claude)',

      async login(callbacks) {
        const gcloud = gcloudOrThrow()

        callbacks.onProgress?.('Checking gcloud authentication...')
        let authenticated = false
        try {
          authenticated = exec(gcloud, ['auth', 'print-access-token'], { timeout: 10000 }).length > 20
        } catch {
          authenticated = false
        }
        if (!authenticated) {
          const answer = await callbacks.onPrompt({
            message: "Not signed in to gcloud. Run 'gcloud auth login' now? A browser window will open. (y/n)",
          })
          if (answer?.trim().toLowerCase() !== 'y') {
            throw new Error('Sign in first: gcloud auth login (or gcloud auth application-default login)')
          }
          spawn(gcloud, ['auth', 'login'], { stdio: 'inherit' })
        }

        callbacks.onProgress?.('Configuring project...')
        let project = process.env.ANTHROPIC_VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || ''
        if (!project) {
          let current = ''
          try {
            current = exec(gcloud, ['config', 'get-value', 'project'], { timeout: 5000 })
          } catch {
            // ignore
          }
          if (current && current !== '(unset)') {
            const use = await callbacks.onPrompt({ message: `Use gcloud's current project '${current}'? (y/n)` })
            if (use?.trim().toLowerCase() === 'y') project = current
          }
        }
        if (!project) {
          const entered = await callbacks.onPrompt({ message: 'Enter your GCP project ID:' })
          project = entered?.trim() ?? ''
          if (!project) throw new Error('A GCP project ID is required')
        }

        callbacks.onProgress?.('Configuring region...')
        let region = process.env.CLOUD_ML_REGION || process.env.VERTEX_LOCATION || process.env.VERTEXAI_LOCATION || ''
        if (!region) {
          const choice = await callbacks.onPrompt({
            message:
              'Select region:\n\n' +
              '  1. global (recommended: newest models, lowest price)\n' +
              '  2. us (multi-region)\n' +
              '  3. eu (multi-region)\n' +
              '  4. us-east5\n' +
              '  5. europe-west1\n' +
              '  6. asia-southeast1\n\n' +
              'Enter 1-6 or a region name:',
          })
          region = REGION_CHOICES[choice?.trim() ?? ''] || choice?.trim() || 'global'
        }

        callbacks.onProgress?.(
          `Configured.\nProject: ${project}\nRegion: ${region}\n` +
            'Saved to ~/.pi/agent/auth.json. Environment variables still take priority.',
        )

        return {
          refresh: Date.now().toString(),
          access: 'gcloud',
          expires: Date.now() + 1000 * 60 * 60 * 24 * 365,
          project,
          region,
        }
      },

      async refreshToken(credentials) {
        return { ...credentials, refresh: Date.now().toString() }
      },

      // Requests get a fresh Google token inside the stream; this value is a placeholder.
      getApiKey() {
        return 'vertex-oauth'
      },
    },
  })
}
