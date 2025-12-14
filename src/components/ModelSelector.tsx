'use client';

/**
 * Model Selector Component
 * 
 * Dropdown for selecting AI models.
 */

import React from 'react';
import {
    Dropdown,
    Option,
    makeStyles,
    tokens,
    Badge,
    Text,
} from '@fluentui/react-components';
import { ModelConfig, ModelProvider } from '@/types/ai-types';

const useStyles = makeStyles({
    dropdown: {
        minWidth: '200px',
    },
    optionContent: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
    },
    modelInfo: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
    },
    modelSize: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3,
    },
});

interface ModelSelectorProps {
    models: ModelConfig[];
    selectedModelId?: string;
    onModelChange: (modelId: string) => void;
    disabled?: boolean;
}

function formatFileSize(bytes?: number): string {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function getProviderBadgeColor(provider: ModelProvider): 'brand' | 'success' | 'warning' | 'danger' {
    switch (provider) {
        case ModelProvider.TransformerJS:
            return 'success';
        case ModelProvider.Ollama:
            return 'brand';
        case ModelProvider.OpenAICompatible:
            return 'warning';
        default:
            return 'brand';
    }
}

export function ModelSelector({
    models,
    selectedModelId,
    onModelChange,
    disabled = false,
}: ModelSelectorProps) {
    const styles = useStyles();

    const selectedModel = models.find((m) => m.id === selectedModelId);

    return (
        <Dropdown
            className={styles.dropdown}
            placeholder="Select a model"
            value={selectedModel?.name || ''}
            selectedOptions={selectedModelId ? [selectedModelId] : []}
            onOptionSelect={(_, data) => {
                if (data.optionValue) {
                    onModelChange(data.optionValue);
                }
            }}
            disabled={disabled}
        >
            {models.map((model) => (
                <Option key={model.id} value={model.id} text={model.name}>
                    <div className={styles.optionContent}>
                        <div className={styles.modelInfo}>
                            <Text weight="semibold">{model.name}</Text>
                            {model.sizeBytes && (
                                <Text className={styles.modelSize}>
                                    {formatFileSize(model.sizeBytes)}
                                </Text>
                            )}
                        </div>
                        <Badge
                            size="small"
                            appearance="tint"
                            color={getProviderBadgeColor(model.provider)}
                        >
                            {model.provider}
                        </Badge>
                    </div>
                </Option>
            ))}
        </Dropdown>
    );
}
