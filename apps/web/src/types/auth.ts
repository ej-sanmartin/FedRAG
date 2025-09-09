export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  isLoading: boolean;
}

export interface AuthContextType extends AuthState {
  login: () => void;
  logout: () => void;
  handleCallback: (code: string) => Promise<void>;
}