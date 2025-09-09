/**
 * Debug utilities for development
 */

import { config } from './config';

/**
 * Log environment configuration in development mode
 */
export function logEnvironmentInfo(): void {
  if (!config.dev.mode) {
    return;
  }

  console.group('🔧 Environment Configuration');
  
  console.log('Mode:', import.meta.env.MODE);
  console.log('Dev:', import.meta.env.DEV);
  console.log('Prod:', import.meta.env.PROD);
  
  console.group('📱 App Config');
  console.log('Name:', config.app.name);
  console.log('Version:', config.app.version);
  console.groupEnd();
  
  console.group('🔐 Auth Config');
  console.log('Domain:', config.cognito.domain);
  console.log('Redirect URI:', config.cognito.redirectUri);
  console.log('Logout URI:', config.cognito.logoutUri);
  console.groupEnd();
  
  console.group('🌐 API Config');
  console.log('URL:', config.api.url);
  console.groupEnd();
  
  console.group('🎛️ Features');
  console.log('PII Toggle:', config.features.piiToggle);
  console.log('Citations:', config.features.citations);
  console.log('Guardrail Banner:', config.features.guardrailBanner);
  console.groupEnd();
  
  console.group('🎨 UI Config');
  console.log('Max Message Length:', config.ui.maxMessageLength);
  console.log('Chat History Limit:', config.ui.chatHistoryLimit);
  console.log('Citation Panel Width:', config.ui.citationPanelWidth);
  console.groupEnd();
  
  console.groupEnd();
}

/**
 * Check if all required environment variables are present
 */
export function checkEnvironmentVariables(): { missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];
  
  // Required variables
  const required = [
    'VITE_COGNITO_USER_POOL_ID',
    'VITE_COGNITO_CLIENT_ID',
    'VITE_COGNITO_DOMAIN',
    'VITE_API_URL',
  ];
  
  for (const key of required) {
    if (!import.meta.env[key]) {
      missing.push(key);
    }
  }
  
  // Optional but recommended variables
  const recommended = [
    'VITE_COGNITO_REDIRECT_URI',
    'VITE_COGNITO_LOGOUT_URI',
    'VITE_APP_NAME',
    'VITE_APP_VERSION',
  ];
  
  for (const key of recommended) {
    if (!import.meta.env[key]) {
      warnings.push(key);
    }
  }
  
  if (config.dev.mode) {
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:', missing);
    }
    
    if (warnings.length > 0) {
      console.warn('⚠️ Missing recommended environment variables:', warnings);
    }
    
    if (missing.length === 0 && warnings.length === 0) {
      console.log('✅ All environment variables are properly configured');
    }
  }
  
  return { missing, warnings };
}

/**
 * Performance monitoring utilities
 */
export const perf = {
  mark: (name: string) => {
    if (config.dev.mode && 'performance' in window) {
      performance.mark(name);
    }
  },
  
  measure: (name: string, startMark: string, endMark?: string) => {
    if (config.dev.mode && 'performance' in window) {
      try {
        const measure = performance.measure(name, startMark, endMark);
        console.log(`⏱️ ${name}: ${measure.duration.toFixed(2)}ms`);
        return measure;
      } catch (error) {
        console.warn('Performance measurement failed:', error);
      }
    }
  },
  
  now: () => {
    if ('performance' in window) {
      return performance.now();
    }
    return Date.now();
  },
};

export default {
  logEnvironmentInfo,
  checkEnvironmentVariables,
  perf,
};