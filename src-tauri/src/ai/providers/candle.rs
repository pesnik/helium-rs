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

// Model definition for configurable models
#[derive(Clone)]
struct ModelDefinition {
    repo: &'static str,
    model_files: Vec<&'static str>,
    tokenizer_file: &'static str,
    config_file: &'static str,
    eos_tokens: Vec<u32>,
    prompt_format: PromptFormat,
}

#[derive(Clone)]
enum PromptFormat {
    ChatML,  // <|im_start|>role\ncontent<|im_end|>
    Instruct, // Instruct: ... Output:
}

// Registry of supported models
fn get_model_registry() -> std::collections::HashMap<&'static str, ModelDefinition> {
    let mut registry = std::collections::HashMap::new();
    
    // Qwen1.5-0.5B - Smallest (~500MB)
    registry.insert("qwen1.5:0.5b", ModelDefinition {
        repo: "Qwen/Qwen1.5-0.5B-Chat",
        model_files: vec!["model.safetensors"],
        tokenizer_file: "tokenizer.json",
        config_file: "config.json",
        eos_tokens: vec![151645, 151643],
        prompt_format: PromptFormat::ChatML,
    });
    
    // Phi-2 - Best quality (~2.7GB)
    registry.insert("phi-2", ModelDefinition {
        repo: "microsoft/phi-2",
        model_files: vec!["model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors"],
        tokenizer_file: "tokenizer.json",
        config_file: "config.json",
        eos_tokens: vec![50256],
        prompt_format: PromptFormat::Instruct,
    });
    
    // StableLM-2-1.6B - Middle ground (~3.3GB)
    registry.insert("stablelm-2-1.6b", ModelDefinition {
        repo: "stabilityai/stablelm-2-1_6b",
        model_files: vec!["model.safetensors"],
        tokenizer_file: "tokenizer.json",
        config_file: "config.json",
        eos_tokens: vec![0, 2],
        prompt_format: PromptFormat::ChatML,
    });
    
    registry
}



#[derive(Clone, serde::Serialize)]
pub struct DownloadStatus {
    pub status: String,
    pub progress: f32, // 0.0 to 1.0
}

/// Download the model if needed and return paths
async fn ensure_model_files(model_id: &str, sender: Option<mpsc::Sender<DownloadStatus>>) -> Result<(Vec<PathBuf>, PathBuf, PathBuf), AIError> {
    let registry = get_model_registry();
    let model_def = registry.get(model_id).ok_or_else(|| AIError {
        error_type: AIErrorType::InvalidConfiguration,
        message: format!("Unknown model ID: {}", model_id),
        details: None,
        suggested_actions: Some(vec!["Use a supported model ID".to_string()]),
    })?;
    let api = Api::new().map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to initialize HF API: {}", e),
        details: None, suggested_actions: None
    })?;
    
    println!("[Candle] Initializing HuggingFace API for model: {}", model_def.repo);
    let repo = api.repo(Repo::new(model_def.repo.to_string(), RepoType::Model));

    let report = |msg: &str, prog: f32| {
        if let Some(tx) = &sender {
            let _ = tx.try_send(DownloadStatus {
                status: msg.to_string(),
                progress: prog,
            });
        }
    };

    report("Checking/Downloading tokenizer...", 0.1);
    println!("[Candle] Fetching tokenizer: {}", model_def.tokenizer_file);
    let tokenizer_path = repo.get(model_def.tokenizer_file).await.map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to fetch tokenizer: {}", e),
        details: None, suggested_actions: Some(vec!["Check internet connection".to_string()])
    })?;
    
    report("Checking/Downloading config...", 0.2);
    println!("[Candle] Fetching config: {}", model_def.config_file);
    let config_path = repo.get(model_def.config_file).await.map_err(|e| AIError {
        error_type: AIErrorType::NetworkError,
        message: format!("Failed to fetch config: {}", e),
        details: None, suggested_actions: None
    })?;
    
    report("Downloading model weights...", 0.3);
    let mut model_paths = Vec::new();
    for (i, file) in model_def.model_files.iter().enumerate() {
        println!("[Candle] Fetching model file {}/{}: {}", i+1, model_def.model_files.len(), file);
        let path = repo.get(file).await.map_err(|e| AIError {
            error_type: AIErrorType::NetworkError,
            message: format!("Failed to fetch model file {}: {}", file, e),
            details: None, suggested_actions: None
        })?;
        model_paths.push(path);
    }
    
    report("Ready", 1.0);
    Ok((model_paths, config_path, tokenizer_path))
}

pub async fn download_embedded_model(model_id: String, sender: mpsc::Sender<DownloadStatus>) -> Result<(), String> {
    match ensure_model_files(&model_id, Some(sender)).await {
        Ok(_) => Ok(()),
        Err(e) => Err(e.message),
    }
}

