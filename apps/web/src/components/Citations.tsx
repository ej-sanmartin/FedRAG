import React from 'react';
import type { Citation } from '../lib/api/client';

interface CitationsProps {
  citations: Citation[];
}

const Citations: React.FC<CitationsProps> = ({ citations }) => {
  // Helper function to extract filename from S3 URI
  const getFilenameFromUri = (uri: string): string => {
    try {
      const parts = uri.split('/');
      return parts[parts.length - 1] || uri;
    } catch {
      return uri;
    }
  };

  // Helper function to format S3 URI for display
  const formatS3Uri = (uri: string): string => {
    // Convert s3:// URIs to more readable format
    if (uri.startsWith('s3://')) {
      return uri.replace('s3://', 'S3: ');
    }
    return uri;
  };

  // Helper function to truncate text with ellipsis
  const truncateText = (text: string, maxLength: number = 200): string => {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  };

  if (!citations || citations.length === 0) {
    return (
      <div className="p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">
          Citations
        </h3>
        <div className="text-center py-8">
          <div className="text-gray-400 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">
            Source citations will appear here when you ask questions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
        <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Citations ({citations.length})
      </h3>
      
      <div className="space-y-4 max-h-[calc(100vh-16rem)] overflow-y-auto">
        {citations.map((citation, index) => (
          <div key={index} className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
            {/* Citation header */}
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-gray-900 flex items-center">
                <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-semibold mr-2">
                  {index + 1}
                </span>
                Citation {index + 1}
              </div>
              
              {/* Citation span info if available */}
              {citation.generatedResponsePart?.textResponsePart?.span && (
                <div className="text-xs text-gray-500">
                  Chars {citation.generatedResponsePart.textResponsePart.span.start}-
                  {citation.generatedResponsePart.textResponsePart.span.end}
                </div>
              )}
            </div>

            {/* Referenced text from generated response */}
            {citation.generatedResponsePart?.textResponsePart?.text && (
              <div className="mb-3 p-2 bg-blue-50 border-l-4 border-blue-200 rounded">
                <div className="text-xs text-blue-700 font-medium mb-1">Referenced Text:</div>
                <div className="text-sm text-blue-800 italic">
                  "{citation.generatedResponsePart.textResponsePart.text}"
                </div>
              </div>
            )}

            {/* Retrieved references */}
            <div className="space-y-3">
              {citation.retrievedReferences.map((ref, refIndex) => (
                <div key={refIndex} className="border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                  {/* Source document link */}
                  {ref.location?.s3Location?.uri && (
                    <div className="mb-2">
                      <div className="text-xs text-gray-600 mb-1">Source Document:</div>
                      <div className="flex items-center space-x-2">
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <a 
                          href={ref.location.s3Location.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline text-sm font-medium flex-1 truncate"
                          title={ref.location.s3Location.uri}
                        >
                          {getFilenameFromUri(ref.location.s3Location.uri)}
                        </a>
                        <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </div>
                      <div className="text-xs text-gray-500 mt-1 font-mono">
                        {formatS3Uri(ref.location.s3Location.uri)}
                      </div>
                    </div>
                  )}

                  {/* Document excerpt */}
                  <div className="mb-2">
                    <div className="text-xs text-gray-600 mb-1">Excerpt:</div>
                    <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded border leading-relaxed">
                      {truncateText(ref.content.text)}
                    </div>
                  </div>

                  {/* Metadata if available */}
                  {ref.metadata && Object.keys(ref.metadata).length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs text-gray-600 mb-1">Metadata:</div>
                      <div className="text-xs text-gray-500 bg-gray-50 p-2 rounded font-mono">
                        {Object.entries(ref.metadata).map(([key, value]) => (
                          <div key={key} className="truncate">
                            <span className="font-semibold">{key}:</span> {String(value)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Footer note */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500 text-center">
          Citations are automatically generated from retrieved documents
        </p>
      </div>
    </div>
  );
};

export default Citations;