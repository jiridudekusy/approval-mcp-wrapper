import type { Locale } from './i18n.js';

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function humanDateTime(date: Date, locale: Locale, timeZone?: string, dateOnly = false): string {
  const options = timeZone === undefined ? {} : { timeZone };
  const dateText = new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'numeric', year: 'numeric', ...options,
  }).format(date);
  if (dateOnly) return dateText;
  const timeText = new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', hour12: false, ...options,
  }).format(date);
  return `${dateText}${locale === 'cs' ? ' v ' : ' at '}${timeText}`;
}

export function formatDateTime(value: Date | string, locale: Locale): string {
  if (typeof value === 'string') {
    if (ISO_DATE_TIME.test(value)) return formatIsoDateTime(value, locale) ?? value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : humanDateTime(parsed, locale);
  }
  return humanDateTime(value, locale);
}

export function formatIsoDateTime(value: string, locale: Locale): string | undefined {
  const parts = ISO_DATE_TIME.exec(value);
  if (parts === null) return undefined;
  const [, year, month, day, hour, minute, seconds, zone] = parts;
  const dateOnly = hour === undefined;
  const wallTime = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour ?? 0), Number(minute ?? 0), Number(seconds ?? 0)));
  if (wallTime.getUTCFullYear() !== Number(year) ||
      wallTime.getUTCMonth() !== Number(month) - 1 ||
      wallTime.getUTCDate() !== Number(day) ||
      wallTime.getUTCHours() !== Number(hour ?? 0) ||
      wallTime.getUTCMinutes() !== Number(minute ?? 0) ||
      wallTime.getUTCSeconds() !== Number(seconds ?? 0)) return undefined;
  const date = zone === undefined
    ? wallTime
    : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return humanDateTime(date, locale, zone === undefined ? 'UTC' : undefined, dateOnly);
}
