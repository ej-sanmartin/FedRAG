/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Cognito Configuration
  readonly VITE_COGNITO_USER_POOL_ID: string
  readonly VITE_COGNITO_CLIENT_ID: string
  readonly VITE_COGNITO_DOMAIN: string
  readonly VITE_COGNITO_REDIRECT_URI: string
  readonly VITE_COGNITO_LOGOUT_URI: string

  // API Configuration
  readonly VITE_API_URL: string

  // Application Configuration
  readonly VITE_APP_NAME: string
  readonly VITE_APP_VERSION: string

  // Development Configuration
  readonly VITE_DEV_MODE: string
  readonly VITE_LOG_LEVEL: string

  // Feature Flags
  readonly VITE_ENABLE_PII_TOGGLE: string
  readonly VITE_ENABLE_CITATIONS: string
  readonly VITE_ENABLE_GUARDRAIL_BANNER: string

  // UI Configuration
  readonly VITE_MAX_MESSAGE_LENGTH: string
  readonly VITE_CHAT_HISTORY_LIMIT: string
  readonly VITE_CITATION_PANEL_WIDTH: string

  // AWS Region
  readonly VITE_AWS_REGION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}