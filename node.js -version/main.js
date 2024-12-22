const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const prompts = require('prompts');
const winston = require('winston');
const { promisify } = require('util');
const { pipeline } = require('stream');
const streamPipeline = promisify(pipeline);
const slugify = require('slugify'); 

// Logger configuration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} - ${level} - ${message}`)
  ),
  transports: [
    new winston.transports.Console()
  ],
});

class Server {
  constructor(name, hostname, station, load, country, city, latitude, longitude, public_key, distance = 0) {
    this.name = name;
    this.hostname = hostname;
    this.station = station;
    this.load = load;
    this.country = country;
    this.city = city;
    this.latitude = latitude;
    this.longitude = longitude;
    this.public_key = public_key;
    this.distance = distance;
  }
}

class UserConfig {
  constructor(dns = "103.86.96.100", use_ip = false, keepalive = 25) {
    this.dns = dns;
    this.use_ip = use_ip;
    this.keepalive = keepalive;
  }
}

async function getUserPreferences() {
  const response = await prompts([
    {
      type: 'text',
      name: 'dns',
      message: 'Enter DNS server IP (default: 103.86.96.100):',
      initial: '103.86.96.100',
      validate: value => /^(\d{1,3}\.){3}\d{1,3}$/.test(value) ? true : 'Please enter a valid IP address.'
    },
    {
      type: 'toggle',
      name: 'use_ip',
      message: 'Use IP instead of hostname for endpoints?',
      initial: false,
      active: 'yes',
      inactive: 'no'
    },
    {
      type: 'number',
      name: 'keepalive',
      message: 'Enter PersistentKeepalive value (default: 25):',
      initial: 25,
      validate: value => {
        if (value === '' || value === null || value === undefined) return true;
        return (value >= 15 && value <= 120) ? true : 'Keepalive must be between 15 and 120.';
      },
      format: value => {
        if (value === '' || value === null || value === undefined) return 25;
        return value;
      }
    }
  ], {
    onCancel: () => {
      console.log('\nOperation cancelled by user. Exiting...');
      process.exit(0);
    }
  });

  return new UserConfig(response.dns || "103.86.96.100", response.use_ip || false, response.keepalive || 25);
}

function calculateDistance(ulat, ulon, slat, slon) {
  // Calculate the distance between two geographic coordinates using the Haversine formula
  const toRadians = degrees => degrees * (Math.PI / 180);
  const dlon = toRadians(slon - ulon);
  const dlat = toRadians(slat - ulat);
  const a = Math.sin(dlat / 2) ** 2 +
            Math.cos(toRadians(ulat)) * Math.cos(toRadians(slat)) *
            Math.sin(dlon / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(a));
  return c * 6371; // Radius of Earth in kilometers
}

function parseServer(serverData, userLocation) {
  try {
    const [ulat, ulon] = userLocation;
    const location = serverData.locations[0];
    const tech = serverData.technologies.find(t => t.identifier === 'wireguard_udp');
    const metadata = tech ? tech.metadata.find(m => m.name === 'public_key') : null;
    const public_key = metadata ? metadata.value : null;

    if (!public_key) return null;

    const distance = calculateDistance(
      ulat, ulon,
      location.latitude,
      location.longitude
    );

    return new Server(
      serverData.name,
      serverData.hostname,
      serverData.station,
      parseInt(serverData.load || 0),
      location.country.name,
      location.country.city ? location.country.city.name : 'unknown',
      location.latitude,
      location.longitude,
      public_key,
      distance
    );
  } catch {
    return null;
  }
}

function isValidToken(token) {
  return /^[a-fA-F0-9]{64}$/.test(token);
}

class NordVPNConfigGenerator {
  constructor(concurrentLimit = 200) {
    this.concurrentLimit = concurrentLimit;
    this.outputDir = null;
    this.userConfig = null;
  }

