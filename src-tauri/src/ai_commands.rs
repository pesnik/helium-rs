// AI Commands - Tauri Commands for AI/LLM Operations

use crate::ai::{
    providers::{
        get_ollama_models, get_ollama_status, get_openai_compatible_status,
        run_ollama_inference, run_openai_compatible_inference,
    },
    InferenceRequest, InferenceResponse, ModelConfig, ModelProvider, ProviderStatus,
};
use tauri::command;

/// Get status of all AI providers
#[command]
pub async fn get_ai_providers_status() -> Result<Vec<ProviderStatus>, String> {
    let mut statuses = Vec::new();

    // Check Ollama
    statuses.push(get_ollama_status(None).await);

    // TransformerJS runs in browser, so we don't check it here
    // OpenAI-compatible requires user configuration, so we skip it

    Ok(statuses)
}

/// Get available models for a specific provider
#[command]
pub async fn get_provider_models(
    provider: String,
    endpoint: Option<String>,
) -> Result<Vec<ModelConfig>, String> {
    match provider.as_str() {
        "ollama" => get_ollama_models(endpoint.as_deref())
            .await
            .map_err(|e| e.message),
        "transformerjs" => {
            // Return hardcoded list of Transformer.js models
            // These are defined in the frontend
            Ok(vec![])
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Run AI inference
#[command]
pub async fn run_ai_inference(request: InferenceRequest) -> Result<InferenceResponse, String> {
    match request.model_config.provider {
        ModelProvider::Ollama => run_ollama_inference(&request)
            .await
            .map_err(|e| e.message),
        ModelProvider::OpenAICompatible => run_openai_compatible_inference(&request)
            .await
            .map_err(|e| e.message),
        ModelProvider::TransformerJS => {
            // TransformerJS runs in the browser, not in Rust
            Err("TransformerJS inference should run in the browser".to_string())
        }
        _ => Err("Provider not yet implemented".to_string()),
    }
}

/// Check if a specific provider is available
#[command]
pub async fn check_provider_availability(
    provider: String,
    endpoint: Option<String>,
) -> Result<bool, String> {
    match provider.as_str() {
        "ollama" => {
            let status = get_ollama_status(endpoint.as_deref()).await;
            Ok(status.is_available)
        }
        "openai-compatible" => {
            if let Some(ep) = endpoint {
                let status = get_openai_compatible_status(&ep, None).await;
                Ok(status.is_available)
            } else {
                Ok(false)
            }
        }
        _ => Ok(false),
    }
}
