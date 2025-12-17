/**
 * AI Service
 * 
 * Main service layer for AI/LLM operations.
 * Handles provider selection, inference routing, and state management.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
    ModelConfig,
    ModelProvider,
    InferenceRequest,
    InferenceResponse,
    ProviderStatus,
    AIMode,
    ChatMessage,
    MessageRole,
} from '@/types/ai-types';
// Lazy import for TransformerJS to avoid SSR/build issues
// Import only when actually needed
const getTransformerJS = async () => {
    return await import('./providers/transformerjs');
};
import { buildFileSystemContext } from './context-builder';
import { getTemplateForMode, buildPrompt } from './prompts';
import { mcpService } from './mcp-service';

// Known models registry
export const KNOWN_MODELS: ModelConfig[] = [
    {
        id: 'llama3.2:1B', name: 'Llama 3.2 1B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'llama3.2:1B', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true },
        recommendedFor: [AIMode.QA], sizeBytes: 1.3e9
    },
    {
        id: 'llama3.2:3B', name: 'Llama 3.2 3B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'llama3.2:3B', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true },
        recommendedFor: [AIMode.QA, AIMode.Agent], sizeBytes: 2.0e9
    },
    {
        id: 'mistral', name: 'Mistral 7B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'mistral', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 4096, stream: true },
        recommendedFor: [AIMode.Agent], sizeBytes: 4.1e9
    },
    {
        id: 'qwen2.5-coder:0.5b', name: 'Qwen 2.5 Coder 0.5B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'qwen2.5-coder:0.5b', parameters: { temperature: 0.2, topP: 0.7, maxTokens: 4096, stream: true },
        recommendedFor: [AIMode.Agent], sizeBytes: 0.35e9
    },
    {
        id: 'gemma:2b', name: 'Gemma 2B', provider: ModelProvider.Ollama, isAvailable: false,
        modelId: 'gemma:2b', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true },
        recommendedFor: [AIMode.QA], sizeBytes: 1.5e9
    },
    // Embedded AI (Candle) - Multiple options
    {
        id: 'embedded-qwen1.5', name: 'Qwen1.5-0.5B (Embedded)', provider: ModelProvider.Candle, isAvailable: true,
        modelId: 'qwen1.5:0.5b', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 512, stream: true },
        recommendedFor: [AIMode.QA], sizeBytes: 500e6
    },
    {
        id: 'embedded-phi2', name: 'Phi-2 (Embedded)', provider: ModelProvider.Candle, isAvailable: true,
        modelId: 'phi-2', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 512, stream: true },
        recommendedFor: [AIMode.Agent, AIMode.QA], sizeBytes: 2.7e9
    },
    {
        id: 'embedded-stablelm', name: 'StableLM-2-1.6B (Embedded)', provider: ModelProvider.Candle, isAvailable: true,
        modelId: 'stablelm-2-1.6b', parameters: { temperature: 0.7, topP: 0.9, maxTokens: 512, stream: true },
        recommendedFor: [AIMode.Agent], sizeBytes: 3.3e9
    }
];

/**
 * Get status of all AI providers
 */
