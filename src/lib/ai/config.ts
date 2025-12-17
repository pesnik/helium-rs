/**
 * AI Configuration
 *
 * Centralized configuration for AI models and providers.
 * Reads from .env with defaults from .env.example.
 */

import { ModelProvider } from '@/types/ai-types';

export interface AIConfig {
    defaultProvider: ModelProvider;
    defaultModels: {
        ollama: string;
        openai: string;
        candle: string;
    };
    endpoints: {
        ollama: string;
        openaiCompatible: string;
    };
    parameters: {
        temperature: number;
        topP: number;
        maxTokens: number;
    };
    apiKeys: {
        openai?: string;
    };
    debug: {
        enableLogs: boolean;
    };
}

/**
 * Load AI configuration from environment variables
 * Uses defaults from .env.example when .env is not present
 */
export function loadAIConfig(): AIConfig {
    return {
        defaultProvider: (process.env.NEXT_PUBLIC_DEFAULT_AI_PROVIDER as ModelProvider) || ModelProvider.Ollama,

        defaultModels: {
            ollama: process.env.NEXT_PUBLIC_DEFAULT_OLLAMA_MODEL || 'llama3.2:1B',
            openai: process.env.NEXT_PUBLIC_DEFAULT_OPENAI_MODEL || 'openai-compatible-generic',
            candle: process.env.NEXT_PUBLIC_DEFAULT_CANDLE_MODEL || 'embedded-qwen1.5',
        },

        endpoints: {
            ollama: process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434',
            openaiCompatible: process.env.NEXT_PUBLIC_OPENAI_COMPATIBLE_ENDPOINT || 'http://127.0.0.1:8033',
        },

        parameters: {
            temperature: parseFloat(process.env.NEXT_PUBLIC_DEFAULT_TEMPERATURE || '0.7'),
            topP: parseFloat(process.env.NEXT_PUBLIC_DEFAULT_TOP_P || '0.9'),
            maxTokens: parseInt(process.env.NEXT_PUBLIC_DEFAULT_MAX_TOKENS || '2048', 10),
        },

        apiKeys: {
            openai: process.env.NEXT_PUBLIC_OPENAI_API_KEY,
        },

        debug: {
            enableLogs: process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS === 'true',
        },
    };
}

/**
 * Get the default endpoint for a provider
 */
export function getDefaultEndpoint(provider: ModelProvider, config?: AIConfig): string | undefined {
    const cfg = config || loadAIConfig();

    switch (provider) {
        case ModelProvider.Ollama:
            return cfg.endpoints.ollama;
        case ModelProvider.OpenAICompatible:
            return cfg.endpoints.openaiCompatible;
        default:
            return undefined;
    }
}

/**
 * Get the default model ID for a provider
 */
export function getDefaultModelId(provider: ModelProvider, config?: AIConfig): string {
    const cfg = config || loadAIConfig();

    switch (provider) {
        case ModelProvider.Ollama:
            return cfg.defaultModels.ollama;
        case ModelProvider.OpenAICompatible:
            return cfg.defaultModels.openai;
        case ModelProvider.Candle:
            return cfg.defaultModels.candle;
        default:
            return '';
    }
}

// Export singleton instance
export const aiConfig = loadAIConfig();
