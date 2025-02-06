import { v4, validate } from 'uuid';

export class Uuid {
  readonly value: string;

  constructor(value: string) {
    if (!Uuid.isValid(value)) {
      throw new Error(`<${value}> is not a valid uuid`);
    }

    this.value = value;
  }

  static random(): Uuid {
    return new Uuid(v4());
  }

  static isValid(value: string) {
    return validate(value);
  }

  toString(): string {
    return this.value;
  }
}
