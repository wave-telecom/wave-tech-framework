import type { Result } from '../core/result';

/**
 * Contract for a single network-adapter operation: takes a validated request,
 * returns either the success value or a typed error — never throws for an
 * expected failure. Distinct from `core/use-case.ts`'s `UseCase<IRequest,
 * IResponse>` (no error channel), which BSS modules' own `application/
 * use-cases/` already use for a different purpose.
 */
export interface ProviderUseCase<TInput, TOutput, TError> {
  execute: (input: TInput) => Promise<Result<TOutput, TError>>;
}
