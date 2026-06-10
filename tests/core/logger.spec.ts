import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { transports as winstonTransports } from 'winston';
import { Logger, WinstonLogger } from '../../src/core/logger';

const makeStreamTransport = () =>
    new winstonTransports.Stream({ stream: new PassThrough() });

describe('Logger.initialize with custom transports', () => {
    it('registers additional transports alongside default Console', () => {
        const custom = makeStreamTransport();
        Logger.initialize('test-service', { transports: [custom] });

        const instance = WinstonLogger.getInstance();
        expect(instance.transports).toHaveLength(2);
        expect(instance.transports[0]).toBeInstanceOf(winstonTransports.Console);
        expect(instance.transports[1]).toBe(custom);
    });

    it('keeps singleton — second initialize does not replace transports', () => {
        Logger.initialize('other-service', { transports: [makeStreamTransport()] });

        const instance = WinstonLogger.getInstance();
        expect(instance.transports).toHaveLength(2);
    });
});
