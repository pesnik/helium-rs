/**
 * AI Configuration
 *
 * Centralized configuration for AI models and providers.
 * Reads from environment variables with sensible defaults.
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
 * Runtime config loaded from public/config.json
 * This bypasses Next.js build-time env var issues
 */
let runtimeConfig: AIConfig | null = null;

/**
 * Load AI configuration from runtime config file
 * Falls back to environment variables if config.json is not available
 */
export function loadAIConfig(): AIConfig {
    // If we already loaded runtime config, use it
    if (runtimeConfig) {
        return runtimeConfig;
    }

    // IMPORTANT: Use DIRECT property access for Turbopack to inline env vars at build time
    // Do NOT use intermediate objects or optional chaining!
    console.log('[loadAIConfig] Direct access NEXT_PUBLIC_OLLAMA_ENDPOINT:', process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT);
    console.log('[loadAIConfig] typeof process:', typeof process);

    return {
        defaultProvider: (process.env.NEXT_PUBLIC_DEFAULT_AI_PROVIDER as ModelProvider) || ModelProvider.Ollama,

        defaultModels: {
            ollama: process.env.NEXT_PUBLIC_DEFAULT_OLLAMA_MODEL || 'qwen2.5-coder:0.5b',
            openai: process.env.NEXT_PUBLIC_DEFAULT_OPENAI_MODEL || 'gpt-3.5-turbo',
            candle: process.env.NEXT_PUBLIC_DEFAULT_CANDLE_MODEL || 'embedded-qwen1.5',
        },

        endpoints: {
            ollama: process.env.NEXT_PUBLIC_OLLAMA_ENDPOINT || 'http://127.0.0.1:11434',
            openaiCompatible: process.env.NEXT_PUBLIC_OPENAI_COMPATIBLE_ENDPOINT || 'http://127.0.0.1:8080',
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
 * Load config from runtime TypeScript file
 * This is the preferred method as it's bundled with the app
 */
export async function loadRuntimeConfig(): Promise<AIConfig> {
    if (runtimeConfig) {
        console.log('[loadRuntimeConfig] Using cached runtime config');
        return runtimeConfig;
    }

    try {
        console.log('[loadRuntimeConfig] Loading runtime config from module...');
        const { RUNTIME_CONFIG } = await import('./runtime-config');
        console.log('[loadRuntimeConfig] Successfully loaded runtime config:', RUNTIME_CONFIG);

        runtimeConfig = RUNTIME_CONFIG;
        return RUNTIME_CONFIG;  // Return the imported config directly
    } catch (error) {
        console.error('[loadRuntimeConfig] Exception while loading runtime config:', error);
        // Fallback to env vars
        console.warn('[loadRuntimeConfig] Falling back to env vars');
        return loadAIConfig();
    }
}

/**
 * Get the default endpoint for a provider
 * NOTE: This is async because it loads runtime config
 */
export async function getDefaultEndpoint(provider: ModelProvider, config?: AIConfig): Promise<string | undefined> {
    // If config is provided, use it (for backwards compatibility)
    // Otherwise, load runtime config (preferred)
    const cfg = config || await loadRuntimeConfig();

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

// Always log config on load for debugging
console.log('[AI Config] Loaded configuration:', {
    defaultProvider: aiConfig.defaultProvider,
    endpoints: aiConfig.endpoints,
    parameters: aiConfig.parameters,
    debug: aiConfig.debug,
});
console.log('[AI Config] Load location:', new Error().stack?.split('\n')[1]);

// Log if config object is valid
if (!aiConfig || typeof aiConfig !== 'object') {
    console.error('[AI Config] ERROR: Config is invalid!', aiConfig);
}
