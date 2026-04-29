import { describe, it, expect } from 'vitest';
import {
    setHookContext,
    setHookLogMetadata,
    getHookLogMetadata,
} from '../../src/core/hooks';

describe('setHookLogMetadata', () => {
    it('object overload — sets all keys', () => {
        setHookContext(() => {
            setHookLogMetadata({ a: 1, b: 2 });
            expect(getHookLogMetadata()).toEqual({ a: 1, b: 2 });
        });
    });

    it('key/value overload — sets single key', () => {
        setHookContext(() => {
            setHookLogMetadata('a', 1);
            expect(getHookLogMetadata()).toEqual({ a: 1 });
        });
    });

    it('merges new keys without dropping previous', () => {
        setHookContext(() => {
            setHookLogMetadata({ a: 1 });
            setHookLogMetadata({ b: 2 });
            expect(getHookLogMetadata()).toEqual({ a: 1, b: 2 });
        });
    });

    it('overwrites same key on subsequent call', () => {
        setHookContext(() => {
            setHookLogMetadata({ a: 1 });
            setHookLogMetadata({ a: 2 });
            expect(getHookLogMetadata()).toEqual({ a: 2 });
        });
    });

    it('mixed overloads merge correctly', () => {
        setHookContext(() => {
            setHookLogMetadata({ a: 1 });
            setHookLogMetadata('b', 2);
            expect(getHookLogMetadata()).toEqual({ a: 1, b: 2 });
        });
    });

    it('returns empty object outside ALS zone', () => {
        expect(getHookLogMetadata()).toEqual({});
    });

    it('isolates metadata between parallel ALS zones', async () => {
        const captured: Record<string, unknown>[] = [];
        await Promise.all([
            new Promise<void>((resolve) => {
                setHookContext(() => {
                    setHookLogMetadata({ zone: 'A' });
                    setImmediate(() => {
                        captured.push(getHookLogMetadata());
                        resolve();
                    });
                });
            }),
            new Promise<void>((resolve) => {
                setHookContext(() => {
                    setHookLogMetadata({ zone: 'B' });
                    setImmediate(() => {
                        captured.push(getHookLogMetadata());
                        resolve();
                    });
                });
            }),
        ]);
        expect(captured).toContainEqual({ zone: 'A' });
        expect(captured).toContainEqual({ zone: 'B' });
    });
});
