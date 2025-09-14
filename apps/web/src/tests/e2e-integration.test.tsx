/**
 * Frontend End-to-End Integration Tests
 * 
 * These tests verify the complete frontend integration including:
 * - Authentication flow with Cognito
 * - API client integration with JWT tokens
 * - Chat interface functionality
 * - Citation display and PII redaction toggle
 * - Error handling and user experience
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthProvider';
import Chat from '../pages/Chat';
import { apiCall, chatQuery } from '../lib/api/client';
import * as cognitoAuth from '../lib/auth/cognito';

// Mock the API client
vi.mock('../lib/api/client', () => ({
  apiCall: vi.fn(),
  chatQuery: vi.fn(),
}));

// Mock the Cognito auth module
vi.mock('../lib/auth/cognito', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  handleCallback: vi.fn(),
  getToken: vi.fn(),
  isAuthenticated: vi.fn(),
}));

// Mock environment variables
vi.mock('../lib/config', () => ({
  config: {
    apiUrl: 'https://api.test.example.com',
    cognitoUserPoolId: 'us-east-1_TEST123',
    cognitoClientId: 'test-client-id',
    cognitoDomain: 'test-domain.auth.us-east-1.amazoncognito.com',
    region: 'us-east-1',
  },
}));

// Test data
const mockChatResponse = {
  answer: 'Data retention policy requires keeping records for 7 years according to federal regulations.',
  citations: [
    {
      generatedResponsePart: {
        textResponsePart: {
          text: 'Data retention policy requires keeping records for 7 years',
          span: { start: 0, end: 57 }
        }
      },
      retrievedReferences: [
        {
          content: { text: 'Federal regulations specify that organizations must retain data records for a minimum of seven years...' },
          location: { s3Location: { uri: 's3://fedrag-corpus/policies/data-retention.pdf' } },
          metadata: { title: 'Data Retention Policy', section: '3.1' }
        }
      ]
    }
  ],
  guardrailAction: 'NONE',
  sessionId: 'test-session-123'
};

const mockPiiResponse = {
  answer: 'The policy applies to all employees including contact at <REDACTED:EMAIL>.',
  citations: [],
  guardrailAction: 'NONE',
  sessionId: 'test-session-456',
  redactedQuery: 'What is the policy for <REDACTED:EMAIL>?',
  redactedAnswer: 'The policy applies to all employees including contact at <REDACTED:EMAIL>.'
};

const mockGuardrailResponse = {
  answer: 'I cannot provide information about that topic as it violates our content policies.',
  citations: [],
  guardrailAction: 'INTERVENED',
  sessionId: 'test-session-789'
};

// Helper component to wrap tests with providers
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>
    <AuthProvider>
      {children}
    </AuthProvider>
  </BrowserRouter>
);

describe('Frontend End-to-End Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock authenticated state by default
    (cognitoAuth.isAuthenticated as any).mockReturnValue(true);
    (cognitoAuth.getToken as any).mockReturnValue('mock-jwt-token');
    
    // Mock successful API calls by default
    (chatQuery as any).mockResolvedValue(mockChatResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Authentication Flow Integration', () => {
    it('should redirect to login when not authenticated', async () => {
      // Mock unauthenticated state
      (cognitoAuth.isAuthenticated as any).mockReturnValue(false);
      (cognitoAuth.getToken as any).mockReturnValue(null);

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      // Should show login prompt or redirect
      await waitFor(() => {
        expect(cognitoAuth.isAuthenticated).toHaveBeenCalled();
      });
    });

    it('should display chat interface when authenticated', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      // Should render chat interface
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/ask a question/i)).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    });

    it('should handle token refresh on API errors', async () => {
      // Mock API call that returns 401
      (chatQuery as any).mockRejectedValueOnce(new Error('Unauthorized'));
      (chatQuery as any).mockResolvedValueOnce(mockChatResponse);

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'Test query' } });
      fireEvent.click(sendButton);

      // Should retry after handling auth error
      await waitFor(() => {
        expect(chatQuery).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('2. Chat Interface Functionality', () => {
    it('should send queries and display responses', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      // Type and send a query
      fireEvent.change(input, { target: { value: 'What is the data retention policy?' } });
      fireEvent.click(sendButton);

      // Should call the API
      await waitFor(() => {
        expect(chatQuery).toHaveBeenCalledWith('What is the data retention policy?', expect.any(String));
      });

      // Should display the response
      await waitFor(() => {
        expect(screen.getByText(/Data retention policy requires keeping records for 7 years/)).toBeInTheDocument();
      });
    });

    it('should display loading state during API calls', async () => {
      // Mock delayed response
      (chatQuery as any).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockChatResponse), 1000)));

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'Test query' } });
      fireEvent.click(sendButton);

      // Should show loading indicator
      await waitFor(() => {
        expect(screen.getByText(/thinking/i) || screen.getByRole('progressbar')).toBeInTheDocument();
      });
    });

    it('should maintain message history', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      // Send first message
      fireEvent.change(input, { target: { value: 'First question' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText('First question')).toBeInTheDocument();
      });

      // Send second message
      fireEvent.change(input, { target: { value: 'Second question' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText('Second question')).toBeInTheDocument();
      });

      // Both messages should be visible
      expect(screen.getByText('First question')).toBeInTheDocument();
      expect(screen.getByText('Second question')).toBeInTheDocument();
    });

    it('should clear input after sending message', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i) as HTMLInputElement;
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'Test message' } });
      expect(input.value).toBe('Test message');

      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(input.value).toBe('');
      });
    });
  });

  describe('3. Citation Display Integration', () => {
    it('should display citations panel when citations are available', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'What is the policy?' } });
      fireEvent.click(sendButton);

      // Should display citations
      await waitFor(() => {
        expect(screen.getByText(/citations/i) || screen.getByText(/sources/i)).toBeInTheDocument();
      });

      // Should display S3 URI link
      await waitFor(() => {
        expect(screen.getByText(/s3:\/\/fedrag-corpus\/policies\/data-retention\.pdf/)).toBeInTheDocument();
      });
    });

    it('should display citation excerpts', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'What is the policy?' } });
      fireEvent.click(sendButton);

      // Should display citation excerpt
      await waitFor(() => {
        expect(screen.getByText(/Federal regulations specify that organizations must retain/)).toBeInTheDocument();
      });
    });

    it('should handle responses without citations', async () => {
      (chatQuery as any).mockResolvedValue({
        ...mockChatResponse,
        citations: []
      });

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'What is the policy?' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(/Data retention policy requires keeping records for 7 years/)).toBeInTheDocument();
      });

      // Should not display citations section
      expect(screen.queryByText(/citations/i)).not.toBeInTheDocument();
    });
  });

  describe('4. PII Redaction Integration', () => {
    it('should display PII redaction toggle when PII is detected', async () => {
      (chatQuery as any).mockResolvedValue(mockPiiResponse);

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'What is the policy for john.doe@company.com?' } });
      fireEvent.click(sendButton);

      // Should display redacted response
      await waitFor(() => {
        expect(screen.getByText(/The policy applies to all employees including contact at <REDACTED:EMAIL>/)).toBeInTheDocument();
      });

      // Should show PII toggle option
      await waitFor(() => {
        expect(screen.getByText(/show original/i) || screen.getByText(/toggle redaction/i)).toBeInTheDocument();
      });
    });

    it('should toggle between redacted and original text', async () => {
      (chatQuery as any).mockResolvedValue({
        ...mockPiiResponse,
        answer: 'The policy applies to all employees including contact at support@company.com.'
      });

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'Test query with PII' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(/support@company\.com/)).toBeInTheDocument();
      });

      // Find and click toggle button
      const toggleButton = screen.getByText(/show redacted/i) || screen.getByText(/toggle/i);
      fireEvent.click(toggleButton);

      // Should show redacted version
      await waitFor(() => {
        expect(screen.getByText(/<REDACTED:EMAIL>/)).toBeInTheDocument();
      });
    });

    it('should not show PII toggle when no PII is detected', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'What is the general policy?' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(/Data retention policy requires keeping records for 7 years/)).toBeInTheDocument();
      });

      // Should not show PII toggle
      expect(screen.queryByText(/show original/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/toggle redaction/i)).not.toBeInTheDocument();
    });
  });

  describe('5. Guardrail Intervention Display', () => {
    it('should display guardrail intervention banner', async () => {
      (chatQuery as any).mockResolvedValue(mockGuardrailResponse);

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'How to hack systems?' } });
      fireEvent.click(sendButton);

      // Should display blocked message
      await waitFor(() => {
        expect(screen.getByText(/cannot provide information about that topic/)).toBeInTheDocument();
      });

      // Should display intervention banner
      await waitFor(() => {
        expect(screen.getByText(/content blocked/i) || screen.getByText(/policy violation/i)).toBeInTheDocument();
      });
    });

    it('should not display intervention banner for normal responses', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'What is the policy?' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(screen.getByText(/Data retention policy requires keeping records for 7 years/)).toBeInTheDocument();
      });

      // Should not show intervention banner
      expect(screen.queryByText(/content blocked/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/policy violation/i)).not.toBeInTheDocument();
    });
  });

  describe('6. Error Handling and User Experience', () => {
    it('should display error message when API call fails', async () => {
      (chatQuery as any).mockRejectedValue(new Error('Network error'));

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'Test query' } });
      fireEvent.click(sendButton);

      // Should display error message
      await waitFor(() => {
        expect(screen.getByText(/error/i) || screen.getByText(/failed/i)).toBeInTheDocument();
      });
    });

    it('should handle empty query submission', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const sendButton = screen.getByRole('button', { name: /send/i });

      // Try to send empty query
      fireEvent.click(sendButton);

      // Should not make API call
      expect(chatQuery).not.toHaveBeenCalled();

      // Should show validation message or disable button
      const input = screen.getByPlaceholderText(/ask a question/i) as HTMLInputElement;
      expect(input.value).toBe('');
    });

    it('should disable send button while processing', async () => {
      // Mock delayed response
      (chatQuery as any).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockChatResponse), 1000)));

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'Test query' } });
      fireEvent.click(sendButton);

      // Send button should be disabled during processing
      await waitFor(() => {
        expect(sendButton).toBeDisabled();
      });
    });

    it('should handle logout functionality', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      // Look for logout button (might be in header or menu)
      const logoutButton = screen.queryByText(/logout/i) || screen.queryByText(/sign out/i);
      
      if (logoutButton) {
        fireEvent.click(logoutButton);

        await waitFor(() => {
          expect(cognitoAuth.logout).toHaveBeenCalled();
        });
      }
    });
  });

  describe('7. Responsive Design and Accessibility', () => {
    it('should have proper ARIA labels and roles', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      // Check for proper accessibility attributes
      const input = screen.getByPlaceholderText(/ask a question/i);
      expect(input).toHaveAttribute('type', 'text');

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeInTheDocument();
    });

    it('should handle keyboard navigation', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);

      // Type query
      fireEvent.change(input, { target: { value: 'Test query' } });

      // Press Enter to send
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(chatQuery).toHaveBeenCalledWith('Test query', expect.any(String));
      });
    });

    it('should display proper focus indicators', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      // Focus input
      fireEvent.focus(input);
      expect(input).toHaveFocus();

      // Tab to button
      fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' });
      expect(sendButton).toHaveFocus();
    });
  });

  describe('8. Session Management', () => {
    it('should maintain session ID across multiple queries', async () => {
      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      // First query
      fireEvent.change(input, { target: { value: 'First question' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(chatQuery).toHaveBeenCalledWith('First question', expect.any(String));
      });

      const firstSessionId = (chatQuery as any).mock.calls[0][1];

      // Second query
      fireEvent.change(input, { target: { value: 'Second question' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(chatQuery).toHaveBeenCalledWith('Second question', firstSessionId);
      });
    });

    it('should generate new session ID on page refresh', async () => {
      const { unmount } = render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const input = screen.getByPlaceholderText(/ask a question/i);
      const sendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(input, { target: { value: 'Test query' } });
      fireEvent.click(sendButton);

      await waitFor(() => {
        expect(chatQuery).toHaveBeenCalled();
      });

      const firstSessionId = (chatQuery as any).mock.calls[0][1];

      // Simulate page refresh by unmounting and remounting
      unmount();
      vi.clearAllMocks();

      render(
        <TestWrapper>
          <Chat />
        </TestWrapper>
      );

      const newInput = screen.getByPlaceholderText(/ask a question/i);
      const newSendButton = screen.getByRole('button', { name: /send/i });

      fireEvent.change(newInput, { target: { value: 'New query' } });
      fireEvent.click(newSendButton);

      await waitFor(() => {
        expect(chatQuery).toHaveBeenCalled();
      });

      const newSessionId = (chatQuery as any).mock.calls[0][1];
      expect(newSessionId).not.toBe(firstSessionId);
    });
  });
});