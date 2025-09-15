/**
 * Bedrock Knowledge Base integration for FedRag Privacy RAG Assistant
 * 
 * This module provides integration with AWS Bedrock Knowledge Bases using the
 * RetrieveAndGenerate API, including guardrail integration, citation processing,
 * and session management for conversation continuity.
 */

import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type {
  RetrieveAndGenerateCommandInput,
  RetrieveAndGenerateCommandOutput,
} from '@aws-sdk/client-bedrock-agent-runtime';

import type {
  BedrockRetrieveAndGenerateResponse,
  Citation,
  GuardrailAction,
  KnowledgeBaseConfig,
  AwsServiceError,
} from './types.js';

/**
 * Default configuration for Claude Sonnet model parameters
 */
const DEFAULT_MODEL_CONFIG = {
  temperature: 0.2,
  topP: 0.9,
  maxTokens: 800,
};

/**
 * Default retrieval configuration
 */
const DEFAULT_RETRIEVAL_CONFIG = {
  numberOfResults: 6,
};

/**
 * Default prompt template that enforces citations and context-only responses
 */
const DEFAULT_PROMPT_TEMPLATE = `You are a helpful assistant that answers questions based only on the provided context. 

IMPORTANT INSTRUCTIONS:
1. Only use information from the provided context to answer questions
2. If the context doesn't contain enough information to answer the question, explicitly state this
3. Always include inline citations in bracket format [1], [2] for each piece of information
4. If you cannot find relevant information in the context, respond with "I don't have sufficient information in the provided context to answer this question. The following sections might contain relevant information: [list relevant topic areas]"
5. Be concise but comprehensive in your responses
6. Do not make assumptions or add information not present in the context

Context: {context}

Question: {question}

Answer:`;

/**
 * Bedrock Knowledge Base client wrapper
 */
export class BedrockKnowledgeBase {
  private client: BedrockAgentRuntimeClient;
  private config: KnowledgeBaseConfig;

  constructor(config: KnowledgeBaseConfig, region = 'us-east-1') {
    this.client = new BedrockAgentRuntimeClient({ region });
    this.config = config;
  }

  /**
   * Query the knowledge base with PII-masked input
   * 
   * @param query - The user query (should be PII-masked)
   * @param sessionId - Optional session ID for conversation continuity
   * @returns Promise<BedrockRetrieveAndGenerateResponse>
   */
  async askKb(
    query: string,
    sessionId?: string
  ): Promise<BedrockRetrieveAndGenerateResponse> {
    try {
      const input = this.buildRetrieveAndGenerateInput(query, sessionId);
      const command = new RetrieveAndGenerateCommand(input);
      
      const startTime = Date.now();
      const response = await this.client.send(command);
      const latency = Date.now() - startTime;

      // Log performance metrics
      console.log(JSON.stringify({
        operation: 'bedrock_retrieve_and_generate',
        latency,
        sessionId: response.sessionId,
        guardrailAction: response.guardrailAction || 'NONE',
        citationCount: response.citations?.length || 0,
      }));

      return this.processBedrockResponse(response);
    } catch (error) {
      const awsError = this.handleBedrockError(error);
      
      throw awsError;
    }
  }