export async function getProvidersStatus(): Promise<ProviderStatus[]> {
    try {
        // Get backend provider status (Ollama, etc.)
        // Pass Ollama endpoint from config
        const { loadAIConfig } = await import('./config');
        const config = loadAIConfig();

        console.log('[getProvidersStatus] Calling backend with ollamaEndpoint:', config.endpoints.ollama);
        const backendStatuses = await invoke<ProviderStatus[]>('get_ai_providers_status', {
            ollamaEndpoint: config.endpoints.ollama
        });
        console.log('[getProvidersStatus] Received backend statuses:', backendStatuses);

        // Merge backend/installed models with KNOWN_MODELS for Ollama
        // Robust check: Handle case sensitivity or missing status
        let ollamaStatus = backendStatuses.find(p => p.provider.toLowerCase() === ModelProvider.Ollama.toLowerCase());

        if (!ollamaStatus) {
            // If backend didn't return Ollama status (e.g. not running/found), create a placeholder
            // so we can still show the "Library" of known models for download guidance
            ollamaStatus = {
                provider: ModelProvider.Ollama,
                isAvailable: false,
                availableModels: [],
                version: undefined
            };
            backendStatuses.push(ollamaStatus);
        }

        if (ollamaStatus) {
            // Ensure availableModels exists (backend might return null or snake_case if misconfigured)
            if (!ollamaStatus.availableModels) {
                ollamaStatus.availableModels = [];
            }

            const installedIds = new Set(ollamaStatus.availableModels.map(m => m.modelId));

            // Add uninstalled KNOWN_MODELS with the correct endpoint
            KNOWN_MODELS.forEach(known => {
                if (known.provider === ModelProvider.Ollama && !installedIds.has(known.modelId)) {
                    const modelWithEndpoint = {
                        ...known,
                        endpoint: config.endpoints.ollama,
                        isAvailable: false // Mark as not available since not installed
                    };
                    console.log('[getProvidersStatus] Adding KNOWN_MODEL:', known.modelId, 'with endpoint:', modelWithEndpoint.endpoint);
                    ollamaStatus.availableModels.push(modelWithEndpoint);
                }
            });

            // Log all Ollama models with their endpoints
            console.log('[getProvidersStatus] Final Ollama models:',
                ollamaStatus.availableModels.map(m => ({
                    id: m.id,
                    modelId: m.modelId,
                    endpoint: m.endpoint,
                    isAvailable: m.isAvailable
                }))
            );
        }

        // Add TransformerJS status (browser-based) without loading the module
        // We define models statically to avoid loading the heavy TransformerJS library
        // until it's actually needed
        const transformerJSStatus: ProviderStatus = {
            provider: ModelProvider.TransformerJS,
            isAvailable: true,
            version: '2.17.2',
            availableModels: [
                {
                    id: 'transformerjs-distilbart',
                    name: 'DistilBART CNN (Small)',
                    provider: ModelProvider.TransformerJS,
                    modelId: 'Xenova/distilbart-cnn-6-6',
                    parameters: {
                        temperature: 0.7,
                        topP: 0.9,
                        maxTokens: 512,
                        stream: false,
                    },
                    isAvailable: true,
                    sizeBytes: 268_000_000,
                    recommendedFor: [AIMode.QA],
                },
                {
                    id: 'transformerjs-bart-large',
                    name: 'BART Large CNN',
                    provider: ModelProvider.TransformerJS,
                    modelId: 'Xenova/bart-large-cnn',
                    parameters: {
                        temperature: 0.7,
                        topP: 0.9,
                        maxTokens: 1024,
                        stream: false,
                    },
                    isAvailable: true,
                    sizeBytes: 1_630_000_000,
                    recommendedFor: [AIMode.QA],
                },
            ],
        };

        return [transformerJSStatus, ...backendStatuses];
    } catch (error) {
        console.error('Failed to get provider status:', error);
        return [];
    }
}

/**
 * Get available models for a provider
 */
export async function getProviderModels(
    provider: ModelProvider,
    endpoint?: string
): Promise<ModelConfig[]> {
    if (provider === ModelProvider.TransformerJS) {
        const transformerJS = await getTransformerJS();
        return transformerJS.getAvailableTransformerJSModels();
    }

    try {
        return await invoke<ModelConfig[]>('get_provider_models', {
            provider: provider.toString(),
            endpoint,
        });
    } catch (error) {
        console.error(`Failed to get models for ${provider}:`, error);
        return [];
    }
}

/**
 * Check if a provider is available
 */
export async function checkProviderAvailability(
    provider: ModelProvider,
    endpoint?: string
): Promise<boolean> {
    if (provider === ModelProvider.TransformerJS) {
        const transformerJS = await getTransformerJS();
        return await transformerJS.isTransformerJSAvailable();
    }

    try {
        return await invoke<boolean>('check_provider_availability', {
            provider: provider.toString(),
            endpoint,
        });
    } catch (error) {
        console.error(`Failed to check availability for ${provider}:`, error);
        return false;
    }
}

/**
 * Cancel an ongoing inference request
 */
export async function cancelInference(sessionId: string): Promise<void> {
    try {
        await invoke('cancel_inference', { sessionId });
        console.log('[ai-service] Cancelled inference for session:', sessionId);
    } catch (error) {
        console.error('[ai-service] Failed to cancel inference:', error);
        throw error;
    }
}

/**
 * Run AI inference
 */
