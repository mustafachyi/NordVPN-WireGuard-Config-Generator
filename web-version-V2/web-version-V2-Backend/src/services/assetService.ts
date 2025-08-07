import { join, relative } from 'path';
import { readdir } from 'fs/promises';
import { getMimeType } from 'hono/utils/mime';
import { Logger } from '../utils/logger';

interface CachedAsset {
    path: string;
    content: Buffer;
    compressedContent: Buffer | null;
    mimeType: string;
    etag: string;
}

const PUBLIC_ROOT = './public';

class AssetService {
    private sortedAssets: CachedAsset[] = [];

    private async scanAndCacheDirectory(directory: string, assetList: CachedAsset[]): Promise<void> {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(directory, entry.name);
            if (entry.isDirectory()) {
                await this.scanAndCacheDirectory(fullPath, assetList);
            } else if (entry.isFile() && !entry.name.endsWith('.br')) {
                await this.cacheFile(fullPath, assetList);
            }
        }
    }

    private async cacheFile(filePath: string, assetList: CachedAsset[]): Promise<void> {
        const file = Bun.file(filePath);
        const content = Buffer.from(await file.arrayBuffer());
        const compressedPath = `${filePath}.br`;
        const compressedFile = Bun.file(compressedPath);
        let compressedContent: Buffer | null = null;

        if (await compressedFile.exists()) {
            compressedContent = Buffer.from(await compressedFile.arrayBuffer());
        }

        const webPath = `/${relative(PUBLIC_ROOT, filePath).replace(/\\/g, '/')}`;
        const finalPath = webPath.endsWith('/index.html') ? webPath.slice(0, -10) || '/' : webPath;
        
        assetList.push({
            path: finalPath,
            content,
            compressedContent,
            mimeType: getMimeType(filePath) ?? 'application/octet-stream',
            etag: `W/"${content.length}-${file.lastModified}"`,
        });
    }

    public async initialize(): Promise<void> {
        Logger.info('AssetService', 'Starting static asset caching...');
        const assetList: CachedAsset[] = [];
        await this.scanAndCacheDirectory(PUBLIC_ROOT, assetList);
        
        assetList.sort((a, b) => a.path.localeCompare(b.path));
        this.sortedAssets = assetList;

        Logger.info('AssetService', `Cached and sorted ${this.sortedAssets.length} assets from disk.`);
    }

    public get(path: string): CachedAsset | undefined {
        const targetPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
        
        let low = 0;
        let high = this.sortedAssets.length - 1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const midPath = this.sortedAssets[mid].path;

            if (midPath === targetPath) {
                return this.sortedAssets[mid];
            }

            if (midPath < targetPath) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return undefined;
    }
}

export const assetService = new AssetService();