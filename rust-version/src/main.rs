use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Local;
use log::{error, info, warn};
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, io};
use std::fs;
use std::sync::Arc;
use tokio::sync::Semaphore;
use std::process::Command;
use indicatif::{ProgressBar, ProgressStyle};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tracing_subscriber::FmtSubscriber;
use std::time::Duration;

#[derive(Debug, Deserialize, Serialize, Clone)]
struct Server {
    name: String,
    hostname: String,
    station: String,
    load: i32,
    country: String,
    city: String,
    latitude: f64,
    longitude: f64,
    public_key: String,
    distance: f64,
}

#[derive(Debug, Deserialize)]
struct Location {
    country: Country,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Deserialize)]
struct Country {
    name: String,
    city: Option<City>,
}

#[derive(Debug, Deserialize)]
struct City {
    name: String,
}

#[derive(Debug, Deserialize)]
struct Technology {
    identifier: String,
    metadata: Vec<Metadata>,
}

#[derive(Debug, Deserialize)]
struct Metadata {
    name: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct ServerResponse {
    name: String,
    hostname: String,
    station: String,
    load: Option<i32>,
    locations: Vec<Location>,
    technologies: Vec<Technology>,
}

#[derive(Debug)]
struct UserConfig {
    dns: String,
    use_ip: bool,
    keepalive: i32,
}

impl Default for UserConfig {
    fn default() -> Self {
        Self {
            dns: "103.86.96.100".to_string(),
            use_ip: false,
            keepalive: 25,
        }
    }
}

impl UserConfig {
    fn is_valid(&self) -> bool {
        self.dns.chars().all(|c| c.is_ascii_digit() || c == '.') &&
        self.keepalive >= 15 && self.keepalive <= 120
    }
}

#[derive(Debug, thiserror::Error)]
enum ConfigError {
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),
    #[error("IO error: {0}")]
    IoError(#[from] io::Error),
    #[error("Serde JSON error: {0}")]
    SerdeError(#[from] serde_json::Error),
    #[error("Access token error: {0}")]
    AccessTokenError(String),
    #[error("Input error: {0}")]
    InputError(String),
    #[error("Anyhow error: {0}")]
    AnyhowError(#[from] anyhow::Error),
}

impl From<String> for ConfigError {
    fn from(error: String) -> Self {
        ConfigError::InputError(error)
    }
}

struct SharedState {
    shutdown: AtomicBool,
    tasks_completed: Mutex<usize>,
    total_tasks: Mutex<usize>,
    cleanup_done: Mutex<bool>,  
}

impl SharedState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            shutdown: AtomicBool::new(false),
            tasks_completed: Mutex::new(0),
            total_tasks: Mutex::new(0),
            cleanup_done: Mutex::new(false),  
        })
    }
}

async fn get_location(client: &Client) -> Result<(f64, f64)> {
    let response = client
        .get("https://ipinfo.io/json")
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let loc = response["loc"]
        .as_str()
        .context("Failed to get location")?
        .split(',')
        .collect::<Vec<&str>>();

    if loc.len() != 2 {
        anyhow::bail!("Invalid location format");
    }

    Ok((
        loc[0].parse::<f64>()?,
        loc[1].parse::<f64>()?,
    ))
}

fn calculate_distance(ulat: f64, ulon: f64, slat: f64, slon: f64) -> f64 {
    let (ulon, ulat, slon, slat) = (
        ulon.to_radians(),
        ulat.to_radians(),
        slon.to_radians(),
        slat.to_radians(),
    );
    
    let dlon = slon - ulon;
    let dlat = slat - ulat;
    
    let a = (dlat / 2.0).sin().powi(2) + 
            ulat.cos() * slat.cos() * (dlon / 2.0).sin().powi(2);
    
    2.0 * ((a).sqrt().asin()) * 6371.0
}

fn is_valid_token(token: &str) -> bool {
    let re = Regex::new(r"^[a-fA-F0-9]{64}$").unwrap();
    re.is_match(token)
}

