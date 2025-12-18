/**
 * Inference with Tool Calling Support
 *
 * Wrapper around AI inference that handles tool calling loop.
 */

import { InferenceRequest, InferenceResponse, ChatMessage, MessageRole, ToolExecutionData } from '@/types/ai-types';
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
    const allToolExecutions: ToolExecutionData[] = []; // Track all tool executions

    while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        console.log(`[InferenceWithTools] Iteration ${iterations}/${MAX_TOOL_ITERATIONS}`);

        // Run inference
        const response = await runInference(currentRequest, onChunk, onProgress);

        console.log(`[InferenceWithTools] Response content preview:`, response.message.content.substring(0, 200));

        // Check for native tool calls first (OpenAI format in response.message.toolCalls)
        let toolCalls: any[] = [];

        if (response.message.toolCalls && response.message.toolCalls.length > 0) {
            // Native function calling - convert OpenAI format to our internal format
            console.log(`[InferenceWithTools] Found ${response.message.toolCalls.length} native tool calls`);
            toolCalls = response.message.toolCalls.map((tc: any) => ({
                id: tc.id,
                name: tc.function.name,
                arguments: JSON.parse(tc.function.arguments), // OpenAI returns arguments as JSON string
            }));
        } else {
            // Fallback to prompt-based tool calling (XML/JSON in content)
            const hasToolCalls = detectToolCall(response.message.content);
            console.log(`[InferenceWithTools] Has prompt-based tool calls:`, hasToolCalls);

            if (!hasToolCalls) {
                // No tool calls - we're done
                console.log(`[InferenceWithTools] No tool calls detected, finishing`);
                finalResponse = response;
                break;
            }

            // Extract tool calls from content
            toolCalls = extractToolCalls(response.message.content);
        }

        console.log(`[InferenceWithTools] Extracted ${toolCalls.length} tool calls`);

        if (toolCalls.length === 0) {
            // False positive - no valid tool calls found
            console.log(`[InferenceWithTools] Tool call tags found but extraction failed`);
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

                // Create tool execution data (executing status)
                const toolExecution: ToolExecutionData = {
                    toolName: toolCall.name,
                    arguments: toolCall.arguments,
                    status: 'executing',
                };

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
                console.log(`[InferenceWithTools]    Result length: ${result.content.length} characters`);
                console.log(`[InferenceWithTools]    Result preview: ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}`);

                // Log full result for debugging (useful when inspecting tool responses)
                if (result.content.length < 1000) {
                    console.log(`[InferenceWithTools]    Full result:`, result.content);
                } else {
                    console.log(`[InferenceWithTools]    Full result (first 1000 chars):`, result.content.substring(0, 1000) + '...');
                }

                // Update tool execution data (success status)
                toolExecution.status = result.isError ? 'error' : 'success';
                toolExecution.result = result.content;
                toolExecution.executionTimeMs = executionTimeMs;
                if (result.isError) {
                    toolExecution.error = result.content;
                }

                // Add to all executions
                allToolExecutions.push(toolExecution);

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

                // Create tool execution data (error status)
                const toolExecution: ToolExecutionData = {
                    toolName: toolCall.name,
                    arguments: toolCall.arguments,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error),
                };
                allToolExecutions.push(toolExecution);

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

    // Attach all tool executions to the final response message
    if (allToolExecutions.length > 0) {
        finalResponse.message.toolExecutions = allToolExecutions;
    }

    return finalResponse;
}