pub async fn check_candle_availability() -> bool {
    // Just check if HF API is accessible
    Api::new().is_ok()
}



pub async fn run_candle_inference(window: tauri::Window, request: &InferenceRequest) -> Result<InferenceResponse, AIError> {
    // Extract model ID from request
    let model_id = &request.model_config.model_id;
    
    // Get model definition
    let registry = get_model_registry();
    let model_def = registry.get(model_id.as_str()).ok_or_else(|| AIError {
        error_type: AIErrorType::InvalidConfiguration,
        message: format!("Unknown model ID: {}", model_id),
        details: None,
        suggested_actions: Some(vec!["Select a supported embedded model".to_string()]),
    })?;
    
    // Download/get model files
    let (model_paths, config_path, tokenizer_path) = ensure_model_files(model_id, None).await?;
    let device = Device::Cpu;

    let tokenizer = Tokenizer::from_file(tokenizer_path).map_err(|e| AIError {
        error_type: AIErrorType::InvalidConfiguration,
        message: format!("Token error: {}", e),
        details: None, suggested_actions: None
    })?;

    let config_str = std::fs::read_to_string(config_path).unwrap();
    let config: QwenConfig = serde_json::from_str(&config_str).unwrap();

    // Create fresh model instance to ensure empty KV cache
    let model_path_refs: Vec<&PathBuf> = model_paths.iter().collect();
    let vb = unsafe { VarBuilder::from_mmaped_safetensors(&model_path_refs, DType::F32, &device).unwrap() };
    let mut model = QwenModel::new(&config, vb).unwrap();

    // Build prompt based on model's format
    let mut prompt = String::new();
    match model_def.prompt_format {
        PromptFormat::ChatML => {
            for msg in &request.messages {
                let role = match msg.role {
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                    MessageRole::System => "system",
                };
                prompt.push_str(&format!("<|im_start|>{}\n{}<|im_end|>\n", role, msg.content));
            }
            prompt.push_str("<|im_start|>assistant\n");
        },
        PromptFormat::Instruct => {
            for msg in &request.messages {
                match msg.role {
                    MessageRole::System => prompt.push_str(&format!("Instruct: {}\n", msg.content)),
                    MessageRole::User => prompt.push_str(&format!("Instruct: {}\n", msg.content)),
                    MessageRole::Assistant => prompt.push_str(&format!("Output: {}\n", msg.content)),
                }
            }
            prompt.push_str("Output:");
        },
    }

    let tokens = tokenizer.encode(prompt, true).map_err(|e| AIError {
        error_type: AIErrorType::InferenceFailed,
        message: format!("Encoding error: {}", e),
        details: None, suggested_actions: None
    })?;

    let mut input_ids = tokens.get_ids().to_vec();
    let mut generated_tokens = Vec::new();
    let mut logits_processor = LogitsProcessor::new(299792458, Some(request.model_config.parameters.temperature as f64), Some(request.model_config.parameters.top_p as f64));
    
    let start_time = std::time::Instant::now();
    let max_tokens = request.model_config.parameters.max_tokens as usize;
    let mut response_text = String::new();
    
    let mut pos = 0;

    for _ in 0..max_tokens {
        let (context_size, start_pos) = if pos == 0 {
            (input_ids.len(), 0)
        } else {
            (1, pos)
        };

        let ctxt = &input_ids[input_ids.len() - context_size..];
        let input_tensor = Tensor::new(ctxt, &device).unwrap().unsqueeze(0).unwrap();
        
        // Forward pass with correct position
        let logits = model.forward(&input_tensor, start_pos, None).unwrap();
        let logits = logits.squeeze(0).unwrap();
        let logits = logits.get(logits.dim(0).unwrap() - 1).unwrap().to_dtype(DType::F32).unwrap();

        let next_token = logits_processor.sample(&logits).unwrap();
        generated_tokens.push(next_token);
        input_ids.push(next_token);
        pos += context_size;

        if let Some(text) = tokenizer.decode(&[next_token], true).ok() {
             response_text.push_str(&text);
             let _ = window.emit("ai-response-chunk", &text);
        }

        // Check stop (EOS - use model's defined tokens)
        if model_def.eos_tokens.contains(&next_token) { 
            break;
        }
    }
    
    // ... return response ...
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
            prompt_tokens: (input_ids.len() - generated_tokens.len()) as u32,
            completion_tokens: generated_tokens.len() as u32,
            total_tokens: input_ids.len() as u32,
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
        // Models are now defined in frontend KNOWN_MODELS to avoid duplicates
        available_models: vec![],
        error: None,
    }
}