  /**
   * Build the RetrieveAndGenerate input configuration
   */
  private buildRetrieveAndGenerateInput(
    query: string,
    sessionId?: string
  ): RetrieveAndGenerateCommandInput {
    const input: RetrieveAndGenerateCommandInput = {
      input: {
        text: query,
      },
      retrieveAndGenerateConfiguration: {
        type: 'KNOWLEDGE_BASE',
        knowledgeBaseConfiguration: {
          knowledgeBaseId: this.config.knowledgeBaseId,
          modelArn: this.config.modelArn,
          generationConfiguration: {
            guardrailConfiguration: this.config.generationConfiguration.guardrailConfiguration,
            inferenceConfig: {
              textInferenceConfig: {
                temperature: this.config.generationConfiguration.inferenceConfig.textInferenceConfig.temperature || DEFAULT_MODEL_CONFIG.temperature,
                topP: this.config.generationConfiguration.inferenceConfig.textInferenceConfig.topP || DEFAULT_MODEL_CONFIG.topP,
                maxTokens: this.config.generationConfiguration.inferenceConfig.textInferenceConfig.maxTokens || DEFAULT_MODEL_CONFIG.maxTokens,
              },
            },
            promptTemplate: {
              textPromptTemplate: this.config.generationConfiguration.promptTemplate.textPromptTemplate || DEFAULT_PROMPT_TEMPLATE,
            },
          },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: this.config.retrievalConfiguration.vectorSearchConfiguration.numberOfResults || DEFAULT_RETRIEVAL_CONFIG.numberOfResults,
            },
          },
        },
      },
    };

    // Add session ID if provided for conversation continuity
    if (sessionId) {
      input.sessionId = sessionId;
    }

    return input;
  }

  /**
   * Process and normalize Bedrock response
   */
  private processBedrockResponse(
    response: RetrieveAndGenerateCommandOutput
  ): BedrockRetrieveAndGenerateResponse {
    // Extract the generated text
    const text = response.output?.text || '';

    // Process citations to match our interface
    const citations = this.processCitations(response.citations || []);

    // Determine guardrail action
    const guardrailAction: GuardrailAction = response.guardrailAction === 'INTERVENED' 
      ? 'INTERVENED' 
      : 'NONE';

    // Generate or use provided session ID
    const sessionId = response.sessionId || this.generateSessionId();

    return {
      output: { text },
      citations,
      guardrailAction,
      sessionId,
    };
  }

  /**
   * Process citations from Bedrock response to match our interface
   */
  private processCitations(rawCitations: any[]): Citation[] {
    return rawCitations.map((citation) => ({
      generatedResponsePart: {
        textResponsePart: {
          text: citation.generatedResponsePart?.textResponsePart?.text || '',
          span: {
            start: citation.generatedResponsePart?.textResponsePart?.span?.start || 0,
            end: citation.generatedResponsePart?.textResponsePart?.span?.end || 0,
          },
        },
      },
      retrievedReferences: (citation.retrievedReferences || []).map((ref: any) => ({
        content: {
          text: ref.content?.text || '',
        },
        location: ref.location?.s3Location ? {
          s3Location: {
            uri: ref.location.s3Location.uri,
          },
        } : undefined,
        metadata: ref.metadata || {},
      })),
    }));
  }

  /**
   * Handle Bedrock service errors with proper categorization
   */
  private handleBedrockError(error: any): AwsServiceError {
    const awsError: AwsServiceError = {
      name: error.name || 'BedrockError',
      message: error.message || 'Unknown Bedrock service error',
      code: error.$metadata?.httpStatusCode?.toString() || error.code,
      statusCode: error.$metadata?.httpStatusCode || 500,
      retryable: false,
    };

    // Categorize errors for appropriate handling
    switch (error.name) {
      case 'ThrottlingException':
        awsError.retryable = true;
        awsError.message = 'Request rate exceeded. Please retry after a delay.';
        break;
      
      case 'ValidationException':
        awsError.statusCode = 400;
        awsError.message = 'Invalid request parameters: ' + error.message;
        // Check if this is actually a guardrail intervention
        if (error.message?.includes('guardrail') || 
            error.message?.includes('content policy') ||
            error.message?.includes('denied topic')) {
          awsError.name = 'GuardrailIntervention';
          awsError.message = 'Content blocked by guardrails';
        }
        break;
      
      case 'ResourceNotFoundException':
        awsError.statusCode = 404;
        awsError.message = 'Knowledge base or model not found: ' + error.message;
        break;
      
      case 'AccessDeniedException':
        awsError.statusCode = 403;
        awsError.message = 'Insufficient permissions to access Bedrock resources';
        break;
      
      case 'ServiceUnavailableException':
        awsError.retryable = true;
        awsError.statusCode = 503;
        awsError.message = 'Bedrock service temporarily unavailable';
        break;
      
      case 'InternalServerException':
        awsError.retryable = true;
        awsError.statusCode = 500;
        awsError.message = 'Internal Bedrock service error';
        break;
      
      default:
        // Handle guardrail interventions
        if (error.message?.includes('guardrail') || 
            error.message?.includes('content policy') ||
            error.message?.includes('denied topic')) {
          awsError.name = 'GuardrailIntervention';
          awsError.statusCode = 400;
          awsError.message = 'Content blocked by guardrails';
        }
        break;
    }

    return awsError;
  }

  /**
   * Generate a unique session ID for conversation tracking
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate knowledge base configuration
   */
  static validateConfig(config: KnowledgeBaseConfig): void {
    if (!config.knowledgeBaseId) {
      throw new Error('Knowledge base ID is required');
    }
    
    if (!config.modelArn) {
      throw new Error('Model ARN is required');
    }
    
    if (!config.generationConfiguration?.guardrailConfiguration?.guardrailId) {
      throw new Error('Guardrail ID is required');
    }
    
    if (!config.generationConfiguration?.guardrailConfiguration?.guardrailVersion) {
      throw new Error('Guardrail version is required');
    }
  }
}

/**
 * Factory function to create a configured Bedrock Knowledge Base instance
 */
export function createBedrockKnowledgeBase(
  knowledgeBaseId: string,
  modelArn: string,
  guardrailId: string,
  guardrailVersion: string,
  region?: string
): BedrockKnowledgeBase {
  const config: KnowledgeBaseConfig = {
    knowledgeBaseId,
    modelArn,
    generationConfiguration: {
      guardrailConfiguration: {
        guardrailId,
        guardrailVersion,
      },
      inferenceConfig: {
        textInferenceConfig: DEFAULT_MODEL_CONFIG,
      },
      promptTemplate: {
        textPromptTemplate: DEFAULT_PROMPT_TEMPLATE,
      },
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: DEFAULT_RETRIEVAL_CONFIG,
    },
  };

  BedrockKnowledgeBase.validateConfig(config);
  return new BedrockKnowledgeBase(config, region);
}

/**
 * Utility function to check if an error is a guardrail intervention
 */
export function isGuardrailIntervention(error: AwsServiceError): boolean {
  // Check for explicit guardrail intervention error name
  if (error.name === 'GuardrailIntervention') {
    return true;
  }
  
  // Check for ValidationException with guardrail-related messages
  if (error.name === 'ValidationException' && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    return message.includes('guardrail') || 
           message.includes('content policy') ||
           message.includes('content blocked') ||
           message.includes('harm category') ||
           message.includes('denied topic') ||
           message.includes('inappropriate content');
  }
  
  // Check for other error types with guardrail-related messages
  if (typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    return message.includes('guardrail') || 
           message.includes('content policy');
  }
  
  return false;
}

/**
 * Utility function to extract session ID from Bedrock response
 */
export function extractSessionId(response: BedrockRetrieveAndGenerateResponse): string {
  return response.sessionId;
}

/**
 * Utility function to format citations for display
 */
export function formatCitationsForDisplay(citations: Citation[]): string {
  if (!citations || citations.length === 0) {
    return '';
  }

  return citations
    .map((citation, index) => {
      const refCount = citation.retrievedReferences.length;
      const sources = citation.retrievedReferences
        .map(ref => ref.location?.s3Location?.uri || 'Unknown source')
        .join(', ');
      
      return `[${index + 1}] ${refCount} reference(s): ${sources}`;
    })
    .join('\n');
}