import { App, Notice, Plugin, TFolder, TFile, TextFileView, WorkspaceLeaf } from 'obsidian';
import axios from 'axios';
import { isValidPrivateKey, generateKey, normalizeServerName } from './utils';
import { ApiService, ConfigRequest } from './api.service';
import { VIEW_TYPE_NORDVPN, DEFAULT_SETTINGS, CACHE_EXPIRY_TIME, TOKEN_REGEX, NORDVPN_ICON } from './constants';
import { NordVPNView } from './view';
import { NordVPNSettingTab } from './settings';
import { NordVPNPluginSettings, ServerGroup, ServerInfo, ConfigServerInfo } from './types';

class ConfigFileView extends TextFileView {
	private editor: HTMLTextAreaElement;

	getViewType(): string {
		return "conf";
	}

	getDisplayText(): string {
		return this.file?.basename || "Config File";
	}

	getIcon(): string {
		return "document";
	}

	async onOpen() {
		if (this.file?.extension === 'conf') {
			const content = await this.app.vault.read(this.file);
			this.setViewData(content);
		}
	}

	async setViewData(data: string, clear: boolean = false) {
		this.contentEl.empty();
		
		// Create editor container with monospace font
		const container = this.contentEl.createDiv({
			cls: 'conf-editor-container'
		});
		
		// Create textarea for editing
		this.editor = container.createEl('textarea', {
			cls: 'conf-editor',
			attr: {
				spellcheck: 'false'
			}
		});
		
		// Set initial content
		this.editor.value = data;
		
		// Handle changes
		this.editor.addEventListener('input', () => {
			this.requestSave();
		});

		// Add some basic styling
		container.style.cssText = 'height: 100%; padding: 10px;';
		this.editor.style.cssText = `
			width: 100%;
			height: 100%;
			resize: none;
			font-family: var(--font-monospace);
			background-color: var(--background-primary);
			color: var(--text-normal);
			border: 1px solid var(--background-modifier-border);
			border-radius: 4px;
			padding: 10px;
			line-height: 1.5;
		`;
	}

	clear() {
		this.contentEl.empty();
	}

	getViewData(): string {
		return this.editor?.value || '';
	}

	requestSave = async () => {
		if (this.file) {
			await this.app.vault.modify(this.file, this.getViewData());
		}
	}
}

export default class NordVPNPlugin extends Plugin {
	settings: NordVPNPluginSettings;
	private serverCache: ServerGroup | null = null;
	private lastETag: string | null = null;
	private lastCacheTime: number | null = null;
	private apiService: ApiService;
	private privateKey: string | null = null;
	private _d: { iv: string, data: string } | null = null;

	async onload() {
		await this.loadSettings();
		this.apiService = new ApiService(this.settings.apiUrl);
		await this.loadPrivateKey();

		// Register .conf file extension and view handler
		this.registerExtensions(['conf'], 'conf');
		this.registerView('conf', (leaf) => new ConfigFileView(leaf));

		this.registerView(
			VIEW_TYPE_NORDVPN,
			(leaf) => new NordVPNView(leaf, this)
		);

		// Add ribbon icon with custom SVG
		const ribbonIconEl = this.addRibbonIcon('', 'NordVPN Config Generator', () => {
			this.activateView();
		});
		ribbonIconEl.innerHTML = NORDVPN_ICON;

		this.addSettingTab(new NordVPNSettingTab(this.app, this));
	}

	async onunload() {
		// Save private key before unloading
		if (this.privateKey) {
			try {
				await this.savePrivateKey();
			} catch (error) {
				console.error('Failed to save private key during unload:', error);
			}
		}
		this.clearCache();
	}

	private clearCache() {
		this.serverCache = null;
		this.lastETag = null;
		this.lastCacheTime = null;
	}

	private async loadPrivateKey() {
		try {
			const data = await this.loadData();
			if (data?._d?.iv && data?._d?.data && this.apiService) {
				const key = generateKey(CACHE_EXPIRY_TIME);
				try {
					const decrypted = this.apiService.decryptData(data._d.iv, data._d.data, key);
					if (isValidPrivateKey(decrypted)) {
						this.privateKey = decrypted;
						this._d = data._d;
					}
				} catch (error) {
					console.error('Failed to decrypt private key:', error);
					this.privateKey = null;
					this._d = null;
				}
			}
		} catch (error) {
			console.error('Error loading private key:', error);
			this.privateKey = null;
			this._d = null;
		}
	}

	private async savePrivateKey() {
		try {
			if (this.privateKey) {
				if (!isValidPrivateKey(this.privateKey)) {
					throw new Error('Invalid private key format');
				}
				const key = generateKey(CACHE_EXPIRY_TIME);
				this._d = this.apiService.encryptData(this.privateKey, key);
				
				const data = await this.loadData() || {};
				data._d = this._d;
				await this.saveData(data);
			} else {
				const data = await this.loadData() || {};
				delete data._d;
				this._d = null;
				await this.saveData(data);
			}
		} catch (error) {
			console.error('Failed to save private key:', error);
			throw error;
		}
	}

	async loadSettings() {
		const loadedData = await this.loadData() || {};
		
		// Clean up any sensitive data that might have been saved
		const sensitiveKeys = ['token'];
		let needsSave = false;
		sensitiveKeys.forEach(key => {
			if (key in loadedData) {
				delete loadedData[key];
				needsSave = true;
			}
		});

		// Merge settings, prioritizing saved values over defaults
		this.settings = {
			...DEFAULT_SETTINGS,  // Start with defaults
			...loadedData        // Override with saved values
		};

		// If we found and removed sensitive data, save the cleaned settings
		if (needsSave) {
			await this.saveData(loadedData);
		}
	}

