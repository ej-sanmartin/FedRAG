/**
 * Cognito OAuth integration with PKCE flow
 * Implements secure authentication flow for FedRag application
 */

interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  domain: string;
  redirectUri: string;
  logoutUri: string;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface DecodedToken {
  sub: string;
  email: string;
  name?: string;
  exp: number;
  iat: number;
}

interface User {
  id: string;
  email: string;
  name?: string;
}

// Configuration - these will be set via environment variables
const getCognitoConfig = (): CognitoConfig => {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const domain = import.meta.env.VITE_COGNITO_DOMAIN;
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI || `${window.location.origin}/callback`;
  const logoutUri = import.meta.env.VITE_COGNITO_LOGOUT_URI || window.location.origin;

  if (!userPoolId || !clientId || !domain) {
    throw new Error('Missing required Cognito configuration. Please check environment variables.');
  }

  return {
    userPoolId,
    clientId,
    domain,
    redirectUri,
    logoutUri,
  };
};

/**
 * Generate a cryptographically secure random string for PKCE
 */
const generateRandomString = (length: number): string => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => charset[v % charset.length]).join('');
};

/**
 * Generate SHA256 hash and base64url encode for PKCE challenge
 */
const sha256 = async (plain: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  
  // Convert to base64url encoding
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

/**
 * Generate PKCE code verifier and challenge
 */
const generatePKCE = async (): Promise<{ codeVerifier: string; codeChallenge: string }> => {
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await sha256(codeVerifier);
  
  return {
    codeVerifier,
    codeChallenge,
  };
};

/**
 * Decode JWT token without verification (for client-side use only)
 * Note: Token verification should be done server-side
 */
const decodeJWT = (token: string): DecodedToken => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    
    const payload = parts[1];
    // Add padding if needed for base64 decoding
    const paddedPayload = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = JSON.parse(atob(paddedPayload));
    
    return decoded;
  } catch (error) {
    throw new Error('Failed to decode JWT token');
  }
};

/**
 * Check if token is expired (with 5 minute buffer)
 */
const isTokenExpired = (token: string): boolean => {
  try {
    const decoded = decodeJWT(token);
    const now = Math.floor(Date.now() / 1000);
    const buffer = 5 * 60; // 5 minutes buffer
    
    return decoded.exp < (now + buffer);
  } catch {
    return true; // Treat invalid tokens as expired
  }
};

/**
 * Store tokens securely in localStorage
 */
const storeTokens = (tokens: TokenResponse): void => {
  localStorage.setItem('fedrag_access_token', tokens.access_token);
  localStorage.setItem('fedrag_id_token', tokens.id_token);
  localStorage.setItem('fedrag_refresh_token', tokens.refresh_token);
  localStorage.setItem('fedrag_token_expires_at', String(Date.now() + (tokens.expires_in * 1000)));
};

/**
 * Retrieve stored tokens
 */
const getStoredTokens = (): { accessToken: string; idToken: string; refreshToken: string } | null => {
  const accessToken = localStorage.getItem('fedrag_access_token');
  const idToken = localStorage.getItem('fedrag_id_token');
  const refreshToken = localStorage.getItem('fedrag_refresh_token');
  
  if (!accessToken || !idToken || !refreshToken) {
    return null;
  }
  
  return { accessToken, idToken, refreshToken };
};

/**
 * Clear all stored tokens
 */
const clearTokens = (): void => {
  localStorage.removeItem('fedrag_access_token');
  localStorage.removeItem('fedrag_id_token');
  localStorage.removeItem('fedrag_refresh_token');
  localStorage.removeItem('fedrag_token_expires_at');
  localStorage.removeItem('fedrag_user');
  localStorage.removeItem('fedrag_pkce_verifier');
  localStorage.removeItem('fedrag_pkce_state');
};

/**
 * Initiate OAuth login flow with PKCE
 */
