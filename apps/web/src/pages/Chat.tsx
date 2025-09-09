import React from 'react';
import Layout from '../components/Layout';

const Chat: React.FC = () => {
  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 h-[calc(100vh-12rem)]">
          <div className="flex h-full">
            {/* Chat Area */}
            <div className="flex-1 flex flex-col">
              {/* Chat Header */}
              <div className="border-b border-gray-200 px-6 py-4">
                <h2 className="text-lg font-medium text-gray-900">
                  Policy Research Assistant
                </h2>
                <p className="text-sm text-gray-500">
                  Ask questions about policy documents with privacy protection
                </p>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-4">
                  {/* Welcome Message */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-blue-800">
                      Welcome to FedRag! Ask me questions about policy documents. 
                      Your queries are protected with PII detection and masking.
                    </p>
                  </div>
                  
                  {/* TODO: Message components will be implemented in task 16 */}
                </div>
              </div>

              {/* Input Area */}
              <div className="border-t border-gray-200 p-6">
                <div className="flex space-x-4">
                  <input
                    type="text"
                    placeholder="Ask a question about policy documents..."
                    className="flex-1 border border-gray-300 rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled
                  />
                  <button
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled
                  >
                    Send
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Chat functionality will be implemented in upcoming tasks
                </p>
              </div>
            </div>

            {/* Citations Panel */}
            <div className="w-80 border-l border-gray-200 bg-gray-50">
              <div className="p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">
                  Citations
                </h3>
                <p className="text-sm text-gray-500">
                  Source citations will appear here when you ask questions
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;