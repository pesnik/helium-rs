/**
 * AI Service
 * 
 * Main service layer for AI/LLM operations.
 * Handles provider selection, inference routing, and state management.
 */

import { invoke } from '@tauri-apps/api/core';
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
import {
    runTransformerJSInference,
    isTransformerJSAvailable,
    getAvailableTransformerJSModels,
} from './providers/transformerjs';
import { buildFileSystemContext } from './context-builder';
import { getTemplateForMode, buildPrompt } from './prompts';

/**
 * Get status of all AI providers
 */
export async function getProvidersStatus(): Promise<ProviderStatus[]> {
    try {
        // Get backend provider status (Ollama, etc.)
        const backendStatuses = await invoke<ProviderStatus[]>('get_ai_providers_status');

        // Add TransformerJS status (browser-based)
        const transformerJSAvailable = await isTransformerJSAvailable();
        const transformerJSStatus: ProviderStatus = {
            provider: ModelProvider.TransformerJS,
            isAvailable: transformerJSAvailable,
            version: '2.17.2',
            availableModels: transformerJSAvailable ? getAvailableTransformerJSModels() : [],
            error: transformerJSAvailable ? undefined : 'Transformer.js not loaded',
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
        return getAvailableTransformerJSModels();
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
        return await isTransformerJSAvailable();
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
 * Run AI inference
 */
export async function runInference(
    request: InferenceRequest,
    onChunk?: (chunk: string) => void
): Promise<InferenceResponse> {
    // Add system prompt based on mode
    const messagesWithSystem = prepareMessages(request);
    const requestWithSystem = { ...request, messages: messagesWithSystem };

    // Route to appropriate provider
    if (request.modelConfig.provider === ModelProvider.TransformerJS) {
        return await runTransformerJSInference(requestWithSystem, onChunk);
    }

    // For backend providers (Ollama, OpenAI-compatible)
    try {
        return await invoke<InferenceResponse>('run_ai_inference', {
            request: requestWithSystem,
        });
    } catch (error: any) {
        console.error('Inference failed:', error);
        throw new Error(error || 'Inference failed');
    }
}

/**
 * Prepare messages with system prompt
 */
function prepareMessages(request: InferenceRequest): ChatMessage[] {
    const template = getTemplateForMode(request.mode);

    // Build context string
    const fsContextStr = request.fsContext
        ? buildFileSystemContext(request.fsContext)
        : 'No file system context available.';

    // Build system prompt
    const systemPrompt = buildPrompt(template.systemPrompt, {
        fs_context: fsContextStr,
        current_path: request.fsContext?.currentPath || '/',
        mcp_tools: '(Agent mode tools will be available in Phase 4)',
    });

    // Check if system message already exists
    const hasSystemMessage = request.messages.some(
        (m) => m.role === MessageRole.System
    );

    if (hasSystemMessage) {
        return request.messages;
    }

    // Add system message at the beginning
    const systemMessage: ChatMessage = {
        id: `system-${Date.now()}`,
        role: MessageRole.System,
        content: systemPrompt,
        timestamp: Date.now(),
    };

    return [systemMessage, ...request.messages];
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

    // Prefer smaller models for summarization
    if (mode === AIMode.Summarize) {
        return recommendedModels.sort((a, b) => {
            const sizeA = a.sizeBytes || Infinity;
            const sizeB = b.sizeBytes || Infinity;
            return sizeA - sizeB;
        })[0];
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
