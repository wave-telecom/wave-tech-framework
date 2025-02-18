import type { Request, Response, NextFunction } from 'express';
import type { Mock } from 'vitest';
import { setContext, setCorrelationId, setTenantId } from '../../src/middlewares/context';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import * as hooks from '../../src/core/hooks';
import { Uuid } from '../../src/core/uuid';

// Mock dependencies
vi.mock('../../src/core/hooks');
vi.mock('../../src/core/uuid');

describe('Context Middleware', () => {
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
