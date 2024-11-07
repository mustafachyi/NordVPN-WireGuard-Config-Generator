// Import Fastify and dependencies
require('dotenv').config();
const fastify = require('fastify')({ logger: true });
const axios = require('axios');
const Archiver = require('archiver');
const path = require('path');
const QRCode = require('qrcode');
const sharp = require('sharp');

// Register compression plugin with Brotli
fastify.register(require('@fastify/compress'), {
  global: true,
  brotli: { mode: 0, quality: 5, lgwin: 22 },
  encodings: ['br', 'gzip'],
});

// Register caching plugin
fastify.register(require('@fastify/caching'), {
  privacy: 'public',
  expiresIn: 60, // 1 minute
});

// Register static file serving
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/', // Serve files from the root URL
  wildcard: false, // Disable wildcard serving to avoid conflicts
});

// Cache for servers, public keys, and ZIP buffer
let serversCache = {};
let publicKeysCache = {};
let zipBuffer = null;

// Common configuration content template
const configTemplate = (publicKey, hostnamePrefix) => `[Interface]
PrivateKey=YOUR_PRIVATE_KEY
Address=10.5.0.2/16
DNS=103.86.96.100

[Peer]
PublicKey=${publicKey}
AllowedIPs=0.0.0.0/0,::/0
Endpoint=${hostnamePrefix}.nordvpn.com:51820
PersistentKeepalive=25
`;

// Function to generate ZIP buffer with improved compression
const generateZipBuffer = async () => {
  return new Promise((resolve, reject) => {
    const archive = Archiver('zip', { zlib: { level: 9 } });
    const buffers = [];

    archive.on('error', reject);
    archive.on('data', data => buffers.push(data));
    archive.on('end', () => {
      zipBuffer = Buffer.concat(buffers);
      resolve();
    });

    for (const country of Object.keys(serversCache).sort()) {
      for (const city of Object.keys(serversCache[country]).sort()) {
        serversCache[country][city]
          .sort((a, b) => a.formattedName.localeCompare(b.formattedName))
          .forEach(server => {
            const configContent = configTemplate(publicKeysCache[server.publicKeyId], server.hostnamePrefix);
            const filePath = path.join(country, city, `${server.formattedName}.conf`);
            archive.append(configContent, { name: filePath });
          });
      }
    }

    archive.finalize();
  });
};

// Function to fetch and cache server data
const fetchServers = async () => {
  try {
    const { data: servers } = await axios.get('https://api.nordvpn.com/v1/servers', {
      params: {
        limit: 7000,
        'filters[servers_technologies][identifier]': 'wireguard_udp',
      },
    });

    if (!Array.isArray(servers)) throw new Error('Invalid data format: expected an array of servers');

    const newServersCache = {};
    const newPublicKeys = {};
    let publicKeyIdCounter = 1;

    servers.forEach(server => {
      const wireguardTech = server.technologies.find(t => t.identifier === 'wireguard_udp');
      if (!wireguardTech) return;

      const publicKey = wireguardTech.metadata.find(m => m.name === 'public_key')?.value;
      if (!publicKey) return;

      const location = server.locations[0]?.country;
      const country = location?.name;
      const city = location?.city?.name;
      if (!country || !city) return;

      const hostnamePrefix = server.hostname.split('.nordvpn.com')[0] || server.hostname;
      const serverNumberMatch = hostnamePrefix.match(/\d+$/);
      const serverNumber = serverNumberMatch ? serverNumberMatch[0] : 'unknown';
      const formattedName = `${country}_${city}_${serverNumber}`.replace(/\s+/g, '_');

      if (!newServersCache[country]) newServersCache[country] = {};
      if (!newServersCache[country][city]) newServersCache[country][city] = [];

      if (!newPublicKeys[publicKey]) {
        publicKeysCache[publicKeyIdCounter] = publicKey;
        newPublicKeys[publicKey] = publicKeyIdCounter++;
      }

      newServersCache[country][city].push({
        formattedName,
        hostnamePrefix,
        publicKeyId: newPublicKeys[publicKey],
        load: server.load,
      });
    });

    // Sort servers alphabetically
    const sortedServersCache = {};
    Object.keys(newServersCache).sort().forEach(country => {
      sortedServersCache[country] = {};
      Object.keys(newServersCache[country]).sort().forEach(city => {
        sortedServersCache[country][city] = newServersCache[country][city]
          .sort((a, b) => a.formattedName.localeCompare(b.formattedName));
      });
    });

    if (Object.keys(sortedServersCache).length === 0) throw new Error('No valid server data found');

    serversCache = sortedServersCache;
    await generateZipBuffer();
    fastify.log.info('Cache updated successfully');
  } catch (error) {
    fastify.log.error('Error fetching or caching server data:', error);
  }
};