	async saveSettings() {
		try {
			// First save private key to ensure it is persisted
			await this.savePrivateKey();
			
			// Load existing data to preserve encryptedPrivateKey
			const data = await this.loadData() || {};
			
			// Update with new settings while preserving _d
			const updatedData = {
				...data,
				dns: this.settings.dns,
				endpoint_type: this.settings.endpoint_type,
				keepalive: this.settings.keepalive,
				outputFolder: this.settings.outputFolder,
				apiUrl: this.settings.apiUrl,
				_d: this._d  // Ensure _d is included in the save
			};
			
			// Save all data
			await this.saveData(updatedData);
			
			// Update API service after settings are saved
			this.apiService = new ApiService(this.settings.apiUrl);

			// Update views after all saves are complete
			this.app.workspace.getLeavesOfType(VIEW_TYPE_NORDVPN).forEach(leaf => {
				const view = leaf.view as NordVPNView;
				view.updatePrivateKey();
			});
		} catch (error) {
			console.error('Failed to save settings:', error);
			throw error; // Re-throw to notify callers
		}
	}

	async ensureOutputFolder(): Promise<TFolder> {
		const folderPath = this.settings.outputFolder;
		const configFolder = this.app.vault.getAbstractFileByPath(folderPath) as TFolder;
		
		if (!configFolder) {
			await this.app.vault.createFolder(folderPath);
			return this.app.vault.getAbstractFileByPath(folderPath) as TFolder;
		}
		
		return configFolder;
	}

	async validateToken(token: string): Promise<string> {
		if (!token || !TOKEN_REGEX.test(token)) {
			throw new Error('Invalid token format. Token must be a 64-character hexadecimal string.');
		}
		return this.apiService.validateToken(token);
	}

	getPrivateKey(): string {
		if (!this.privateKey) {
			throw new Error('No private key available. Please generate one using your NordVPN token.');
		}
		return this.privateKey;
	}

	async getServers(): Promise<ServerGroup> {
		const now = Date.now();

		if (this.serverCache && this.lastCacheTime && (now - this.lastCacheTime) < CACHE_EXPIRY_TIME) {
			return this.serverCache;
		}

		const { data, etag } = await this.apiService.getServers(this.lastETag || undefined);
		
		if (data === null && this.serverCache) {
			this.lastCacheTime = now;
			return this.serverCache;
		}

		if (etag) {
			this.lastETag = etag;
		}

		this.serverCache = data;
		this.lastCacheTime = now;
		return data;
	}

	private sanitizeName(name: string): string {
		return name.toLowerCase()
			.replace(/\s+/g, '_')
			.replace(/(\d+)/g, '_$1')
			.replace(/and/g, '_and_')
			.replace(/_{2,}/g, '_')
			.replace(/^_+|_+$/g, '')
			.replace(/[^a-z0-9_]/g, '_')
			.replace(/_{2,}/g, '_');
	}

	private sanitizeApiName(name: string): string {
		// For API requests, we only lowercase and remove spaces
		return name.toLowerCase().replace(/\s+/g, '');
	}

	private createConfigRequest(privateKey: string | null, server: { country: string; city: string; name: string }): ConfigRequest {
		return {
			country: this.sanitizeApiName(server.country),
			city: this.sanitizeApiName(server.city),
			name: this.sanitizeApiName(server.name),
			...(privateKey && { privateKey }),
			dns: this.settings.dns,
			endpoint: this.settings.endpoint_type,
			keepalive: this.settings.keepalive
		};
	}

	async generateConfig(privateKey: string | null, server: { country: string; city: string; name: string }): Promise<string> {
		return this.apiService.generateConfig(this.createConfigRequest(privateKey, server));
	}

	async generateQRCode(privateKey: string | null, server: { country: string; city: string; name: string }): Promise<string> {
		const blob = await this.apiService.generateQRCode(this.createConfigRequest(privateKey, server));
		return URL.createObjectURL(blob);
	}

	async saveConfig(privateKey: string | null, server: ConfigServerInfo, basePath: string) {
		const config = await this.generateConfig(privateKey, {
			country: this.sanitizeApiName(server.country),
			city: this.sanitizeApiName(server.city),
			name: this.sanitizeApiName(server.name)
		});

		try {
			// Create the full path for the file
			const filePath = `${this.settings.outputFolder}/${basePath}/${this.sanitizeName(server.country)}/${this.sanitizeName(server.city)}/${this.sanitizeName(server.name)}.conf`.replace(/\/+/g, '/');

			// Ensure the parent folders exist
			const folders = filePath.split('/').slice(0, -1);
			let currentPath = '';
			for (const folder of folders) {
				currentPath += folder + '/';
				try {
					await this.app.vault.createFolder(currentPath.slice(0, -1));
				} catch (error) {
					// Ignore if folder exists
				}
			}

			// Get or create the file
			const existingFile = this.app.vault.getAbstractFileByPath(filePath);
			if (existingFile instanceof TFile) {
				await this.app.vault.modify(existingFile, config);
			} else {
				await this.app.vault.create(filePath, config);
			}

			new Notice(`Configuration saved to ${filePath}`);
		} catch (error) {
			new Notice(`Failed to save config for ${server.name}: ${error.message}`);
			throw error;
		}
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_NORDVPN)[0] || workspace.getLeaf(false);
		await leaf.setViewState({ type: VIEW_TYPE_NORDVPN, active: true });
		workspace.revealLeaf(leaf);
	}

	async setPrivateKey(privateKey: string) {
		if (!isValidPrivateKey(privateKey)) {
			throw new Error('Invalid WireGuard private key format');
		}
		this.privateKey = privateKey;
		await this.saveSettings();
	}

	async clearPrivateKey() {
		this.privateKey = null;
		await this.saveSettings();
	}
}
