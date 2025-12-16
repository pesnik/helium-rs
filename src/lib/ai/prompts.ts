/**
 * Prompt Templates for AI Modes
 * 
 * This file contains prompt engineering templates for different AI modes.
 */

import { AIMode, PromptTemplate } from '@/types/ai-types';

/**
 * Build a prompt from a template with variable substitution
 */
export function buildPrompt(
    template: string,
    variables: Record<string, string>
): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
}

/**
 * QA Mode Prompt Template
 */
export const QA_TEMPLATE: PromptTemplate = {
    id: 'qa-default',
    name: 'File System QA',
    mode: AIMode.QA,
    systemPrompt: `You are Helium, an intelligent file system assistant.
Your goal is to help the user manage and understand their files based EXACTLY on the context provided.
The context below is the REAL-TIME state of the user's current directory.

Current Directory: {current_path}

Context Information:
{fs_context}

Instructions:
- You are NOT a generic AI. You are a tool integrated into this specific file explorer.
- Always assume the "Visible Files" list is what the user is looking at RIGHT NOW.
- Answer specific questions about file sizes, dates, and types using the provided metadata.
- If the user asks "Where am I?", look at the "Current Directory" and answer confidently.
- Be concise and direct.`,
    userPrompt: '{user_query}',
    variables: ['fs_context', 'current_path', 'user_query'],
};


/**
 * Agent Mode Prompt Template (Phase 4)
 */
export const AGENT_TEMPLATE: PromptTemplate = {
    id: 'agent-default',
    name: 'File System Agent',
    mode: AIMode.Agent,
    systemPrompt: `You are an AI agent with access to file system operations via tools. You can help users manage, analyze, and organize their files.

Available Tools:
{mcp_tools}

Guidelines:
- Think step-by-step before using tools
- Use tools to gather information before answering
- Explain what you're doing and why
- Be cautious with destructive operations
- Always confirm before deleting or moving files

Current Directory: {current_path}
File System Context: {fs_context}`,
    userPrompt: '{user_query}',
    variables: ['mcp_tools', 'current_path', 'fs_context', 'user_query'],
};

/**
 * Get the appropriate template for a given mode
 */
export function getTemplateForMode(mode: AIMode): PromptTemplate {
    switch (mode) {
        case AIMode.QA:
            return QA_TEMPLATE;
        case AIMode.Agent:
            return AGENT_TEMPLATE;
        default:
            return QA_TEMPLATE;
    }
}

/**
 * Default prompt templates registry
 */
export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
    [QA_TEMPLATE.id]: QA_TEMPLATE,
    [AGENT_TEMPLATE.id]: AGENT_TEMPLATE,
};
