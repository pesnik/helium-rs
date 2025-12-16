/**
 * Transformer.js Provider
 * 
 * In-browser AI using Transformer.js with WebGPU/WASM acceleration.
 * Best for summarization tasks with small models.
 */

import {
    ModelConfig,
    ChatMessage,
    InferenceRequest,
    InferenceResponse,
    MessageRole,
    AIErrorType,
    AIError,
} from '@/types/ai-types';

// Lazy import Transformers.js to avoid loading it until needed
let transformersModule: any = null;

async function loadTransformers() {
    if (!transformersModule) {
        // @ts-ignore - dynamic import
        transformersModule = await import('@xenova/transformers');

        // Configure environment for browser execution
        // Disable local model checking to prevent FS errors
        if (transformersModule.env) {
            transformersModule.env.allowLocalModels = false;
            transformersModule.env.useBrowserCache = true;
        }
    }
    return transformersModule;
}

/**
 * Transformer.js model instance cache
 */
const modelCache = new Map<string, any>();

/**
 * Load a model from Transformer.js
 */
async function loadModel(modelId: string, onProgress?: (progress: any) => void): Promise<any> {
    if (modelCache.has(modelId)) {
        return modelCache.get(modelId);
    }

    const transformers = await loadTransformers();

    try {
        // For summarization, we'll use pipeline API
        const model = await transformers.pipeline('summarization', modelId, {
            // Allow auto-detection of best device (WebGPU > WASM > CPU)
            progress_callback: onProgress,
        });

        modelCache.set(modelId, model);
        return model;
    } catch (error) {
        console.error('Failed to load Transformer.js model:', error);
        throw {
            type: AIErrorType.ModelNotFound,
            message: `Failed to load model: ${modelId}`,
            details: { error },
            suggestedActions: [
                'Check your internet connection',
                'Try a different model',
                'Clear browser cache and retry',
            ],
        } as AIError;
    }
}

/**
 * Run inference with Transformer.js
 */
export async function runTransformerJSInference(
    request: InferenceRequest,
    onChunk?: (chunk: string) => void,
    onProgress?: (progress: any) => void
): Promise<InferenceResponse> {
    const startTime = Date.now();

    try {
        // Get the last user message
        const lastMessage = request.messages
            .filter((m) => m.role === MessageRole.User)
            .pop();

        if (!lastMessage) {
            throw {
                type: AIErrorType.InvalidConfiguration,
                message: 'No user message found in request',
            } as AIError;
        }

        // Load the model with progress callback
        const model = await loadModel(request.modelConfig.modelId, onProgress);

        // For summarization mode, we'll use the summarization pipeline
        const result = await model(lastMessage.content, {
            max_length: request.modelConfig.parameters.maxTokens,
            min_length: 30,
            do_sample: false,
        });

        const responseText = result[0]?.summary_text || result.toString();

        // Call onChunk if provided (for streaming simulation)
        if (onChunk) {
            // Simulate streaming by chunking the response
            const words = responseText.split(' ');
            for (let i = 0; i < words.length; i++) {
                onChunk(words[i] + (i < words.length - 1 ? ' ' : ''));
                // Small delay to simulate streaming
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }

        const inferenceTimeMs = Date.now() - startTime;

        const responseMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: MessageRole.Assistant,
            content: responseText,
            timestamp: Date.now(),
        };

        return {
            message: responseMessage,
            isComplete: true,
            inferenceTimeMs,
        };
    } catch (error: any) {
        console.error('Transformer.js inference failed:', error);

        if (error.type) {
            throw error; // Already an AIError
        }

        const errorMessage = error instanceof Error ? error.message : String(error);

        throw {
            type: AIErrorType.InferenceFailed,
            message: `Inference failed: ${errorMessage}`,
            details: { error: errorMessage },
            suggestedActions: [
                'Check your internet connection (needed for first run)',
                'Try a shorter input',
                'Reload the application'
            ],
        } as AIError;
    }
}

/**
 * Check if Transformer.js is available
 */
export async function isTransformerJSAvailable(): Promise<boolean> {
    try {
        await loadTransformers();
        return true;
    } catch {
        return false;
    }
}

/**
 * Get available Transformer.js models
 */
export function getAvailableTransformerJSModels(): ModelConfig[] {
    return [
        {
            id: 'transformerjs-distilbart',
            name: 'DistilBART CNN (Small)',
            provider: 'transformerjs' as any,
            modelId: 'Xenova/distilbart-cnn-6-6',
            parameters: {
                temperature: 0.7,
                topP: 0.9,
                maxTokens: 512,
                stream: false,
            },
            isAvailable: true,
            sizeBytes: 268_000_000, // ~268 MB
            recommendedFor: ['qa' as any],
        },
        {
            id: 'transformerjs-bart-large',
            name: 'BART Large CNN',
            provider: 'transformerjs' as any,
            modelId: 'Xenova/bart-large-cnn',
            parameters: {
                temperature: 0.7,
                topP: 0.9,
                maxTokens: 1024,
                stream: false,
            },
            isAvailable: true,
            sizeBytes: 1_630_000_000, // ~1.6 GB
            recommendedFor: ['qa' as any],
        },
    ];
}

/**
 * Unload a model from cache to free memory
 */
export function unloadModel(modelId: string): void {
    if (modelCache.has(modelId)) {
        modelCache.delete(modelId);
    }
}

/**
 * Clear all cached models
 */
export function clearModelCache(): void {
    modelCache.clear();
}
