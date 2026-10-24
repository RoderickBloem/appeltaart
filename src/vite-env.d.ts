/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_USE_EMULATORS: string
}

interface Window {
  /** Present only in builds that use the Firebase emulators. Resolves to the uid. */
  emulatorSignIn?: (name: string, email: string) => Promise<string>
}