export const login = async (): Promise<void> => {
  const config = getCognitoConfig();
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = generateRandomString(32);
  
  // Store PKCE verifier and state for callback verification
  localStorage.setItem('fedrag_pkce_verifier', codeVerifier);
  localStorage.setItem('fedrag_pkce_state', state);
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    state: state,
  });
  
  const authUrl = `https://${config.domain}/oauth2/authorize?${params.toString()}`;
  window.location.href = authUrl;
};

/**
 * Handle OAuth callback and exchange authorization code for tokens
 */
export const handleCallback = async (code: string, state?: string): Promise<{ accessToken: string; user: User }> => {
  const config = getCognitoConfig();
  
  // Verify state parameter to prevent CSRF attacks
  const storedState = localStorage.getItem('fedrag_pkce_state');
  if (state && storedState && state !== storedState) {
    throw new Error('Invalid state parameter - possible CSRF attack');
  }
  
  const codeVerifier = localStorage.getItem('fedrag_pkce_verifier');
  if (!codeVerifier) {
    throw new Error('Missing PKCE code verifier');
  }
  
  // Clean up PKCE storage
  localStorage.removeItem('fedrag_pkce_verifier');
  localStorage.removeItem('fedrag_pkce_state');
  
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code: code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });
  
  try {
    const response = await fetch(`https://${config.domain}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorData}`);
    }
    
    const tokens: TokenResponse = await response.json();
    
    // Store tokens
    storeTokens(tokens);
    
    // Decode ID token to get user information
    const userInfo = decodeJWT(tokens.id_token);
    const user = {
      id: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
    };
    
    // Store user info
    localStorage.setItem('fedrag_user', JSON.stringify(user));
    
    return {
      accessToken: tokens.access_token,
      user,
    };
  } catch (error) {
    // Clean up any partial state on error
    clearTokens();
    throw error;
  }
};

/**
 * Logout user and redirect to Cognito logout
 */
export const logout = (): void => {
  const config = getCognitoConfig();
  
  // Clear all local storage
  clearTokens();
  
  // Redirect to Cognito logout URL
  const logoutParams = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: config.logoutUri,
  });
  
  const logoutUrl = `https://${config.domain}/logout?${logoutParams.toString()}`;
  window.location.href = logoutUrl;
};

/**
 * Get current valid access token (with automatic refresh if needed)
 */
export const getToken = async (): Promise<string | null> => {
  const tokens = getStoredTokens();
  if (!tokens) {
    return null;
  }
  
  // Check if access token is expired
  if (isTokenExpired(tokens.accessToken)) {
    // Try to refresh the token
    try {
      const newTokens = await refreshToken(tokens.refreshToken);
      return newTokens.access_token;
    } catch (error) {
      // Refresh failed, user needs to re-authenticate
      clearTokens();
      return null;
    }
  }
  
  return tokens.accessToken;
};

/**
 * Refresh access token using refresh token
 */
const refreshToken = async (refreshTokenValue: string): Promise<TokenResponse> => {
  const config = getCognitoConfig();
  
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshTokenValue,
  });
  
  const response = await fetch(`https://${config.domain}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }
  
  const tokens: TokenResponse = await response.json();
  
  // Store new tokens
  storeTokens(tokens);
  
  return tokens;
};

/**
 * Check if user is currently authenticated
 */
export const isAuthenticated = async (): Promise<boolean> => {
  const token = await getToken();
  return token !== null;
};

/**
 * Get current user information
 */
export const getCurrentUser = (): User | null => {
  const userStr = localStorage.getItem('fedrag_user');
  if (!userStr) {
    return null;
  }
  
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
};

/**
 * Validate token and return user info (for initial app load)
 */
export const validateToken = async (): Promise<{ isValid: boolean; user: User | null; token: string | null }> => {
  try {
    const token = await getToken();
    const user = getCurrentUser();
    
    if (token && user) {
      return {
        isValid: true,
        user,
        token,
      };
    }
    
    return {
      isValid: false,
      user: null,
      token: null,
    };
  } catch {
    clearTokens();
    return {
      isValid: false,
      user: null,
      token: null,
    };
  }
};