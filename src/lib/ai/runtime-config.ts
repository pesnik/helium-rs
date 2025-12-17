/**
 * Runtime Configuration
 *
 * Edit this file to change AI provider endpoints and defaults.
 * This bypasses Next.js environment variable issues.
 */

import { ModelProvider, AIConfig } from '@/types/ai-types';

export const RUNTIME_CONFIG: AIConfig = {
    defaultProvider: ModelProvider.Ollama,

    defaultModels: {
        ollama: 'llama3.2:1B',
        openai: 'openai-compatible-generic',
        candle: 'embedded-qwen1.5',
    },

    endpoints: {
        ollama: 'http://192.168.10.205:11434',
        openaiCompatible: 'http://127.0.0.1:8033',
    },

    parameters: {
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 2048,
    },

    apiKeys: {},

    debug: {
        enableLogs: false,
    },
};
