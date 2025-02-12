import type { Logger as WinstonLoggerInstance } from 'winston';
import { createLogger, format, transports } from 'winston';
import { getHookCorrelationId } from './hooks';
type Severity = 'debug' | 'info' | 'http' | 'warn' | 'error';

export class WinstonLogger {
    private static instance: WinstonLoggerInstance | undefined;

    static getInstance(serviceName?: string) {
        if (!this.instance) {
            this.instance = createLogger({
                level: 'http',
                format: format.combine(
                    format((info) => {
                        if (process.env.NODE_ENV === 'test') return false;
                        info['severity'] = info.level.toUpperCase();
                        return info;
                    })(),
                    format.timestamp(),
                    format.errors({ stack: true }),
                    format.splat(),
                    format.json()
                ),
                defaultMeta: {
                    service: process.env.NODE_ENV === 'test' ?
                        'test' :
                        serviceName,
                },
                transports: [
                    new transports.Console(),
                ],
            });
        }
        return this.instance;
    }
}

export class Logger {
    private static loggerInstance: WinstonLoggerInstance | undefined;

    private constructor() { }

    static {
        const env = process.env.NODE_ENV;
        if (env && ['local', 'test'].includes(env)) this.initialize('local-service');
    }

    static initialize(serviceName: string) {
        if (this.loggerInstance) return;
        this.loggerInstance = WinstonLogger.getInstance(serviceName);
    }

    private static getLogger() {
        if (!this.loggerInstance) throw new Error('Logger not initialized');
        return this.loggerInstance;
    }

    private static log(
        severity: Severity,
        message: string,
        meta?: Record<string, unknown>,
        err?: unknown
    ) {
        const logger = this.getLogger();
        const errorMsg = err instanceof Error ? `Error: ${err.message}` : '';
        const errObject = err instanceof Error ?
            {
                message: err.message,
                name: err.name,
                stack: err.stack,
            } :
            JSON.stringify(err);

        const correlationId = getHookCorrelationId();
        const logMessage = `${message}. ${errorMsg}`;
        const metaObj = { ...meta, err: errObject, correlationId };
        logger.log(severity, logMessage, metaObj);
    }

    static debug(message: string, meta?: Record<string, unknown>, err?: unknown) {
        this.log('debug', message, meta, err);
    }

    static info(message: string, meta?: Record<string, unknown>, err?: unknown) {
        this.log('info', message, meta, err);
    }

    static http(message: string, meta?: Record<string, unknown>, err?: unknown) {
        this.log('http', message, meta, err);
    }

    static warn(message: string, meta?: Record<string, unknown>, err?: unknown) {
        this.log('warn', message, meta, err);
    }

    static error(message: string, meta?: Record<string, unknown>, err?: unknown) {
        this.log('error', message, meta, err);
    }
}
