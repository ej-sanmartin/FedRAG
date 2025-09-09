import React, { useState } from 'react';
import type { Citation } from '../lib/api/client';

// Message types for chat history
export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: Date;
  citations?: Citation[];
  guardrailAction?: 'INTERVENED' | 'NONE';
  redactedContent?: string;
}

interface MessageProps {
  message: ChatMessage;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const [showRedacted, setShowRedacted] = useState(false);
  
  const isUser = message.type === 'user';
  const isError = message.type === 'error';
  const isAssistant = message.type === 'assistant';

  // Format message content with proper line breaks
  const formatMessageContent = (content: string) => {
    return content.split('\n').map((line, index) => (
      <React.Fragment key={index}>
        {line}
        {index < content.split('\n').length - 1 && <br />}
      </React.Fragment>
    ));
  };

  // Determine which content to display
  const displayContent = showRedacted && message.redactedContent 
    ? message.redactedContent 
    : message.content;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-3xl px-4 py-3 rounded-lg ${
          isUser
            ? 'bg-blue-600 text-white'
            : isError
            ? 'bg-red-50 text-red-800 border border-red-200'
            : 'bg-gray-100 text-gray-900'
        }`}
      >
        {/* Guardrail intervention banner */}
        {message.guardrailAction === 'INTERVENED' && (
          <div className="mb-2 p-2 bg-yellow-100 border border-yellow-300 rounded text-yellow-800 text-sm">
            <div className="flex items-center space-x-2">
              <span>⚠️</span>
              <span>Content filtered by guardrails</span>
            </div>
          </div>
        )}
        
        {/* PII redaction toggle for assistant messages */}
        {isAssistant && message.redactedContent && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-gray-600">PII Protection:</span>
            <button
              onClick={() => setShowRedacted(!showRedacted)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                showRedacted
                  ? 'bg-orange-100 text-orange-800 border border-orange-300'
                  : 'bg-green-100 text-green-800 border border-green-300'
              }`}
            >
              {showRedacted ? 'Show Original' : 'Show Redacted'}
            </button>
          </div>
        )}
        
        {/* Message content */}
        <div className="text-sm leading-relaxed">
          {formatMessageContent(displayContent)}
        </div>
        
        {/* PII redaction indicator */}
        {showRedacted && message.redactedContent && (
          <div className="mt-2 text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
            <span className="flex items-center space-x-1">
              <span>🔒</span>
              <span>PII has been masked for privacy protection</span>
            </span>
          </div>
        )}
        
        {/* Timestamp */}
        <div
          className={`text-xs mt-2 ${
            isUser ? 'text-blue-100' : isError ? 'text-red-600' : 'text-gray-500'
          }`}
        >
          {message.timestamp.toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
};

export default Message;