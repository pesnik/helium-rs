'use client';

import React, { useEffect, useState } from 'react';
import {
    makeStyles,
    shorthands,
    Button,
    Text,
    Subtitle2,
    ProgressBar,
    Checkbox,
    Dialog,
    DialogSurface,
    DialogBody,
    DialogTitle,
    DialogContent,
    DialogActions,
    Accordion,
    AccordionItem,
    AccordionHeader,
    AccordionPanel,
    Badge,
} from '@fluentui/react-components';
import {
    DeleteRegular,
    ArrowClockwiseRegular,
    BroomRegular,
    StethoscopeRegular,
    InfoRegular,
} from '@fluentui/react-icons';
import { invoke } from '@tauri-apps/api/core';
import { JunkCategory, JunkItem } from '../types/cleaner';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        ...shorthands.gap('16px'),
        ...shorthands.padding('20px'),
        backgroundColor: '#1a1a1a', // Slightly darker background for contrast
        color: 'white',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    summaryCard: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...shorthands.padding('24px'),
        backgroundColor: '#292929',
        ...shorthands.borderRadius('8px'),
        ...shorthands.border('1px', 'solid', '#333'),
    },
    listContainer: {
        flexGrow: 1,
        overflowY: 'auto',
        ...shorthands.border('1px', 'solid', '#333'),
        ...shorthands.borderRadius('8px'),
        ...shorthands.padding('10px'),
    },
    categoryHeader: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('10px'),
        width: '100%',
    },
    itemRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        ...shorthands.padding('8px', '16px'),
        ':hover': {
            backgroundColor: '#333',
        },
    },
});

