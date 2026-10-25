// Writes .env.production from the output of
// `firebase apps:sdkconfig WEB --json`, read on stdin. Used by the deploy
// workflow, so the web config never has to be copied by hand.
import { readFileSync, writeFileSync } from 'node:fs'

const { result } = JSON.parse(readFileSync(0, 'utf8'))
const config = result.sdkConfig ?? JSON.parse(result.fileContents)
for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
  if (!config[key]) throw new Error(`Web app config has no ${key}`)
}
writeFileSync(
  '.env.production',
  [
    `VITE_FIREBASE_API_KEY=${config.apiKey}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${config.authDomain}`,
    `VITE_FIREBASE_PROJECT_ID=${config.projectId}`,
    `VITE_FIREBASE_APP_ID=${config.appId}`,
    'VITE_USE_EMULATORS=false',
    '',
  ].join('\n'),
)
