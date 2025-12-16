import React from 'react';
import {
    makeStyles,
    tokens,
    shorthands,
    Text,
    Slider,
    Label,
    Switch,
    Button,
    Divider,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    TabList,
    Tab,
    SelectTabData,
    SelectTabEvent,
    Card,
    CardHeader,
    Input,
    Badge,
    Dropdown,
    Option,
    ProgressBar,
} from '@fluentui/react-components';
import {
    Dismiss24Regular,
    Save24Regular,
    BotRegular,
    CubeRegular,
    GlobeRegular,
    Play24Regular,
    ArrowDownload24Regular,
} from '@fluentui/react-icons';
import { ModelConfig, ModelParameters, ModelProvider, AIMode } from '@/types/ai-types';

const useStyles = makeStyles({
    dialogSurface: {
        minWidth: '800px', // Match mockup width
        maxWidth: '900px',
        minHeight: '600px',
    },
    // Tabs
    tabList: {
        borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
        marginBottom: '20px',
    },
    // Layout
    contentGrid: {
        display: 'grid',
        gridTemplateColumns: '2fr 1fr', // 2:1 split for Main vs Preview
        gap: '24px',
        height: '450px', // Fixed height
    },
    mainColumn: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('16px'),
        overflowY: 'auto',
        paddingRight: '12px',
    },
    previewColumn: {
        backgroundColor: tokens.colorNeutralBackground2, // Slightly darker
        ...shorthands.borderRadius('12px'),
        ...shorthands.padding('20px'),
        display: 'flex',
        flexDirection: 'column', // Fixed: was missing
        ...shorthands.gap('16px'),
        height: 'fit-content',
    },
    // New style for progress
    progressContainer: {
        width: '100%',
        marginTop: '8px',
    },
    // Model Cards
    cardGrid: {
        display: 'flex',
        flexDirection: 'row',
        ...shorthands.gap('12px'),
        overflowX: 'auto',
        paddingBottom: '12px', // Space for scrollbar
        scrollSnapType: 'x mandatory',
        minHeight: '180px', // Ensure height for cards
    },
    modelCard: {
        cursor: 'pointer',
        ...shorthands.padding('16px'),
        transition: 'all 0.2s',
        ...shorthands.border('1px solid transparent'),
        backgroundColor: tokens.colorNeutralBackground1,
        boxShadow: tokens.shadow4,
        position: 'relative',
        minWidth: '200px', // Fixed width for carousel
        maxWidth: '220px',
        scrollSnapAlign: 'start',
        flexShrink: 0, // Prevent shrinking
    },
    selectedCard: {
        ...shorthands.borderColor(tokens.colorBrandStroke1),
        backgroundColor: tokens.colorBrandBackground2,
        boxShadow: tokens.shadow8, // Enhanced shadow for selected
    },
    // Badges
    badgeRow: {
        display: 'flex',
        ...shorthands.gap('8px'),
        marginTop: '8px',
        flexWrap: 'wrap',
    },
    // Typography
    sectionTitle: {
        marginBottom: '12px',
    },
    // Settings Rows
    settingRow: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
        marginBottom: '16px',
    },
    labelRow: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
});

interface AISettingsPanelProps {
    modelConfig: ModelConfig;
    allModels: ModelConfig[];
    onUpdateConfig: (newConfig: ModelConfig) => void;
    onSelectModel: (modelId: string) => void;
    onDownloadModel?: (modelId: string, provider: ModelProvider, endpoint?: string) => void;
    downloadProgress?: { modelId: string; status: string; progress: number; total?: number; completed?: number };
    onClose: () => void;
    open: boolean;
}

