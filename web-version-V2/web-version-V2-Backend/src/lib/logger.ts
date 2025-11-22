export const Log = {
    info: (ctx: string, msg: string) => console.log(`[${new Date().toISOString()}] [INFO ] [${ctx}] ${msg}`),
    warn: (ctx: string, msg: string) => console.warn(`[${new Date().toISOString()}] [WARN ] [${ctx}] ${msg}`),
    error: (ctx: string, msg: string, err?: unknown) => console.error(`[${new Date().toISOString()}] [ERROR] [${ctx}] ${msg}`, err)
};