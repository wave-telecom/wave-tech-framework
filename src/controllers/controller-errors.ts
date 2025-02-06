import type express from 'express';

export interface ErrorParams<T> {
  error: T;
  message: string;
}

export type ControllerErrors<T> = (
  code: ErrorParams<T>,
  response: express.Response,
) => express.Response;
