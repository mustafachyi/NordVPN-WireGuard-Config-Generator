enum LogLevel {
    INFO,
    WARN,
    ERROR,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
};

const formatLogEntry = (level: LogLevel, context: string, message: string): string => {
    const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const levelName = LEVEL_NAMES[level].padEnd(5);
    return `[${timestamp}] [${levelName}] [${context}] ${message}`;
};

const writeLog = (
    level: LogLevel,
    context: string,
    message: string,
    details?: unknown
): void => {
    if (process.env.NODE_ENV === 'test') {
        return;
    }

    const logMessage = formatLogEntry(level, context, message);
    const logMethod =
        level === LogLevel.ERROR
            ? console.error
            : level === LogLevel.WARN
            ? console.warn
            : console.log;

    logMethod(logMessage);
    if (details) {
        logMethod(details);
    }
};

export const Logger = {
    info: (context: string, message: string): void => {
        writeLog(LogLevel.INFO, context, message);
    },
    warn: (context: string, message: string): void => {
        writeLog(LogLevel.WARN, context, message);
    },
    error: (context: string, message: string, error?: unknown): void => {
        writeLog(LogLevel.ERROR, context, message, error);
    },
};