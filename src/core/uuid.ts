import { v4, v5, validate } from 'uuid';

export class Uuid {
  readonly value: string;

  constructor(value: string) {
    if (!Uuid.isValid(value)) {
      throw new Error(`<${value}> is not a valid uuid`);
    }

    this.value = value;
  }

  static toUuid(value: string): Uuid {
    return new Uuid(value);
  }

  static random(): Uuid {
    return new Uuid(v4());
  }

  static isValid(value: string) {
    return validate(value);
  }

  static fromSeed(seed: string, nameSpace: string): Uuid {
    return new Uuid(v5(seed, nameSpace));
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
