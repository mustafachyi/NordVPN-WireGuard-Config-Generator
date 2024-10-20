// Import Fastify and path
const fastify = require('fastify')({ logger: true });
const path = require('path');
const axios = require('axios');
const JSZip = require('jszip');

// Import handlers
const htmlHandler = require('./handlers/htmlHandler');

// Register compression plugin
fastify.register(require('@fastify/compress'), { global: true });

// Register caching plugin
fastify.register(require('@fastify/caching'), {
  privacy: 'public',
  expiresIn: 60 //1 minute
});

// Cache for server data
let cachedServers = {};

// Function to fetch and cache server data
const fetchAndCacheServers = async () => {
  try {
    const response = await axios.get('https://api.nordvpn.com/v1/servers', {
      params: {
        limit: 6500,
        'filters[servers_technologies][identifier]': 'wireguard_udp'
      }
    });
    const servers = response.data;

    if (!Array.isArray(servers)) {
      throw new Error('Invalid data format: expected an array of servers');
    }

    const newCache = {};

    servers.forEach(server => {
      const wireguardTech = server.technologies.find(tech => tech.identifier === 'wireguard_udp');
      if (!wireguardTech) return;

      const publicKeyMeta = wireguardTech.metadata.find(meta => meta.name === 'public_key');
      if (!publicKeyMeta) return;

      const location = server.locations[0];
      const country = location.country.name;
      const city = location.country.city.name;

      if (!newCache[country]) {
        newCache[country] = {};
      }

      if (!newCache[country][city]) {
        newCache[country][city] = [];
      }

      newCache[country][city].push({
        originalName: server.name,
        formattedName: server.name.replace(/[^a-zA-Z0-9]/g, '_'), // Replace non-alphanumeric characters with underscores
        station: server.station,
        publicKey: publicKeyMeta.value,
        load: server.load
      });
    });

    if (Object.keys(newCache).length === 0) {
      throw new Error('No valid server data found');
    }

    cachedServers = newCache;
    fastify.log.info('Server data cached successfully');
  } catch (error) {
    fastify.log.error('Error fetching server data:', error);
  }
};

// Fetch and cache server data when the server starts
fetchAndCacheServers();

// Set up a timer to refresh the data every hour
setInterval(fetchAndCacheServers, 300000); // 300000 ms = 5 minutes

// Serve static files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'utils'),
  prefix: '/', // optional: default '/'
});

// Define routes
fastify.get('/nordvpn-servers', async (request, reply) => {
  if (Object.keys(cachedServers).length === 0) {
    reply.status(500).send({ error: 'No server data available' });
  } else {
    reply.send(cachedServers);
  }
});

fastify.get('/download-all', async (request, reply) => {
  try {
    const zip = new JSZip();
    const configTemplate = `[Interface]
Key = YOUR_PRIVATE_KEY_HERE
Address = 10.5.0.2/16
DNS = 103.86.96.100

[Peer]
PublicKey = {{publicKey}}
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = {{station}}:51820
PersistentKeepalive = 25
    `;

    for (const country in cachedServers) {
      for (const city in cachedServers[country]) {
        const folder = zip.folder(`${country}/${city}`);
        cachedServers[country][city].forEach(server => {
          const configContent = configTemplate
            .replace('{{publicKey}}', server.publicKey)
            .replace('{{station}}', server.station);
          folder.file(`${server.formattedName}.conf`, configContent);
        });
      }
    }

    const content = await zip.generateAsync({ type: 'nodebuffer' });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', 'attachment; filename=nordvpn_configs.zip');
    reply.send(content);
  } catch (error) {
    fastify.log.error('Error generating ZIP file:', error);
    reply.status(500).send({ error: 'Error generating ZIP file' });
  }
});

fastify.get('/', htmlHandler);

// Start the server
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    fastify.log.info(`Server is running at http://localhost:3000`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();