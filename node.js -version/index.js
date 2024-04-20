const axios = require('axios');
const buffer = require('buffer');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);

async function getKey(token) {
    try {
        const encodedToken = buffer.Buffer.from(`token:${token}`).toString('base64');
        const headers = { 'Authorization': `Basic ${encodedToken}` };
        const response = await axios.get("https://api.nordvpn.com/v1/users/services/credentials", { headers });
        return response.data.nordlynx_private_key;
    } catch (error) {
        if (error.response) {
            console.log(`Http Error: ${error.response.status}`);
        } else if (error.request) {
            console.log(`Error Connecting: ${error.request}`);
        } else if (error.message) {
            console.log(`Timeout Error: ${error.message}`);
        } else {
            console.log(`Something went wrong: ${error}`);
        }
    }
}

async function getServers() {
    try {
        const response = await axios.get("https://api.nordvpn.com/v1/servers?limit=7000&filters[servers_technologies][identifier]=wireguard_udp");
        return response.data;
    } catch (error) {
        console.error(`Error occurred: ${error}`);
        throw error;
    }
}

function findKey(server) {
    for (let tech of server.technologies) {
        if (tech.identifier === 'wireguard_udp') {
            for (let data of tech.metadata || []) {
                if (data.name === 'public_key') {
                    return data.value;
                }
            }
        }
    }
}

function formatName(name) {
    return name.replace(' ', '_');
}

function generateConfig(key, server) {
    const publicKey = findKey(server);
    if (publicKey) {
        const countryName = formatName(server.locations[0].country.name);
        const cityName = formatName(server.locations[0].country.city?.name || 'Unknown');
        const serverName = formatName(`${server.name.replace('#', '')}_${cityName}`);
        const config = `
[Interface]
PrivateKey = ${key}
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = ${publicKey}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = ${server.station}:51820
PersistentKeepalive = 25
`;
        return { countryName, cityName, serverName, config };
    } else {
        console.info(`No WireGuard public key found for ${server.name} in ${server.city?.name || 'Unknown'}. Skipping.`);
    }
}

function saveConfig(key, server, filePath = null) {
    try {
        if ('locations' in server) {
            const result = generateConfig(key, server);
            if (result) {
                const { countryName, cityName, serverName, config } = result;
                if (filePath === null) {
                    const countryPath = path.join('configs', countryName);
                    fs.mkdirSync(countryPath, { recursive: true });
                    const cityPath = path.join(countryPath, cityName);
                    fs.mkdirSync(cityPath, { recursive: true });
                    const filename = `${serverName.replace(/ |-/g, '_').replace(/_+/g, '_')}.conf`; // Removing dashes and consecutive underscores
                    filePath = path.join(cityPath, filename);
                }
                fs.writeFileSync(filePath, config);
                console.info(`WireGuard configuration for ${serverName} saved to ${filePath}`);
                return filePath;
            }
        }
    } catch (error) {
        console.error(`Error occurred while saving config: ${error}`);
    }
}


function calculateDistance(ulat, ulon, slat, slon) {
    const dlon = slon - ulon;
    const dlat = slat - ulat;
    const a = Math.sin(dlat/2)**2 + Math.cos(ulat) * Math.cos(slat) * Math.sin(dlon/2)**2;
    const c = 2 * Math.asin(Math.sqrt(a));
    return c * 6371;
}

function sortServers(servers, ulat, ulon) {
    servers.forEach(server => {
        const slat = server.locations[0].latitude;
        const slon = server.locations[0].longitude;
        server.distance = calculateDistance(ulat, ulon, slat, slon);
    });
    return servers.sort((a, b) => {
        const loadDiff = a.load - b.load;
        if (loadDiff !== 0) {
            return loadDiff;
        }
        return a.distance - b.distance;
    });
}

async function getLocation() {
    try {
        const response = await axios.get('https://ipinfo.io/json');
        const location = response.data.loc.split(',');
        return [parseFloat(location[0]), parseFloat(location[1])];
    } catch (error) {
        console.error(`Error occurred: ${error}`);
        throw error;
    }
}

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.question('Please enter your token: ', async (token) => {
        const key = await getKey(token);
        const servers = await getServers();
        const [ulat, ulon] = await getLocation();
        const sortedServers = sortServers(servers, ulat, ulon);
        const promises = sortedServers.map(server => saveConfig(key, server));
        const paths = await Promise.all(promises);

        const serversByLocation = {};
        for (let server of sortedServers) {
            const country = server.locations[0].country.name;
            const city = server.locations[0].country.city.name;
            if (!serversByLocation[country]) {
                serversByLocation[country] = {};
            }
            if (!serversByLocation[country][city]) {
                serversByLocation[country][city] = { distance: Math.round(server.distance), servers: [] };
            }
            const serverInfo = [server.name, `load: ${server.load}`];
            serversByLocation[country][city].servers.push(serverInfo);
        }

        if (!fs.existsSync('best_configs')) {
            fs.mkdirSync('best_configs', { recursive: true });
        }
        for (let country in serversByLocation) {
            for (let city in serversByLocation[country]) {
                const bestServer = serversByLocation[country][city].servers[0];
                const bestServerInfo = sortedServers.find(server => server.name === bestServer[0]);
                const safeCountryName = formatName(country).replace(/ |-/g, '_').replace(/_+/g, '_'); // Removing dashes and consecutive underscores
                const safeCityName = formatName(city).replace(/ |-/g, '_').replace(/_+/g, '_'); // Removing dashes and consecutive underscores
                saveConfig(key, bestServerInfo, path.join('best_configs', `${safeCountryName}_${safeCityName}.conf`));
            }
        }

        let data = '{\n';
        const countryKeys = Object.keys(serversByLocation).sort();
        countryKeys.forEach((country, i) => {
            data += `  "${country}": {\n`;
            const cityKeys = Object.keys(serversByLocation[country]).sort();
            cityKeys.forEach((city, j) => {
                data += `    "${city}": {\n      "distance": ${serversByLocation[country][city].distance},\n      "servers": [\n`;
                serversByLocation[country][city].servers.forEach((server, k) => {
                    data += `        ["${server[0]}", ${server[1]}]${k < serversByLocation[country][city].servers.length - 1 ? ',' : ''}\n`;
                });
                data += `      ]\n    }${j < cityKeys.length - 1 ? ',' : ''}\n`;
            });
            data += `  }${i < countryKeys.length - 1 ? ',' : ''}\n`;
        });
        data += '}\n';

        await writeFile('servers.json', data);

        rl.close();
    });
}

main().catch(console.error);
