import type { ZodError, ZodIssue } from 'zod';

export const validationErrors = {
  string: (fieldName: string) => `${fieldName} should be a string.`,
  min: (length: number) => `Value length should be less than ${length} characters.`,
  max: (length: number) => `Value length should not be more than ${length} characters.`,
  array: (fieldName: string) => `${fieldName} should be an array.`,
  boolean: (fieldName: string) => `${fieldName} should be a boolean.`,
  number: (fieldName: string) => `${fieldName} should be a number.`,
  enum: (values: string[]) => `Valid values are: ${values.join(', ')}.`,
  uuid: () => 'Value should be a valid uuid',
  date: (fieldName: string) => `${fieldName} should be a valid date.`,
};

export interface ValidationError {
  message: string;
  field: string | number;
}

export const formatValidationErrors = (error?: ZodError): ValidationError[] => {
  if (!error) return [];
  return error.errors.map((issue: ZodIssue) => ({
    message: issue.message,
    field: issue.path[0],
  }));
};
