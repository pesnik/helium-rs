'use client';

/**
 * AI Panel Component
 * 
 * Main AI panel that integrates chat, mode selector, and model selector.
 */

import React, { useState, useEffect } from 'react';
import {
    makeStyles,
    tokens,
    shorthands,
    Text,
    Button,
    Spinner,
} from '@fluentui/react-components';
import { AISettingsPanel } from './AISettingsPanel';
import {
    Settings24Regular,
    ArrowDownload24Regular,
} from '@fluentui/react-icons';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { AIChat } from './AIChat';
import { ModeSelector } from './ModeSelector';
import {
    AIMode,
    ChatMessage,
    MessageRole,
    ModelConfig,
    FileSystemContext,
    ModelProvider,
} from '@/types/ai-types';
import {
    getProvidersStatus,
    runInference,
    createMessage,
    getDefaultModelForMode,
} from '@/lib/ai/ai-service';
import { aiConfig, getDefaultEndpoint, getDefaultProvider, loadAIConfig } from '@/lib/ai/config';
import { mcpManager } from '@/lib/ai/mcp-manager';
import { runInferenceWithTools } from '@/lib/ai/inference-with-tools';
import { removeToolCallTags } from '@/lib/ai/tool-calling';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.borderLeft('1px', 'solid', tokens.colorNeutralStroke1),
    },
    header: {
        ...shorthands.padding('12px', '16px'),
        backgroundColor: '#1e1e1e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...shorthands.gap('12px'),
    },
    headerLeft: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('12px'),
        flex: 1,
    },
    headerRight: {
        display: 'flex',
        ...shorthands.gap('8px'),
        alignItems: 'center',
    },
    chatContainer: {
        flex: 1,
        minHeight: 0,
    },
    loadingContainer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        ...shorthands.gap('12px'),
    },
});

interface AIPanelProps {
    isOpen: boolean;
    onClose: () => void;
    fsContext?: FileSystemContext;
    className?: string;
}

