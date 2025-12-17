'use client';

/**
 * Mode Selector Component
 *
 * Allows users to switch between AI modes (QA, Agent).
 */

import React from 'react';
import {
    ToggleButton,
    makeStyles,
    tokens,
    shorthands,
    Tooltip,
    mergeClasses,
} from '@fluentui/react-components';
import {
    ChatMultiple24Regular,
    Bot24Regular,
} from '@fluentui/react-icons';
import { AIMode } from '@/types/ai-types';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        ...shorthands.gap('8px'),
    },
    button: {
        minWidth: 'auto',
        ...shorthands.borderRadius('20px'),
        ...shorthands.padding('6px', '14px'),
        backgroundColor: 'transparent',
        color: '#a0a0a0',
        ...shorthands.border('1px', 'solid', '#3a3a3a'),
        '&:hover': {
            backgroundColor: '#2a2a2a',
            color: '#ffffff',
        },
    },
    buttonChecked: {
        backgroundColor: '#2d5a8f',
        color: '#ffffff',
        ...shorthands.border('1px', 'solid', '#4a7fbe'),
        '&:hover': {
            backgroundColor: '#3668a3',
        },
    },
});

interface ModeSelectorProps {
    selectedMode: AIMode;
    onModeChange: (mode: AIMode) => void;
    disabled?: boolean;
}

const MODE_CONFIG = {
    [AIMode.QA]: {
        icon: <ChatMultiple24Regular />,
        label: 'QA Mode',
        tooltip: 'Ask questions about your files and folders',
    },
    [AIMode.Agent]: {
        icon: <Bot24Regular />,
        label: 'Agent',
        tooltip: 'AI agent with MCP filesystem tools - can read, write, search, and manage files',
    },
};

export function ModeSelector({
    selectedMode,
    onModeChange,
    disabled = false,
}: ModeSelectorProps) {
    const styles = useStyles();

    return (
        <div className={styles.container}>
            {Object.entries(MODE_CONFIG).map(([mode, config]) => {
                const isSelected = selectedMode === mode;
                return (
                    <Tooltip key={mode} content={config.tooltip} relationship="description">
                        <ToggleButton
                            className={mergeClasses(styles.button, isSelected && styles.buttonChecked)}
                            icon={config.icon}
                            checked={isSelected}
                            onClick={() => onModeChange(mode as AIMode)}
                            disabled={disabled}
                            appearance="subtle"
                        >
                            {config.label}
                        </ToggleButton>
                    </Tooltip>
                );
            })}
        </div>
    );
}
