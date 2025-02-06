import type * as express from 'express';
import { Logger } from '../logger';
import { ValidationError } from './validation-errors';

export abstract class BaseController {
  protected abstract executeImpl(
    req: express.Request,
    res: express.Response
  ): Promise<unknown>;

  async execute(req: express.Request, res: express.Response): Promise<void> {
    try {
      await this.executeImpl(req, res);
    } catch (err) {
      Logger.error('[BaseController] Unexpected error occurred', {}, err);
      this.fail(res, 'An unexpected error occurred', err);
    }
  }

  static jsonResponse(
    res: express.Response,
    code: number,
    message: string
  ): express.Response {
    return res.status(code).json({ message });
  }

  noContent(res: express.Response): express.Response {
    return res.sendStatus(204);
  }

  ok<T>(res: express.Response, dto?: T): express.Response {
    if (dto) {
      res.type('application/json');
      return res.status(200).json(dto);
    }

    return res.sendStatus(200);
  }

  created<T>(res: express.Response, dto?: T): express.Response {
    if (dto) {
      res.type('application/json');
      return res.status(201).json(dto);
    }

    return res.sendStatus(201);
  }

  accepted(res: express.Response): express.Response {
    return res.sendStatus(202);
  }

  processing(res: express.Response): express.Response {
    return res.sendStatus(102);
  }

  clientError(
    res: express.Response,
    message?: string,
    validationErrors?: ValidationError[]
  ): express.Response {
    if (validationErrors?.length) {
      return res.status(400).json({ message: message ?? 'Bad Request', errors: validationErrors });
    }
    return BaseController.jsonResponse(res, 400, message ?? 'Bad Request');
  }

  unauthorized(res: express.Response, message?: string): express.Response {
    return BaseController
      .jsonResponse(res, 401, message ? message : 'Unauthorized');
  }

  paymentRequired(res: express.Response, message?: string): express.Response {
    return BaseController
      .jsonResponse(res, 402, message ? message : 'Payment required');
  }

  forbidden(res: express.Response, message?: string): express.Response {
    return BaseController
      .jsonResponse(res, 403, message ? message : 'Forbidden');
  }

  notFound(res: express.Response, message?: string): express.Response {
    return BaseController
      .jsonResponse(res, 404, message ? message : 'Not found');
  }

  conflict(res: express.Response, message?: string): express.Response {
    return BaseController
      .jsonResponse(res, 409, message ? message : 'Conflict');
  }

  unprocessableEntity(
    res: express.Response,
    message?: string
  ): express.Response {
    return BaseController
      .jsonResponse(res, 422, message ? message : 'Unprocessable Entity');
  }

  tooMany(res: express.Response, message?: string): express.Response {
    return BaseController
      .jsonResponse(res, 429, message ? message : 'Too many requests');
  }

  fail(
    res: express.Response,
    message: string,
    err?: unknown
  ): express.Response {
    const errMsg = err instanceof Error ? err.message : 'Error not specified.';
    return res.status(500).json({
      message,
      error: errMsg,
    });
  }

  mountOptionalArray<T>(prop: unknown): T[] | undefined {
    if (!prop) return undefined;
    return prop instanceof Array ? prop : [prop];
  }

  buildLinkHeader(path: string, total: number, page: number, pageSize: number): string {
    let result = '';
    const maxPage = Math.ceil(total / pageSize);
    const previousPage = page > 1 ? page - 1 : undefined;

    result += `</${path}?page=${page}&pageSize=${pageSize}>;rel=self,`;
    result += `</${path}?page=1&pageSize=${pageSize}>;rel=first,`;

    if (previousPage) {
      result += `</${path}?page=${previousPage}&pageSize=${pageSize}>;rel=previous,`;
    }

    if (page < maxPage) {
      result += `</${path}?page=${page + 1}&pageSize=${pageSize}>;rel=next,`;
    }

    result += `</${path}?page=${maxPage}&pageSize=${pageSize}>;rel=last`;

    return result;
  }
}
