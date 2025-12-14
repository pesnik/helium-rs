/**
 * File System Context Builder
 * 
 * Builds relevant context from file system data for AI prompts.
 */

import { FileSystemContext, ScanSummary } from '@/types/ai-types';

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Build context string from file system data
 */
export function buildFileSystemContext(context: FileSystemContext): string {
    const parts: string[] = [];

    // Current path
    if (context.currentPath) {
        parts.push(`Current Directory: ${context.currentPath}`);
    }

    // Selected paths
    if (context.selectedPaths && context.selectedPaths.length > 0) {
        parts.push(`\nSelected Items:`);
        context.selectedPaths.forEach((path) => {
            parts.push(`- ${path}`);
        });
    }

    // Scan data summary
    if (context.scanData) {
        parts.push('\nFile System Summary:');
        parts.push(`- Total Files: ${context.scanData.totalFiles.toLocaleString()}`);
        parts.push(`- Total Size: ${formatFileSize(context.scanData.totalSize)}`);

        if (context.scanData.largestFiles.length > 0) {
            parts.push('\nLargest Files:');
            context.scanData.largestFiles.slice(0, 10).forEach((file, index) => {
                parts.push(`${index + 1}. ${file.path} - ${formatFileSize(file.size)}`);
            });
        }

        if (Object.keys(context.scanData.fileTypes).length > 0) {
            parts.push('\nFile Type Distribution:');
            const sortedTypes = Object.entries(context.scanData.fileTypes)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10);
            sortedTypes.forEach(([type, count]) => {
                parts.push(`- ${type}: ${count.toLocaleString()} files`);
            });
        }
    }

    return parts.join('\n');
}

/**
 * Truncate context to fit within token limit
 * Simple character-based truncation (can be improved with tokenizer)
 */
export function truncateContext(
    context: string,
    maxChars: number = 4000
): string {
    if (context.length <= maxChars) {
        return context;
    }

    const truncated = context.substring(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');

    if (lastNewline > 0) {
        return truncated.substring(0, lastNewline) + '\n\n[Context truncated...]';
    }

    return truncated + '\n\n[Context truncated...]';
}

/**
 * Extract file paths from text (for creating clickable links)
 */
export function extractFilePaths(text: string): string[] {
    // Simple regex to match common file path patterns
    const pathRegex = /(?:\/|~\/|[A-Z]:\\)[\w\-\/\\.]+/g;
    const matches = text.match(pathRegex);
    return matches ? Array.from(new Set(matches)) : [];
}
