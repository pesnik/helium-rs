// AI Commands - Tauri Commands for AI/LLM Operations

use crate::ai::{
    providers::{
        get_ollama_models, get_ollama_status, get_openai_compatible_status,
        run_ollama_inference, run_openai_compatible_inference,
        get_candle_status, run_candle_inference, download_embedded_model, check_candle_availability
    },
    InferenceRequest, InferenceResponse, ModelConfig, ModelProvider, ProviderStatus,
};
use tauri::{command, Emitter, State};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

// Global state to track active inference sessions
pub struct InferenceState {
    pub active_sessions: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl Default for InferenceState {
    fn default() -> Self {
        Self {
            active_sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Get status of all AI providers
#[command]
pub async fn get_ai_providers_status(ollama_endpoint: Option<String>) -> Result<Vec<ProviderStatus>, String> {
    let mut statuses = Vec::new();

    // Check Ollama with provided endpoint
    statuses.push(get_ollama_status(ollama_endpoint.as_deref()).await);

    // Check Candle (Embedded)
    statuses.push(get_candle_status().await);

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
        "candle" => {
            let status = get_candle_status().await;
            Ok(status.available_models)
        }
        "transformerjs" => {
            // Return hardcoded list of Transformer.js models
            // These are defined in the frontend
            Ok(vec![])
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Cancel an ongoing inference request
#[command]
pub async fn cancel_inference(
    session_id: String,
    state: State<'_, InferenceState>,
) -> Result<(), String> {
    let mut sessions = state.active_sessions.lock().unwrap();
    if let Some(token) = sessions.remove(&session_id) {
        token.cancel();
        Ok(())
    } else {
        // Session not found means it already completed - this is still success from user's perspective
        Ok(())
    }
}

/// Run AI inference
#[command]
pub async fn run_ai_inference(
    window: tauri::Window,
    request: InferenceRequest,
    state: State<'_, InferenceState>,
) -> Result<InferenceResponse, String> {
    // Create cancellation token for this session
    let cancel_token = CancellationToken::new();
    let session_id = request.session_id.clone();

    // Register the session
    {
        let mut sessions = state.active_sessions.lock().unwrap();
        sessions.insert(session_id.clone(), cancel_token.clone());
    }

    // Run inference with cancellation support
    let result = match request.model_config.provider {
        ModelProvider::Ollama => run_ollama_inference(window, &request, cancel_token.clone())
            .await
            .map_err(|e| e.message),
        ModelProvider::Candle => run_candle_inference(window, &request)
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
    };

    // Cleanup: remove session from active sessions
    {
        let mut sessions = state.active_sessions.lock().unwrap();
        sessions.remove(&session_id);
    }

    result
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
        "candle" => {
            Ok(check_candle_availability().await)
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

/// Download the embedded model (streaming progress)
#[command]
pub async fn download_model(window: tauri::Window, model_id: String) -> Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);
    
    // Spawn background task
    tokio::spawn(async move {
        while let Some(status) = rx.recv().await {
            let _ = window.emit("model-download-progress", status);
        }
    });

    download_embedded_model(model_id, tx).await
}
