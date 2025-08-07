import { Logger } from '../utils/logger';
import { brotliCompressSync } from 'zlib';

const HTML_FILE_PATH = './public/index.html';

class HtmlService {
    private baseHtml: string | null = null;
    private injectedHtml: string | null = null;
    private compressedInjectedHtml: Buffer | null = null;
    private htmlEtag: string | null = null;

    public async initialize(): Promise<void> {
        try {
            this.baseHtml = await Bun.file(HTML_FILE_PATH).text();
            this.updateInjectedHtml(null, 'initial');
            Logger.info('HtmlService', 'Base HTML template initialized and cached.');
        } catch (error) {
            Logger.error('HtmlService', 'Fatal: Could not read base HTML file.', error);
            throw new Error('Failed to initialize HtmlService.');
        }
    }

    public updateInjectedHtml(serversPayload: Buffer | null, serverEtag: string): void {
        if (!this.baseHtml) {
            const errorMessage = 'Service is starting, please refresh shortly.';
            this.injectedHtml = errorMessage;
            this.compressedInjectedHtml = brotliCompressSync(errorMessage);
            Logger.error('HtmlService', 'Cannot update HTML: Base template not loaded.');
            return;
        }

        if (!serversPayload) {
            this.injectedHtml = this.baseHtml;
            Logger.warn('HtmlService', 'Server data unavailable, serving static HTML.');
        } else {
            const dataScript = `<script id="server-data" type="application/json">${serversPayload.toString('utf-8')}</script>`;
            this.injectedHtml = this.baseHtml.replace('</body>', `${dataScript}</body>`);
        }
        
        this.compressedInjectedHtml = brotliCompressSync(this.injectedHtml);
        this.htmlEtag = serverEtag;
    }

    public getInjectedHtml(): string {
        return this.injectedHtml ?? 'Service Unavailable';
    }

    public getCompressedInjectedHtml(): Buffer | null {
        return this.compressedInjectedHtml;
    }

    public getEtag(): string | null {
        return this.htmlEtag;
    }
}

export const htmlService = new HtmlService();