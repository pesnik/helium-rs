'use client';

/**
 * AI Chat Component
 * 
 * Main chat interface for AI interactions.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
    Button,
    Input,
    Text,
    Spinner,
    makeStyles,
    tokens,
    shorthands,
} from '@fluentui/react-components';
import {
    Send24Regular,
    Bot24Regular,
    Person24Regular,
} from '@fluentui/react-icons';
import { ChatMessage, MessageRole } from '@/types/ai-types';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: tokens.colorNeutralBackground1,
    },
    messagesContainer: {
        flex: 1,
        overflowY: 'auto',
        ...shorthands.padding('16px'),
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
    },
    messageWrapper: {
        display: 'flex',
        ...shorthands.gap('8px'),
        alignItems: 'flex-start',
    },
    userMessage: {
        flexDirection: 'row-reverse',
    },
    messageIcon: {
        width: '32px',
        height: '32px',
        ...shorthands.borderRadius('50%'),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    userIcon: {
        backgroundColor: tokens.colorBrandBackground,
        color: tokens.colorNeutralForegroundOnBrand,
    },
    assistantIcon: {
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground1,
    },
    messageBubble: {
        maxWidth: '70%',
        ...shorthands.padding('12px', '16px'),
        ...shorthands.borderRadius('16px'),
        wordWrap: 'break-word',
    },
    userBubble: {
        backgroundColor: tokens.colorBrandBackground,
        color: tokens.colorNeutralForegroundOnBrand,
    },
    assistantBubble: {
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground1,
    },
    inputContainer: {
        ...shorthands.padding('16px'),
        ...shorthands.borderTop('1px', 'solid', tokens.colorNeutralStroke1),
        display: 'flex',
        ...shorthands.gap('8px'),
        alignItems: 'center',
    },
    input: {
        flex: 1,
    },
    timestamp: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3,
        marginTop: '4px',
    },
    emptyState: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        ...shorthands.gap('8px'),
        color: tokens.colorNeutralForeground3,
    },
    streamingIndicator: {
        display: 'flex',
        ...shorthands.gap('4px'),
        alignItems: 'center',
    },
});

interface AIChatProps {
    messages: ChatMessage[];
    onSendMessage: (content: string) => void;
    isLoading?: boolean;
    placeholder?: string;
}

export function AIChat({
    messages,
    onSendMessage,
    isLoading = false,
    placeholder = 'Ask about your files...',
}: AIChatProps) {
    const styles = useStyles();
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = () => {
        if (inputValue.trim() && !isLoading) {
            onSendMessage(inputValue.trim());
            setInputValue('');
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatTimestamp = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className={styles.container}>
            <div className={styles.messagesContainer}>
                {messages.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Bot24Regular />
                        <Text>Start a conversation about your files</Text>
                    </div>
                ) : (
                    <>
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={`${styles.messageWrapper} ${message.role === MessageRole.User ? styles.userMessage : ''
                                    }`}
                            >
                                <div
                                    className={`${styles.messageIcon} ${message.role === MessageRole.User
                                            ? styles.userIcon
                                            : styles.assistantIcon
                                        }`}
                                >
                                    {message.role === MessageRole.User ? (
                                        <Person24Regular />
                                    ) : (
                                        <Bot24Regular />
                                    )}
                                </div>
                                <div>
                                    <div
                                        className={`${styles.messageBubble} ${message.role === MessageRole.User
                                                ? styles.userBubble
                                                : styles.assistantBubble
                                            }`}
                                    >
                                        <Text>{message.content}</Text>
                                    </div>
                                    <div className={styles.timestamp}>
                                        {formatTimestamp(message.timestamp)}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className={styles.messageWrapper}>
                                <div className={`${styles.messageIcon} ${styles.assistantIcon}`}>
                                    <Bot24Regular />
                                </div>
                                <div className={styles.streamingIndicator}>
                                    <Spinner size="tiny" />
                                    <Text size={200}>Thinking...</Text>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </div>

            <div className={styles.inputContainer}>
                <Input
                    className={styles.input}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={placeholder}
                    disabled={isLoading}
                />
                <Button
                    appearance="primary"
                    icon={<Send24Regular />}
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isLoading}
                />
            </div>
        </div>
    );
}