  async initializeOutputDirectory() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '_');
    this.outputDir = path.join(__dirname, `nordvpn_configs_${timestamp}`);
    await fs.mkdir(this.outputDir, { recursive: true });
    logger.info(`Created output directory: ${this.outputDir}`);
  }

  async generateConfigs(token, userConfig) {
    this.userConfig = userConfig;

    if (!isValidToken(token)) {
      logger.error("Invalid token format. Expected 64 character hex string.");
      return;
    }

    logger.info("Starting configuration generation...");

    try {
      const key = await this.getPrivateKey(token);
      if (!key) {
        logger.error("Failed to get private key. Invalid token or API error.");
        return;
      }

      await this.initializeOutputDirectory();

      const servers = await this.getServers();
      if (!servers.length) {
        logger.error("Failed to get servers");
        return;
      }
      logger.info(`Found ${servers.length} servers`);

      const location = await this.getLocation();
      if (!location) {
        logger.error("Failed to get location");
        return;
      }
      logger.info(`Current location: ${location}`);

      await this.processAndSave(key, servers, location);
      logger.info(`All configurations have been saved to: ${this.outputDir}`);
    } catch (error) {
      logger.error(`Error generating configs: ${error.message}`);
    }
  }

  async getPrivateKey(token) {
    const tokenEncoded = Buffer.from(`token:${token}`).toString('base64');
    try {
      const response = await axios.get('https://api.nordvpn.com/v1/users/services/credentials', {
        headers: { 'Authorization': `Basic ${tokenEncoded}` }
      });
      return response.data.nordlynx_private_key || null;
    } catch {
      return null;
    }
  }

  async getServers() {
    try {
      const response = await axios.get('https://api.nordvpn.com/v1/servers', {
        params: { limit: 7000, 'filters[servers_technologies][identifier]': 'wireguard_udp' }
      });
      return response.data;
    } catch {
      return [];
    }
  }

  async getLocation() {
    try {
      const response = await axios.get('https://ipinfo.io/json');
      const loc = response.data.loc.split(',');
      if (loc.length === 2) {
        return [parseFloat(loc[0]), parseFloat(loc[1])];
      }
      return null;
    } catch {
      return null;
    }
  }

  generateConfig(key, server) {
    const endpoint = this.userConfig.use_ip ? server.station : server.hostname;
    return `[Interface]
PrivateKey = ${key}
Address = 10.5.0.2/16
DNS = ${this.userConfig.dns}

[Peer]
PublicKey = ${server.public_key}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${endpoint}:51820
PersistentKeepalive = ${this.userConfig.keepalive}`;
  }

  sanitizeName(name) {
    // Sanitize the server name for filesystem compatibility
    let sanitized = name.toLowerCase();
    
    sanitized = sanitized.replace(/\s+/g, '_').replace(/(\d+)/g, '_$1').replace(/and/g, '_and_');
    sanitized = sanitized.replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
    sanitized = sanitized.replace(/[^a-z0-9_]/g, '_').replace(/_{2,}/g, '_');
    
    return sanitized;
  }

  async saveConfig(key, server, basePath) {
    const config = this.generateConfig(key, server);
    const country = this.sanitizeName(server.country);
    const city = this.sanitizeName(server.city);
    const name = this.sanitizeName(server.name);

    const dirPath = path.join(this.outputDir, basePath, country, city);
    await fs.mkdir(dirPath, { recursive: true });

    const filePath = path.join(dirPath, `${name}.conf`);
    await fs.writeFile(filePath, config, 'utf8');
  }

  async processAndSave(privateKey, servers, location) {
    logger.info("Processing server information...");
    const parsedServers = servers.map(server => parseServer(server, location)).filter(s => s);
    logger.info(`Successfully processed ${parsedServers.length} servers`);

    const sortedServers = parsedServers.sort((a, b) => a.load - b.load || a.distance - b.distance);

    logger.info("Generating standard configurations...");
    const configPromises = sortedServers.map(server => this.saveConfig(privateKey, server, 'configs'));
    await Promise.all(configPromises);

    logger.info("Generating optimized configurations...");
    const bestServers = {};
    sortedServers.forEach(server => {
      const key = `${server.country}_${server.city}`;
      if (!bestServers[key] || server.load < bestServers[key].load) {
        bestServers[key] = server;
      }
    });

    const bestConfigPromises = Object.values(bestServers).map(server => this.saveConfig(privateKey, server, 'best_configs'));
    await Promise.all(bestConfigPromises);

    logger.info("Saving server information...");
    const serversInfo = {};
    sortedServers.forEach(server => {
      if (!serversInfo[server.country]) {
        serversInfo[server.country] = {};
      }
      if (!serversInfo[server.country][server.city]) {
        serversInfo[server.country][server.city] = { distance: Math.round(server.distance), servers: [] };
      }
      serversInfo[server.country][server.city].servers.push([server.name, server.load]);
    });

    const serversJsonPath = path.join(this.outputDir, 'servers.json');
    await fs.writeFile(serversJsonPath, JSON.stringify(serversInfo, null, 2), 'utf8');
  }
}

async function validateToken(token) {
  const tokenEncoded = Buffer.from(`token:${token}`).toString('base64');
  try {
    const response = await axios.get('https://api.nordvpn.com/v1/users/services/credentials', {
      headers: { 'Authorization': `Basic ${tokenEncoded}` }
    });
    return response.data.nordlynx_private_key || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log("\nNordVPN Configuration Generator");
  console.log("==============================");
  
  
  console.log();

  try {
    const tokenResponse = await prompts({
      type: 'password',
      name: 'token',
      message: 'Please enter your access token (64 character hex string):\n',
      validate: value => /^[a-fA-F0-9]{64}$/.test(value) ? true : 'Token must be a 64 character hex string.'
    }, {
      onCancel: () => {
        console.log('\nOperation cancelled by user. Exiting...');
        process.exit(0);
      }
    });

    const token = tokenResponse.token;

    if (!token) {
      logger.error("No token provided");
      return;
    }

    logger.info("Validating access token...");
    const privateKey = await validateToken(token);
    if (!privateKey) {
      logger.error("Invalid token or API error. Could not retrieve private key.");
      return;
    }

    logger.info("Token validated successfully!");

    
    console.log();

    const userConfig = await getUserPreferences();

    const startTime = Date.now();
    const generator = new NordVPNConfigGenerator();
    await generator.generateConfigs(token, userConfig);
    const elapsedTime = (Date.now() - startTime) / 1000;

    if (generator.outputDir) {
      logger.info(`Process completed in ${elapsedTime.toFixed(2)} seconds`);
    } else {
      logger.error("Process failed - no configurations were generated");
    }
  } catch (error) {
    if (error.message === 'Aborted') {
      console.log('\nOperation cancelled by user. Exiting...');
      process.exit(0);
    } else {
      logger.error(`Unexpected error: ${error.message}`);
      process.exit(1);
    }
  }
}

main();