/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextFunction, Request, Response } from 'express';
import type { Context, Next } from 'hono';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as hooks from '../../src/core/hooks';
import { Uuid } from '../../src/core/uuid';
import { setContext, setContextHono, setCorrelationId, setCorrelationIdHono, setTenantId, setTenantIdHono } from '../../src/middlewares/context';

// Mock dependencies
vi.mock('../../src/core/hooks');
vi.mock('../../src/core/uuid');

describe('Express Context Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      body: {}
    };
    mockResponse = {};
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe('set context', () => {
    it('should call setHookContext and next', () => {
      setContext(mockRequest as Request, mockResponse as Response, mockNext);

      expect(hooks.setHookContext).toHaveBeenCalled();
    });
  });

  describe('set correlation id', () => {
    it('should use correlation ID from header', () => {
      const testCorrelationId = 'test-correlation-id';
      mockRequest.headers = {
        'x-correlation-id': testCorrelationId
      };

      setCorrelationId(mockRequest as Request, mockResponse as Response, mockNext);

      expect(hooks.setHookCorrelationId).toHaveBeenCalledWith(testCorrelationId);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use correlation ID from message attributes', () => {
      const testCorrelationId = 'test-correlation-id';
      mockRequest.body = {
        message: {
          attributes: {
            correlationId: testCorrelationId
          }
        }
      };

      setCorrelationId(mockRequest as Request, mockResponse as Response, mockNext);

      expect(hooks.setHookCorrelationId).toHaveBeenCalledWith(testCorrelationId);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should generate new correlation ID if none provided', () => {
      const mockUuid = 'generated-uuid';
      (Uuid.random as Mock).mockReturnValue({ value: mockUuid });

      setCorrelationId(mockRequest as Request, mockResponse as Response, mockNext);

      expect(hooks.setHookCorrelationId).toHaveBeenCalledWith(mockUuid);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should prefer message attributes over header for correlation ID', () => {
      const headerCorrelationId = 'header-correlation-id';
      const attributeCorrelationId = 'attribute-correlation-id';
      mockRequest.headers = {
        'x-correlation-id': headerCorrelationId
      };
      mockRequest.body = {
        message: {
          attributes: {
            correlationId: attributeCorrelationId
          }
        }
      };

      setCorrelationId(mockRequest as Request, mockResponse as Response, mockNext);

      expect(hooks.setHookCorrelationId).toHaveBeenCalledWith(attributeCorrelationId);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('set tenant id', () => {
    const defaultTenantId = 'default-tenant';

    it('should use tenant ID from header', () => {
      const testTenantId = 'test-tenant';
      mockRequest.headers = {
        'x-tenant-id': testTenantId
      };

      const middleware = setTenantId(defaultTenantId);
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(hooks.setHookTenantId).toHaveBeenCalledWith(testTenantId);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use default tenant ID if none provided in header', () => {
      const middleware = setTenantId(defaultTenantId);
      middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(hooks.setHookTenantId).toHaveBeenCalledWith(defaultTenantId);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should throw an error if tenant ID is not provided in header nor default tenant ID', () => {
      const middleware = setTenantId();
      expect(() => {
        middleware(mockRequest as Request, mockResponse as Response, mockNext)
      }).toThrow('Tenant ID is required, but it is not present in the request headers');
    });
  });
});

describe('Hono Context Middleware', () => {
  let mockContext: Partial<Context>;
  let mockNext: Next;

  beforeEach(() => {
    mockContext = {
      req: {
        header: vi.fn(),
      } as any,
    };
    mockNext = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();
    (hooks.setHookContext as Mock).mockImplementation(callback => callback());
  });

  describe('setContextHono', () => {
    it('should call setHookContext and next', async () => {
      await setContextHono(mockContext as Context, mockNext);
      expect(hooks.setHookContext).toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('setCorrelationIdHono', () => {
    it('should use correlation ID from header', async () => {
      const testCorrelationId = 'test-correlation-id';
      (mockContext.req!.header as Mock).mockReturnValue(testCorrelationId);

      await setCorrelationIdHono(mockContext as Context, mockNext);

      expect(mockContext.req!.header).toHaveBeenCalledWith('x-correlation-id');
      expect(hooks.setHookCorrelationId).toHaveBeenCalledWith(testCorrelationId);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should generate new correlation ID if none provided', async () => {
      const mockUuid = 'generated-uuid';
      (mockContext.req!.header as Mock).mockReturnValue(undefined);
      (Uuid.random as Mock).mockReturnValue({ value: mockUuid });

      await setCorrelationIdHono(mockContext as Context, mockNext);

      expect(hooks.setHookCorrelationId).toHaveBeenCalledWith(mockUuid);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('setTenantIdHono', () => {
    const defaultTenantId = 'default-tenant';

    it('should use tenant ID from header', async () => {
      const testTenantId = 'test-tenant';
      (mockContext.req!.header as Mock).mockReturnValue(testTenantId);

      const middleware = setTenantIdHono(defaultTenantId);
      await middleware(mockContext as Context, mockNext);

      expect(mockContext.req!.header).toHaveBeenCalledWith('x-tenant-id');
      expect(hooks.setHookTenantId).toHaveBeenCalledWith(testTenantId);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use default tenant ID if none provided in header', async () => {
      (mockContext.req!.header as Mock).mockReturnValue(undefined);

      const middleware = setTenantIdHono(defaultTenantId);
      await middleware(mockContext as Context, mockNext);

      expect(hooks.setHookTenantId).toHaveBeenCalledWith(defaultTenantId);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should throw an error if tenant ID is not provided in header nor default tenant ID', async () => {
      (mockContext.req!.header as Mock).mockReturnValue(undefined);
      const middleware = setTenantIdHono();
      await expect(middleware(mockContext as Context, mockNext))
        .rejects.toThrow('Tenant ID is required, but it is not present in the request headers');
    });
  });
});
