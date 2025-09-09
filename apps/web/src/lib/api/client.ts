/**
 * API client with JWT integration for FedRag application
 * Provides authenticated HTTP requests with automatic token handling
 */

import { getToken, login } from '../auth/cognito';

// API configuration
const getApiConfig = () => {
  const apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    throw new Error('Missing VITE_API_URL environment variable');
  }
  return { apiUrl };
};

// API request/response types
export interface ChatRequest {
  query: string;
  sessionId?: string;
}

export interface Citation {
  generatedResponsePart: {
    textResponsePart: {
      text: string;
      span: { start: number; end: number };
    };
  };
  retrievedReferences: Array<{
    content: { text: string };
    location: { s3Location?: { uri: string } };
    metadata?: Record<string, unknown>;
  }>;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  guardrailAction?: 'INTERVENED' | 'NONE';
  sessionId: string;
  redactedQuery?: string;
  redactedAnswer?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  statusCode: number;
}

// Custom error class for API errors
export class ApiClientError extends Error {
  public statusCode: number;
  public code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Generic API call wrapper with JWT authentication
 */
export const apiCall = async <T = unknown>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> => {
  const { apiUrl } = getApiConfig();
  
  // Get current JWT token
  const token = await getToken();
  if (!token) {
    // No valid token available, redirect to login
    login();
    throw new ApiClientError('Authentication required', 401, 'NO_TOKEN');
  }

  // Prepare request headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...(options.headers as Record<string, string>),
  };

  // Make the API request
  const url = `${apiUrl}${endpoint}`;
  const requestOptions: RequestInit = {
    ...options,
    headers,
  };

  try {
    const response = await fetch(url, requestOptions);

    // Handle authentication errors
    if (response.status === 401 || response.status === 403) {
      // Token is invalid or expired, redirect to login
      login();
      throw new ApiClientError('Authentication failed', response.status, 'AUTH_FAILED');
    }

    // Handle other HTTP errors
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let errorCode = 'HTTP_ERROR';

      try {
        const errorData = await response.json();
        if (errorData.message) {
          errorMessage = errorData.message;
        }
        if (errorData.code) {
          errorCode = errorData.code;
        }
      } catch {
        // If we can't parse error response, use default message
      }

      throw new ApiClientError(errorMessage, response.status, errorCode);
    }

    // Parse successful response
    const data = await response.json();
    return data as T;

  } catch (error) {
    // Re-throw ApiClientError as-is
    if (error instanceof ApiClientError) {
      throw error;
    }

    // Handle network errors and other fetch failures
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new ApiClientError('Network error - please check your connection', 0, 'NETWORK_ERROR');
    }

    // Handle other unexpected errors
    throw new ApiClientError(
      error instanceof Error ? error.message : 'An unexpected error occurred',
      0,
      'UNKNOWN_ERROR'
    );
  }
};

/**
 * Specific function for chat API endpoint
 */
export const chatQuery = async (request: ChatRequest): Promise<ChatResponse> => {
  return apiCall<ChatResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify(request),
  });
};

/**
 * Health check endpoint (if available)
 */
export const healthCheck = async (): Promise<{ status: string; timestamp: string }> => {
  return apiCall<{ status: string; timestamp: string }>('/health', {
    method: 'GET',
  });
};

/**
 * Utility function to check if an error is an API client error
 */
export const isApiClientError = (error: unknown): error is ApiClientError => {
  return error instanceof ApiClientError;
};

/**
 * Utility function to handle API errors in components
 */
export const handleApiError = (error: unknown): string => {
  if (isApiClientError(error)) {
    switch (error.code) {
      case 'NO_TOKEN':
      case 'AUTH_FAILED':
        return 'Please log in to continue';
      case 'NETWORK_ERROR':
        return 'Network error - please check your connection and try again';
      default:
        return error.message;
    }
  }

  return 'An unexpected error occurred. Please try again.';
};