export const CleanerPanel = () => {
    const styles = useStyles();
    const [categories, setCategories] = useState<JunkCategory[]>([]);
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false); // Visual state for scanning
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [cleanDialogOpen, setCleanDialogOpen] = useState(false);

    // Initial scan
    useEffect(() => {
        handleScan();
    }, []);

    const handleScan = async () => {
        setLoading(true);
        setScanning(true);
        setCategories([]);
        setSelectedItems(new Set()); // Reset selection
        try {
            // Fake delay for effect if too fast?
            const start = Date.now();
            const result = await invoke<JunkCategory[]>('scan_junk');
            const end = Date.now();
            if (end - start < 800) {
                await new Promise(r => setTimeout(r, 800 - (end - start)));
            }

            setCategories(result);

            // Auto-select all by default? Or let user choose? 
            // Let's auto-select "safe" ones. For now, select all.
            const allPaths = new Set<string>();
            result.forEach(cat => {
                cat.items.forEach(item => allPaths.add(item.path));
            });
            setSelectedItems(allPaths);

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
            setScanning(false);
        }
    };

    const handleClean = async () => {
        setCleanDialogOpen(false);
        setLoading(true);
        try {
            await invoke('clean_junk', { paths: Array.from(selectedItems) });
            // Re-scan to show updated state
            await handleScan();
        } catch (e) {
            console.error("Failed to clean:", e);
            alert("Failed to clean some items: " + e);
            setLoading(false);
        }
    };

    const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const totalSelectedSize = Array.from(selectedItems).reduce((acc, path) => {
        // Find item size
        for (const cat of categories) {
            const item = cat.items.find(i => i.path === path);
            if (item) return acc + item.size;
        }
        return acc;
    }, 0);

    const toggleCategory = (cat: JunkCategory, checked: boolean) => {
        const newSet = new Set(selectedItems);
        cat.items.forEach(item => {
            if (checked) newSet.add(item.path);
            else newSet.delete(item.path);
        });
        setSelectedItems(newSet);
    };

    const toggleItem = (path: string, checked: boolean) => {
        const newSet = new Set(selectedItems);
        if (checked) newSet.add(path);
        else newSet.delete(path);
        setSelectedItems(newSet);
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <Subtitle2 style={{ fontSize: '20px' }}>System Cleaner</Subtitle2>
                    <Text block style={{ color: '#aaa' }}>Remove temporary files and free up space.</Text>
                </div>
                <Button appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={handleScan} disabled={loading}>
                    Rescan
                </Button>
            </div>

            {/* Summary / Hero Section */}
            <div className={styles.summaryCard}>
                {scanning ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <StethoscopeRegular style={{ fontSize: '48px', color: '#0078d4' }} />
                        <Text size={500}>Scanning system for junk...</Text>
                        <ProgressBar style={{ width: '200px' }} />
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        {categories.length === 0 ? (
                            <>
                                <BroomRegular style={{ fontSize: '48px', color: '#28a745' }} />
                                <Text size={600} weight="bold">System is Clean!</Text>
                                <Text>No junk files found.</Text>
                            </>
                        ) : (
                            <>
                                <BroomRegular style={{ fontSize: '48px', color: '#ffc107' }} />
                                <Text size={600} weight="bold">{formatSize(totalSelectedSize)}</Text>
                                <Text>Ready to clean</Text>
                                <Button
                                    appearance="primary"
                                    size="large"
                                    icon={<DeleteRegular />}
                                    style={{ marginTop: '10px', minWidth: '150px' }}
                                    onClick={() => setCleanDialogOpen(true)}
                                    disabled={selectedItems.size === 0}
                                >
                                    Clean Now
                                </Button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Details List */}
            {categories.length > 0 && !scanning && (
                <div className={styles.listContainer}>
                    <Accordion multiple collapsible>
                        {categories.map((cat) => {
                            // Check status for category checkbox
                            const catItems = cat.items.map(i => i.path);
                            const selectedCount = catItems.filter(p => selectedItems.has(p)).length;
                            const isAllSelected = selectedCount === catItems.length;
                            const isIndeterminate = selectedCount > 0 && selectedCount < catItems.length;

                            return (
                                <AccordionItem value={cat.id} key={cat.id}>
                                    <AccordionHeader>
                                        <div className={styles.categoryHeader} onClick={(e) => e.stopPropagation()}>
                                            <Checkbox
                                                checked={isAllSelected ? true : (isIndeterminate ? 'mixed' : false)}
                                                onChange={(e, data) => toggleCategory(cat, !!data.checked)}
                                            />
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <Text weight="semibold">{cat.name}</Text>
                                                <Text size={200} style={{ color: '#aaa' }}>{cat.description} • {formatSize(cat.total_size)}</Text>
                                            </div>
                                            <Badge appearance="filled" color="brand" style={{ marginLeft: 'auto' }}>
                                                {cat.items.length}
                                            </Badge>
                                        </div>
                                    </AccordionHeader>
                                    <AccordionPanel>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            {cat.items.map(item => (
                                                <div key={item.path} className={styles.itemRow}>
                                                    <Checkbox
                                                        label={item.name}
                                                        checked={selectedItems.has(item.path)}
                                                        onChange={(e, data) => toggleItem(item.path, !!data.checked)}
                                                    />
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <Text size={200} style={{ color: '#aaa' }}>{formatSize(item.size)}</Text>
                                                        {/* <Button icon={<InfoRegular />} appearance="transparent" size="small" /> */}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </AccordionPanel>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>
                </div>
            )}

            {/* Clean Confirmation Dialog */}
            <Dialog open={cleanDialogOpen} onOpenChange={(event, data) => setCleanDialogOpen(data.open)}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Confirm Cleaning</DialogTitle>
                        <DialogContent>
                            <Text>
                                Are you sure you want to permanently delete {selectedItems.size} items totaling <strong>{formatSize(totalSelectedSize)}</strong>?
                            </Text>
                            <Text block style={{ marginTop: '10px', color: 'var(--colorPaletteRedForeground1)' }}>
                                This action cannot be undone.
                            </Text>
                        </DialogContent>
                        <DialogActions>
                            <Button appearance="secondary" onClick={() => setCleanDialogOpen(false)}>Cancel</Button>
                            <Button
                                appearance="primary"
                                style={{ backgroundColor: '#d13438', color: 'white' }}
                                onClick={handleClean}
                            >
                                Delete
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </div>
    );
};