// Initial fetch and set interval for refreshing data every 5 minutes
fetchServers();
setInterval(fetchServers, 300000); // 300,000 ms = 5 minutes

// Define routes
fastify.get('/servers', async (request, reply) => {
  if (!Object.keys(serversCache).length) {
    reply.status(500).send({ error: 'No server data available' });
  } else {
    const response = {};
    Object.keys(serversCache).forEach(country => {
      response[country] = {};
      Object.keys(serversCache[country]).forEach(city => {
        response[country][city] = serversCache[country][city].map(server => ({
          formattedName: server.formattedName,
          load: server.load,
        }));
      });
    });
    reply
      .header('Cache-Control', 'public, max-age=60') // Cache for 1 minute
      .send(response);
  }
});

fastify.get('/download-all', async (request, reply) => {
  if (!zipBuffer) {
    reply.status(500).send({ error: 'ZIP file is not available' });
    return;
  }
  reply
    .header('Content-Type', 'application/zip')
    .header('Content-Disposition', 'attachment; filename=server_configs.zip')
    .send(zipBuffer);
});

const getServerData = (country, city, server) => {
  if (!serversCache[country] || !serversCache[country][city]) return null;
  return serversCache[country][city].find(s => s.formattedName === server);
};

const sendConfigContent = (reply, serverData) => {
  const configContent = configTemplate(publicKeysCache[serverData.publicKeyId], serverData.hostnamePrefix);
  reply
    .header('Content-Type', 'text/plain')
    .send(configContent);
};

fastify.get('/download/:country/:city/:server', async (request, reply) => {
  const { country, city, server } = request.params;
  const serverData = getServerData(country, city, server);
  if (!serverData) {
    reply.status(404).send({ error: 'Server not found' });
    return;
  }

  const configContent = configTemplate(publicKeysCache[serverData.publicKeyId], serverData.hostnamePrefix);
  reply
    .header('Content-Type', 'text/plain')
    .header('Content-Disposition', `attachment; filename=${server}.conf`)
    .send(configContent);
});

fastify.get('/config/:country/:city/:server', async (request, reply) => {
  const { country, city, server } = request.params;
  const serverData = getServerData(country, city, server);
  if (!serverData) {
    reply.status(404).send({ error: 'Server not found' });
    return;
  }

  sendConfigContent(reply, serverData);
});

// New route to generate and serve QR codes as WebP images
fastify.get('/qrcode/:country/:city/:server', async (request, reply) => {
  const { country, city, server } = request.params;
  const serverData = getServerData(country, city, server);
  if (!serverData) {
    reply.status(404).send({ error: 'Server not found' });
    return;
  }

  const configContent = configTemplate(publicKeysCache[serverData.publicKeyId], serverData.hostnamePrefix);

  try {
    const qrCodeBuffer = await QRCode.toBuffer(configContent, { type: 'png' });
    const webpBuffer = await sharp(qrCodeBuffer).webp({ quality: 80 }).toBuffer();

    reply
      .header('Content-Type', 'image/webp')
      .send(webpBuffer);
  } catch (error) {
    fastify.log.error('Error generating QR code:', error);
    reply.status(500).send({ error: 'Failed to generate QR code' });
  }
});

// Handle non-existing endpoints
fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({ error: 'Endpoint not found' });
});

// Start the server
const startServer = async () => {
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    fastify.log.info(`Server is running at http://localhost:${process.env.PORT || 3000}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

startServer();