import { ItemView, WorkspaceLeaf, ButtonComponent, DropdownComponent, setIcon, Notice, Modal } from 'obsidian';
import { VIEW_TYPE_NORDVPN } from './constants';
import NordVPNPlugin from './main';
import { ServerGroup, ServerData, ConfigServerInfo } from './types';

export class NordVPNView extends ItemView {
    private plugin: NordVPNPlugin;
    private privateKey: string | null = null;
    private servers: ServerGroup | null = null;
    private selectedCountry: string = 'All Countries';
    private selectedCity: string = 'All Cities';
    private sortByLoad: boolean = false;
    private sortAZ: boolean = true;
    private sortLoadReverse: boolean = false;
    private sortAZReverse: boolean = false;
    private observer: IntersectionObserver | null = null;
    private currentPage: number = 0;
    private readonly serversPerPage: number = 40;
    private citySelect: DropdownComponent | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: NordVPNPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    public updatePrivateKey() {
        try {
            this.privateKey = this.plugin.getPrivateKey();
        } catch (error) {
            this.privateKey = null;
            console.log('No private key set, continuing without it');
        }
    }

    getViewType(): string {
        return VIEW_TYPE_NORDVPN;
    }

    getDisplayText(): string {
        return 'NordVPN Config Generator';
    }

    async onOpen() {
        await this.initializeView();
    }

    async onClose() {
        this.observer?.disconnect();
    }

    private async initializeView() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('nordvpn-view');

