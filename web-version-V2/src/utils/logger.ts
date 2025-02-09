export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  context: string;
  message: string;
  details?: any;
}

export class Logger {
  private static readonly MAX_LOG_ENTRIES = 1000; // Keep last 1000 entries
  private static readonly CLEANUP_THRESHOLD = 800; // Clean when reaching 800 entries
  private static logs: LogEntry[] = [];
  private static cacheUpdateCount = 0;
  private static currentLogLevel: LogLevel = LogLevel.INFO;

  private static cleanup(): void {
    if (this.logs.length > this.CLEANUP_THRESHOLD) {
      // Keep only the most recent entries
      this.logs = this.logs.slice(-this.MAX_LOG_ENTRIES);
    }
  }

  private static shouldLog(level: LogLevel): boolean {
    return level >= this.currentLogLevel;
  }

  private static log(level: LogLevel, context: string, message: string, details?: any): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      context,
      message,
      details
    };

    this.logs.push(entry);
    this.cleanup();

    // Format for console output
    const time = new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, -5);
    const levelStr = LogLevel[level].padEnd(5);
    
    switch (level) {
      case LogLevel.ERROR:
        console.error(`[${time}] [${levelStr}] [${context}] ${message}`);
        if (details) console.error(`[${time}] [${levelStr}] [${context}] Details:`, details);
        break;
      case LogLevel.WARN:
        console.warn(`[${time}] [${levelStr}] [${context}] ${message}`);
        break;
      default:
        console.log(`[${time}] [${levelStr}] [${context}] ${message}`);
    }
  }

  static setLogLevel(level: LogLevel): void {
    this.currentLogLevel = level;
  }

  static debug(context: string, message: string): void {
    this.log(LogLevel.DEBUG, context, message);
  }

  static info(context: string, message: string): void {
    this.log(LogLevel.INFO, context, message);
  }

  static warn(context: string, message: string): void {
    this.log(LogLevel.WARN, context, message);
  }

  static error(context: string, message: string, error?: any): void {
    this.log(LogLevel.ERROR, context, message, error);
  }

  static clear(): void {
    this.logs = [];
    console.clear();
  }

  static getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(-count);
  }

  static incrementCacheUpdate(): number {
    return ++this.cacheUpdateCount;
  }

  static getCacheUpdateCount(): number {
    return this.cacheUpdateCount;
  }
}
