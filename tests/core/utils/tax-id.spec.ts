import { describe, expect, test } from 'vitest';
import { validateCnpj, validateCpf, validateCpfCnpj } from '../../../src/utils/tax-id';

describe('utils tax id', () => {
  describe('validateCpf function', () => {
    test('should turn true when receiving a valid CPF', () => {
      const cpf = '67051897039'; // valid CPF using https://www.4devs.com.br/gerador_de_cpf
      const result = validateCpf(cpf);
      expect(result).toBe(true);
    });

    test('should turn false when receiving an invalid CPF', () => {
      const cpf = '67051897038';
      const result = validateCpf(cpf);
      expect(result).toBe(false);
    });
  });

  describe('validateCnpj function', () => {
    test('should turn true when receiving a valid CNPJ', () => {
      const cnpj = '15662494000147'; // valid CNPJ using https://www.4devs.com.br/gerador_de_cnpj
      const result = validateCnpj(cnpj);
      expect(result).toBe(true);
    });

    test('should turn false when receiving an invalid CNPJ', () => {
      const cnpj = '15662494000146';
      const result = validateCnpj(cnpj);
      expect(result).toBe(false);
    });
  });

  describe('validateCpfCnpj function', () => {
    test('should turn true when receiving a valid CPF', () => {
      const cpf = '67051897039';
      const result = validateCpfCnpj(cpf);
      expect(result).toBe(true);
    });

    test('should turn true when receiving a valid CNPJ', () => {
      const cnpj = '15662494000147';
      const result = validateCpfCnpj(cnpj);
      expect(result).toBe(true);
    });

    test('should turn false when receiving an invalid CPF or CNPJ', () => {
      const cnpj = '15662494000146';
      const result = validateCpfCnpj(cnpj);
      expect(result).toBe(false);
    });
  });
});
