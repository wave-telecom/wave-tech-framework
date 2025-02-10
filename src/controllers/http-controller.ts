import { type Request, type Response } from 'express';
import type { z } from 'zod';
import type { UseCase } from '../core/use-case';
import { BaseController } from './base-controller';
import type { ControllerErrors } from './controller-errors';
import { formatValidationErrors } from './validation-errors';

export class HttpController<T> extends BaseController {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly validator: z.ZodType<any, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly useCase: UseCase<any, any>,
    private treatErrors: ControllerErrors<T>,
    private isAsyncResponse = false,
  ) {
    super();
  }

  async executeImpl(req: Request, res: Response): Promise<Response> {
    const validation = this.validator.safeParse({
      ...req.body,
      ...req.params,
      ...req.query,
    });

    if (!validation.success) {
      const errors = formatValidationErrors(validation.error);
      return this.clientError(res, undefined, errors);
    }

    const result = await this.useCase.execute(validation.data);

    if (result?.ok === false) return this.treatErrors(result, res);

    if (this.isAsyncResponse) return this.accepted(res);
    if ((result?.ok && !result?.value) || !result) return this.noContent(res);

    if (result.value?.total || result.total) {
      res.setHeader('x-total-count', result.value?.total ?? result.total);
      return this.ok(res, result.value?.data ?? result.data);
    }

    return this.ok(res, result.value ?? result);
  }
}