        try {
            // Try to get private key if available, but don't require it
            try {
                this.privateKey = this.plugin.getPrivateKey();
            } catch (error) {
                // Just log it, don't show error or return
                console.log('No private key set, continuing without it');
            }

            // Get servers
            this.servers = await this.plugin.getServers();
            if (!this.servers) {
                this.showError('Failed to fetch server list.');
                return;
            }

            // Create controls
            this.createControls(container);

            // Create server grid
            const gridEl = container.createEl('div', { cls: 'nordvpn-server-grid' });
            
            // Initialize intersection observer for lazy loading
            this.setupLazyLoading(gridEl);

            // Initial render
            this.renderServers();

        } catch (error) {
            this.showError(`An error occurred: ${error.message}`);
        }
    }

    private createControls(container: HTMLElement) {
        // Create top bar
        const topBar = container.createEl('div', { cls: 'nordvpn-top-bar' });

        // Left side - Country and City dropdowns
        const selectorsEl = topBar.createEl('div', { cls: 'nordvpn-selectors' });
        selectorsEl.setAttribute('data-all-countries', 'true');

        // Country selector
        const countrySelect = new DropdownComponent(selectorsEl)
            .addOption('All Countries', 'All Countries');
        
        if (this.servers) {
            Object.keys(this.servers).sort().forEach(country => {
                countrySelect.addOption(country, this.formatDisplayName(country));
            });
        }

        // Create container for city dropdown
        const cityContainer = selectorsEl.createDiv({ cls: 'city-select' });

        // City selector
        this.citySelect = new DropdownComponent(cityContainer)
            .addOption('All Cities', 'All Cities');
        
        countrySelect.setValue(this.selectedCountry)
            .onChange((value) => {
                this.selectedCountry = value;
                selectorsEl.setAttribute('data-all-countries', value === 'All Countries' ? 'true' : 'false');
                
                if (value === 'All Countries') {
                    this.selectedCity = 'All Cities';
                } else {
                    const cities = this.servers?.[value];
                    if (cities && Object.keys(cities).length === 1) {
                        this.selectedCity = Object.keys(cities)[0];
                    } else {
                        this.selectedCity = 'All Cities';
                    }
                }
                
                this.updateCityDropdown();
                this.renderServers();
                this.updateServerCount(countEl);
            });

        this.updateCityDropdown();
        
        this.citySelect.onChange((value) => {
            this.selectedCity = value;
            this.renderServers();
            this.updateServerCount(countEl);
        });

        // Right side - Sort controls and count
        const controlsEl = topBar.createEl('div', { cls: 'nordvpn-controls' });

        // Sort buttons
        const loadSortBtn = new ButtonComponent(controlsEl)
            .setButtonText('By Load')
            .onClick(() => {
                if (this.sortByLoad) {
                    this.sortLoadReverse = !this.sortLoadReverse;
                } else {
                    this.sortByLoad = true;
                    this.sortAZ = false;
                    this.sortLoadReverse = false;
                }
                this.updateSortButtons(loadSortBtn, azSortBtn);
                this.renderServers();
            });

        const azSortBtn = new ButtonComponent(controlsEl)
            .setButtonText('A-Z')
            .onClick(() => {
                if (this.sortAZ) {
                    this.sortAZReverse = !this.sortAZReverse;
                } else {
                    this.sortAZ = true;
                    this.sortByLoad = false;
                    this.sortAZReverse = false;
                }
                this.updateSortButtons(loadSortBtn, azSortBtn);
                this.renderServers();
            });

        // Server count
        const countEl = controlsEl.createEl('div', { 
            cls: 'server-count',
            attr: { style: 'margin-left: var(--size-4-2);' }
        });
        this.updateServerCount(countEl);

        // Initial sort button states
        this.updateSortButtons(loadSortBtn, azSortBtn);
    }

    private updateSortButtons(loadBtn: ButtonComponent, azBtn: ButtonComponent) {
        loadBtn.buttonEl.removeClass('mod-cta', 'mod-warning');
        azBtn.buttonEl.removeClass('mod-cta', 'mod-warning');

        if (this.sortByLoad) {
            loadBtn.buttonEl.addClass(this.sortLoadReverse ? 'mod-warning' : 'mod-cta');
        } else if (this.sortAZ) {
            azBtn.buttonEl.addClass(this.sortAZReverse ? 'mod-warning' : 'mod-cta');
        }
    }

    private updateCityDropdown() {
        if (!this.servers || !this.citySelect) return;

        const currentValue = this.citySelect.getValue();
        const dropdownEl = this.citySelect.selectEl;
        
        while (dropdownEl.firstChild) {
            dropdownEl.removeChild(dropdownEl.firstChild);
        }

        if (this.selectedCountry !== 'All Countries') {
            const cities = this.servers[this.selectedCountry];
            if (cities) {
                const cityList = Object.keys(cities).sort();
                
                if (cityList.length > 1) {
                    const allCitiesOption = document.createElement('option');
                    allCitiesOption.value = 'All Cities';
                    allCitiesOption.text = 'All Cities';
                    dropdownEl.appendChild(allCitiesOption);
                }

                cityList.forEach(city => {
                    const option = document.createElement('option');
                    option.value = city;
                    option.text = this.formatDisplayName(city);
                    dropdownEl.appendChild(option);
                });

                if (cityList.length === 1) {
                    this.selectedCity = cityList[0];
                    this.citySelect.setValue(cityList[0]);
                } else {
                    const options = Array.from(dropdownEl.options).map(opt => opt.value);
                    this.citySelect.setValue(options.includes(currentValue) ? currentValue : 'All Cities');
                }
            }
        }
    }

    private getFilteredServers(): ServerData[] {
        if (!this.servers) return [];

        let filtered: ServerData[] = [];

        Object.entries(this.servers).forEach(([country, cities]) => {
            if (this.selectedCountry === 'All Countries' || country === this.selectedCountry) {
                Object.entries(cities).forEach(([city, servers]) => {
                    if (this.selectedCity === 'All Cities' || city === this.selectedCity) {
                        servers.forEach(server => {
                            filtered.push({ country, city, server });
                        });
                    }
                });
            }
        });

        if (this.sortByLoad) {
            filtered.sort((a, b) => {
                const comparison = a.server.load - b.server.load;
                return this.sortLoadReverse ? -comparison : comparison;
            });
        } else if (this.sortAZ) {
            filtered.sort((a, b) => {
                const comparison = a.server.name.localeCompare(b.server.name);
                return this.sortAZReverse ? -comparison : comparison;
            });
        }

        return filtered;
    }

    private async renderServers() {
        if (!this.servers) return;

        const gridEl = this.containerEl.querySelector('.nordvpn-server-grid') as HTMLElement;
        if (!gridEl) return;

        gridEl.empty();
        this.currentPage = 0;

        const filtered = this.getFilteredServers();
        const start = 0;
        const end = Math.min(this.serversPerPage, filtered.length);

        this.renderServerBatch(gridEl, filtered, start, end);

        if (end < filtered.length) {
            const sentinel = gridEl.createEl('div', { cls: 'scroll-sentinel' });
            this.observer?.observe(sentinel);
        }
    }

    private async loadMoreServers() {
        const filtered = this.getFilteredServers();
        const gridEl = this.containerEl.querySelector('.nordvpn-server-grid') as HTMLElement;
        if (!gridEl) return;

        const start = (this.currentPage + 1) * this.serversPerPage;
        const end = Math.min(start + this.serversPerPage, filtered.length);

        if (start < filtered.length) {
            const oldSentinel = gridEl.querySelector('.scroll-sentinel');
            if (oldSentinel) {
                oldSentinel.remove();
            }

            this.currentPage++;
            this.renderServerBatch(gridEl, filtered, start, end);

            if (end < filtered.length) {
                const sentinel = gridEl.createEl('div', { 
                    cls: 'scroll-sentinel',
                    attr: { style: 'height: 10px; margin: 10px 0;' }
                });
                this.observer?.observe(sentinel);
            }
        }
    }

    private renderServerBatch(containerEl: HTMLElement, servers: ServerData[], start: number, end: number) {
        for (let i = start; i < end; i++) {
            const { country, city, server } = servers[i];
            this.createServerCard(containerEl, country, city, server);
        }
    }

    private createServerCard(containerEl: HTMLElement, country: string, city: string, server: { name: string; load: number }) {
        const cardEl = containerEl.createEl('div', { 
            cls: 'server-card-container',
            attr: { style: 'margin: 0.25rem; flex: 1 1 250px; min-width: 250px; max-width: calc(50% - 0.5rem);' }
        });
        
        const cardContent = cardEl.createEl('div', { cls: 'server-card' });

        // Info on the left
        const infoEl = cardContent.createEl('div', { cls: 'server-card-info' });
        infoEl.createEl('div', { 
            cls: 'server-card-name', 
            text: this.formatDisplayName(server.name)
        });

        const descEl = infoEl.createEl('div', { cls: 'server-card-description' });
        descEl.createEl('span', {
            cls: 'server-card-location',
            text: `${this.formatDisplayName(city)}, ${this.formatDisplayName(country)}`
        });
        
        descEl.createSpan({
            cls: `server-card-load ${server.load > 70 ? 'mod-error' : server.load > 40 ? 'mod-warning' : 'mod-success'}`,
            text: ` • ${server.load}%`
        });

        // Actions on the right
        const controlEl = cardContent.createEl('div', { cls: 'server-card-actions' });

        // Copy config button
        const copyBtn = new ButtonComponent(controlEl)
            .setIcon('copy')
            .setTooltip('Copy configuration');
        copyBtn.buttonEl.addClass('server-card-icon-button');
        copyBtn.onClick(async () => {
            try {
                // Get the latest private key before generating config
                this.updatePrivateKey();
                const config = await this.plugin.generateConfig(this.privateKey, {
                    country,
                    city,
                    name: server.name
                });
                await navigator.clipboard.writeText(config);
                new Notice('Configuration copied to clipboard');
            } catch (error) {
                new Notice(`Failed to copy configuration: ${error.message}`);
            }
        });

        // Download button
        const downloadBtn = new ButtonComponent(controlEl)
            .setIcon('download')
            .setTooltip('Download configuration');
        downloadBtn.buttonEl.addClass('server-card-icon-button');
        downloadBtn.onClick(async () => {
            try {
                // Get the latest private key before saving config
                this.updatePrivateKey();
                await this.plugin.saveConfig(this.privateKey, {
                    country,
                    city,
                    name: server.name
                }, '');
            } catch (error) {
                new Notice(`Failed to save configuration: ${error.message}`);
            }
        });

        // QR Code button
        const qrBtn = new ButtonComponent(controlEl)
            .setIcon('qr-code')
            .setTooltip('Show QR code');
        qrBtn.buttonEl.addClass('server-card-icon-button');
        qrBtn.onClick(async () => {
            try {
                // Get the latest private key before generating QR code
                this.updatePrivateKey();
                const qrUrl = await this.plugin.generateQRCode(this.privateKey, {
                    country,
                    city,
                    name: server.name
                });
                this.showQRCode(qrUrl, server.name);
            } catch (error) {
                new Notice(`Failed to generate QR code: ${error.message}`);
            }
        });
    }

    private showQRCode(qrUrl: string, serverName: string) {
        const modal = new Modal(this.app);
        const { contentEl } = modal;
        contentEl.addClass('nordvpn-qr-modal');

        contentEl.createEl('h2', { text: `QR Code for ${serverName}` });
        
        contentEl.createEl('p', { 
            text: 'Scan this code with your mobile device to import the WireGuard configuration.',
            cls: 'nordvpn-qr-description'
        });

        contentEl.createEl('img', {
            attr: {
                src: qrUrl,
                alt: `WireGuard Configuration QR Code for ${serverName}`
            }
        });

        modal.onClose = () => {
            URL.revokeObjectURL(qrUrl);
            contentEl.empty();
        };

        modal.open();
    }

    private showError(message: string) {
        const container = this.containerEl.children[1];
        container.empty();
        container.createEl('div', {
            cls: 'nordvpn-status error',
            text: message
        });
    }

    private setupLazyLoading(gridEl: HTMLElement) {
        this.observer?.disconnect();
        
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadMoreServers();
                }
            });
        }, { 
            root: gridEl,
            threshold: 0.1,
            rootMargin: '100px'
        });

        const sentinel = gridEl.createEl('div', { 
            cls: 'scroll-sentinel',
            attr: { style: 'height: 10px; margin: 10px 0;' }
        });
        this.observer.observe(sentinel);
    }

    private updateServerCount(countEl: HTMLElement) {
        if (!this.servers) return;
        
        const filtered = this.getFilteredServers();
        const total = filtered.length;
        
        countEl.setText(`${total} server${total !== 1 ? 's' : ''}`);
    }

    private formatDisplayName(name: string): string {
        return name.replace(/_/g, ' ');
    }
} 