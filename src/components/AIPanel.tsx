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
    Badge,
    Button,
    Spinner,
} from '@fluentui/react-components';
import { AISettingsPanel } from './AISettingsPanel';
import {
    Settings24Regular,
    LockClosed24Filled,
    ArrowDownload24Regular,
} from '@fluentui/react-icons';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { AIChat } from './AIChat';
import { ModeSelector } from './ModeSelector';
import { ModelSelector } from './ModelSelector';
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

    // DEBUG: Trace context reception
    React.useEffect(() => {
        console.log('[AIPanel] Received fsContext path:', fsContext?.currentPath);
    }, [fsContext?.currentPath]);

    const [mode, setMode] = useState<AIMode>(AIMode.QA);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);

    const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
    const [showSettings, setShowSettings] = useState(false);

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
                const statuses = await getProvidersStatus();

                // Collect all available models
                const allModels: ModelConfig[] = [];
                statuses.forEach((status) => {
                    // Include models even if provider is "offline" (e.g. for "Known Models" library)
                    allModels.push(...status.availableModels);
                });

                setAvailableModels(allModels);

                // Select default model for current mode
                const defaultModel = getDefaultModelForMode(mode, allModels);
                if (defaultModel) {
                    setSelectedModelId(defaultModel.id);
                }
            } catch (error) {
                console.error('Failed to initialize AI panel:', error);
            } finally {
                setIsInitializing(false);
            }
        }

        initialize();
    }, []);

    // Update selected model when mode changes
    useEffect(() => {
        const defaultModel = getDefaultModelForMode(mode, availableModels);
        if (defaultModel) {
            setSelectedModelId(defaultModel.id);
        }
    }, [mode, availableModels]);

    const handleUpdateConfig = (newConfig: ModelConfig) => {
        // Update the model config in available models list
        setAvailableModels(prev => prev.map(m => m.id === newConfig.id ? newConfig : m));
        // Also update local cache if needed, but for now just state is enough
    };

    const handleSendMessage = async (content: string) => {
        const userMessage = createMessage(MessageRole.User, content);
        setMessages((prev) => [...prev, userMessage]);
        setIsLoading(true);

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
            let assistantMsgId = '';

            // Don't create placeholder yet - wait for first chunk to avoid empty bubble
            let streamedContent = '';

            const response = await runInference({
                sessionId: 'default', // TODO: Implement session management
                modelConfig: selectedModel,
                messages: [...messages, userMessage],
                fsContext,
                mode,
            }, isStreaming ? (chunk) => {
                // Remove download message once we start getting chunks
                if (downloadMsgId) {
                    setMessages((prev) => prev.filter(msg => msg.id !== downloadMsgId));
                    downloadMsgId = ''; // Clear it so we only remove once
                }

                // Create placeholder on first chunk to avoid empty bubble
                if (!assistantMsgId) {
                    assistantMsgId = `msg-${Date.now()}-ai`;
                    const assistantMessage: ChatMessage = {
                        id: assistantMsgId,
                        role: MessageRole.Assistant,
                        content: chunk,
                        timestamp: Date.now(),
                    };
                    streamedContent = chunk;
                    setMessages((prev) => [...prev, assistantMessage]);
                    return;
                }

                // Handle streaming chunk
                streamedContent += chunk;
                setMessages((prev) => prev.map(msg =>
                    msg.id === assistantMsgId
                        ? { ...msg, content: streamedContent }
                        : msg
                ));
            } : undefined);

            if (isStreaming) {
                // Remove download message if still present
                if (downloadMsgId) {
                    setMessages((prev) => prev.filter(msg => msg.id !== downloadMsgId));
                }
                // Final update for streaming (ensure exact final state)
                setMessages((prev) => prev.map(msg =>
                    msg.id === assistantMsgId
                        ? response.message
                        : msg
                ));
            } else {
                // Non-streaming: Add the full message now
                setMessages((prev) => [...prev, response.message]);
            }
        } catch (error: any) {
            console.error('Inference failed:', error);

            // Remove download message if present
            if (downloadMsgId) {
                setMessages((prev) => prev.filter(msg => msg.id !== downloadMsgId));
            }

            const errorMessage = createMessage(
                MessageRole.Assistant,
                `Sorry, I encountered an error: ${error.message || 'Unknown error'}`
            );
            errorMessage.error = error.message;
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleModeChange = (newMode: AIMode) => {
        setMode(newMode);
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
                    <ModelSelector
                        models={availableModels}
                        selectedModelId={selectedModelId}
                        onModelChange={setSelectedModelId}
                        disabled={isLoading || availableModels.length === 0 || showSettings}
                    />
                    <Button
                        appearance="subtle"
                        icon={<Settings24Regular />}
                        size="small"
                        title="AI Settings"
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
                    onUpdateConfig={handleUpdateConfig}
                    onSelectModel={setSelectedModelId}
                    onClose={() => setShowSettings(false)}
                    open={showSettings}
                    downloadProgress={downloadProgress}
                    onDownloadModel={handleDownloadModel}
                />
            )}
        </div>
    );
}
