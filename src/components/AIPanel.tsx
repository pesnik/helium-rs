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
} from '@fluentui/react-icons';
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
        ...shorthands.borderBottom('1px', 'solid', tokens.colorNeutralStroke1),
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
    },
    headerTop: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerActions: {
        display: 'flex',
        ...shorthands.gap('8px'),
        alignItems: 'center',
    },
    headerControls: {
        display: 'flex',
        ...shorthands.gap('12px'),
        alignItems: 'center',
    },
    chatContainer: {
        flex: 1,
        minHeight: 0,
    },
    privacyBadge: {
        cursor: 'help',
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
    fsContext?: FileSystemContext;
}

export function AIPanel({ fsContext }: AIPanelProps) {
    const styles = useStyles();

    const [mode, setMode] = useState<AIMode>(AIMode.QA);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);

    const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
    const [selectedModelId, setSelectedModelId] = useState<string | undefined>();
    const [showSettings, setShowSettings] = useState(false);

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

        try {
            const selectedModel = availableModels.find((m) => m.id === selectedModelId);
            if (!selectedModel) {
                throw new Error('No model selected');
            }

            const response = await runInference({
                sessionId: 'default', // TODO: Implement session management
                modelConfig: selectedModel,
                messages: [...messages, userMessage],
                fsContext,
                mode,
            });

            setMessages((prev) => [...prev, response.message]);
        } catch (error: any) {
            console.error('Inference failed:', error);

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
                <div className={styles.headerTop}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <Text weight="semibold" size={400}>
                            AI Assistant
                        </Text>
                        {fsContext?.currentPath && (
                            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                                {fsContext.currentPath}
                            </Text>
                        )}
                    </div>
                    <div className={styles.headerActions}>
                        <Badge
                            className={styles.privacyBadge}
                            appearance="tint"
                            color="success"
                            icon={<LockClosed24Filled />}
                            title="All AI processing happens locally on your device"
                        >
                            Local
                        </Badge>
                        <Button
                            appearance={showSettings ? "primary" : "subtle"}
                            icon={<Settings24Regular />}
                            size="small"
                            title="AI Settings"
                            onClick={() => setShowSettings(!showSettings)}
                        />
                    </div>
                </div>

                <div className={styles.headerControls}>
                    <ModeSelector
                        selectedMode={mode}
                        onModeChange={handleModeChange}
                        disabled={isLoading || showSettings}
                    />
                    <ModelSelector
                        models={availableModels}
                        selectedModelId={selectedModelId}
                        onModelChange={setSelectedModelId}
                        disabled={isLoading || availableModels.length === 0 || showSettings}
                    />
                </div>
            </div>

            <div className={styles.chatContainer}>
                {availableModels.length === 0 ? (
                    <div className={styles.loadingContainer}>
                        <Text weight="semibold" size={400}>No AI models detected</Text>
                        <div style={{ textAlign: 'center', padding: '0 20px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' }}>
                            <Text>
                                To use <strong>QA Mode</strong>, you need a local AI engine.
                            </Text>
                            <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                Ollama is a free tool that runs powerful LLMs locally on your machine, ensuring total privacy.
                            </Text>
                        </div>

                        <Button
                            appearance="primary"
                            onClick={() => window.open('https://ollama.com', '_blank')}
                        >
                            Download Ollama
                        </Button>

                        <Text size={200} style={{ marginTop: '16px', textAlign: 'center', maxWidth: '80%' }}>
                            <strong>Tip:</strong> Switch to <strong>Summarize Mode</strong> to use the built-in browser model (no download required).
                        </Text>
                    </div>
                ) : (
                    <AIChat
                        messages={messages}
                        onSendMessage={handleSendMessage}
                        isLoading={isLoading}
                        loadingStatus="Thinking..."
                        placeholder={
                            mode === AIMode.Summarize
                                ? 'Describe what you want to summarize...'
                                : 'Ask about your files...'
                        }
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
                />
            )}
        </div>
    );
}
