/**
 * Formatting helpers shared across pages.
 *
 * The API returns unix timestamps; some endpoints may use seconds and others
 * milliseconds, so `toMs` normalises both using a magnitude check.
 *
 * Number/date formatting and relative-time wording follow the language
 * currently selected in `i18n` (read lazily, so switching the language is
 * picked up on the next render).
 */

import { getLang, t, type Lang } from "./i18n";

const LOCALES: Record<Lang, string> = { ru: "ru-RU", en: "en-US" };

function locale(): string {
  return LOCALES[getLang()];
}

const integerFormats: Record<Lang, Intl.NumberFormat> = {
  ru: new Intl.NumberFormat("ru-RU"),
  en: new Intl.NumberFormat("en-US"),
};

const shortDateFormats: Record<Lang, Intl.DateTimeFormat> = {
  ru: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }),
  en: new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }),
};

const fullDateFormats: Record<Lang, Intl.DateTimeFormat> = {
  ru: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }),
  en: new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric" }),
};

export function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

export function formatCost(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `$${value.toFixed(4)}`;
}

export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return integerFormats[getLang()].format(Math.round(value));
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return integerFormats[getLang()].format(Math.round(value));
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Russian plural: forms are [one, few, many], e.g. ["den", "dnya", "dney"].
 * Kept for Russian-only call sites; bilingual strings go through `t()` with
 * plural arrays instead.
 */
export function pluralRu(value: number, forms: [string, string, string]): string {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/** Relative timestamp such as "5 min ago" (locale wording via `t`). */
export function timeAgo(ts: number): string {
  const diff = Date.now() - toMs(ts);
  if (diff < 10_000) return t("time.justNow");
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t("time.secondsAgo", { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t("time.yesterday");
  if (days < 7) return t("time.daysAgo", { n: days });
  return shortDateFormats[getLang()].format(new Date(toMs(ts)));
}

/** Absolute clock time, HH:MM:SS. */
export function formatClock(ts: number): string {
  return new Date(toMs(ts)).toLocaleTimeString(locale(), {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Absolute date + time, used in tooltips. */
export function formatDateTime(ts: number): string {
  return new Date(toMs(ts)).toLocaleString(locale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Localised short date from a "YYYY-MM-DD" string (calendar tooltips). */
export function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return fullDateFormats[getLang()].format(new Date(year, (month ?? 1) - 1, day ?? 1));
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("greeting.morning");
  if (hour < 18) return t("greeting.afternoon");
  return t("greeting.evening");
}

/** "820 ms" style latency, used in connection test results. */
export function formatLatency(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return t("common.ok");
  return `${Math.round(ms)} ms`;
}