async fn get_private_key(client: &Client, token: &str) -> Result<String, ConfigError> {
    let token_encoded = STANDARD.encode(format!("token:{}", token));
    let response = client
        .get("https://api.nordvpn.com/v1/users/services/credentials")
        .header("Authorization", format!("Basic {}", token_encoded))
        .send()
        .await
        .map_err(|_| ConfigError::AccessTokenError("Failed to connect to NordVPN API".to_string()))?;

    if response.status() == 401 {
        return Err(ConfigError::AccessTokenError("Invalid access token".to_string()));
    }

    let data = response.json::<serde_json::Value>().await
        .map_err(|_| ConfigError::AccessTokenError("Failed to read API response".to_string()))?;

    data["nordlynx_private_key"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| ConfigError::AccessTokenError("Access token is not valid for WireGuard configuration".to_string()))
}

fn generate_config(key: &str, server: &Server, config: &UserConfig) -> String {
    let endpoint = if config.use_ip {
        &server.station
    } else {
        &server.hostname
    };

    format!(
        "[Interface]\n\
        PrivateKey = {}\n\
        Address = 10.5.0.2/16\n\
        DNS = {}\n\n\
        [Peer]\n\
        PublicKey = {}\n\
        AllowedIPs = 0.0.0.0/0, ::/0\n\
        Endpoint = {}:51820\n\
        PersistentKeepalive = {}",
        key, config.dns, server.public_key, endpoint, config.keepalive
    )
}

fn get_user_preferences() -> Result<UserConfig, ConfigError> {
    println!("\nConfiguration Options (press Enter to use defaults)");
    
    let mut config = UserConfig::default();
    
    if let Ok(input) = rprompt::prompt_reply("Enter DNS server IP (default: 103.86.96.100): ") {
        if !input.trim().is_empty() {
            config.dns = input;
        }
    }
    
    if let Ok(input) = rprompt::prompt_reply("Use IP instead of hostname for endpoints? (y/N): ") {
        config.use_ip = input.trim().to_lowercase() == "y";
    }
    
    if let Ok(input) = rprompt::prompt_reply("Enter PersistentKeepalive value (default: 25): ") {
        if let Ok(value) = input.trim().parse::<i32>() {
            if value >= 15 && value <= 120 {
                config.keepalive = value;
            }
        }
    }
    
    if !config.is_valid() {
        return Err(ConfigError::InputError("Invalid configuration values".to_string()));
    }
    
    Ok(config)
}

async fn get_servers(client: &Client) -> Result<Vec<ServerResponse>> {
    let response = client
        .get("https://api.nordvpn.com/v1/servers")
        .query(&[
            ("limit", "7000"),
            ("filters[servers_technologies][identifier]", "wireguard_udp"),
        ])
        .send()
        .await?
        .json::<Vec<ServerResponse>>()
        .await?;
    Ok(response)
}

async fn process_servers(
    servers: Vec<ServerResponse>,
    user_location: (f64, f64),
) -> Vec<Server> {
    let (ulat, ulon) = user_location;
    let mut processed_servers = Vec::new();

    for server in servers {
        if let Some(location) = server.locations.first() {
            if let Some(public_key) = server
                .technologies
                .iter()
                .find(|t| t.identifier == "wireguard_udp")
                .and_then(|t| t.metadata.iter().find(|m| m.name == "public_key"))
                .map(|m| m.value.clone())
            {
                let distance = calculate_distance(
                    ulat,
                    ulon,
                    location.latitude,
                    location.longitude,
                );

                processed_servers.push(Server {
                    name: server.name,
                    hostname: server.hostname,
                    station: server.station,
                    load: server.load.unwrap_or(100),
                    country: location.country.name.clone(),
                    city: location.country.city.as_ref().map_or(
                        "unknown".to_string(),
                        |c| c.name.clone(),
                    ),
                    latitude: location.latitude,
                    longitude: location.longitude,
                    public_key,
                    distance,
                });
            }
        }
    }

    processed_servers.sort_by(|a, b| {
        a.load.cmp(&b.load).then(a.distance.partial_cmp(&b.distance).unwrap())
    });
    processed_servers
}

