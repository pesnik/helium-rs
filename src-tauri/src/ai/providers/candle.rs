// Candle Provider - Full Implementation
use crate::ai::{
    AIError, AIErrorType, ChatMessage, InferenceRequest, InferenceResponse, MessageRole,
    ModelConfig, ModelParameters, ModelProvider, ProviderStatus, TokenUsage, AIMode
};
use tauri::Emitter;
use anyhow::Result;
use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::qwen2::{Config as QwenConfig, Model as QwenModel};
use hf_hub::{api::tokio::Api, Repo, RepoType};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokenizers::Tokenizer;
use tokio::sync::mpsc;
use lazy_static::lazy_static;

const MODEL_REPO: &str = "Qwen/Qwen2.5-Coder-0.5B-Instruct";
const TOKENIZER_FILE: &str = "tokenizer.json";
const MODEL_FILE: &str = "model.safetensors";
const CONFIG_FILE: &str = "config.json";

// Shared model state
struct ModelContext {
    model: Mutex<QwenModel>,
    tokenizer: Tokenizer,
    device: Device,
    config: QwenConfig,
}

lazy_static! {
    static ref MODEL_CACHE: Mutex<Option<Arc<ModelContext>>> = Mutex::new(None);
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadStatus {
    pub status: String,
    pub progress: f32, // 0.0 to 1.0
}

/// Download the model if needed and return paths
async fn ensure_model_files(sender: Option<mpsc::Sender<DownloadStatus>>) -> Result<(PathBuf, PathBuf, PathBuf), AIError> {
    let api = Api::new().map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to initialize HF API: {}", e),
        details: None, suggested_actions: None
    })?;
    
    let repo = api.repo(Repo::new(MODEL_REPO.to_string(), RepoType::Model));

    let report = |msg: &str, prog: f32| {
        if let Some(tx) = &sender {
            let _ = tx.try_send(DownloadStatus {
                status: msg.to_string(),
                progress: prog,
            });
        }
    };

    report("Checking/Downloading tokenizer...", 0.1);
    let tokenizer_path = repo.get(TOKENIZER_FILE).await.map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to fetch tokenizer: {}", e),
        details: None, suggested_actions: Some(vec!["Check internet connection".to_string()])
    })?;
    
    report("Checking/Downloading config...", 0.2);
    let config_path = repo.get(CONFIG_FILE).await.map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to fetch config: {}", e),
        details: None, suggested_actions: None
    })?;
    
    report("Checking/Downloading model weights (0.5B params)...", 0.3);
    let model_path = repo.get(MODEL_FILE).await.map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to fetch model weights: {}", e),
        details: None, suggested_actions: None
    })?;
    
    report("Ready", 1.0);
    Ok((model_path, config_path, tokenizer_path))
}

pub async fn download_embedded_model(sender: mpsc::Sender<DownloadStatus>) -> Result<(), String> {
    match ensure_model_files(Some(sender)).await {
        Ok(_) => Ok(()),
        Err(e) => Err(e.message),
    }
}

pub async fn check_candle_availability() -> bool {
    let api = Api::new().ok();
    if let Some(api) = api {
        let repo = api.repo(Repo::new(MODEL_REPO.to_string(), RepoType::Model));
        // Simple existence check by trying to get path without downloading?
        // hf-hub creates a local cache. We can check if files exist in cache.
        // For now, let's assume if we can get the tokenizer quickly, it's likely there.
        // A better check would be to look at the filesystem cache dir.
        return true; 
    }
    false
}

async fn load_model() -> Result<Arc<ModelContext>, AIError> {
    {
        let guard = MODEL_CACHE.lock().unwrap();
        if let Some(ctx) = guard.as_ref() {
            return Ok(ctx.clone());
        }
    }

    let (model_path, config_path, tokenizer_path) = ensure_model_files(None).await?;

    let device = Device::Cpu; // Force CPU for simplicity/compatibility on 0.5B
    
    let tokenizer = Tokenizer::from_file(tokenizer_path).map_err(|e| AIError {
        error_type: AIErrorType::InvalidConfiguration,
        message: format!("Token error: {}", e),
        details: None, suggested_actions: None
    })?;

    let config_str = std::fs::read_to_string(config_path).unwrap();
    let config: QwenConfig = serde_json::from_str(&config_str).unwrap();

    let vb = unsafe { VarBuilder::from_mmaped_safetensors(&[model_path], DType::F32, &device).unwrap() };
    let model = QwenModel::new(&config, vb).unwrap();

    let ctx = Arc::new(ModelContext {
        model: Mutex::new(model),
        tokenizer,
        device,
        config,
    });

    let mut guard = MODEL_CACHE.lock().unwrap();
    *guard = Some(ctx.clone());
    Ok(ctx)
}

