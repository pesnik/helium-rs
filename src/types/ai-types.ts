/**
 * AI/LLM Type Definitions for Helium
 * 
 * This file contains all TypeScript types and interfaces for the AI/LLM integration.
 */

/**
 * Supported AI model providers
 */
export enum ModelProvider {
    TransformerJS = 'transformerjs',
    Ollama = 'ollama',
    OpenAICompatible = 'openai-compatible',
    LlamaCpp = 'llamacpp',
    MLX = 'mlx',
    Candle = 'candle',
}

/**
 * AI operation modes
 */
export enum AIMode {
    QA = 'qa',
    Agent = 'agent',
}

/**
 * Message role in a conversation
 */
export enum MessageRole {
    User = 'user',
    Assistant = 'assistant',
    System = 'system',
}

/**
 * Model configuration
 */
export interface ModelConfig {
    /** Unique identifier for this configuration */
    id: string;
    /** Display name */
    name: string;
    /** Provider type */
    provider: ModelProvider;
    /** Model identifier (e.g., "llama3.2:3b" for Ollama) */
    modelId: string;
    /** Model parameters */
    parameters: ModelParameters;
    /** Custom endpoint (for OpenAI-compatible providers) */
    endpoint?: string;
    /** API key (optional, for local servers) */
    apiKey?: string;
    /** Whether this model is currently available/installed */
    isAvailable: boolean;
    /** Model size in bytes (if known) */
    sizeBytes?: number;
    /** Recommended use cases */
    recommendedFor: AIMode[];
}

/**
 * Model inference parameters
 */
export interface ModelParameters {
    /** Temperature (0.0 - 2.0) */
    temperature: number;
    /** Top-p sampling (0.0 - 1.0) */
    topP: number;
    /** Maximum tokens to generate */
    maxTokens: number;
    /** Whether to stream responses */
    stream: boolean;
    /** Stop sequences */
    stopSequences?: string[];
    /** Context window size */
    contextWindow?: number;
}

/**
 * Chat message
 */
export interface ChatMessage {
    /** Unique message ID */
    id: string;
    /** Message role */
    role: MessageRole;
    /** Message content */
    content: string;
    /** Timestamp */
    timestamp: number;
    /** Associated file/folder paths (for context) */
    contextPaths?: string[];
    /** Whether this message is currently streaming */
    isStreaming?: boolean;
    /** Error message if inference failed */
    error?: string;
}

/**
 * Chat session/conversation
 */
export interface ChatSession {
    /** Unique session ID */
    id: string;
    /** Session title (auto-generated or user-set) */
    title: string;
    /** Current AI mode */
    mode: AIMode;
    /** Model configuration used */
    modelConfig: ModelConfig;
    /** Messages in this session */
    messages: ChatMessage[];
    /** Created timestamp */
    createdAt: number;
    /** Last updated timestamp */
    updatedAt: number;
    /** Current file system context */
    fsContext?: FileSystemContext;
}

/**
 * File system context for AI operations
 */
export interface FileSystemContext {
    /** Current working directory */
    currentPath: string;
    /** Selected files/folders */
    selectedPaths: string[];
    /** Visible files in current view with metadata */
    visibleFiles?: FileMetadata[];
    /** Recent scan data (if available) */
    scanData?: ScanSummary;
}

/**
 * Metadata for a file or folder
 */
export interface FileMetadata {
    name: string;
    isDir: boolean;
    size: number;
    fileCount?: number;
    lastModified: number;
}

/**
 * Summary of file system scan data
 */
export interface ScanSummary {
    /** Total files scanned */
    totalFiles: number;
    /** Total size in bytes */
    totalSize: number;
    /** Largest files */
    largestFiles: Array<{
        path: string;
        size: number;
    }>;
    /** File type distribution */
    fileTypes: Record<string, number>;
    /** Scan timestamp */
    scannedAt: number;
}

/**
 * Inference request to backend
 */
export interface InferenceRequest {
    /** Session ID */
    sessionId: string;
    /** Model configuration */
    modelConfig: ModelConfig;
    /** Messages (conversation history) */
    messages: ChatMessage[];
    /** File system context */
    fsContext?: FileSystemContext;
    /** AI mode */
    mode: AIMode;
}

/**
 * Inference response from backend
 */
export interface InferenceResponse {
    /** Generated message */
    message: ChatMessage;
    /** Whether more chunks are coming (for streaming) */
    isComplete: boolean;
    /** Token usage statistics */
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    /** Inference time in milliseconds */
    inferenceTimeMs?: number;
}

/**
 * Model availability status
 */
export interface ModelAvailability {
    /** Model configuration */
    config: ModelConfig;
    /** Whether the model is installed/available */
    isAvailable: boolean;
    /** Download progress (0-1.0) if downloading */
    downloadProgress?: number;
    /** Current download status message */
    downloadStatus?: string;
    /** Error message if unavailable */
    error?: string;
}

/**
 * Provider status
 */
export interface ProviderStatus {
    /** Provider type */
    provider: ModelProvider;
    /** Whether the provider is available */
    isAvailable: boolean;
    /** Version information */
    version?: string;
    /** Available models */
    availableModels: ModelConfig[];
    /** Error message if unavailable */
    error?: string;
}

/**
 * AI settings/preferences
 */
export interface AISettings {
    /** Default model for each mode */
    defaultModels: Record<AIMode, string>; // model config IDs
    /** Whether AI features are enabled */
    enabled: boolean;
    /** Privacy settings */
    privacy: {
        /** Only allow local processing */
        localOnly: boolean;
        /** Disable telemetry */
        noTelemetry: boolean;
    };
    /** UI preferences */
    ui: {
        /** Whether AI panel is visible */
        panelVisible: boolean;
        /** Panel width (percentage) */
        panelWidth: number;
        /** Theme preference */
        theme: 'light' | 'dark' | 'auto';
    };
}

/**
 * Prompt template
 */
export interface PromptTemplate {
    /** Template ID */
    id: string;
    /** Template name */
    name: string;
    /** AI mode this template is for */
    mode: AIMode;
    /** System prompt template */
    systemPrompt: string;
    /** User prompt template */
    userPrompt: string;
    /** Variables that can be substituted */
    variables: string[];
}

/**
 * MCP tool definition (for agent mode - Phase 4)
 */
export interface MCPTool {
    /** Tool name */
    name: string;
    /** Tool description */
    description: string;
    /** Input schema */
    inputSchema: Record<string, unknown>;
    /** Whether this tool is available */
    isAvailable: boolean;
}

/**
 * Error types for AI operations
 */
export enum AIErrorType {
    ModelNotFound = 'model_not_found',
    ProviderUnavailable = 'provider_unavailable',
    InferenceFailed = 'inference_failed',
    OutOfMemory = 'out_of_memory',
    NetworkError = 'network_error',
    InvalidConfiguration = 'invalid_configuration',
    ContextTooLarge = 'context_too_large',
}

/**
 * AI error
 */
export interface AIError {
    /** Error type */
    type: AIErrorType;
    /** Error message */
    message: string;
    /** Additional details */
    details?: Record<string, unknown>;
    /** Suggested actions */
    suggestedActions?: string[];
}
