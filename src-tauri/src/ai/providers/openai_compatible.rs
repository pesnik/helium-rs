// OpenAI-Compatible Provider
//
// Generic client for OpenAI-compatible APIs (vLLM, LocalAI, LM Studio, etc.)

use crate::ai::{
    AIError, AIErrorType, ChatMessage, InferenceRequest, InferenceResponse, MessageRole,
    ModelConfig, ModelProvider, ProviderStatus, TokenUsage,
};
use reqwest;
use serde::{Deserialize, Serialize};
use std::time::Instant;

/// OpenAI chat request format
#[derive(Debug, Serialize)]
struct OpenAIChatRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f32,
    top_p: f32,
    max_tokens: u32,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

/// OpenAI chat response format
#[derive(Debug, Deserialize)]
struct OpenAIChatResponse {
    id: String,
    choices: Vec<OpenAIChoice>,
    usage: Option<OpenAIUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIMessage,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAIUsage {
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
}

/// Run inference with OpenAI-compatible API
pub async fn run_openai_compatible_inference(
    request: &InferenceRequest,
) -> Result<InferenceResponse, AIError> {
    let start_time = Instant::now();

    let endpoint = request.model_config.endpoint.as_ref().ok_or_else(|| AIError {
        error_type: AIErrorType::InvalidConfiguration,
        message: "No endpoint configured for OpenAI-compatible provider".to_string(),
        details: None,
        suggested_actions: Some(vec!["Configure endpoint in model settings".to_string()]),
    })?;

    // Support both with and without /v1 prefix
    // If endpoint already ends with /v1, use it as-is
    let url = if endpoint.ends_with("/v1") || endpoint.contains("/v1/") {
        format!("{}/chat/completions", endpoint.trim_end_matches('/'))
    } else {
        format!("{}/v1/chat/completions", endpoint.trim_end_matches('/'))
    };

    // Convert messages to OpenAI format
    // Handle system messages specially - merge them into first user message
    // This ensures roles alternate (user/assistant/user/assistant) as required by llama-server
    let mut openai_messages: Vec<OpenAIMessage> = Vec::new();
    let mut system_prompts: Vec<String> = Vec::new();

    for m in request.messages.iter() {
        match m.role {
            MessageRole::System => {
                // Collect system messages
                system_prompts.push(m.content.clone());
            }
            MessageRole::User => {
                // If this is the first user message and we have system prompts, prepend them
                let mut content = String::new();
                if !system_prompts.is_empty() && openai_messages.is_empty() {
                    // This is the first user message - prepend system prompts
                    content.push_str(&system_prompts.join("\n\n"));
                    content.push_str("\n\n---\n\n");
                    system_prompts.clear(); // Clear after using
                }
                content.push_str(&m.content);
                openai_messages.push(OpenAIMessage {
                    role: "user".to_string(),
                    content,
                });
            }
            MessageRole::Assistant => {
                openai_messages.push(OpenAIMessage {
                    role: "assistant".to_string(),
                    content: m.content.clone(),
                });
            }
        }
    }

    let openai_request = OpenAIChatRequest {
        model: request.model_config.model_id.clone(),
        messages: openai_messages,
        temperature: request.model_config.parameters.temperature,
        top_p: request.model_config.parameters.top_p,
        max_tokens: request.model_config.parameters.max_tokens,
        stream: false,
        stop: request.model_config.parameters.stop_sequences.clone(),
    };

    let mut client_builder = reqwest::Client::builder();
    let client = client_builder.build().map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to create HTTP client: {}", e),
        details: None,
        suggested_actions: None,
    })?;

    let mut request_builder = client.post(&url).json(&openai_request);

    // Add API key if provided
    if let Some(api_key) = &request.model_config.api_key {
        request_builder = request_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let response = request_builder.send().await.map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to send request: {}", e),
        details: None,
        suggested_actions: Some(vec![
            "Check the endpoint URL".to_string(),
            "Verify the server is running".to_string(),
        ]),
    })?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(AIError {
            error_type: AIErrorType::InferenceFailed,
            message: format!("API returned error: {} - {}", status, error_text),
            details: None,
            suggested_actions: Some(vec![
                "Check API key if required".to_string(),
                "Verify model name".to_string(),
            ]),
        });
    }

    let openai_response: OpenAIChatResponse = response.json().await.map_err(|e| AIError {
        error_type: AIErrorType::InferenceFailed,
        message: format!("Failed to parse response: {}", e),
        details: None,
        suggested_actions: None,
    })?;

    let inference_time_ms = start_time.elapsed().as_millis() as u64;

    let choice = openai_response.choices.first().ok_or_else(|| AIError {
        error_type: AIErrorType::InferenceFailed,
        message: "No response choices returned".to_string(),
        details: None,
        suggested_actions: None,
    })?;

    let response_message = ChatMessage {
        id: format!("msg-{}", chrono::Utc::now().timestamp_millis()),
        role: MessageRole::Assistant,
        content: choice.message.content.clone(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        context_paths: None,
        is_streaming: None,
        error: None,
    };

    let usage = openai_response.usage.map(|u| TokenUsage {
        prompt_tokens: u.prompt_tokens,
        completion_tokens: u.completion_tokens,
        total_tokens: u.total_tokens,
    });

    Ok(InferenceResponse {
        message: response_message,
        is_complete: choice.finish_reason.is_some(),
        usage,
        inference_time_ms: Some(inference_time_ms),
    })
}

/// Check if OpenAI-compatible endpoint is available
pub async fn check_openai_compatible_availability(endpoint: &str) -> Result<bool, AIError> {
    // Support both with and without /v1 prefix
    let url = if endpoint.ends_with("/v1") || endpoint.contains("/v1/") {
        format!("{}/models", endpoint.trim_end_matches('/'))
    } else {
        format!("{}/v1/models", endpoint.trim_end_matches('/'))
    };

    match reqwest::get(&url).await {
        Ok(response) => Ok(response.status().is_success()),
        Err(_) => Ok(false),
    }
}

/// Get OpenAI-compatible provider status
pub async fn get_openai_compatible_status(
    endpoint: &str,
    api_key: Option<&str>,
) -> ProviderStatus {
    let is_available = check_openai_compatible_availability(endpoint)
        .await
        .unwrap_or(false);

    // For OpenAI-compatible, we can't easily list models without more info
    // User will need to manually configure models
    let available_models = vec![];

    let error = if !is_available {
        Some(format!("Cannot connect to endpoint: {}", endpoint))
    } else {
        None
    };

    ProviderStatus {
        provider: ModelProvider::OpenAICompatible,
        is_available,
        version: None,
        available_models,
        error,
    }
}
