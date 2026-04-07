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
    test('should return true when receiving a valid numeric CNPJ', () => {
      const cnpj = '15662494000147'; // valid CNPJ using https://www.4devs.com.br/gerador_de_cnpj
      const result = validateCnpj(cnpj);
      expect(result).toBe(true);
    });

    test('should return false when receiving an invalid numeric CNPJ', () => {
      const cnpj = '15662494000146';
      const result = validateCnpj(cnpj);
      expect(result).toBe(false);
    });

    test('should return false when receiving a repeated-digit numeric CNPJ', () => {
      expect(validateCnpj('00000000000000')).toBe(false);
      expect(validateCnpj('11111111111111')).toBe(false);
      expect(validateCnpj('99999999999999')).toBe(false);
    });

    test('should return true when receiving a valid alphanumeric CNPJ', () => {
      // Example from SERPRO document: 12.ABC.345/01DE-35
      const cnpj = '12ABC34501DE35';
      const result = validateCnpj(cnpj);
      expect(result).toBe(true);
    });

    test('should return false when receiving an alphanumeric CNPJ with wrong check digits', () => {
      const cnpj = '12ABC34501DE36'; // last digit should be 5, not 6
      const result = validateCnpj(cnpj);
      expect(result).toBe(false);
    });

    test('should return false when receiving an alphanumeric CNPJ with wrong first check digit', () => {
      const cnpj = '12ABC34501DE45'; // first DV should be 3, not 4
      const result = validateCnpj(cnpj);
      expect(result).toBe(false);
    });

    test('should return true when receiving a valid alphanumeric CNPJ in lowercase', () => {
      const cnpj = '12abc34501de35'; // same as valid alphanumeric, normalized to uppercase
      const result = validateCnpj(cnpj);
      expect(result).toBe(true);
    });

    test('should return false when receiving a CNPJ with invalid characters', () => {
      const cnpj = '12ABC34501D@35'; // '@' is outside the SERPRO charset [0-9A-Z]
      const result = validateCnpj(cnpj);
      expect(result).toBe(false);
    });

    test('should return true when receiving a valid numeric CNPJ with mask', () => {
      const cnpj = '15.662.494/0001-47';
      const result = validateCnpj(cnpj);
      expect(result).toBe(true);
    });

    test('should return true when receiving a valid alphanumeric CNPJ with mask', () => {
      const cnpj = '12.ABC.345/01DE-35';
      const result = validateCnpj(cnpj);
      expect(result).toBe(true);
    });

    test('should return false when receiving an invalid numeric CNPJ with mask', () => {
      const cnpj = '15.662.494/0001-46';
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