export async function runInference(
    request: InferenceRequest,
    onChunk?: (chunk: string) => void,
    onProgress?: (progress: any) => void
): Promise<InferenceResponse> {
    // Add system prompt based on mode
    const messagesWithSystem = prepareMessages(request);
    const requestWithSystem = { ...request, messages: messagesWithSystem };

    // Route to appropriate provider
    if (request.modelConfig.provider === ModelProvider.TransformerJS) {
        const transformerJS = await getTransformerJS();
        return await transformerJS.runTransformerJSInference(requestWithSystem, onChunk, onProgress);
    }

    // For backend providers (Ollama, OpenAI-compatible)
    try {
        let unlisten: (() => void) | undefined;

        // Setup streaming listener if onChunk callback is provided
        if (onChunk) {
            unlisten = await listen<string>('ai-response-chunk', (event) => {
                onChunk(event.payload);
            });
        }

        const response = await invoke<InferenceResponse>('run_ai_inference', {
            request: requestWithSystem,
        });

        if (unlisten) unlisten();
        return response;
    } catch (error: any) {
        console.error('[ai-service] Inference failed:', error);
        throw new Error(error || 'Inference failed');
    }
}

/**
 * Prepare messages with system prompt
 */
function prepareMessages(request: InferenceRequest): ChatMessage[] {
    try {
        const template = getTemplateForMode(request.mode);

        // Build context string
        const fsContextStr = request.fsContext
            ? buildFileSystemContext(request.fsContext)
            : 'No file system context available.';

    // Build system prompt with MCP tools if in Agent mode
    const mcpToolsStr = request.mode === AIMode.Agent
        ? mcpService.formatToolsForPrompt()
        : '(Tools not available in QA mode)';

    const systemPrompt = buildPrompt(template.systemPrompt, {
        fs_context: fsContextStr,
        current_path: request.fsContext?.currentPath || '/',
        mcp_tools: mcpToolsStr,
    });

    // Check if system message already exists
    const systemMessageIndex = request.messages.findIndex(
        (m) => m.role === MessageRole.System
    );

    const systemMessage: ChatMessage = {
        id: `system-${Date.now()}`,
        role: MessageRole.System,
        content: systemPrompt,
        timestamp: Date.now(),
    };

        // If system message exists, replace it with the new one
        // CAUSE: Previous logic returned early if system message existed, preserving old context
        if (systemMessageIndex !== -1) {
            const newMessages = [...request.messages];
            newMessages[systemMessageIndex] = systemMessage;
            return newMessages;
        }

        // Add system message at the beginning if not present
        return [systemMessage, ...request.messages];
    } catch (error) {
        console.error('[ai-service] Error in prepareMessages:', error);
        console.error('[ai-service] Request:', request);
        // Return messages without modification if there's an error
        return request.messages;
    }
}

/**
 * Create a new chat message
 */
export function createMessage(
    role: MessageRole,
    content: string,
    contextPaths?: string[]
): ChatMessage {
    return {
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role,
        content,
        timestamp: Date.now(),
        contextPaths,
    };
}

/**
 * Get default model for a mode
 */
export function getDefaultModelForMode(
    mode: AIMode,
    availableModels: ModelConfig[]
): ModelConfig | null {
    // Filter models recommended for this mode
    const recommendedModels = availableModels.filter((m) =>
        m.recommendedFor.includes(mode)
    );

    if (recommendedModels.length === 0) {
        return availableModels[0] || null;
    }

    // Prefer larger models for agent mode
    if (mode === AIMode.Agent) {
        return recommendedModels.sort((a, b) => {
            const sizeA = a.sizeBytes || 0;
            const sizeB = b.sizeBytes || 0;
            return sizeB - sizeA;
        })[0];
    }

    // For QA, prefer medium-sized models
    return recommendedModels[0];
}

/**
 * Pull/Download a model from Ollama
 */
export async function pullOllamaModel(
    modelName: string,
    endpoint: string = 'http://localhost:11434',
    onProgress?: (data: any) => void
): Promise<void> {
    try {
        const response = await fetch(`${endpoint}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName, stream: true }),
        });

        if (!response.ok) {
            throw new Error(`Ollama pull failed: ${response.statusText}`);
        }

        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');

            // Process all complete lines
            for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i].trim();
                if (line) {
                    try {
                        const json = JSON.parse(line);
                        if (json.error) throw new Error(json.error);
                        onProgress?.(json);
                    } catch (e) {
                        console.error("Error parsing JSON line:", e);
                    }
                }
            }

            // Keep the last partial line in buffer
            buffer = lines[lines.length - 1];
        }

    } catch (error) {
        console.error('Failed to pull model:', error);
        throw error;
    }
}
