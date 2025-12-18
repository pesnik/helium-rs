/**
 * Tool Calling Utilities
 *
 * Utilities for detecting and parsing tool calls from LLM responses.
 */

import { ToolCall } from '@/types/ai-types';

/**
 * Detect if a message contains a tool call (XML format or raw JSON format)
 */
export function detectToolCall(content: string): boolean {
    // Check for XML-wrapped tool calls
    const hasXmlToolCall = content.includes('<tool_call>') && content.includes('</tool_call>');
    if (hasXmlToolCall) return true;

    // Check for raw JSON tool calls (fallback for models that don't follow XML format)
    // Look for patterns like: { "id": "call_X", "name": "tool_name", "arguments": {...} }
    const rawJsonPattern = /\{\s*"id"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{/;
    return rawJsonPattern.test(content);
}

/**
 * Extract tool calls from LLM response
 * Supports:
 * 1. XML-style tags: <tool_call>...</tool_call>
 * 2. Raw JSON format (fallback for models that don't follow XML format)
 */
export function extractToolCalls(content: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    console.log('[ToolCalling] Extracting tool calls from content:');
    console.log('[ToolCalling] Content length:', content.length);
    console.log('[ToolCalling] Content preview:', content.substring(0, 300));

    // First, try to extract XML-wrapped tool calls
    const xmlRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match;

    while ((match = xmlRegex.exec(content)) !== null) {
        try {
            let jsonContent = match[1].trim();

            console.log('[ToolCalling] XML format - Raw JSON content:', jsonContent);

            // Try to extract just the JSON object if there's extra text
            const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                jsonContent = jsonMatch[0];
            }

            console.log('[ToolCalling] XML format - Cleaned JSON:', jsonContent);

            const parsed = JSON.parse(jsonContent);

            console.log('[ToolCalling] XML format - Parsed tool call:', parsed);

            // Validate required fields
            if (parsed.name && parsed.arguments) {
                toolCalls.push({
                    id: parsed.id || `call_${Date.now()}_${toolCalls.length}`,
                    name: parsed.name,
                    arguments: parsed.arguments,
                });
                console.log('[ToolCalling] ✅ Valid tool call added (XML):', parsed.name);
            } else {
                console.warn('[ToolCalling] ⚠️ Tool call missing required fields:', parsed);
            }
        } catch (error) {
            console.error('[ToolCalling] ❌ Failed to parse XML tool call:', error);
            console.error('[ToolCalling] Content that failed:', match[1]);
        }
    }

    // If no XML tool calls found, try to extract raw JSON tool calls
    if (toolCalls.length === 0) {
        console.log('[ToolCalling] No XML tool calls found, trying raw JSON format...');

        // Match raw JSON objects with id, name, and arguments fields
        // This handles cases where the LLM outputs tool calls without XML wrappers
        // Use a more robust approach: find all JSON-like objects and validate them
        const jsonObjectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
        const matches = content.match(jsonObjectRegex);

        if (matches) {
            for (const potentialJson of matches) {
                try {
                    const parsed = JSON.parse(potentialJson);

                    // Check if it's a valid tool call (has id, name, and arguments)
                    if (parsed.id && parsed.name && parsed.arguments &&
                        typeof parsed.id === 'string' &&
                        typeof parsed.name === 'string' &&
                        typeof parsed.arguments === 'object') {

                        console.log('[ToolCalling] Raw JSON format - Found valid tool call:', potentialJson);
                        console.log('[ToolCalling] Raw JSON format - Parsed:', parsed);

                        toolCalls.push({
                            id: parsed.id,
                            name: parsed.name,
                            arguments: parsed.arguments,
                        });
                        console.log('[ToolCalling] ✅ Valid tool call added (raw JSON):', parsed.name);
                    }
                } catch (error) {
                    // Not valid JSON or not a tool call, skip silently
                }
            }
        }
    }

    console.log(`[ToolCalling] Total tool calls extracted: ${toolCalls.length}`);
    return toolCalls;
}

/**
 * Remove tool call tags from content (for display)
 * Removes both XML-wrapped tool calls and raw JSON tool calls
 */
export function removeToolCallTags(content: string): string {
    // Remove XML-wrapped tool calls
    let cleaned = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '');

    // Remove raw JSON tool calls (fallback for models that don't follow XML format)
    // This prevents raw JSON from being shown to the user
    const jsonObjectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    const matches = cleaned.match(jsonObjectRegex);

    if (matches) {
        for (const potentialJson of matches) {
            try {
                const parsed = JSON.parse(potentialJson);

                // If it's a tool call (has id, name, and arguments), remove it
                if (parsed.id && parsed.name && parsed.arguments &&
                    typeof parsed.id === 'string' &&
                    typeof parsed.name === 'string' &&
                    typeof parsed.arguments === 'object') {
                    // Escape special regex characters in the JSON string
                    const escapedJson = potentialJson.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    cleaned = cleaned.replace(new RegExp(escapedJson, 'g'), '');
                }
            } catch (error) {
                // Not valid JSON, skip
            }
        }
    }

    return cleaned.trim();
}

/**
 * Format tool result for LLM
 */
export function formatToolResult(toolName: string, result: string, isError: boolean): string {
    if (isError) {
        return `<tool_result name="${toolName}" error="true">
${result}
</tool_result>`;
    }

    return `<tool_result name="${toolName}">
${result}
</tool_result>`;
}

/**
 * Check if content has tool result tags
 */
export function hasToolResult(content: string): boolean {
    return content.includes('<tool_result') && content.includes('</tool_result>');
}
