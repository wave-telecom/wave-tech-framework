import { addDays } from 'date-fns';
import { fillWithZeros } from './format';

const MILLISECONDS_IN_A_DAY = 1000 * 60 * 60 * 24;

export function getPeriodFromMonthAndYear(
  referenceYear: number, referenceMonth: number
): { startDate: Date; endDate: Date; } {
  let endMonth: number;
  let endYear: number;

  if ((referenceMonth + 1) > 12) {
    endMonth = 1;
    endYear = referenceYear + 1;
  } else {
    endMonth = referenceMonth + 1;
    endYear = referenceYear;
  }

  const startDate = new Date(`${referenceYear}-${fillWithZeros(referenceMonth.toString(), 2)}-01T00:00:00.000-03:00`);
  const endDate = new Date(`${endYear}-${fillWithZeros(endMonth.toString(), 2)}-01T00:00:00.000-03:00`);

  return { startDate, endDate };
}

export function getFirstDate(): Date {
  return new Date('1970-01-01');
}

export function getFirstAndLastDayOfMonth(): { firstDay: Date; lastDay: Date; } {
  const date = new Date();
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);

  return { firstDay, lastDay };
}

export function getDifferenceInDays(newerDate: Date, olderDate: Date): string {
  const differenceInMillis = Math.abs(olderDate.getTime() - newerDate.getTime());
  const differenceInDays = Math.ceil(differenceInMillis / MILLISECONDS_IN_A_DAY);

  return differenceInDays.toString();
}

export function addDaysToDate(date: Date, days: number): Date {
  const dateToAdd = new Date(date);
  dateToAdd.setDate(dateToAdd.getDate() + days);

  return dateToAdd;
}

interface SplittedDate { day: number; month: number; year: number; }
export function splitDate(date: Date): SplittedDate {
  return {
    day: date.getDate(),
    month: date.getMonth(),
    year: date.getFullYear(),
  };
}

export function setDateToMidnight(date: Date): Date {
  return new Date(date.setHours(0, 0, 0, 0));
}

export function getBrazilianDate(date: Date): string {
  return date.toLocaleDateString('pt-BR');
}

export function secondsToMillis(seconds: number): number {
  const milliseconds = 1000;
  return seconds * milliseconds;
}

function calculateEasterDate(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month - 1, day);
}

function calculateBrazilianHolidays(year: number): Date[] {
  const easterDate = calculateEasterDate(year);

  const fixedHolidays = [
    new Date(year, 0, 1), // Ano Novo
    new Date(year, 3, 21), // Tiradentes
    new Date(year, 4, 1), // Dia do Trabalhador
    new Date(year, 8, 7), // Independência do Brasil
    new Date(year, 9, 12), // Nossa Senhora Aparecida
    new Date(year, 10, 2), // Finados
    new Date(year, 10, 15), // Proclamação da republica
    new Date(year, 11, 25), // Natal
  ];

  const mobileHolidays = [
    easterDate, // Pascoa
    addDays(easterDate, -48), // Segunda-feira Carnaval
    addDays(easterDate, -47), // Terça-feira Carnaval
    addDays(easterDate, -2), // Sexta-feira Santa
    addDays(easterDate, 60), // Corpus Christi
  ];

  const allHolidays = fixedHolidays.concat(mobileHolidays);
  allHolidays.sort((a, b) => a.getTime() - b.getTime());

  return allHolidays;
}

export function isBrazilianHoliday(dateToCheck: Date): boolean {
  const holidays: Date[] = calculateBrazilianHolidays(dateToCheck.getUTCFullYear());

  return holidays.some((date) => date.toISOString().split('T')[0] === dateToCheck.toISOString().split('T')[0]);
}

export function isWeekend(dateToCheck: Date): boolean {
  const dayOfWeek = dateToCheck.getDay();

  return dayOfWeek === 5 || dayOfWeek === 6;
}

export function addHoursToDate(originalDate: Date, hoursToAdd: number): Date {
  const newDate = new Date(originalDate);
  newDate.setHours(originalDate.getHours() + hoursToAdd);

  return newDate;
}

export function dateDiffInMonths(dateFrom: Date, dateTo: Date) {
  return dateTo.getMonth() - dateFrom.getMonth() +
    (12 * (dateTo.getFullYear() - dateFrom.getFullYear()));
}

export function removeDaysFromDate(date: Date, days: number): Date {
  const dateToAdd = new Date(date);
  dateToAdd.setDate(dateToAdd.getDate() - days);

  return dateToAdd;
}

export function convertToUTC(data: string): string {
  const dataLocal = new Date(data);
  const ano = dataLocal.getUTCFullYear();
  const mes = ('0' + (dataLocal.getUTCMonth() + 1)).slice(-2);
  const dia = ('0' + dataLocal.getUTCDate()).slice(-2);
  const hora = ('0' + (dataLocal.getUTCHours() + 3)).slice(-2);
  const minuto = ('0' + dataLocal.getUTCMinutes()).slice(-2);
  const segundo = ('0' + dataLocal.getUTCSeconds()).slice(-2);

  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}Z`;
}

export function convertToLocal(data: string): string {
  const dataLocal = new Date(data + 'z');
  const ano = dataLocal.getUTCFullYear();
  const mes = ('0' + (dataLocal.getUTCMonth() + 1)).slice(-2);
  const dia = ('0' + dataLocal.getUTCDate()).slice(-2);
  const hora = ('0' + (dataLocal.getUTCHours() - 3)).slice(-2);
  const minuto = ('0' + dataLocal.getUTCMinutes()).slice(-2);
  const segundo = ('0' + dataLocal.getUTCSeconds()).slice(-2);

  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}Z`;
}
