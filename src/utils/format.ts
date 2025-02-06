import { divideMonetaryValues, monetaryValue, roundMonetaryValue } from './math';

export function toFixedRemoveDot(n: number, fixed: number): string {
  const s = n.toFixed(fixed);
  return s.replace('.', '');
}

export function fillWithZeros(s: string, desiredSize: number): string {
  if (desiredSize - s.length <= 0) return s;

  const zeros = '0'.repeat(desiredSize - s.length);

  return zeros + s;
}

export function fillWithWhiteSpaces(s: string, desiredSize: number, atTheEnd = false): string {
  if (desiredSize - s.length <= 0) return s;

  const spaces = ' '.repeat(desiredSize - s.length);

  return atTheEnd ? s + spaces : spaces + s;
}

export function formatBrazilianDateWithYearAndMonth(date: Date): string {
  const brazilianDatetime = date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const [, month, year] = brazilianDatetime.split('/');
  return `${year.slice(-2)}${month}`;
}

export function formatToBrazilianDate(date: Date): string {
  return date.toISOString()
      .slice(0, 10)
      .split('-')
      .reverse()
      .join('/');
}

export function formatFixedPrice(price: string, cents = false): number {
  const value = cents ? divideMonetaryValues(price, '100') : price;
  return monetaryValue(roundMonetaryValue(value, 2));
}

export function convertToReaisWithoutCurrency(price: string, cents = false): string {
  const value = formatFixedPrice(price, cents);
  return value.toLocaleString('pt-BR');
}

export function convertToReais(price: string, cents = false): string {
  const value = formatFixedPrice(price, cents);
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function convertCentavosToReais(cents: number): string {
  return (cents/100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatCnpjCpf(value: string): string {
  const numbers = value.replace(/\D+/, '');

  if (numbers.length === 11) {
    return numbers.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/g, '$1.$2.$3-$4');
  }

  return numbers.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/g, '$1.$2.$3/$4-$5');
}

export function formatZipcode(value?: string): string | undefined {
  if (!value) return;

  const numbers = value.replace(/^\D+/g, '');

  return numbers.replace(/(\d{5})(\d{3})/g, '$1-$2');
}

export function replaceOnString(string: string, toBeReplaced: string, value: string): string {
  return string.replace(toBeReplaced, value);
}

export function formatPhone(number?: string): string {
  if (!number) return '';
  if (number.length < 8 || number.length > 9) throw new Error('[Format Phone] Invalid phone detected');
  const startNumber = number.length === 9 ? number.substring(0, 5) : number.substring(0, 4);
  const endNumber = number.length === 9 ? number.substring(5) : number.substring(4);
  return `${startNumber}-${endNumber}`;
}

export function formatPhoneToMsisdn(phone?: {
  countryCode: string,
  areaCode: string,
  phoneNumber: string,
}): string {
  if (!phone) return '';
  return `${phone.countryCode}${phone.areaCode}${phone.phoneNumber}`;
}

export function formatFileName(entity: string, resourceId: string, extension: string): string {
  return `${entity}-${resourceId}_${new Date().getTime()}.${extension}`;
}
