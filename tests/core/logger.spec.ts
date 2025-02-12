import { describe, expect, it } from 'vitest';
import { Logger } from 'src'

const testFn = () => {
  Logger.info('test');
  return 1 + 1;
};

describe('logger', () => {
  it('should guarantee that test does not fail if env is local and logger is not initialized manually', () => {
    process.env.NODE_ENV = 'local';
    const result = testFn();
    expect(result).toBe(2);
  });

  it('should guarantee that test does not fail if env is test and logger is not initialized manually', () => {
    process.env.NODE_ENV = 'test';
    const result = testFn();
    expect(result).toBe(2);
  });
});
