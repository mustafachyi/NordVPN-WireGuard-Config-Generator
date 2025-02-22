// Extend Obsidian App interface to include SecretStorage API
declare module 'obsidian' {
    interface App {
        loadSecret(key: string): Promise<string | null>;
        saveSecret(key: string, value: string): Promise<void>;
        deleteSecret(key: string): Promise<void>;
    }
}

// Plugin Settings Interface
export interface NordVPNPluginSettings {
    dns: string;
    endpoint_type: 'hostname' | 'station';
    keepalive: number;
    outputFolder: string;
    apiUrl: string;
}

// Server Data Structures
export interface ServerGroup {
    [country: string]: {
        [city: string]: Array<{
            name: string;
            load: number;
        }>;
    };
}

export interface ServerInfo {
    name: string;
    hostname: string;
    station: string;
    load: number;
    country: string;
    city: string;
    public_key: string;
}

// Configuration Related Types
export interface ConfigServerInfo {
    name: string;
    country: string;
    city: string;
}

export interface ServerData {
    country: string;
    city: string;
    server: {
        name: string;
        load: number;
    };
} 