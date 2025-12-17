/**
 * MCP Manager - Smart Dynamic Directory Management
 *
 * Manages MCP initialization for a production app where users navigate folders.
 * Handles dynamic directory updates without requiring manual configuration.
 */

import { mcpService } from './mcp-service';
import { MCPServerConfig } from '@/types/ai-types';

class MCPManager {
    private currentDirectory: string | null = null;
    private isInitialized: boolean = false;
    private parentDirectories: Set<string> = new Set();

    /**
     * Initialize or update MCP based on current directory
     * This is called whenever the user navigates to a new folder
     */
    async ensureInitialized(currentPath: string): Promise<boolean> {
        try {
            // Normalize the path to resolve relative paths and ensure consistent format
            const normalizedPath = this.normalizePath(currentPath);

            // Extract parent directory (allow access to parent for context)
            const parentPath = this.getParentDirectory(normalizedPath);

            // Check if we need to reinitialize
            const needsReinit = !this.isInitialized ||
                               this.currentDirectory !== normalizedPath;

            if (!needsReinit) {
                return true; // Already initialized for this directory
            }

            console.log('[MCPManager] 📁 Initializing MCP for directory:', normalizedPath);
            if (currentPath !== normalizedPath) {
                console.log('[MCPManager]    Original path:', currentPath);
            }

            // Build allowed directories list
            const allowedDirectories = this.buildAllowedDirectories(normalizedPath, parentPath);
            console.log('[MCPManager]    Allowed directories:', allowedDirectories);

            // Shutdown existing if needed
            if (this.isInitialized) {
                await mcpService.shutdown();
            }

            // Initialize MCP with current directory
            const result = await mcpService.initialize({
                allowedDirectories,
                confirmDestructive: true,
                maxFileSize: 10 * 1024 * 1024, // 10MB
            });

            if (result.success) {
                this.isInitialized = true;
                this.currentDirectory = normalizedPath;
                if (parentPath) {
                    this.parentDirectories.add(parentPath);
                }
                console.log('[MCPManager] ✅ Initialized for:', currentPath);
                return true;
            } else {
                console.error('[MCPManager] ❌ Failed:', result.error);
                return false;
            }
        } catch (error) {
            console.error('[MCPManager] Error:', error);
            return false;
        }
    }

    /**
     * Build list of allowed directories
     * Includes current directory and parent for better context
     */
    private buildAllowedDirectories(currentPath: string, parentPath: string | null): string[] {
        const allowed = [currentPath];

        // Add parent directory for context (helps AI understand folder structure)
        if (parentPath && parentPath !== currentPath) {
            allowed.push(parentPath);
        }

        return allowed;
    }

    /**
     * Get parent directory from a path
     */
    private getParentDirectory(path: string): string | null {
        try {
            // Handle both Windows and Unix paths
            const separator = path.includes('\\') ? '\\' : '/';
            const parts = path.split(separator).filter(p => p);

            if (parts.length <= 1) {
                return null; // Root directory
            }

            parts.pop(); // Remove last part (current folder name)
            return parts.join(separator);
        } catch {
            return null;
        }
    }

    /**
     * Update allowed directories when user navigates
     * More efficient than full reinit - just updates the config
     */
    async updateDirectory(newPath: string): Promise<boolean> {
        return this.ensureInitialized(newPath);
    }

    /**
     * Check if MCP is ready for the current directory
     */
    isReadyForDirectory(path: string): boolean {
        return this.isInitialized && this.currentDirectory === path;
    }

    /**
     * Get current initialized directory
     */
    getCurrentDirectory(): string | null {
        return this.currentDirectory;
    }

    /**
     * Shutdown MCP (called on app unmount)
     */
    async shutdown(): Promise<void> {
        if (this.isInitialized) {
            await mcpService.shutdown();
            this.isInitialized = false;
            this.currentDirectory = null;
            this.parentDirectories.clear();
        }
    }

    /**
     * Check initialization status
     */
    async checkStatus(): Promise<boolean> {
        try {
            return await mcpService.isInitialized();
        } catch {
            return false;
        }
    }

    /**
     * Normalize path to resolve relative paths and ensure consistent format
     * Resolves './' and '../' and normalizes backslashes on Windows
     */
    private normalizePath(path: string): string {
        try {
            // Remove leading './' or '.\'
            let normalized = path.replace(/^\.[\\/]/, '');

            // On Windows, ensure consistent backslashes
            if (normalized.includes('\\')) {
                normalized = normalized.replace(/\//g, '\\');
            }

            // Remove trailing slashes
            normalized = normalized.replace(/[\\/]+$/, '');

            // Resolve '..' components manually
            const separator = normalized.includes('\\') ? '\\' : '/';
            const parts = normalized.split(separator).filter(p => p && p !== '.');
            const resolved: string[] = [];

            for (const part of parts) {
                if (part === '..') {
                    resolved.pop(); // Go up one directory
                } else {
                    resolved.push(part);
                }
            }

            const result = resolved.join(separator);

            // Preserve drive letter on Windows if present
            if (path.match(/^[A-Za-z]:/)) {
                return result;
            }

            // Add leading slash for Unix absolute paths
            if (path.startsWith('/') && !result.startsWith('/')) {
                return '/' + result;
            }

            return result;
        } catch {
            return path; // Fallback to original path if normalization fails
        }
    }
}

// Export singleton instance
export const mcpManager = new MCPManager();
