module.exports = {
  apps: [
    {
      name: 'nordvpn-configs',
      script: 'server.js',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};