/**
 * Inference with Tool Calling Support
 *
 * Wrapper around AI inference that handles tool calling loop.
 */

import { InferenceRequest, InferenceResponse, ChatMessage, MessageRole } from '@/types/ai-types';
import { runInference } from './ai-service';
import { mcpService } from './mcp-service';
import { detectToolCall, extractToolCalls, formatToolResult, removeToolCallTags } from './tool-calling';

const MAX_TOOL_ITERATIONS = 5; // Prevent infinite loops

export interface ToolExecutionEvent {
    toolName: string;
    arguments: Record<string, unknown>;
    result?: string;
    error?: string;
    executionTimeMs?: number;
}

export interface InferenceWithToolsOptions {
    onChunk?: (chunk: string) => void;
    onToolExecution?: (event: ToolExecutionEvent) => void;
    onProgress?: (progress: any) => void;
}

/**
 * Run inference with automatic tool calling support
 *
 * This function wraps the standard inference and handles:
 * 1. Detecting tool calls in LLM responses
 * 2. Executing tools via MCP
 * 3. Feeding results back to the LLM
 * 4. Continuing until no more tool calls
 */
export async function runInferenceWithTools(
    request: InferenceRequest,
    options: InferenceWithToolsOptions = {}
): Promise<InferenceResponse> {
    const { onChunk, onToolExecution, onProgress } = options;

    let currentRequest = { ...request };
    let iterations = 0;
    let finalResponse: InferenceResponse | null = null;

    while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        console.log(`[InferenceWithTools] Iteration ${iterations}/${MAX_TOOL_ITERATIONS}`);

        // Run inference
        const response = await runInference(currentRequest, onChunk, onProgress);

        // Check if response contains tool calls
        const hasToolCalls = detectToolCall(response.message.content);

        if (!hasToolCalls) {
            // No tool calls - we're done
            finalResponse = response;
            break;
        }

        // Extract tool calls
        const toolCalls = extractToolCalls(response.message.content);

        if (toolCalls.length === 0) {
            // False positive - no valid tool calls found
            finalResponse = response;
            break;
        }

        console.log(`[InferenceWithTools] 🔧 Found ${toolCalls.length} tool call(s):`, toolCalls);

        // Execute each tool call
        const toolResults: ChatMessage[] = [];

        for (const toolCall of toolCalls) {
            try {
                const startTime = Date.now();

                console.log(`[InferenceWithTools] 🔧 Executing tool: ${toolCall.name}`);
                console.log(`[InferenceWithTools]    Arguments:`, JSON.stringify(toolCall.arguments, null, 2));

                // Notify about tool execution
                if (onToolExecution) {
                    onToolExecution({
                        toolName: toolCall.name,
                        arguments: toolCall.arguments,
                    });
                }

                // Execute the tool
                const result = await mcpService.executeTool(toolCall);
                const executionTimeMs = Date.now() - startTime;

                console.log(`[InferenceWithTools] ✅ Tool ${toolCall.name} executed in ${executionTimeMs}ms`);
                console.log(`[InferenceWithTools]    Result preview: ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}`);

                // Notify about result
                if (onToolExecution) {
                    onToolExecution({
                        toolName: toolCall.name,
                        arguments: toolCall.arguments,
                        result: result.content,
                        error: result.isError ? result.content : undefined,
                        executionTimeMs,
                    });
                }

                // Create tool result message
                const toolResultMessage: ChatMessage = {
                    id: `tool-result-${Date.now()}-${toolCall.id}`,
                    role: MessageRole.User, // Tool results come back as user messages
                    content: formatToolResult(toolCall.name, result.content, result.isError),
                    timestamp: Date.now(),
                };

                toolResults.push(toolResultMessage);
            } catch (error) {
                console.error(`[InferenceWithTools] Tool execution error:`, error);

                const errorMessage: ChatMessage = {
                    id: `tool-error-${Date.now()}-${toolCall.id}`,
                    role: MessageRole.User,
                    content: formatToolResult(
                        toolCall.name,
                        `Error: ${error instanceof Error ? error.message : String(error)}`,
                        true
                    ),
                    timestamp: Date.now(),
                };

                toolResults.push(errorMessage);

                if (onToolExecution) {
                    onToolExecution({
                        toolName: toolCall.name,
                        arguments: toolCall.arguments,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }

        // Add assistant's tool call message to history
        const assistantMessage: ChatMessage = {
            ...response.message,
            // Remove tool call tags from display content
            content: removeToolCallTags(response.message.content) || '(Using tools...)',
        };

        // Prepare next iteration with updated conversation history
        currentRequest = {
            ...currentRequest,
            messages: [
                ...currentRequest.messages,
                assistantMessage,
                ...toolResults,
            ],
        };

        // Continue the loop to get LLM's next response
    }

    if (!finalResponse) {
        throw new Error('Maximum tool calling iterations reached');
    }

    return finalResponse;
}
