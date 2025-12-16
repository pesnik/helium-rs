'use client';

/**
 * Provider Selector Component
 *
 * Quick provider switcher with icon-based UI.
 */

import React from 'react';
import {
    Dropdown,
    Option,
    makeStyles,
    tokens,
    shorthands,
} from '@fluentui/react-components';
import {
    BotRegular,
    GlobeRegular,
    CubeRegular,
} from '@fluentui/react-icons';
import { ModelProvider } from '@/types/ai-types';

const useStyles = makeStyles({
    dropdown: {
        minWidth: '140px',
        backgroundColor: '#2a2a2a',
        ...shorthands.borderRadius('6px'),
        color: '#ffffff',
        ...shorthands.border('1px', 'solid', '#3a3a3a'),
        '& button': {
            backgroundColor: '#2a2a2a',
            color: '#ffffff',
            ...shorthands.border('1px', 'solid', '#3a3a3a'),
            '&:hover': {
                backgroundColor: '#333333',
            },
        },
    },
});

interface ProviderSelectorProps {
    activeProvider?: ModelProvider;
    availableProviders: ModelProvider[];
    onProviderChange: (provider: ModelProvider) => void;
    disabled?: boolean;
}

function getProviderIcon(provider: ModelProvider) {
    switch (provider) {
        case ModelProvider.TransformerJS:
            return <GlobeRegular />;
        case ModelProvider.Ollama:
            return <BotRegular />;
        case ModelProvider.Candle:
            return <BotRegular />;
        case ModelProvider.OpenAICompatible:
            return <CubeRegular />;
        default:
            return <CubeRegular />;
    }
}

function getProviderDisplayName(provider: ModelProvider): string {
    switch (provider) {
        case ModelProvider.TransformerJS:
            return 'Transformer.js';
        case ModelProvider.Ollama:
            return 'Ollama';
        case ModelProvider.Candle:
            return 'Embedded AI';
        case ModelProvider.OpenAICompatible:
            return 'OpenAI';
        default:
            return provider;
    }
}

export function ProviderSelector({
    activeProvider,
    availableProviders,
    onProviderChange,
    disabled = false,
}: ProviderSelectorProps) {
    const styles = useStyles();

    const displayValue = activeProvider
        ? getProviderDisplayName(activeProvider)
        : 'Select Provider';

    return (
        <Dropdown
            className={styles.dropdown}
            placeholder="Select Provider"
            value={displayValue}
            selectedOptions={activeProvider ? [activeProvider] : []}
            onOptionSelect={(_, data) => {
                if (data.optionValue) {
                    onProviderChange(data.optionValue as ModelProvider);
                }
            }}
            disabled={disabled}
        >
            {availableProviders.map((provider) => (
                <Option key={provider} value={provider} text={getProviderDisplayName(provider)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {getProviderIcon(provider)}
                        <span>{getProviderDisplayName(provider)}</span>
                    </div>
                </Option>
            ))}
        </Dropdown>
    );
}
