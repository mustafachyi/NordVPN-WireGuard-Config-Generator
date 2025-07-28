export enum LogLevel {
    INFO,
    WARN,
    ERROR,
}

const LOG_LEVEL_MAP: Record<LogLevel, string> = {
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
};

export class Logger {
    private static currentLevel: LogLevel = LogLevel.INFO;

    private static formatMessage(
        level: LogLevel,
        context: string,
        message: string
    ): string {
        const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const levelLabel = LOG_LEVEL_MAP[level].padEnd(5);
        return `[${timestamp}] [${levelLabel}] [${context}] ${message}`;
    }

    private static log(
        level: LogLevel,
        context: string,
        message: string,
        details?: unknown
    ): void {
        if (level < this.currentLevel || process.env.NODE_ENV === 'test') return;

        const formattedMessage = this.formatMessage(level, context, message);
        const logMethod =
            level === LogLevel.ERROR
                ? console.error
                : level === LogLevel.WARN
                ? console.warn
                : console.log;

        logMethod(formattedMessage);
        if (details) {
            logMethod(details);
        }
    }

    static info(context: string, message: string): void {
        this.log(LogLevel.INFO, context, message);
    }

    static warn(context: string, message: string): void {
        this.log(LogLevel.WARN, context, message);
    }

    static error(context: string, message: string, error?: unknown): void {
        this.log(LogLevel.ERROR, context, message, error);
    }
}