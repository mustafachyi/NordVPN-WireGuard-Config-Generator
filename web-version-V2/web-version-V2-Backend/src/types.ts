export interface ServerLoc {
    country: { name: string; code: string; city: { name: string } };
}

export interface RawServer {
    name: string;
    station: string;
    hostname: string;
    load: number;
    locations: ServerLoc[];
    technologies: { metadata: { name: string; value: string }[] }[];
}

export interface ProcessedServer {
    name: string;
    station: string;
    hostname: string;
    country: string;
    city: string;
    keyId: number;
}

export interface ServerPayload {
    h: string[];
    l: Record<string, Record<string, [string, number, string][]>>;
}

export interface Asset {
    content: Buffer;
    brotli: Buffer | null;
    mime: string;
    etag: string;
}

export interface ConfigRequest {
    token?: string;
    country?: string;
    city?: string;
    name?: string;
    privateKey?: string;
    dns?: string;
    endpoint?: string;
    keepalive?: number;
}

export interface ValidatedConfig {
    name: string;
    privateKey: string;
    dns: string;
    useStation: boolean;
    keepalive: number;
}