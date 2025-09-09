import React, { useState, useRef, useEffect } from 'react';
import Layout from '../components/Layout';
import Message, { type ChatMessage as MessageType } from '../components/Message';
import Citations from '../components/Citations';
import { chatQuery, handleApiError, type ChatResponse } from '../lib/api/client';

const Chat: React.FC = () => {
  // State management
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  
  // Refs for auto-scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages are added
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputValue.trim() || isLoading) {
      return;
    }

    const userMessage: MessageType = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    // Add user message and clear input
    setMessages(prev => [...prev, userMessage]);
    const currentQuery = inputValue.trim();
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      // Make API call
      const response: ChatResponse = await chatQuery({
        query: currentQuery,
        sessionId,
      });

      // Update session ID if provided
      if (response.sessionId) {
        setSessionId(response.sessionId);
      }

      // Create assistant message
      const assistantMessage: MessageType = {
        id: `assistant-${Date.now()}`,
        type: 'assistant',
        content: response.answer,
        timestamp: new Date(),
        citations: response.citations,
        guardrailAction: response.guardrailAction,
        redactedContent: response.redactedAnswer,
      };

      setMessages(prev => [...prev, assistantMessage]);

    } catch (err) {
      // Error is handled by creating an error message for the user
      
      // Create error message
      const errorMessage: MessageType = {
        id: `error-${Date.now()}`,
        type: 'error',
        content: handleApiError(err),
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
      setError(handleApiError(err));
    } finally {
      setIsLoading(false);
      // Refocus input after response
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // Handle input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    // Clear any previous errors when user starts typing
    if (error) {
      setError(null);
    }
  };

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Clear chat history
  const clearChat = () => {
    setMessages([]);
    setSessionId(undefined);
    setError(null);
    inputRef.current?.focus();
  };



  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-[calc(100vh-12rem)]">
          <div className="flex h-full">
            {/* Chat Area */}
            <div className="flex-1 flex flex-col">
              {/* Chat Header */}
              <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-medium text-gray-900">
                    Policy Research Assistant
                  </h2>
                  <p className="text-sm text-gray-500">
                    Ask questions about policy documents with privacy protection
                  </p>
                </div>
                {messages.length > 0 && (
                  <button
                    onClick={clearChat}
                    className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1 rounded border border-gray-300 hover:border-gray-400 transition-colors"
                  >
                    Clear Chat
                  </button>
                )}
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-4">
                  {/* Welcome Message */}
                  {messages.length === 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-blue-800">
                        Welcome to FedRag! Ask me questions about policy documents. 
                        Your queries are protected with PII detection and masking.
                      </p>
                    </div>
                  )}
                  
                  {/* Chat Messages */}
                  {messages.map(message => (
                    <Message key={message.id} message={message} />
                  ))}
                  
                  {/* Loading indicator */}
                  {isLoading && (
                    <div className="flex justify-start mb-4">
                      <div className="bg-gray-100 text-gray-900 max-w-3xl px-4 py-3 rounded-lg">
                        <div className="flex items-center space-x-2">
                          <div className="flex space-x-1">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                          </div>
                          <span className="text-sm text-gray-600">Thinking...</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Auto-scroll target */}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Input Area */}
              <div className="border-t border-gray-200 p-6">
                {/* Error display */}
                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}
                
                <form onSubmit={handleSubmit} className="flex space-x-4">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask a question about policy documents..."
                    className="flex-1 border border-gray-300 rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isLoading}
                    maxLength={1000}
                  />
                  <button
                    type="submit"
                    disabled={isLoading || !inputValue.trim()}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? 'Sending...' : 'Send'}
                  </button>
                </form>
                
                <p className="text-xs text-gray-500 mt-2">
                  Press Enter to send • Max 1000 characters
                </p>
              </div>
            </div>

            {/* Citations Panel */}
            <div className="w-80 border-l border-gray-200 bg-gray-50">
              <Citations 
                citations={(() => {
                  const lastAssistantMessage = messages
                    .filter(m => m.type === 'assistant')
                    .pop();
                  return lastAssistantMessage?.citations || [];
                })()} 
              />
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;