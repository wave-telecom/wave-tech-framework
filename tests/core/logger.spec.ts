import { describe, it, expect } from 'vitest';
import Transport from 'winston-transport';
import { transports as winstonTransports } from 'winston';
import { Logger, WinstonLogger } from '../../src/core/logger';

class FakeHttpTransport extends Transport {
    logs: unknown[] = [];

    override log(info: unknown, callback: () => void) {
        this.logs.push(info);
        callback();
    }
}

describe('Logger.initialize with custom transports', () => {
    it('registers additional transports alongside default Console', () => {
        const fake = new FakeHttpTransport();
        Logger.initialize('test-service', { transports: [fake] });

        const instance = WinstonLogger.getInstance();
        expect(instance.transports).toHaveLength(2);
        expect(instance.transports[0]).toBeInstanceOf(winstonTransports.Console);
        expect(instance.transports[1]).toBe(fake);
    });

    it('keeps singleton — second initialize does not replace transports', () => {
        Logger.initialize('other-service', { transports: [new FakeHttpTransport()] });

        const instance = WinstonLogger.getInstance();
        expect(instance.transports).toHaveLength(2);
    });
});
