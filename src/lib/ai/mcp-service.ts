/**
 * MCP Service
 *
 * Service layer for Model Context Protocol (MCP) filesystem server integration.
 * Handles initialization, tool discovery, and tool execution.
 */

import { invoke } from '@tauri-apps/api/core';
import { MCPTool, MCPServerConfig, ToolCall, ToolResult } from '@/types/ai-types';

export interface InitializeMCPResponse {
    success: boolean;
    server_name?: string;
    server_version?: string;
    protocol_version?: string;
    error?: string;
}

export interface ExecuteToolRequest {
    tool_name: string;
    arguments: Record<string, unknown>;
}

export interface ExecuteToolResponse {
    success: boolean;
    content: Array<{
        type: 'text' | 'resource';
        text?: string;
        uri?: string;
        mime_type?: string;
    }>;
    is_error: boolean;
    execution_time_ms?: number;
    error?: string;
}

/**
 * MCP Service singleton
 */
class MCPService {
    private initialized: boolean = false;
    private tools: MCPTool[] = [];
    private config: MCPServerConfig | null = null;

    /**
     * Initialize the MCP filesystem server
     */
    async initialize(config: MCPServerConfig): Promise<InitializeMCPResponse> {
        console.log('[MCPService] Initializing with config:', config);

        try {
            const response = await invoke<InitializeMCPResponse>('initialize_mcp', {
                allowedDirectories: config.allowedDirectories,
                confirmDestructive: config.confirmDestructive,
                maxFileSize: config.maxFileSize,
            });

            if (response.success) {
                this.initialized = true;
                this.config = config;
                console.log('[MCPService] Initialized successfully:', response);

                // Fetch available tools
                await this.refreshTools();
            } else {
                console.error('[MCPService] Initialization failed:', response.error);
            }

            return response;
        } catch (error) {
            console.error('[MCPService] Initialization error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Check if MCP is initialized
     */
    async isInitialized(): Promise<boolean> {
        try {
            const result = await invoke<boolean>('is_mcp_initialized');
            this.initialized = result;
            return result;
        } catch (error) {
            console.error('[MCPService] Error checking initialization:', error);
            return false;
        }
    }

    /**
     * Get available MCP tools
     */
    async getTools(): Promise<MCPTool[]> {
        if (this.tools.length > 0) {
            return this.tools;
        }
        return await this.refreshTools();
    }

    /**
     * Refresh tools from the MCP server
     */
    async refreshTools(): Promise<MCPTool[]> {
        try {
            console.log('[MCPService] Fetching tools from MCP server...');
            const tools = await invoke<MCPTool[]>('get_mcp_tools');

            // Map backend tool format to frontend format
            this.tools = tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                isAvailable: true,
                annotations: tool.annotations,
            }));

            console.log(`[MCPService] Loaded ${this.tools.length} tools:`, this.tools.map(t => t.name));
            return this.tools;
        } catch (error) {
            console.error('[MCPService] Error fetching tools:', error);
            return [];
        }
    }

    /**
     * Execute a tool
     */
    async executeTool(toolCall: ToolCall): Promise<ToolResult> {
        console.log('[MCPService] 🔧 Executing MCP tool:', toolCall.name);
        console.log('[MCPService]    Tool Call ID:', toolCall.id);
        console.log('[MCPService]    Arguments:', toolCall.arguments);

        try {
            const request: ExecuteToolRequest = {
                tool_name: toolCall.name,
                arguments: toolCall.arguments,
            };

            const startTime = Date.now();
            const response = await invoke<ExecuteToolResponse>('execute_mcp_tool', {
                request,
            });
            const invokeTime = Date.now() - startTime;

            // Convert response to ToolResult
            const content = response.content
                .map(c => {
                    if (c.type === 'text' && c.text) {
                        return c.text;
                    } else if (c.type === 'resource' && c.uri) {
                        return `Resource: ${c.uri}${c.text ? `\n${c.text}` : ''}`;
                    }
                    return '';
                })
                .join('\n');

            const result: ToolResult = {
                tool_call_id: toolCall.id,
                content,
                isError: response.is_error,
                executionTimeMs: response.execution_time_ms || invokeTime,
            };

            if (response.is_error) {
                console.error('[MCPService] ❌ Tool execution failed:', toolCall.name);
                console.error('[MCPService]    Error:', content);
            } else {
                console.log('[MCPService] ✅ Tool executed successfully:', toolCall.name);
                console.log('[MCPService]    Execution time:', result.executionTimeMs + 'ms');
                console.log('[MCPService]    Content length:', content.length, 'bytes');
                console.log('[MCPService]    Content preview:', content.substring(0, 150) + (content.length > 150 ? '...' : ''));
            }

            return result;
        } catch (error) {
            console.error('[MCPService] Tool execution error:', error);
            return {
                tool_call_id: toolCall.id,
                content: `Error: ${error instanceof Error ? error.message : String(error)}`,
                isError: true,
            };
        }
    }

    /**
     * Shutdown the MCP server
     */
    async shutdown(): Promise<void> {
        try {
            console.log('[MCPService] Shutting down MCP server...');
            await invoke<boolean>('shutdown_mcp');
            this.initialized = false;
            this.tools = [];
            this.config = null;
            console.log('[MCPService] Shutdown complete');
        } catch (error) {
            console.error('[MCPService] Shutdown error:', error);
        }
    }

    /**
     * Format tools for LLM prompt (OpenAI function calling format)
     */
    formatToolsForPrompt(): string {
        if (this.tools.length === 0) {
            return '(No tools available)';
        }

        return this.tools
            .map(tool => {
                const hints: string[] = [];
                if (tool.annotations?.readOnlyHint) hints.push('read-only');
                if (tool.annotations?.idempotentHint) hints.push('idempotent');
                if (tool.annotations?.destructiveHint) hints.push('DESTRUCTIVE');

                return `- ${tool.name}: ${tool.description}${hints.length > 0 ? ` [${hints.join(', ')}]` : ''}`;
            })
            .join('\n');
    }

    /**
     * Get tool definition by name
     */
    getToolByName(name: string): MCPTool | undefined {
        return this.tools.find(t => t.name === name);
    }
}

// Export singleton instance
export const mcpService = new MCPService();