fn clear_console() {
    if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "cls"]).status().unwrap();
    } else {
        Command::new("clear").status().unwrap();
    }
}

fn setup_logging() {
    FmtSubscriber::builder()
        .with_env_filter("info")
        .with_target(false)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .with_ansi(false)
        .with_timer(tracing_subscriber::fmt::time::ChronoUtc::rfc_3339())  // Fixed method name
        .with_level(true)
        .init();
}

fn setup_progress_bar(len: u64) -> ProgressBar {
    let pb = ProgressBar::new(len);
    pb.set_style(ProgressStyle::default_bar()
        .template("[{elapsed_precise}] [{bar:40}] {pos}/{len} ({eta})")
        .unwrap()
        .progress_chars("=> "));
    pb.enable_steady_tick(Duration::from_millis(100));
    pb
}

#[tokio::main]
async fn main() -> Result<(), ConfigError> {
    setup_logging();
    let state = SharedState::new();
    
    // Setup ctrl-c handler with improved cleanup
    let state_clone = Arc::clone(&state);
    ctrlc::set_handler(move || {
        let mut cleanup_done = state_clone.cleanup_done.lock();
        if !*cleanup_done {  
            state_clone.shutdown.store(true, Ordering::SeqCst);
            println!("\nReceived shutdown signal, cleaning up...");
            println!("Press Ctrl+C again to force exit");
            *cleanup_done = true;
        } else {
            println!("\nForce exiting...");
            std::process::exit(0);
        }
    }).expect("Error setting Ctrl-C handler");

    println!("\nNordVPN Configuration Generator");
    println!("==============================");
    
    let token = rprompt::prompt_reply("Please enter your access token (64 character hex string):\n")?;
    clear_console();  // Clear console immediately after token input
    
    if !is_valid_token(&token) {
        error!("Invalid token format");
        return Ok(());
    }

    let client = Client::new();
    
    info!("Validating access token");
    let private_key = match get_private_key(&client, &token).await {
        Ok(key) => {
            clear_console();
            info!("Access token validated successfully");
            key
        },
        Err(e) => {
            error!("{}", e);
            return Ok(());
        }
    };

    let user_config = get_user_preferences()?;
    
    let location = get_location(&client).await.map_err(ConfigError::AnyhowError)?;
    info!("Current location: {:?}", location);

    // Start timing here, just before the actual work begins
    let start_time = std::time::Instant::now();

    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let output_dir = PathBuf::from(format!("nordvpn_configs_{}", timestamp));
    fs::create_dir_all(&output_dir)?;
    
    fs::create_dir_all(output_dir.join("configs"))?;
    fs::create_dir_all(output_dir.join("best_configs"))?;

    info!("Retrieving server list from NordVPN API");
    let servers = get_servers(&client).await.map_err(ConfigError::AnyhowError)?;
    info!("Found {} servers to process", servers.len());
    let processed_servers = process_servers(servers, location).await;
    
    info!("Starting configuration generation");
    info!("Creating standard configurations");
    
    let semaphore = Arc::new(Semaphore::new(200));
    let mut tasks = Vec::new();

    let total_configs = processed_servers.len() * 2; // Standard + Best configs
    *state.total_tasks.lock() = total_configs;
    let progress_bar = setup_progress_bar(total_configs as u64);

    // Generate standard configs
    for server in &processed_servers {
        if state.shutdown.load(Ordering::SeqCst) {
            warn!("Shutdown requested, stopping config generation");
            break;
        }

        let sem = semaphore.clone();
        let config = generate_config(&private_key, server, &user_config);
        let path = output_dir.join("configs")
            .join(sanitize_filename(&server.country))
            .join(sanitize_filename(&server.city));
        let filename = format!("{}.conf", sanitize_filename(&server.name));
        
        let pb = progress_bar.clone();
        let state = state.clone();
        tasks.push(tokio::spawn(async move {
            let result = async {
                let _permit = sem.acquire().await?;
                fs::create_dir_all(&path)?;
                fs::write(path.join(filename), config)?;
                Ok::<_, anyhow::Error>(())
            }.await;

            *state.tasks_completed.lock() += 1;
            pb.inc(1);
            result
        }));
    }

    // Generate best configs
    let mut best_servers: HashMap<(String, String), Server> = HashMap::new();
    for server in &processed_servers {
        let key = (server.country.clone(), server.city.clone());
        if !best_servers.contains_key(&key) || 
           server.load < best_servers.get(&key).unwrap().load {
            best_servers.insert(key, server.clone());
        }
    }

    // Add best server configs to tasks
    for server in best_servers.values() {
        if state.shutdown.load(Ordering::SeqCst) {
            warn!("Shutdown requested, stopping config generation");
            break;
        }

        let sem = semaphore.clone();
        let config = generate_config(&private_key, server, &user_config);
        let path = output_dir.join("best_configs")
            .join(sanitize_filename(&server.country))
            .join(sanitize_filename(&server.city));
        let filename = format!("{}.conf", sanitize_filename(&server.name));
        
        let pb = progress_bar.clone();
        let state = state.clone();
        tasks.push(tokio::spawn(async move {
            let result = async {
                let _permit = sem.acquire().await?;
                fs::create_dir_all(&path)?;
                fs::write(path.join(filename), config)?;
                Ok::<_, anyhow::Error>(())
            }.await;

            *state.tasks_completed.lock() += 1;
            pb.inc(1);
            result
        }));
    }

    // Modify tasks handling to respect shutdown signal
    let mut completed_tasks = Vec::new();
    for task in tasks {
        if state.shutdown.load(Ordering::SeqCst) {
            warn!("Shutdown requested, waiting for current tasks to complete...");
            // Wait for already spawned tasks
            for task in completed_tasks {
                if let Err(e) = task.await {
                    warn!("Task error during shutdown: {}", e);
                }
            }
            info!("Cleanup completed, exiting...");
            return Ok(());
        }
        completed_tasks.push(task);
    }

    // Wait for all tasks to complete with timeout
    let mut errors = Vec::new();
    for task in completed_tasks {
        match tokio::time::timeout(std::time::Duration::from_secs(5), task).await {
            Ok(result) => match result {
                Ok(Ok(_)) => continue,
                Ok(Err(e)) => errors.push(e),
                Err(e) => errors.push(anyhow::Error::msg(e.to_string())),
            },
            Err(_) => {
                warn!("Task timed out");
                continue;
            }
        }
    }

    progress_bar.finish_and_clear();

    // Report errors if any
    if !errors.is_empty() {
        warn!("Process completed with {} errors", errors.len());
        for (i, error) in errors.iter().enumerate() {
            warn!("Error {}/{}: {}", i + 1, errors.len(), error);
        }
    }

    info!("Saving server information...");
    let mut servers_info = serde_json::Map::new();
    for server in &processed_servers {
        let country_entry = servers_info
            .entry(&server.country)
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        
        let city_entry = country_entry
            .as_object_mut()
            .unwrap()
            .entry(&server.city)
            .or_insert_with(|| Value::Object(serde_json::Map::new()));

        if let Some(obj) = city_entry.as_object_mut() {
            obj.insert("distance".to_string(), json!(server.distance as i32));
            
            // Update servers array instead of overwriting
            let servers_array = obj.entry("servers")
                .or_insert(json!([]));
            
            if let Some(arr) = servers_array.as_array_mut() {
                arr.push(json!([&server.name, server.load]));
            }
        }
    }

    let servers_json = serde_json::to_string_pretty(&servers_info)?;
    fs::write(output_dir.join("servers.json"), servers_json)?;

    let elapsed = start_time.elapsed();
    info!("---------------------------------------");
    info!("Configuration generation completed");
    info!("Configs saved to: {}", output_dir.display());
    info!("Total time: {:.1} seconds", elapsed.as_secs_f64());

    Ok(())
}

fn sanitize_filename(input: &str) -> String {
    input.to_lowercase()
        .replace(|c: char| !c.is_ascii_alphanumeric(), "_")
        .replace("__", "_")
        .trim_matches('_')
        .to_string()
}
