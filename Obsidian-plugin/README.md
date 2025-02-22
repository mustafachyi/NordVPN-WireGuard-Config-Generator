# NordVPN Config Generator - Obsidian Plugin

A component of the [NordVPN WireGuard Config Generator](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator) suite.

## Overview

This Obsidian plugin generates WireGuard configurations for NordVPN servers directly within your vault. It uses a custom API layer built on top of NordVPN's infrastructure for simplified server management and configuration generation.

## Features

- Generate WireGuard configurations for any NordVPN server
- Select servers by country and city
- View real-time server load information
- Flexible private key management
- Custom configuration viewer
- Automatic configuration file organization

## Requirements

- Obsidian v1.0.0 or higher
- Active NordVPN subscription
- NordVPN authentication token (optional, only needed for key generation)

## Installation

1. Download the latest release (.zip file) from the releases section
2. Extract the zip file in your vault's `.obsidian/plugins` folder
3. Enable the plugin in Obsidian Settings > Community Plugins

## Development

### Prerequisites
- Node.js
- npm/yarn
- TypeScript knowledge

### Setup
1. Clone the repository
2. Run `npm install` to install dependencies
3. Create a test vault for development

### Build Commands
- `npm run dev` - Start development build with watch mode
- `npm run build` - Create production build

The plugin uses esbuild for fast builds and TypeScript for type safety. Development builds include source maps for easier debugging.

## Usage

1. Open the NordVPN Config Generator from the ribbon icon
2. Choose your private key method:
   - Generate new key using your NordVPN token
   - Input existing private key
   - Generate config without private key
3. Select your desired server location
4. Generate and save the configuration

## Configuration

Access plugin settings through Obsidian Settings > NordVPN Config Generator:

- DNS Servers: Set multiple DNS servers for configurations
- Endpoint Type: Choose between hostname or station format
- Keepalive: Set WireGuard keepalive interval
- Output Folder: Specify where configurations are saved

## Security

- Private keys are stored in encrypted format using a timestamp-based key derivation
- Authentication tokens are used only for key generation and never stored
- All sensitive data is encrypted before saving to disk
- No sensitive data is transmitted to external servers except through our secure API layer

## Support

For issues and feature requests, please use the [issue tracker](https://github.com/mustafachyi/NordVPN-WireGuard-Config-Generator).

## License

GPL-3.0
