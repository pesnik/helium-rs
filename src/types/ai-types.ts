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
 * Tool execution data for display
 */
export interface ToolExecutionData {
    toolName: string;
    arguments: Record<string, unknown>;
    result?: string;
    error?: string;
    executionTimeMs?: number;
    status: 'executing' | 'success' | 'error';
}

/**
 * OpenAI-compatible tool definition
 */
export interface Tool {
    type: string; // "function"
    function: ToolFunction;
}

/**
 * Tool function definition
 */
export interface ToolFunction {
    name: string;
    description: string;
    parameters: Record<string, any>; // JSON Schema object
}

/**
 * Tool call in response (OpenAI format)
 */
export interface OpenAIToolCall {
    id: string;
    type: string; // "function"
    function: OpenAIToolCallFunction;
}

/**
 * Tool call function data (OpenAI format)
 */
export interface OpenAIToolCallFunction {
    name: string;
    arguments: string; // JSON string of arguments
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
    /** Tool executions performed (for agent mode) */
    toolExecutions?: ToolExecutionData[];
    /** Tool calls in OpenAI format (for native function calling) */
    toolCalls?: OpenAIToolCall[];
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
    /** Optional tools for native function calling (OpenAI format) */
    tools?: Tool[];
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
 * MCP tool definition (for agent mode)
 */
export interface MCPTool {
    /** Tool name */
    name: string;
    /** Tool description */
    description: string;
    /** Input schema (JSON Schema) */
    inputSchema: Record<string, unknown>;
    /** Whether this tool is available */
    isAvailable: boolean;
    /** Tool annotations for operation hints */
    annotations?: {
        readOnlyHint?: boolean;
        idempotentHint?: boolean;
        destructiveHint?: boolean;
    };
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
    /** Unique ID for this tool call */
    id: string;
    /** Tool name to execute */
    name: string;
    /** Tool arguments (parsed from LLM response) */
    arguments: Record<string, unknown>;
}

/**
 * Result from executing a tool
 */
export interface ToolResult {
    /** ID of the tool call this is a result for */
    tool_call_id: string;
    /** Result content (can be text, JSON, etc.) */
    content: string;
    /** Whether this is an error result */
    isError: boolean;
    /** Execution time in milliseconds */
    executionTimeMs?: number;
}

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
    /** Allowed directories for file operations */
    allowedDirectories: string[];
    /** Whether to require confirmation for destructive operations */
    confirmDestructive: boolean;
    /** Maximum file size for read operations (in bytes) */
    maxFileSize?: number;
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
