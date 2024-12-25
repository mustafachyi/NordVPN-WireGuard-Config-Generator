export class Logger {
  private static cacheUpdateCount = 0;

  private static formatTime(): string {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
  }

  static info(context: string, message: string): void {
    console.log(`[${this.formatTime()}] [INFO] [${context}] ${message}`);
  }

  static error(context: string, message: string, error?: any): void {
    console.error(`[${this.formatTime()}] [ERROR] [${context}] ${message}`);
    if (error) {
      console.error(`[${this.formatTime()}] [ERROR] [${context}] Details:`, error);
    }
  }

  static warn(context: string, message: string): void {
    console.warn(`[${this.formatTime()}] [WARN] [${context}] ${message}`);
  }

  static clear(): void {
    console.clear();
  }

  static incrementCacheUpdate(): number {
    return ++this.cacheUpdateCount;
  }

  static getCacheUpdateCount(): number {
    return this.cacheUpdateCount;
  }
}
