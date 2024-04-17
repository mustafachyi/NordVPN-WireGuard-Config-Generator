use reqwest::Client;
use serde_json::Value;
use std::io::{self, Write};
use std::path::Path;
use std::sync::Arc;
use tokio::fs;
use tokio::task;

pub async fn get_key(client: &Client, token: &str) -> Result<String, Box<dyn std::error::Error>> {
    let res = client
        .get("https://api.nordvpn.com/v1/users/services/credentials")
        .basic_auth("token", Some(token))
        .send()
        .await?;

    let body = res.text().await?;
    let v: Value = serde_json::from_str(&body)?;

    match v.get("nordlynx_private_key") {
        Some(private_key) => Ok(private_key.as_str().unwrap().to_string()),
        None => Err("nordlynx_private_key not found".into()),
    }
}

pub async fn get_servers(client: &Client) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let res = client.get("https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp").send().await?;
    let servers: Vec<Value> = res.json().await?;
    Ok(servers)
}

pub fn find_key(server: &Value) -> Option<String> {
    if let Some(technologies) = server.get("technologies")?.as_array() {
        for tech in technologies {
            if tech.get("identifier")?.as_str()? == "wireguard_udp" {
                if let Some(metadata) = tech.get("metadata")?.as_array() {
                    for data in metadata {
                        if data.get("name")?.as_str()? == "public_key" {
                            return data.get("value")?.as_str().map(|s| s.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

fn format_name(name: &str) -> String {
    if name.contains(' ') {
        name.replace(" ", "_")
    } else {
        name.to_string()
    }
}

fn generate_config(key: &str, server: &Value) -> Option<(String, String, String, String)> {
    if let Some(public_key) = find_key(server) {
        let country_name = format_name(server["locations"][0]["country"]["name"].as_str().unwrap());
        let city_name = format_name(server["locations"][0]["country"].get("city").and_then(|c| c.get("name")).and_then(|n| n.as_str()).unwrap_or("Unknown"));
        let server_name = format_name(&format!("{}_{}", server["name"].as_str().unwrap().replace("#", ""), city_name));
        let config = format!(
            "[Interface]
PrivateKey = {}
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = {}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = {}:51820
PersistentKeepalive = 25
", key, public_key, server["station"].as_str().unwrap());
        Some((country_name, city_name, server_name, config))
    } else {
        println!("No WireGuard public key found for {} in {}. Skipping.", server["name"].as_str().unwrap(), server.get("city").and_then(|c| c.get("name")).and_then(|n| n.as_str()).unwrap_or("Unknown"));
        None
    }
}

async fn save_config(key: Arc<String>, server: &Value, path: Option<&str>) -> Result<Option<String>, Box<dyn std::error::Error>> {
    if server.get("locations").is_some() {
        if let Some((country_folder, city_folder, server_name, config)) = generate_config(&key, server) {
            let path = match path {
                Some(p) => p.to_string(),
                None => {
                    let country_path = Path::new("configs").join(&country_folder);
                    fs::create_dir_all(&country_path).await?;
                    let city_path = country_path.join(&city_folder);
                    fs::create_dir_all(&city_path).await?;
                    city_path.join(format!("{}.conf", server_name)).to_str().unwrap().to_string()
                }
            };
            fs::write(&path, config).await?;
            println!("WireGuard configuration for {} saved to {}", server_name, path);
            Ok(Some(path))
        } else {
            Ok(None)
        }
    } else {
        Ok(None)
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut token = String::new();
    print!("Please enter your token: ");
    io::stdout().flush().unwrap(); // Flush stdout to display the prompt before waiting for input
    io::stdin().read_line(&mut token).unwrap();

    let client = Client::new();
    let servers = get_servers(&client).await?;
    let private_key = Arc::new(get_key(&client, token.trim()).await?);

    let tasks: Vec<_> = servers.into_iter().map(|server| {
        let private_key = Arc::clone(&private_key);
        task::spawn(async move {
            match save_config(private_key, &server, None).await {
                Ok(_) => (),
                Err(e) => eprintln!("Error saving config for server {}: {}", server["name"].as_str().unwrap_or("Unknown"), e),
            }
        })
    }).collect();

    for t in tasks {
        t.await?;
    }

    Ok(())
}