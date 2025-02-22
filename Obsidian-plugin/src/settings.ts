import { App, PluginSettingTab, Setting, setIcon, Notice } from 'obsidian';
import { isValidPrivateKey } from './utils';
import NordVPNPlugin from './main';
import { DEFAULT_SETTINGS, TOKEN_REGEX } from './constants';

export class NordVPNSettingTab extends PluginSettingTab {
    plugin: NordVPNPlugin;
    private tokenInput: HTMLInputElement | null = null;
    private privateKeyInput: HTMLInputElement | null = null;

    constructor(app: App, plugin: NordVPNPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private createPasswordInput(containerEl: HTMLElement, placeholder: string): HTMLInputElement {
        const wrapper = containerEl.createDiv({ cls: 'password-input-wrapper' });
        
        const input = wrapper.createEl('input', {
            type: 'password',
            placeholder: placeholder,
            cls: 'password-input'
        });

        const toggleButton = wrapper.createEl('button', {
            cls: 'password-toggle-button',
            attr: { 'aria-label': 'Toggle visibility' }
        });

        const icon = toggleButton.createSpan({ cls: 'password-toggle-icon' });
        setIcon(icon, 'eye-off');

        toggleButton.addEventListener('click', (e) => {
            e.preventDefault();
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            setIcon(icon, isPassword ? 'eye' : 'eye-off');
        });

        return input;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'NordVPN Config Generator Settings' });

        // Token input with generate key button
        const tokenSetting = new Setting(containerEl)
            .setName('NordVPN Token')
            .setDesc('Your NordVPN API token (64-character hexadecimal string)')
            .addButton(button => button
                .setButtonText('Generate Key')
                .onClick(async () => {
                    const token = this.tokenInput?.value?.trim();
                    if (!token || !TOKEN_REGEX.test(token)) {
                        const message = !token 
                            ? 'Please enter a token first'
                            : 'Invalid token format. Token must be a 64-character hexadecimal string.';
                        new Notice(message);
                        if (token && this.tokenInput) {
                            this.tokenInput.value = '';
                        }
                        return;
                    }
                    try {
                        const privateKey = await this.plugin.validateToken(token);
                        if (privateKey) {
                            if (!isValidPrivateKey(privateKey)) {
                                new Notice('API returned an invalid private key format');
                                return;
                            }
                            // Use the new setPrivateKey method
                            await this.plugin.setPrivateKey(privateKey);
                            if (this.privateKeyInput) {
                                this.privateKeyInput.value = privateKey;
                            }
                            new Notice('Private key generated and saved successfully');
                            if (this.tokenInput) {
                                this.tokenInput.value = '';
                            }
                        }
                    } catch (error) {
                        new Notice(`Failed to generate key: ${error.message}`);
                    }
                }));

        const tokenInputContainer = tokenSetting.controlEl.createDiv();
        this.tokenInput = this.createPasswordInput(tokenInputContainer, 'Enter your token');

        // Private key input with custom password field
        const privateKeySetting = new Setting(containerEl)
            .setName('WireGuard Private Key')
            .setDesc('Your WireGuard private key (44-character Base64 string ending with "=")');

        const privateKeyInputContainer = privateKeySetting.controlEl.createDiv();
        this.privateKeyInput = this.createPasswordInput(privateKeyInputContainer, 'Enter your private key');

        try {
            const privateKey = this.plugin.getPrivateKey();
            if (privateKey) {
                this.privateKeyInput.value = privateKey;
            }
        } catch (error) {
            // No private key available, leave input empty
        }

        this.privateKeyInput.addEventListener('change', async () => {
            const input = this.privateKeyInput;
            if (!input) return;

            const value = input.value;
            if (value) {
                if (!isValidPrivateKey(value)) {
                    new Notice('Invalid WireGuard private key format. Must be a 44-character Base64 string ending with "="');
                    input.value = '';
                    await this.plugin.clearPrivateKey();
                    return;
                }
                await this.plugin.setPrivateKey(value);
            } else {
                await this.plugin.clearPrivateKey();
            }
        });

