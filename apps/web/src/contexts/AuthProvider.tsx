import React, { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthContextType, AuthState } from '../types/auth';
import { AuthContext } from './AuthContext';
import * as cognito from '../lib/auth/cognito';

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    token: null,
    isLoading: true,
  });

  // Check for existing token on mount and validate it
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { isValid, user, token } = await cognito.validateToken();
        
        setAuthState({
          isAuthenticated: isValid,
          user,
          token,
          isLoading: false,
        });
      } catch (error) {
        // Silent fail for auth initialization - user will be prompted to login
        setAuthState({
          isAuthenticated: false,
          user: null,
          token: null,
          isLoading: false,
        });
      }
    };

    initializeAuth();
  }, []);

  const login = () => {
    cognito.login().catch(() => {
      // Error will be handled by the redirect or user can retry
      // Login errors are typically due to configuration issues
    });
  };

  const logout = () => {
    setAuthState({
      isAuthenticated: false,
      user: null,
      token: null,
      isLoading: false,
    });
    
    // Cognito logout will clear tokens and redirect
    cognito.logout();
  };

  const handleCallback = async (code: string) => {
    try {
      setAuthState(prev => ({ ...prev, isLoading: true }));
      
      // Extract state parameter from URL if available
      const urlParams = new URLSearchParams(window.location.search);
      const state = urlParams.get('state');
      
      const { accessToken, user } = await cognito.handleCallback(code, state || undefined);
      
      setAuthState({
        isAuthenticated: true,
        user,
        token: accessToken,
        isLoading: false,
      });
    } catch (error) {
      setAuthState({
        isAuthenticated: false,
        user: null,
        token: null,
        isLoading: false,
      });
      throw error; // Re-throw to let the callback component handle the error
    }
  };

  const value: AuthContextType = {
    ...authState,
    login,
    logout,
    handleCallback,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};



