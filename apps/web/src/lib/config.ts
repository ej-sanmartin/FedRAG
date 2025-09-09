/**
 * Application configuration utility
 * Handles environment variables with proper defaults and validation
 */

export interface AppConfig {
  // Cognito Configuration
  cognito: {
    userPoolId: string;
    clientId: string;
    domain: string;
    redirectUri: string;
    logoutUri: string;
  };

  // API Configuration
  api: {
    url: string;
  };

  // Application Configuration
  app: {
    name: string;
    version: string;
  };

  // Development Configuration
  dev: {
    mode: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
  };

  // Feature Flags
  features: {
    piiToggle: boolean;
    citations: boolean;
    guardrailBanner: boolean;
  };

  // UI Configuration
  ui: {
    maxMessageLength: number;
    chatHistoryLimit: number;
    citationPanelWidth: number;
  };

  // AWS Configuration
  aws: {
    region: string;
  };
}

/**
 * Get environment variable with optional default value
 */
function getEnvVar(key: string, defaultValue?: string): string {
  const value = import.meta.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${key} is required but not defined`);
  }
  return value;
}

/**
 * Parse boolean environment variable
 */
function getBooleanEnvVar(key: string, defaultValue: boolean = false): boolean {
  const value = import.meta.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

/**
 * Parse number environment variable
 */
function getNumberEnvVar(key: string, defaultValue: number): number {
  const value = import.meta.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Application configuration object
 */
export const config: AppConfig = {
  cognito: {
    userPoolId: getEnvVar('VITE_COGNITO_USER_POOL_ID'),
    clientId: getEnvVar('VITE_COGNITO_CLIENT_ID'),
    domain: getEnvVar('VITE_COGNITO_DOMAIN'),
    redirectUri: getEnvVar('VITE_COGNITO_REDIRECT_URI', `${window.location.origin}/callback`),
    logoutUri: getEnvVar('VITE_COGNITO_LOGOUT_URI', window.location.origin),
  },

  api: {
    url: getEnvVar('VITE_API_URL'),
  },

  app: {
    name: getEnvVar('VITE_APP_NAME', 'FedRag Assistant'),
    version: getEnvVar('VITE_APP_VERSION', '1.0.0'),
  },

  dev: {
    mode: getBooleanEnvVar('VITE_DEV_MODE', import.meta.env.DEV),
    logLevel: (getEnvVar('VITE_LOG_LEVEL', 'info') as AppConfig['dev']['logLevel']),
  },

  features: {
    piiToggle: getBooleanEnvVar('VITE_ENABLE_PII_TOGGLE', true),
    citations: getBooleanEnvVar('VITE_ENABLE_CITATIONS', true),
    guardrailBanner: getBooleanEnvVar('VITE_ENABLE_GUARDRAIL_BANNER', true),
  },

  ui: {
    maxMessageLength: getNumberEnvVar('VITE_MAX_MESSAGE_LENGTH', 2000),
    chatHistoryLimit: getNumberEnvVar('VITE_CHAT_HISTORY_LIMIT', 50),
    citationPanelWidth: getNumberEnvVar('VITE_CITATION_PANEL_WIDTH', 400),
  },

  aws: {
    region: getEnvVar('VITE_AWS_REGION', 'us-east-1'),
  },
};

/**
 * Validate configuration on startup
 */
export function validateConfig(): void {
  const requiredFields = [
    'cognito.userPoolId',
    'cognito.clientId',
    'cognito.domain',
    'api.url',
  ];

  for (const field of requiredFields) {
    const keys = field.split('.');
    let value: unknown = config;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        value = undefined;
        break;
      }
    }
    
    if (!value) {
      throw new Error(`Configuration field ${field} is required but not provided`);
    }
  }

  // Log configuration in development mode (without sensitive data)
  if (config.dev.mode) {
    console.log('App Configuration:', {
      app: config.app,
      features: config.features,
      ui: config.ui,
      aws: config.aws,
      cognito: {
        domain: config.cognito.domain,
        redirectUri: config.cognito.redirectUri,
        logoutUri: config.cognito.logoutUri,
      },
      api: {
        url: config.api.url,
      },
    });
  }
}

export default config;