export const AIPanel = ({
    isOpen,
    onClose,
    fsContext,
    className,
}: AIPanelProps) => {
    const styles = useStyles();

    const [mode, setMode] = useState<AIMode>(AIMode.QA);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

    const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
    const [showSettings, setShowSettings] = useState(false);

    // Active provider - determines which models are shown in ModelSelector
    const [activeProvider, setActiveProvider] = useState<ModelProvider | undefined>();

    // Download state
    const [downloadProgress, setDownloadProgress] = useState<{ status: string; progress: number; modelId: string } | undefined>(undefined);

    // Listen for download progress
    useEffect(() => {
        const unlisten = listen('model-download-progress', (event: any) => {
            const payload = event.payload as { status: string; progress: number };
            setDownloadProgress({ ...payload, modelId: 'qwen2.5-coder:0.5b' }); // Assume currently downloading embedded model

            // Refresh models when done
            if (payload.progress >= 1.0) {
                setTimeout(() => {
                    setDownloadProgress(undefined);
                    // Trigger re-fetch of status to make the model available
                    // We can't easily call initialize() here but we can trigger a state update or reload
                    window.location.reload(); // Simple brute force for now to ensure state is fresh, or ideally refetch
                }, 1000);
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, []);

    const handleDownloadModel = async (modelId: string, provider: ModelProvider) => {
        if (provider === ModelProvider.Candle) {
            try {
                await invoke('download_model');
            } catch (error) {
                console.error('Download failed:', error);
                alert('Failed to start download: ' + error);
            }
        }
    };

    // Initialize: Load available models
    useEffect(() => {
        async function initialize() {
            try {
                // Load config first
                const config = loadAIConfig();

                const statuses = await getProvidersStatus();

                // Collect all available models
                const allModels: ModelConfig[] = [];
                statuses.forEach((status) => {
                    // Include models even if provider is "offline" (e.g. for "Known Models" library)
                    allModels.push(...status.availableModels);
                });

                setAvailableModels(allModels);

                // Check for saved defaults (localStorage overrides runtime config)
                const savedProviderQA = localStorage.getItem('defaultAIProvider_qa') as ModelProvider | null;
                const savedProviderAgent = localStorage.getItem('defaultAIProvider_agent') as ModelProvider | null;
                const savedModelIdQA = localStorage.getItem('defaultAIModel_qa');
                const savedModelIdAgent = localStorage.getItem('defaultAIModel_agent');

                // Get provider based on current mode (saved or env-configured)
                const defaultProvider = mode === AIMode.Agent
                    ? (savedProviderAgent || config.defaultProvider.agent)
                    : (savedProviderQA || config.defaultProvider.qa);

                // Get the correct endpoint based on the provider (use provider-specific keys)
                const endpointKey = defaultProvider === ModelProvider.OpenAICompatible
                    ? 'defaultAIEndpoint_openaiCompatible'
                    : 'defaultAIEndpoint_ollama';
                const savedEndpoint = localStorage.getItem(endpointKey);
                const defaultEndpoint = savedEndpoint || (
                    defaultProvider === ModelProvider.OpenAICompatible
                        ? config.endpoints.openaiCompatible
                        : config.endpoints.ollama
                );

                // Get model based on current mode
                const savedModelId = mode === AIMode.Agent ? savedModelIdAgent : savedModelIdQA;
                const configuredOpenAIModelId = mode === AIMode.Agent
                    ? config.defaultModels.agent.openai
                    : config.defaultModels.qa.openai;
                const defaultModelId = savedModelId || (defaultProvider === ModelProvider.OpenAICompatible ? configuredOpenAIModelId : null);

                // If we're using OpenAI-compatible provider, create the model
                if (defaultProvider === ModelProvider.OpenAICompatible && defaultEndpoint) {
                    // Check if model doesn't already exist
                    if (!allModels.find(m => m.id === configuredOpenAIModelId)) {
                        const genericModel: ModelConfig = {
                            id: configuredOpenAIModelId,
                            name: `OpenAI Compatible (${configuredOpenAIModelId})`,
                            provider: ModelProvider.OpenAICompatible,
                            modelId: configuredOpenAIModelId,
                            parameters: {
                                temperature: aiConfig.parameters.temperature,
                                topP: aiConfig.parameters.topP,
                                maxTokens: aiConfig.parameters.maxTokens,
                                stream: true
                            },
                            endpoint: defaultEndpoint,
                            isAvailable: true,
                            recommendedFor: [AIMode.QA, AIMode.Agent],
                            sizeBytes: 0
                        };
                        allModels.push(genericModel);
                        setAvailableModels(allModels);
                    }
                }

                // Priority: 1) Saved model, 2) Env-configured model, 3) Provider's first available model, 4) Default model for mode
                let modelToSelect: ModelConfig | null = null;
                let providerToUse: ModelProvider | undefined = undefined;

                // Try to use saved model first
                if (savedModelId) {
                    modelToSelect = allModels.find(m => m.id === savedModelId) || null;
                    if (modelToSelect) {
                        providerToUse = modelToSelect.provider;
                    }
                }

                // If no saved model, try env-configured model
                if (!modelToSelect && defaultModelId) {
                    modelToSelect = allModels.find(m => m.id === defaultModelId) || null;
                    if (modelToSelect) {
                        providerToUse = modelToSelect.provider;
                    }
                }

                // If still no model, try saved/default provider's first available model
                if (!modelToSelect) {
                    modelToSelect = allModels.find(m =>
                        m.provider === defaultProvider && m.isAvailable
                    ) || allModels.find(m => m.provider === defaultProvider) || null;

                    if (modelToSelect) {
                        providerToUse = defaultProvider;
                    }
                }

                // Fallback to default model for mode
                if (!modelToSelect) {
                    modelToSelect = getDefaultModelForMode(mode, allModels);
                    if (modelToSelect) {
                        providerToUse = modelToSelect.provider;
                    }
                }

                // Apply the selected model and provider
                if (modelToSelect && providerToUse) {
                    setSelectedModelId(modelToSelect.id);
                    setActiveProvider(providerToUse);
                }
            } catch (error) {
                console.error('Failed to initialize AI panel:', error);
            } finally {
                setIsInitializing(false);
            }
        }

        initialize();
    }, []);

    // Initialize MCP when switching to Agent mode or when directory changes
    useEffect(() => {
        async function initMCP() {
            if (mode === AIMode.Agent && fsContext?.currentPath) {
                const initialized = await mcpManager.ensureInitialized(fsContext.currentPath);
                if (!initialized) {
                    console.error('[AIPanel] Failed to initialize MCP for Agent mode');
                }
            }
        }
        initMCP();
    }, [mode, fsContext?.currentPath]);

    // Cleanup MCP on unmount
    useEffect(() => {
        return () => {
            mcpManager.shutdown();
        };
    }, []);

    // Update selected model when mode changes
    // BUT only if we don't already have a valid model selected
    useEffect(() => {
        // Check if current selection is still valid
        const currentModel = availableModels.find(m => m.id === selectedModelId);
        if (currentModel) {
            return; // Keep current selection
        }

        // No valid selection, choose a default for the mode
        const defaultModel = getDefaultModelForMode(mode, availableModels);
        if (defaultModel) {
            setSelectedModelId(defaultModel.id);
            // Update active provider when model changes
            setActiveProvider(defaultModel.provider);
        }
    }, [mode, availableModels, selectedModelId]);

    // Filter models based on active provider
    const filteredModels = React.useMemo(() => {
        if (!activeProvider) return availableModels;
        return availableModels.filter(m => m.provider === activeProvider);
    }, [availableModels, activeProvider]);

    // Get unique providers from available models
    const availableProviders = React.useMemo(() => {
        const providers = new Set(availableModels.map(m => m.provider));
        return Array.from(providers);
    }, [availableModels]);

    const handleUpdateConfig = (newConfig: ModelConfig) => {
        // Update the model config in available models list
        setAvailableModels(prev => prev.map(m => m.id === newConfig.id ? newConfig : m));
        // Also update local cache if needed, but for now just state is enough
    };

    const handleProviderChange = (newProvider: ModelProvider) => {
        setActiveProvider(newProvider);

        // Auto-select first available model from the new provider
        const firstModelOfProvider = availableModels.find(m =>
            m.provider === newProvider && m.isAvailable
        );

        if (firstModelOfProvider) {
            setSelectedModelId(firstModelOfProvider.id);
        } else {
            // If no available model, select the first one (even if not installed)
            const anyModelOfProvider = availableModels.find(m => m.provider === newProvider);
            if (anyModelOfProvider) {
                setSelectedModelId(anyModelOfProvider.id);
            }
        }
    };

    const handleStopGeneration = async () => {
        if (currentSessionId) {
            try {
                await invoke('cancel_inference', { sessionId: currentSessionId });

                // Remove any thinking/streaming messages
                setMessages((prev) => prev.filter(msg =>
                    !(msg.content === '💭 Thinking...' || msg.isStreaming)
                ));

                setIsLoading(false);
                setCurrentSessionId(null);
            } catch (error: any) {
                // If session not found, it likely already completed - this is not an error
                if (!error?.includes?.('not found')) {
                    console.error('Failed to cancel inference:', error);
                }

                // Remove any thinking/streaming messages even if cancel failed
                setMessages((prev) => prev.filter(msg =>
                    !(msg.content === '💭 Thinking...' || msg.isStreaming)
                ));

                // Always reset loading state even if cancel failed
                setIsLoading(false);
                setCurrentSessionId(null);
            }
        }
    };

    const handleSendMessage = async (content: string) => {
        // Clean up any incomplete messages and ensure proper alternation
        // IMPORTANT: We need to capture the cleaned messages to use for the API call
        let cleanedMessages: ChatMessage[] = [];

        setMessages((prev) => {
            // Remove streaming/thinking messages AND error messages from failed requests
            let cleaned = prev.filter(msg =>
                !(msg.content === '💭 Thinking...' ||
                  msg.isStreaming ||
                  msg.content.startsWith('Sorry, I encountered an error:') ||
                  msg.error)
            );

            // If last message is a user message, remove it (it was from a cancelled request)
            if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === MessageRole.User) {
                cleaned = cleaned.slice(0, -1);
            }

            cleanedMessages = cleaned; // Capture for API call
            return cleaned;
        });

        const userMessage = createMessage(MessageRole.User, content);
        setMessages((prev) => [...prev, userMessage]);
        setIsLoading(true);

        // Generate a unique session ID for this request
        const sessionId = `session-${Date.now()}`;
        setCurrentSessionId(sessionId);

        // Check if this is embedded AI (Candle) - might need to download
        const selectedModel = availableModels.find((m) => m.id === selectedModelId);
        const isEmbeddedAI = selectedModel?.provider === ModelProvider.Candle;

        // Add a download status message for embedded AI
        let downloadMsgId = '';
        if (isEmbeddedAI) {
            downloadMsgId = `msg-${Date.now()}-download`;

            // Check if model is available (already downloaded)
            const isModelDownloaded = selectedModel?.isAvailable;
            const modelSize = selectedModel?.sizeBytes ? `${(selectedModel.sizeBytes / 1e9).toFixed(1)}GB` : '~1GB';

            const downloadMessage: ChatMessage = {
                id: downloadMsgId,
                role: MessageRole.Assistant,
                content: isModelDownloaded
                    ? '⚙️ Loading embedded AI model...'
                    : `📥 Downloading ${selectedModel?.name || 'embedded AI model'} (${modelSize}). First download may take a few minutes...`,
                timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, downloadMessage]);
        }

        try {
            const selectedModel = availableModels.find((m) => m.id === selectedModelId);

            if (!selectedModel) {
                throw new Error('No model selected');
            }

            // Enable streaming for all providers (Candle + Ollama)
            // Ideally we check if modelConfig.parameters.stream is true, but we know our backend implementations stream.
            const isStreaming = true;
            let assistantMsgId = `msg-${Date.now()}-ai`;

            // Create a "thinking" placeholder immediately for visual feedback
            let streamedContent = '';
            const thinkingMessage: ChatMessage = {
                id: assistantMsgId,
                role: MessageRole.Assistant,
                content: '💭 Thinking...',
                timestamp: Date.now(),
                isStreaming: true,
            };
            setMessages((prev) => [...prev, thinkingMessage]);

            // Add endpoint for OpenAI-compatible and Ollama providers
            // Priority: 1) localStorage (user custom endpoint), 2) model config (from runtime config/backend), 3) runtime config fallback
            let endpointToUse: string | undefined;
            if (activeProvider === ModelProvider.OpenAICompatible || activeProvider === ModelProvider.Ollama) {
                // CRITICAL FIX: Use activeProvider (current state) instead of selectedModel.provider (can be stale)
                // This prevents race conditions when user switches providers and immediately sends a message
                const endpointKey = activeProvider === ModelProvider.OpenAICompatible
                    ? 'defaultAIEndpoint_openaiCompatible'
                    : 'defaultAIEndpoint_ollama';
                endpointToUse = localStorage.getItem(endpointKey) ||
                               selectedModel.endpoint ||
                               await getDefaultEndpoint(activeProvider);

                // Validation: Warn if model provider doesn't match active provider (indicates state sync issue)
                if (selectedModel.provider !== activeProvider) {
                    console.warn(`[AIPanel] Provider mismatch detected! selectedModel.provider=${selectedModel.provider}, activeProvider=${activeProvider}. Using activeProvider for endpoint resolution.`);
                }
            }

            const modelConfigWithEndpoint = {
                ...selectedModel,
                ...(endpointToUse ? { endpoint: endpointToUse } : {})
            };

            console.log('[AIPanel] Selected model:', selectedModel.id);
            console.log('[AIPanel] Selected model endpoint:', selectedModel.endpoint);
            console.log('[AIPanel] endpointToUse:', endpointToUse);
            console.log('[AIPanel] Final modelConfigWithEndpoint.endpoint:', modelConfigWithEndpoint.endpoint);

            // Use the cleaned messages (not the stale 'messages' variable!)
            const messagesToSend = [...cleanedMessages, userMessage];

            // Use tool-enabled inference for Agent mode, standard inference for QA mode
            const response = mode === AIMode.Agent
                ? await runInferenceWithTools({
                      sessionId: sessionId,
                      modelConfig: modelConfigWithEndpoint,
                      messages: messagesToSend,
                      fsContext,
                      mode,
                  }, {
                      onChunk: isStreaming ? (chunk) => {
                          // Remove download message once we start getting chunks
                          if (downloadMsgId) {
                              setMessages((prev) => prev.filter(msg => msg.id !== downloadMsgId));
                              downloadMsgId = ''; // Clear it so we only remove once
                          }

                          // On first chunk, replace the "thinking" message
                          if (streamedContent === '') {
                              streamedContent = chunk;
                              setMessages((prev) => prev.map(msg =>
                                  msg.id === assistantMsgId
                                      ? { ...msg, content: chunk, isStreaming: true }
                                      : msg
                              ));
                              return;
                          }

                          // Handle subsequent streaming chunks
                          streamedContent += chunk;
                          setMessages((prev) => prev.map(msg =>
                              msg.id === assistantMsgId
                                  ? { ...msg, content: streamedContent, isStreaming: true }
                                  : msg
                          ));
                      } : undefined,
                      onToolExecution: (event) => {
                          if (event.result || event.error) {
                              // Tool completed
                              if (event.error) {
                                  console.error(`[AIPanel] ❌ Tool ${event.toolName} failed:`, event.error);
                              } else {
                                  console.log(`[AIPanel] ✅ Tool ${event.toolName} completed in ${event.executionTimeMs}ms`);
                                  console.log(`[AIPanel]    Result preview:`, event.result?.substring(0, 100));
                              }
                          } else {
                              // Tool started
                              console.log(`[AIPanel] 🔧 Starting tool: ${event.toolName}`);
                              console.log(`[AIPanel]    Arguments:`, event.arguments);
                          }
                      },
                  })
                : await runInference({
                      sessionId: sessionId,
                      modelConfig: modelConfigWithEndpoint,
                      messages: messagesToSend,
                      fsContext,
                      mode,
                  }, isStreaming ? (chunk) => {
                      // Remove download message once we start getting chunks
                      if (downloadMsgId) {
                          setMessages((prev) => prev.filter(msg => msg.id !== downloadMsgId));
                          downloadMsgId = ''; // Clear it so we only remove once
                      }

                      // On first chunk, replace the "thinking" message
                      if (streamedContent === '') {
                          streamedContent = chunk;
                          setMessages((prev) => prev.map(msg =>
                              msg.id === assistantMsgId
                                  ? { ...msg, content: chunk, isStreaming: true }
                                  : msg
                          ));
                          return;
                      }

                      // Handle subsequent streaming chunks
                      streamedContent += chunk;
                      setMessages((prev) => prev.map(msg =>
                          msg.id === assistantMsgId
                              ? { ...msg, content: streamedContent, isStreaming: true }
                              : msg
                          ));
                  } : undefined);

            // Clean tool call tags from the response before displaying to user
            const cleanedContent = removeToolCallTags(response.message.content);
            const cleanedMessage = {
                ...response.message,
                content: cleanedContent || response.message.content, // Fallback to original if cleaning results in empty string
            };

            if (isStreaming) {
                // Remove download message if still present
                if (downloadMsgId) {
                    setMessages((prev) => prev.filter(msg => msg.id !== downloadMsgId));
                }
                // Final update for streaming (ensure exact final state and remove streaming flag)
                setMessages((prev) => prev.map(msg =>
                    msg.id === assistantMsgId
                        ? { ...cleanedMessage, isStreaming: false }
                        : msg
                ));
            } else {
                // Non-streaming: Add the full message now
                setMessages((prev) => [...prev, cleanedMessage]);
            }
        } catch (error: any) {
            console.error('Inference failed:', error);

            // Remove download message if present
            if (downloadMsgId) {
                setMessages((prev) => prev.filter(msg => msg.id !== downloadMsgId));
            }

            // Don't show error message if the inference was cancelled by user
            const isCancelled = error.message?.includes('cancelled by user') ||
                               error.message?.includes('Inference cancelled');

            if (isCancelled) {
                // Remove the "thinking" placeholder message if present
                setMessages((prev) => prev.filter(msg =>
                    !(msg.content === '💭 Thinking...' || msg.isStreaming)
                ));
            } else {
                const errorMessage = createMessage(
                    MessageRole.Assistant,
                    `Sorry, I encountered an error: ${error.message || 'Unknown error'}`
                );
                errorMessage.error = error.message;
                setMessages((prev) => [...prev, errorMessage]);
            }
        } finally {
            setIsLoading(false);
            setCurrentSessionId(null);
        }
    };

    const handleModeChange = (newMode: AIMode) => {
        setMode(newMode);

        // Switch to appropriate provider and model for the new mode
        const config = loadAIConfig();

        // Get saved provider and model for the new mode from localStorage
        const savedProviderKey = newMode === AIMode.Agent ? 'defaultAIProvider_agent' : 'defaultAIProvider_qa';
        const savedModelKey = newMode === AIMode.Agent ? 'defaultAIModel_agent' : 'defaultAIModel_qa';
        const savedProvider = localStorage.getItem(savedProviderKey) as ModelProvider | null;
        const savedModelId = localStorage.getItem(savedModelKey);

        // Determine the provider to use: saved > env-configured
        const providerToUse = savedProvider || getDefaultProvider(newMode, config);

        // Switch to the new provider
        setActiveProvider(providerToUse);

        // If there's a saved model for this mode, use it
        if (savedModelId) {
            const savedModel = availableModels.find(m => m.id === savedModelId);
            if (savedModel) {
                setSelectedModelId(savedModel.id);
                return;
            }
        }

        // Otherwise, fall back to env-configured default for this mode and provider
        const modeKey = newMode === AIMode.Agent ? 'agent' : 'qa';
        let defaultModelId: string | undefined;

        switch (providerToUse) {
            case ModelProvider.Ollama:
                defaultModelId = config.defaultModels[modeKey].ollama;
                break;
            case ModelProvider.OpenAICompatible:
                defaultModelId = config.defaultModels[modeKey].openai;
                break;
            case ModelProvider.Candle:
                defaultModelId = config.defaultModels[modeKey].candle;
                break;
        }

        if (defaultModelId) {
            const defaultModel = availableModels.find(m => m.modelId === defaultModelId && m.provider === providerToUse);
            if (defaultModel) {
                setSelectedModelId(defaultModel.id);
                return;
            }
        }

        // Final fallback: use getDefaultModelForMode
        const fallbackModel = getDefaultModelForMode(newMode, availableModels);
        if (fallbackModel) {
            setSelectedModelId(fallbackModel.id);
            setActiveProvider(fallbackModel.provider);
        }

        // Optionally clear messages when switching modes
        // setMessages([]);
    };

    // Check if we are using a streaming provider
    const selectedModel = availableModels.find(m => m.id === selectedModelId);
    // All providers now stream
    const isStreamingProvider = true;

    if (isInitializing) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <Spinner size="large" />
                    <Text>Initializing AI...</Text>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <ModeSelector
                        selectedMode={mode}
                        onModeChange={handleModeChange}
                        disabled={isLoading || showSettings}
                    />
                </div>
                <div className={styles.headerRight}>
                    <Button
                        appearance="subtle"
                        icon={<Settings24Regular />}
                        size="small"
                        title="Configure AI Provider & Model"
                        onClick={() => setShowSettings(!showSettings)}
                        style={{ color: 'white' }}
                    />
                </div>
            </div>

            <div className={styles.chatContainer}>
                {availableModels.length === 0 ? (
                    <div className={styles.loadingContainer}>
                        <Text weight="semibold" size={400}>No AI models detected</Text>

                        {/* EMBEDDED MODEL DOWNLOAD OPTION */}
                        <div style={{
                            padding: '16px',
                            background: tokens.colorNeutralBackground2,
                            borderRadius: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            alignItems: 'center',
                            maxWidth: '90%',
                            border: `1px solid ${tokens.colorBrandStroke1}`
                        }}>
                            <Text weight="semibold">Get Started with Embedded AI</Text>
                            <Text align="center" size={200}>
                                Download the built-in AI engine (approx. 1GB) to enable smart features locally without extra setup.
                            </Text>

                            {downloadProgress ? (
                                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ height: '4px', background: tokens.colorNeutralStroke1, borderRadius: '2px', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${downloadProgress.progress * 100}%`, background: tokens.colorBrandBackground }} />
                                    </div>
                                    <Text size={200} align="center">{downloadProgress.status} ({Math.round(downloadProgress.progress * 100)}%)</Text>
                                </div>
                            ) : (
                                <Button
                                    appearance="primary"
                                    icon={<ArrowDownload24Regular />}
                                    onClick={() => handleDownloadModel('qwen2.5-coder:0.5b', ModelProvider.Candle)}
                                >
                                    Download Embedded AI
                                </Button>
                            )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '80%' }}>
                            <div style={{ flex: 1, height: '1px', background: tokens.colorNeutralStroke1 }} />
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>OR USE OLLAMA</Text>
                            <div style={{ flex: 1, height: '1px', background: tokens.colorNeutralStroke1 }} />
                        </div>

                        <div style={{ textAlign: 'center', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                            <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                Advanced users can run larger models via Ollama.
                            </Text>
                        </div>

                        <Button
                            appearance="outline"
                            onClick={() => window.open('https://ollama.com', '_blank')}
                        >
                            Download Ollama
                        </Button>
                    </div>
                ) : (
                    <AIChat
                        messages={messages}
                        onSendMessage={handleSendMessage}
                        onStopGeneration={handleStopGeneration}
                        isLoading={isLoading}
                        isStreaming={isLoading && isStreamingProvider} // Only treat as streaming if loading AND provider matches
                        loadingStatus="Thinking..."
                        placeholder="Ask about your files..."
                    />
                )}
            </div>

            {/* Settings Modal */}
            {selectedModelId && availableModels.find(m => m.id === selectedModelId) && (
                <AISettingsPanel
                    modelConfig={availableModels.find(m => m.id === selectedModelId)!}
                    allModels={availableModels}
                    activeProvider={activeProvider}
                    currentMode={mode}
                    onUpdateConfig={handleUpdateConfig}
                    onSelectModel={setSelectedModelId}
                    onProviderChange={handleProviderChange}
                    onClose={() => setShowSettings(false)}
                    open={showSettings}
                    downloadProgress={downloadProgress}
                    onDownloadModel={handleDownloadModel}
                />
            )}
        </div>
    );
}