export function AISettingsPanel({
    modelConfig,
    allModels,
    onUpdateConfig,
    onSelectModel,
    onDownloadModel,
    downloadProgress,
    onClose,
    open
}: AISettingsPanelProps) {
    const styles = useStyles();

    // Defensive defaults in case modelConfig is missing (should be handled by parent)
    const [selectedTab, setSelectedTab] = React.useState<string>('general');
    const [params, setParams] = React.useState<ModelParameters>(modelConfig?.parameters || {
        temperature: 0.7, topP: 0.9, maxTokens: 2048, stream: true
    });
    const [selectedProvider, setSelectedProvider] = React.useState<string>(modelConfig?.provider || 'ollama');
    const [customEndpoint, setCustomEndpoint] = React.useState<string>('http://127.0.0.1:11434');

    // Safety check - if no config, don't render (but hooks must run first)
    if (!modelConfig) {
        return null;
    }
    // ... existing ...

    // Combine installed models with known models
    const displayModels = React.useMemo(() => {
        // Convert selectedProvider string to enum for comparison
        const providerEnum = selectedProvider as ModelProvider;
        return allModels.filter(m => m.provider === providerEnum);
    }, [allModels, selectedProvider]);

    // Sync state when modelConfig changes
    React.useEffect(() => {
        if (modelConfig) {
            setParams(modelConfig.parameters);
            setSelectedProvider(modelConfig.provider);
        }
    }, [modelConfig]);

    const handleParamChange = (key: keyof ModelParameters, value: any) => {
        if (!modelConfig) return;
        const newParams = { ...params, [key]: value };
        setParams(newParams);
        onUpdateConfig({ ...modelConfig, parameters: newParams });
    };

    const getModelBadge = (model: ModelConfig) => {
        // Mock logic for badges based on name/size
        if (model.id.includes('3b') || (model.sizeBytes && model.sizeBytes < 4e9)) return <Badge color="success" appearance="tint">Fast</Badge>;
        if (model.id.includes('70b')) return <Badge color="danger" appearance="tint">Slow</Badge>;
        if (model.id.includes('7b') || model.id.includes('8b')) return <Badge color="warning" appearance="tint">Balanced</Badge>;
        return <Badge color="brand" appearance="tint">Quality</Badge>;
    };

    const getProviderIcon = (provider: ModelProvider) => {
        switch (provider) {
            case ModelProvider.TransformerJS: return <GlobeRegular />;
            case ModelProvider.Ollama: return <BotRegular />;
            case ModelProvider.Candle: return <BotRegular />; // Use Bot icon for now
            default: return <CubeRegular />;
        }
    };

    return (
        <Dialog open={open} onOpenChange={(event, data) => !data.open && onClose()}>
            <DialogSurface className={styles.dialogSurface}>
                <DialogBody>
                    <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                        <Text size={500} weight="semibold">Configure AI Model</Text>
                    </div>

                    <div className={styles.tabList}>
                        <TabList selectedValue={selectedTab} onTabSelect={(_, data) => setSelectedTab(data.value as string)}>
                            <Tab value="general">General</Tab>
                            <Tab value="parameters">Parameters</Tab>
                            <Tab value="advanced">Advanced</Tab>
                        </TabList>
                    </div>

                    <DialogContent>
                        <div className={styles.contentGrid}>
                            {/* LEFT COLUMN: MAIN CONTENT */}
                            <div className={styles.mainColumn}>
                                {selectedTab === 'general' && (
                                    <>
                                        <div>
                                            <Label weight="semibold">Provider</Label>
                                            <div style={{ marginTop: '8px' }}>
                                                <Dropdown
                                                    value={
                                                        selectedProvider === 'transformerjs' ? 'Transformer.js (In-Browser)' :
                                                            selectedProvider === 'ollama' ? 'Ollama (Local Server)' :
                                                                selectedProvider === 'candle' ? 'Embedded AI (Rust/Candle)' :
                                                                    'OpenAI Compatible'
                                                    }
                                                    selectedOptions={[selectedProvider]}
                                                    onOptionSelect={(_, data) => setSelectedProvider(data.optionValue as ModelProvider)}
                                                    style={{ width: '100%' }}
                                                >
                                                    <Option value="candle" text="Embedded AI (Rust/Candle)">
                                                        <BotRegular style={{ marginRight: '8px' }} /> Embedded AI (Recommended)
                                                    </Option>
                                                    <Option value="transformerjs" text="Transformer.js (In-Browser)">
                                                        <GlobeRegular style={{ marginRight: '8px' }} /> Transformer.js (In-Browser)
                                                    </Option>
                                                    <Option value="ollama" text="Ollama (Local Server)">
                                                        <BotRegular style={{ marginRight: '8px' }} /> Ollama (Local Server)
                                                    </Option>
                                                    <Option value="openai-compatible" text="OpenAI Compatible">
                                                        <CubeRegular style={{ marginRight: '8px' }} /> OpenAI Compatible
                                                    </Option>
                                                </Dropdown>
                                            </div>

                                            {/* Endpoint Configuration */}
                                            {(selectedProvider === 'ollama' || selectedProvider === 'openai-compatible') && (
                                                <div style={{ marginTop: '12px' }}>
                                                    <Label size="small">Endpoint URL</Label>
                                                    <Input
                                                        value={customEndpoint}
                                                        onChange={(e) => setCustomEndpoint(e.target.value)}
                                                        placeholder={selectedProvider === 'ollama' ? "http://127.0.0.1:11434" : "http://localhost:1234/v1"}
                                                        style={{ width: '100%', marginTop: '4px' }}
                                                    />
                                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                                        {selectedProvider === 'ollama' ? 'Custom port (e.g. 11434) for local Ollama instance.' : 'URL for local LLM server (compatible with OpenAI API).'}
                                                    </Text>
                                                </div>
                                            )}
                                        </div>

                                        <div>
                                            <Label weight="semibold" className={styles.sectionTitle}>Model Selection</Label>
                                            <div className={styles.cardGrid}>
                                                {displayModels.length === 0 ? (
                                                    <Text style={{ padding: '20px', color: tokens.colorNeutralForeground3 }}>
                                                        No models found for {selectedProvider}.
                                                        Total models available: {allModels.length}
                                                    </Text>
                                                ) : (
                                                    displayModels.map((model) => {
                                                        const isDownloading = downloadProgress?.modelId === model.modelId && downloadProgress?.status === 'downloading';

                                                        return (
                                                            <div
                                                                key={model.id}
                                                                className={`${styles.modelCard} ${model.id === modelConfig.id ? styles.selectedCard : ''}`}
                                                                onClick={() => onSelectModel(model.id)}
                                                                style={{ opacity: model.isAvailable || isDownloading ? 1 : 0.7 }}
                                                            >
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                                    {getProviderIcon(model.provider)}
                                                                    {model.isAvailable ? (
                                                                        <Button
                                                                            icon={<Dismiss24Regular />}
                                                                            size="small"
                                                                            appearance="subtle"
                                                                            title="Delete/Remove Model"
                                                                            onClick={(e) => { e.stopPropagation(); /* TODO: Delete logic */ }}
                                                                        />
                                                                    ) : !isDownloading && (
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                            <Badge appearance="tint" color="informative">Not Installed</Badge>
                                                                            <Button
                                                                                appearance="primary"
                                                                                size="small"
                                                                                icon={<ArrowDownload24Regular />}
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();

                                                                                    if (model.provider === ModelProvider.Candle) {
                                                                                        if (onDownloadModel) {
                                                                                            onDownloadModel(model.modelId, ModelProvider.Candle);
                                                                                        }
                                                                                        return;
                                                                                    }

                                                                                    const command = `ollama pull ${model.modelId}`;
                                                                                    navigator.clipboard.writeText(command);
                                                                                    alert(`Command copied to clipboard!\n\nRun this in your terminal:\n${command}\n\nThen refresh the app.`);
                                                                                }}
                                                                                title={model.provider === ModelProvider.Candle ? "Download Embedded Model" : "Copy install command"}
                                                                            >
                                                                                {model.provider === ModelProvider.Candle ? "Download" : "Get"}
                                                                            </Button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <Text weight="semibold" block style={{ marginTop: '4px' }}>{model.name}</Text>

                                                                {isDownloading ? (
                                                                    <div className={styles.progressContainer}>
                                                                        <ProgressBar value={downloadProgress?.progress ? downloadProgress.progress / 100 : undefined} />
                                                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                                                            {downloadProgress?.progress ? (downloadProgress.progress <= 1.0 ? `${Math.round(downloadProgress.progress * 100)}%` : `${Math.round(downloadProgress.progress)}%`) : 'Starting...'}
                                                                        </Text>
                                                                    </div>
                                                                ) : (
                                                                    <div className={styles.badgeRow}>
                                                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                                                            {model.sizeBytes ? `${(model.sizeBytes / 1e9).toFixed(1)}GB` : 'Unknown size'}
                                                                        </Text>
                                                                        {getModelBadge(model)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })
                                                )}
                                            </div>
                                            <Button
                                                style={{ marginTop: '16px', width: '100%' }}
                                                icon={<ArrowDownload24Regular />}
                                                disabled={selectedProvider === 'transformerjs' || selectedProvider === 'candle'}
                                                onClick={() => {
                                                    if (selectedProvider === 'candle' && onDownloadModel) {
                                                        onDownloadModel('qwen2.5-coder:0.5b', ModelProvider.Candle); // Trigger download
                                                    }
                                                }}
                                            >
                                                {selectedProvider === 'candle' ? 'Download Embedded Model (Automated)' : 'Download New Model from Hub'}
                                            </Button>
                                        </div>
                                    </>
                                )}

                                {selectedTab === 'parameters' && (
                                    <>
                                        <div className={styles.settingRow}>
                                            <div className={styles.labelRow}>
                                                <Label>Temperature ({params.temperature.toFixed(1)})</Label>
                                                <Badge appearance="outline" color={params.temperature > 0.8 ? "warning" : "brand"}>
                                                    {params.temperature > 0.8 ? "Creative" : params.temperature < 0.4 ? "Precise" : "Balanced"}
                                                </Badge>
                                            </div>
                                            <Slider
                                                min={0}
                                                max={2}
                                                step={0.1}
                                                value={params.temperature}
                                                onChange={(_, data) => handleParamChange('temperature', data.value)}
                                            />
                                        </div>

                                        <div className={styles.settingRow}>
                                            <div className={styles.labelRow}>
                                                <Label>Top P ({params.topP.toFixed(1)})</Label>
                                            </div>
                                            <Slider
                                                min={0}
                                                max={1}
                                                step={0.05}
                                                value={params.topP}
                                                onChange={(_, data) => handleParamChange('topP', data.value)}
                                            />
                                        </div>

                                        <div className={styles.settingRow}>
                                            <div className={styles.labelRow}>
                                                <Label>Max Output Tokens ({params.maxTokens})</Label>
                                            </div>
                                            <Slider
                                                min={256}
                                                max={4096}
                                                step={256}
                                                value={params.maxTokens}
                                                onChange={(_, data) => handleParamChange('maxTokens', data.value)}
                                            />
                                        </div>
                                    </>
                                )}

                                {selectedTab === 'advanced' && (
                                    <Text>Advanced settings placehoder...</Text>
                                )}
                            </div>

                            {/* RIGHT COLUMN: PREVIEW PANEL */}
                            <div className={styles.previewColumn}>
                                <Text weight="semibold" size={400}>Preview Panel</Text>

                                <div>
                                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Recommended for:</Label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                        {modelConfig.recommendedFor.map(mode => (
                                            <Text key={mode} weight="medium">
                                                {mode === AIMode.QA ? 'QA Mode' : 'Agent Mode'}
                                            </Text>
                                        ))}
                                    </div>
                                </div>

                                <Divider />

                                <div>
                                    <Label size="small" style={{ color: tokens.colorNeutralForeground2, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <CubeRegular /> System Requirements
                                    </Label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                        <Text size={200}>RAM: {modelConfig.sizeBytes ? `${Math.ceil(modelConfig.sizeBytes / 1e9 + 2)}GB+` : '8GB+'}</Text>
                                        <Text size={200}>GPU: Recommended</Text>
                                        <Text size={200}>VRAM: 4GB+</Text>
                                    </div>
                                </div>

                                <Divider />

                                <div>
                                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>Storage Location</Label>
                                    <Text size={200} block style={{
                                        fontFamily: tokens.fontFamilyMonospace,
                                        marginTop: '4px',
                                        wordBreak: 'break-all',
                                        color: tokens.colorNeutralForeground2
                                    }}>
                                        {modelConfig.provider === 'transformerjs' ? 'Browser Cache (IndexedDB)' : '~/.ollama/models'}
                                    </Text>
                                </div>
                            </div>
                        </div>
                    </DialogContent>

                    <DialogActions>
                        <Button appearance="outline" icon={<Play24Regular />}>
                            Test Inference
                        </Button>
                        <Button appearance="primary" onClick={onClose} icon={<Save24Regular />}>
                            Save
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
