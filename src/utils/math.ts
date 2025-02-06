import * as mathjs from 'mathjs';

export function sumMonetaryValues(a: string, b: string): string {
  return mathjs.format(mathjs.sum(mathjs.number(a), mathjs.number(b)), { precision: 14 });
}

export function subtractMonetaryValues(a: string, b: string): string {
  return mathjs.format(mathjs.subtract(mathjs.number(a), mathjs.number(b)), { precision: 14 });
}

export function multiplyMonetaryValues(a: string, b: string): string {
  return mathjs.format(mathjs.multiply(mathjs.number(a), mathjs.number(b)), { precision: 14 });
}

export function divideMonetaryValues(a: string, b: string): string {
  return mathjs.format(mathjs.divide(mathjs.number(a), mathjs.number(b)), { precision: 14 });
}

export function absoluteMonetaryValue(value: string): number {
  return mathjs.abs(mathjs.number(value));
}

export function monetaryValue(value: string): number {
  return mathjs.number(value);
}

export function roundMonetaryValue(value: string, decimals: number): string {
  return mathjs.format(mathjs.round(monetaryValue(value), decimals), { precision: 14 });
}

export function monetaryValueLargerThan(firstValue: string, secondValue: string) {
  return mathjs.larger(firstValue, secondValue);
}

export function monetaryValueIsEqual(firstValue: string, secondValue: string) {
  return mathjs.equal(firstValue, secondValue);
}