        new Setting(containerEl)
            .setName('DNS Servers')
            .setDesc('Comma-separated list of DNS servers (e.g., "103.86.96.100, 8.8.8.8")')
            .addText(text => {
                text.setPlaceholder('103.86.96.100, 8.8.8.8')
                    .setValue(this.plugin.settings.dns);

                const inputEl = text.inputEl;
                inputEl.addEventListener('blur', async () => {
                    const value = inputEl.value.trim();
                    
                    // Allow empty value to reset to default
                    if (!value) {
                        this.plugin.settings.dns = DEFAULT_SETTINGS.dns;
                        inputEl.value = this.plugin.settings.dns;
                        await this.plugin.saveSettings();
                        return;
                    }

                    // Split by comma and clean up whitespace
                    const servers = value.split(',').map(s => s.trim()).filter(s => s);

                    // IPv4 validation regex
                    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

                    // Check each server
                    const invalidServers = servers.filter(server => !ipv4Regex.test(server));
                    
                    if (invalidServers.length > 0) {
                        new Notice(`Invalid DNS server format: ${invalidServers.join(', ')}\nMust be valid IPv4 addresses`);
                        this.plugin.settings.dns = DEFAULT_SETTINGS.dns;
                        inputEl.value = this.plugin.settings.dns;
                        await this.plugin.saveSettings();
                        return;
                    }

                    // Save the properly formatted DNS string
                    this.plugin.settings.dns = servers.join(', ');
                    inputEl.value = this.plugin.settings.dns; // Normalize the format
                    await this.plugin.saveSettings();
                });

                return text;
            });

        new Setting(containerEl)
            .setName('Endpoint Type')
            .setDesc('Use hostname or station (IP) for server endpoint')
            .addDropdown(dropdown => dropdown
                .addOption('hostname', 'Hostname')
                .addOption('station', 'Station (IP)')
                .setValue(this.plugin.settings.endpoint_type)
                .onChange(async (value: 'hostname' | 'station') => {
                    this.plugin.settings.endpoint_type = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Keepalive Interval')
            .setDesc('Keepalive interval in seconds (15-120)')
            .addText(text => {
                text.setPlaceholder('25')
                    .setValue(String(this.plugin.settings.keepalive));
                
                const inputEl = text.inputEl;
                inputEl.addEventListener('blur', async () => {
                    const value = inputEl.value;
                    const numValue = parseInt(value);
                    
                    if (isNaN(numValue) || numValue < 15 || numValue > 120) {
                        new Notice('Keepalive interval must be between 15 and 120 seconds');
                        this.plugin.settings.keepalive = DEFAULT_SETTINGS.keepalive;
                        inputEl.value = String(this.plugin.settings.keepalive);
                        await this.plugin.saveSettings();
                        return;
                    }
                    
                    this.plugin.settings.keepalive = numValue;
                    await this.plugin.saveSettings();
                });
                
                return text;
            });

        new Setting(containerEl)
            .setName('Output Folder')
            .setDesc('Folder where configuration files will be saved')
            .addText(text => {
                text.setPlaceholder('nordvpn-configs')
                    .setValue(this.plugin.settings.outputFolder);

                const inputEl = text.inputEl;
                inputEl.addEventListener('blur', async () => {
                    const value = inputEl.value.trim();
                    
                    if (!value) {
                        this.plugin.settings.outputFolder = DEFAULT_SETTINGS.outputFolder;
                        inputEl.value = this.plugin.settings.outputFolder;
                    } else {
                        this.plugin.settings.outputFolder = value;
                    }
                    await this.plugin.saveSettings();
                });

                return text;
            });

        new Setting(containerEl)
            .setName('API URL')
            .setDesc('URL of the NordVPN Config Generator API')
            .addText(text => {
                text.setPlaceholder('http://localhost:3000')
                    .setValue(this.plugin.settings.apiUrl);

                const inputEl = text.inputEl;
                inputEl.addEventListener('blur', async () => {
                    const value = inputEl.value.trim();

                    // Allow empty value to reset to default
                    if (!value) {
                        this.plugin.settings.apiUrl = DEFAULT_SETTINGS.apiUrl;
                        inputEl.value = this.plugin.settings.apiUrl;
                        await this.plugin.saveSettings();
                        return;
                    }

                    try {
                        const url = new URL(value);
                        
                        // Check protocol
                        if (!['http:', 'https:'].includes(url.protocol)) {
                            throw new Error('URL must use http or https protocol');
                        }

                        // Remove trailing slash for consistency
                        const normalizedUrl = value.replace(/\/$/, '');
                        
                        this.plugin.settings.apiUrl = normalizedUrl;
                        inputEl.value = normalizedUrl; // Normalize the format
                        await this.plugin.saveSettings();
                    } catch (error) {
                        new Notice(`Invalid API URL: ${error.message}`);
                        this.plugin.settings.apiUrl = DEFAULT_SETTINGS.apiUrl;
                        inputEl.value = this.plugin.settings.apiUrl;
                        await this.plugin.saveSettings();
                    }
                });

                return text;
            });
    }
} 