import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { UseCase } from '../core/use-case';
import { Logger } from '../logger';
import { BaseController } from './base-controller';
import { ControllerErrors } from './controller-errors';
import { formatValidationErrors } from './validation-errors';

export class SubscriberController<T> extends BaseController {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly validator: z.ZodType<any, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly useCase: UseCase<any, any>,
    private treatErrors: ControllerErrors<T>,
  ) {
    super();
  }

  async executeImpl(req: Request, res: Response): Promise<Response> {
    const stringifiedBody = Buffer.from(req.body.message.data, 'base64').toString('utf-8');
    const body = JSON.parse(stringifiedBody);
    const validation = this.validator.safeParse(body);

    if (!validation.success) {
      const errors = formatValidationErrors(validation.error);
      Logger.warn('Some validation errors occurred', { body }, errors);
      return this.clientError(res, undefined, errors);
    }

    const result = await this.useCase.execute(validation.data);

    if (result?.ok === false) return this.treatErrors(result, res);

    return this.ok(res);
  }
}
