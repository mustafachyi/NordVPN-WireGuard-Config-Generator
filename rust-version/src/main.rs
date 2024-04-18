use reqwest::{Client, get};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use std::io::{self, Write};
use std::sync::Arc;
use tokio::fs;
use tokio::task;
use std::cmp::Ordering;
use tokio::fs::File;
use std::path::Path;
use haversine::{distance, Location, Units};
use tokio::io::AsyncWriteExt;

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
        let config = format!("[Interface]
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

fn calculate_distance(ulat: f64, ulon: f64, slat: f64, slon: f64) -> f64 {
    let user_location = Location { latitude: ulat, longitude: ulon };
    let server_location = Location { latitude: slat, longitude: slon };
    distance(user_location, server_location, Units::Kilometers)
}

fn sort_servers(mut servers: Vec<Value>, ulat: f64, ulon: f64) -> Vec<Value> {
    for server in &mut servers {
        let slat = server["locations"][0]["latitude"].as_f64().unwrap();
        let slon = server["locations"][0]["longitude"].as_f64().unwrap();
        server["distance"] = json!(calculate_distance(ulat, ulon, slat, slon));
    }
    servers.sort_by(|a, b| {
        let a_load = a["load"].as_f64().unwrap();
        let b_load = b["load"].as_f64().unwrap();
        let a_distance = a["distance"].as_f64().unwrap();
        let b_distance = b["distance"].as_f64().unwrap();
        a_load.partial_cmp(&b_load).unwrap_or(Ordering::Equal).then_with(|| a_distance.partial_cmp(&b_distance).unwrap_or(Ordering::Equal))
    });
    servers
}

async fn get_location() -> Result<(f64, f64), Box<dyn std::error::Error>> {
    let res = get("https://ipinfo.io/json").await?;
    let body = res.text().await?;
    let v: Value = serde_json::from_str(&body)?;
    let loc = v["loc"].as_str().unwrap().split(',').collect::<Vec<&str>>();
    Ok((loc[0].parse()?, loc[1].parse()?))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut token = String::new();
    print!("Please enter your token: ");
    io::stdout().flush().unwrap(); // Flush stdout to display the prompt before waiting for input
    io::stdin().read_line(&mut token).unwrap();

    let client = Client::new();
    let mut servers = get_servers(&client).await?;
    let private_key = Arc::new(get_key(&client, token.trim()).await?);

    let (ulat, ulon) = get_location().await?;
    servers = sort_servers(servers, ulat, ulon);

    let tasks: Vec<_> = servers.iter().cloned().map(|server| {
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

    let mut servers_by_location: HashMap<String, HashMap<String, Vec<Vec<String>>>> = HashMap::new();
	for server in &servers {
		let country = server["locations"][0]["country"]["name"].as_str().unwrap().to_string();
		let city = server["locations"][0]["country"]["city"]["name"].as_str().unwrap_or("Unknown").to_string();
		let server_info = vec![server["name"].as_str().unwrap().to_string(), server["load"].as_f64().unwrap().to_string()];
		servers_by_location.entry(country).or_insert_with(HashMap::new).entry(city).or_insert_with(Vec::new).push(server_info);
	}

    for (_, cities) in &mut servers_by_location {
        for (_, servers) in cities {
            servers.sort_by(|a, b| a[1].parse::<f64>().unwrap().partial_cmp(&b[1].parse::<f64>().unwrap()).unwrap());
        }
    }

    fs::create_dir_all("best_configs").await?;

    let original_servers = servers.clone(); // Clone the servers vector

    for (country, cities) in &servers_by_location {
        let safe_country_name = country.replace(" ", "_");
        for (city, servers) in cities {
            let best_server = &servers[0];
            // Find the server Value that corresponds to the best server
            let best_server_value = original_servers.iter().find(|server| server["name"].as_str().unwrap() == best_server[0]).unwrap();
            let safe_city_name = city.replace(" ", "_");
            // Save the config for the best server
            save_config(Arc::clone(&private_key), best_server_value, Some(&format!("best_configs/{}_{}.conf", safe_country_name, safe_city_name))).await?;
        }
    }

    let servers_by_location = servers_by_location.into_iter().collect::<BTreeMap<_, _>>();

    // Make file mutable
    let mut file = File::create("servers.json").await?;

    let last_country_index = servers_by_location.len() - 1;
    file.write_all(b"{\n").await?;
    for (index, (country, cities)) in servers_by_location.iter().enumerate() {
        file.write_all(format!("  \"{}\": {{\n", country).as_bytes()).await?;
        let last_city_index = cities.len() - 1;
        for (city_index, (city, servers)) in cities.iter().enumerate() {
            file.write_all(format!("    \"{}\": [\n", city).as_bytes()).await?;
            let last_server_index = servers.len() - 1;
            for (server_index, server) in servers.iter().enumerate() {
                file.write_all(format!("      [\"{}\", {}]", server[0], server[1]).as_bytes()).await?;
                if server_index < last_server_index {
                    file.write_all(b",\n").await?;
                } else {
                    file.write_all(b"\n").await?;
                }
            }
            file.write_all(b"    ]").await?;
            if city_index < last_city_index {
                file.write_all(b",\n").await?;
            } else {
                file.write_all(b"\n").await?;
            }
        }
        file.write_all(b"  }").await?;
        if index < last_country_index {
            file.write_all(b",\n").await?;
        } else {
            file.write_all(b"\n").await?;
        }
    }
    file.write_all(b"}\n").await?;

    Ok(())
}
