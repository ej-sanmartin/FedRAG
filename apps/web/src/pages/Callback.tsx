import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const Callback: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { handleCallback } = useAuth();

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      // OAuth error occurred - redirect to login
      navigate('/login');
      return;
    }

    if (code) {
      handleCallback(code)
        .then(() => {
          navigate('/');
        })
        .catch(() => {
          // Callback handling error - redirect to login
          navigate('/login');
        });
    } else {
      navigate('/login');
    }
  }, [searchParams, handleCallback, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Processing authentication...</p>
      </div>
    </div>
  );
};

export default Callback;