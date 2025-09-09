import React, { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthContextType, AuthState, User } from '../types/auth';
import { AuthContext } from './AuthContext';

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

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('fedrag_token');
    const userStr = localStorage.getItem('fedrag_user');
    
    if (token && userStr) {
      try {
        const user: User = JSON.parse(userStr);
        // TODO: Validate token expiration
        setAuthState({
          isAuthenticated: true,
          user,
          token,
          isLoading: false,
        });
      } catch (error) {
        // Error parsing stored user data - clear invalid data
        localStorage.removeItem('fedrag_token');
        localStorage.removeItem('fedrag_user');
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    } else {
      setAuthState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  const login = () => {
    // TODO: Implement Cognito OAuth redirect
    // This will be implemented in task 14
  };

  const logout = () => {
    localStorage.removeItem('fedrag_token');
    localStorage.removeItem('fedrag_user');
    setAuthState({
      isAuthenticated: false,
      user: null,
      token: null,
      isLoading: false,
    });
    // TODO: Redirect to Cognito logout URL
  };

  const handleCallback = async (code: string) => {
    // TODO: Implement OAuth code exchange
    // This will be implemented in task 14
    // Placeholder to avoid unused parameter warning
    void code;
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



