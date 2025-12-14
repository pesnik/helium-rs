'use client';

/**
 * Mode Selector Component
 * 
 * Allows users to switch between AI modes (QA, Summarize, Agent).
 */

import React from 'react';
import {
    ToggleButton,
    makeStyles,
    tokens,
    shorthands,
    Tooltip,
} from '@fluentui/react-components';
import {
    ChatMultiple24Regular,
    DocumentText24Regular,
    Bot24Regular,
} from '@fluentui/react-icons';
import { AIMode } from '@/types/ai-types';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        ...shorthands.gap('4px'),
        ...shorthands.padding('8px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.borderRadius('8px'),
    },
    button: {
        minWidth: '100px',
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
        label: 'QA',
        tooltip: 'Ask questions about your files and folders',
    },
    [AIMode.Summarize]: {
        icon: <DocumentText24Regular />,
        label: 'Summarize',
        tooltip: 'Get concise summaries of file/folder contents',
    },
    [AIMode.Agent]: {
        icon: <Bot24Regular />,
        label: 'Agent',
        tooltip: 'AI agent with file system operation capabilities (Coming in Phase 4)',
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
            {Object.entries(MODE_CONFIG).map(([mode, config]) => (
                <Tooltip key={mode} content={config.tooltip} relationship="description">
                    <ToggleButton
                        className={styles.button}
                        icon={config.icon}
                        checked={selectedMode === mode}
                        onClick={() => onModeChange(mode as AIMode)}
                        disabled={disabled || mode === AIMode.Agent} // Agent mode disabled for now
                        appearance="subtle"
                    >
                        {config.label}
                    </ToggleButton>
                </Tooltip>
            ))}
        </div>
    );
}
