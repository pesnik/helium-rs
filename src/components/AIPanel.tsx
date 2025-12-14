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

    // Initialize: Load available models
    useEffect(() => {
        async function initialize() {
            try {
                const statuses = await getProvidersStatus();

                // Collect all available models
                const allModels: ModelConfig[] = [];
                statuses.forEach((status) => {
                    if (status.isAvailable) {
                        allModels.push(...status.availableModels);
                    }
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
                    <Text weight="semibold" size={400}>
                        AI Assistant
                    </Text>
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
                            appearance="subtle"
                            icon={<Settings24Regular />}
                            size="small"
                            title="AI Settings"
                        />
                    </div>
                </div>

                <div className={styles.headerControls}>
                    <ModeSelector
                        selectedMode={mode}
                        onModeChange={handleModeChange}
                        disabled={isLoading}
                    />
                    <ModelSelector
                        models={availableModels}
                        selectedModelId={selectedModelId}
                        onModelChange={setSelectedModelId}
                        disabled={isLoading || availableModels.length === 0}
                    />
                </div>
            </div>

            <div className={styles.chatContainer}>
                {availableModels.length === 0 ? (
                    <div className={styles.loadingContainer}>
                        <Text weight="semibold">No AI models detected</Text>
                        <Text size={200}>
                            Install Ollama or use in-browser models to get started.
                        </Text>
                        <Button
                            appearance="primary"
                            onClick={() => window.open('https://ollama.com', '_blank')}
                        >
                            Get Ollama
                        </Button>
                        <Text size={200} style={{ marginTop: '8px' }}>
                            Note: Transformer.js models should appear automatically.
                            If not, check your network connection for initial download.
                        </Text>
                    </div>
                ) : (
                    <AIChat
                        messages={messages}
                        onSendMessage={handleSendMessage}
                        isLoading={isLoading}
                        placeholder={
                            mode === AIMode.Summarize
                                ? 'Describe what you want to summarize...'
                                : 'Ask about your files...'
                        }
                    />
                )}
            </div>
        </div>
    );
}