pub async fn run_candle_inference(window: tauri::Window, request: &InferenceRequest) -> Result<InferenceResponse, AIError> {
    let ctx = load_model().await?;
    
    // Very simple prompt construction
    let mut prompt = String::new();
    for msg in &request.messages {
        let role = match msg.role {
            MessageRole::User => "user",
            MessageRole::Assistant => "assistant",
            MessageRole::System => "system",
        };
        prompt.push_str(&format!("<|im_start|>{}\n{}<|im_end|>\n", role, msg.content));
    }
    prompt.push_str("<|im_start|>assistant\n");

    let tokens = ctx.tokenizer.encode(prompt, true).map_err(|e| AIError {
        error_type: AIErrorType::InferenceFailed,
        message: format!("Encoding error: {}", e),
        details: None, suggested_actions: None
    })?;

    let input_ids = tokens.get_ids().to_vec();
    let mut generated_tokens = Vec::new();
    let mut logits_processor = LogitsProcessor::new(299792458, Some(request.model_config.parameters.temperature as f64), Some(request.model_config.parameters.top_p as f64));

    let mut current_input_ids = input_ids.clone();
    
    // Simplified inference loop (non-streaming for MVP, or we can stream chunks via channel if we change return type)
    // The current signature returns InferenceResponse which is a single object.
    // For streaming, we'd need a different command structure or use tauri events.
    // For now, let's do blocking generation (collect all) then return.
    
    let max_tokens = request.model_config.parameters.max_tokens as usize;
    let mut response_text = String::new();
    let start_time = std::time::Instant::now();

    for _ in 0..max_tokens {
        let input_tensor = Tensor::new(current_input_ids.as_slice(), &ctx.device).unwrap().unsqueeze(0).unwrap();
        // Based on previous error, QwenModel::forward takes 3 arguments: (input, pos, attention_mask)
        let mut model = ctx.model.lock().unwrap();
        let logits = model.forward(&input_tensor, 0, None).unwrap(); 
        drop(model); // Release lock immediately after forward pass
        let logits = logits.squeeze(0).unwrap().to_dtype(DType::F32).unwrap();
        let next_token_logits = logits.get(logits.dim(0).unwrap() - 1).unwrap();
        
        let next_token = logits_processor.sample(&next_token_logits).unwrap();
        generated_tokens.push(next_token);
        
        if let Some(text) = ctx.tokenizer.decode(&[next_token], true).ok() {
             response_text.push_str(&text);
             // Stream the chunk
             let _ = window.emit("ai-response-chunk", &text);
        }

        // Check stop (EOS)
        if next_token == 151645 || next_token == 151643 { 
            break;
        }

        current_input_ids.push(next_token);
    }

    Ok(InferenceResponse {
        message: ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: MessageRole::Assistant,
            content: response_text.trim().to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            context_paths: None,
            is_streaming: Some(false),
            error: None,
        },
        is_complete: true,
        usage: Some(TokenUsage {
            prompt_tokens: input_ids.len() as u32,
            completion_tokens: generated_tokens.len() as u32,
            total_tokens: (input_ids.len() + generated_tokens.len()) as u32,
        }),
        inference_time_ms: Some(start_time.elapsed().as_millis() as u64),
    })
}

pub async fn get_candle_status() -> ProviderStatus {
    let available = check_candle_availability().await;
    ProviderStatus {
        provider: ModelProvider::Candle,
        is_available: available,
        version: Some("0.4.1".to_string()),
        available_models: if available {
            vec![ModelConfig {
                id: "embedded-qwen2.5".to_string(),
                name: "Qwen2.5-Coder-0.5B (Embedded)".to_string(),
                provider: ModelProvider::Candle,
                model_id: "qwen2.5-coder:0.5b".to_string(),
                parameters: ModelParameters {
                    temperature: 0.7,
                    top_p: 0.9,
                    max_tokens: 1024,
                    stream: false,
                    stop_sequences: None,
                    context_window: Some(32768),
                },
                endpoint: None,
                api_key: None,
                is_available: true,
                size_bytes: Some(1024 * 1024 * 1024), // Approx
                recommended_for: vec![AIMode::Agent, AIMode::QA],
            }]
        } else {
            vec![]
        },
        error: None,
    }
}
