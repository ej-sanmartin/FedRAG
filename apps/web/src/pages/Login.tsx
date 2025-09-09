import React from 'react';
import { useAuth } from '../hooks/useAuth';

const Login: React.FC = () => {
  const { login } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to FedRag
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Privacy-first RAG assistant for policy research
          </p>
        </div>
        
        <div className="mt-8 space-y-6">
          <div className="rounded-md shadow-sm">
            <button
              onClick={login}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              Sign in with AWS Cognito
            </button>
          </div>
          
          <div className="text-center">
            <p className="text-xs text-gray-500">
              Secure authentication powered by AWS Cognito
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;