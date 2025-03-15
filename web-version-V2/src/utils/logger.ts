export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

// Core types
interface LogEntry {
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly context: string;
  readonly message: string;
  readonly details?: unknown;
}

// Configuration
const LOG_CONFIG = {
  MAX_ENTRIES: 200,
  CLEANUP_THRESHOLD: 150,
  CLEANUP_TARGET: 100,
  DEFAULT_LEVEL: LogLevel.INFO,
  LEVEL_LABELS: ['DEBUG', 'INFO ', 'WARN ', 'ERROR'] as const,
  TIMESTAMP_SLICE_END: -5
} as const;

/** Efficient logging system with automatic memory management */
export class Logger {
  private static readonly logs: LogEntry[] = [];
  private static cacheUpdateCount = 0;
  private static currentLevel: LogLevel = LOG_CONFIG.DEFAULT_LEVEL;
  private static lastCleanup = Date.now();
  
  /** Formats current time as ISO string without milliseconds */
  private static getTimeString(): string {
    return new Date().toISOString()
      .replace('T', ' ')
      .slice(0, LOG_CONFIG.TIMESTAMP_SLICE_END);
  }

  /** Creates formatted log line with metadata */
  private static formatLogMessage(level: LogLevel, context: string, message: string): string {
    return `[${this.getTimeString()}] [${LOG_CONFIG.LEVEL_LABELS[level]}] [${context}] ${message}`;
  }

  /** Cleans old entries if needed */
  private static cleanupIfNeeded(): void {
    const now = Date.now();
    
    // Only cleanup if threshold reached and not cleaned in last 5 seconds
    if (this.logs.length > LOG_CONFIG.CLEANUP_THRESHOLD && 
        now - this.lastCleanup > 5000) {
      
      this.lastCleanup = now;
      this.logs.splice(0, this.logs.length - LOG_CONFIG.CLEANUP_TARGET);
      global.gc?.();
    }
  }

  /** Processes new log entry with automatic cleanup */
  private static addEntry(level: LogLevel, context: string, message: string, details?: unknown): void {
    if (level < this.currentLevel) return;

    // Store immutable entry
    const entry: LogEntry = Object.freeze({
      timestamp: Date.now(),
      level,
      context,
      message,
      details
    });

    this.logs.push(entry);
    this.cleanupIfNeeded();

    // Output to console
    const formattedMessage = this.formatLogMessage(level, context, message);
    switch (level) {
      case LogLevel.ERROR:
        console.error(formattedMessage);
        if (details) {
          const errorDetails = `[${this.getTimeString()}] [ERROR] [${context}] Details:`;
          console.error(errorDetails, details);
        }
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        break;
      default:
        console.log(formattedMessage);
    }
  }

  // Public methods
  static setLogLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  static debug(context: string, message: string): void {
    this.addEntry(LogLevel.DEBUG, context, message);
  }

  static info(context: string, message: string): void {
    this.addEntry(LogLevel.INFO, context, message);
  }

  static warn(context: string, message: string): void {
    this.addEntry(LogLevel.WARN, context, message);
  }

  static error(context: string, message: string, error?: unknown): void {
    this.addEntry(LogLevel.ERROR, context, message, error);
  }

  static clear(): void {
    this.logs.length = 0;
    console.clear();
  }

  static getRecentLogs(count = 100): ReadonlyArray<LogEntry> {
    const startIndex = Math.max(0, this.logs.length - count);
    return Object.freeze(this.logs.slice(startIndex));
  }

  static incrementCacheUpdate(): number {
    return ++this.cacheUpdateCount;
  }

  static getCacheUpdateCount(): number {
    return this.cacheUpdateCount;
  }
}
