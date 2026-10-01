import clsx from "clsx";
import { formatCost, formatCount, formatDay } from "../format";
import { useT, type TFn, type TranslationKey } from "../i18n";
import { useApi } from "../hooks";
import type { ActivityDay, ActivityResponse } from "../types";
import { ErrorNote, Loading } from "./Feedback";

const WEEKDAY_KEYS: TranslationKey[] = [
  "weekday.mon",
  "weekday.tue",
  "weekday.wed",
  "weekday.thu",
  "weekday.fri",
  "weekday.sat",
  "weekday.sun",
];
/** Compact weekday labels (Mon/Wed/Fri), like GitHub. */
const LABELED_ROWS = new Set([0, 2, 4]);
const MONTH_KEYS: TranslationKey[] = [
  "month.jan",
  "month.feb",
  "month.mar",
  "month.apr",
  "month.may",
  "month.jun",
  "month.jul",
  "month.aug",
  "month.sep",
  "month.oct",
  "month.nov",
  "month.dec",
];

/** Calm green ramp; step 0 is the neutral "no activity" tone. */
const CELL_LEVELS = [
  "bg-zinc-100 dark:bg-zinc-800",
  "bg-emerald-100 dark:bg-emerald-950",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-600 dark:bg-emerald-500",
];

function parseIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/**
 * Group days into week columns (Monday first). Leading cells before the first
 * day and trailing cells after today stay blank, like GitHub. The flattened
 * result feeds a `grid-flow-col grid-rows-7` grid: columns = weeks,
 * rows = weekdays.
 */
function buildColumns(days: ActivityDay[]): (ActivityDay | null)[][] {
  const columns: (ActivityDay | null)[][] = [];
  let current: (ActivityDay | null)[] | null = null;

  for (const day of days) {
    const weekday = (parseIsoDate(day.date).getDay() + 6) % 7; // Monday = 0
    if (current === null || weekday === 0) {
      if (current !== null) columns.push(current);
      current = [];
      for (let index = 0; index < weekday; index += 1) current.push(null);
    }
    current.push(day);
  }

  if (current !== null) {
    while (current.length < 7) current.push(null);
    columns.push(current);
  }

  return columns;
}

/** Short month label above the column where that month first appears. */
function buildMonthLabels(
  columns: (ActivityDay | null)[][],
  monthLabels: string[],
): (string | null)[] {
  let labelledMonth: number | null = null;
  return columns.map((column) => {
    for (const day of column) {
      if (!day) continue;
      const month = parseIsoDate(day.date).getMonth();
      if (labelledMonth === null || month !== labelledMonth) {
        labelledMonth = month;
        return monthLabels[month] ?? null;
      }
    }
    return null;
  });
}

/** Intensity step (0–4) of a cell relative to the busiest day. */
function levelOf(tokens: number, max: number): number {
  if (tokens <= 0 || max <= 0) return 0;
  const ratio = tokens / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function cellTitle(day: ActivityDay, t: TFn): string {
  const parts = [
    formatDay(day.date),
    t("calendar.requestsCount", { n: day.requests }),
    t("calendar.tokensCount", { n: day.tokens }),
  ];
  if (day.cost > 0) parts.push(formatCost(day.cost));
  return parts.join(" · ");
}

/**
 * GitHub-style contribution calendar for the last 120 days, fed by
 * `/admin/api/activity`. Plain CSS grid — no charting library.
 */
export function ActivityCalendar() {
  const { t } = useT();
  const { data, error, loading, reload } = useApi<ActivityResponse>("/admin/api/activity?days=120");

  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return loading ? <Loading label={t("calendar.loading")} /> : null;

  const { days, totals } = data;
  const columns = buildColumns(days);
  const monthLabels = buildMonthLabels(columns, MONTH_KEYS.map((key) => t(key)));
  const cells = columns.flat();

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800/70">
        <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          {t("calendar.title")}
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>
            {t("calendar.activeDays")}{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {formatCount(totals.active_days)}
            </span>
          </span>
          <span>
            {t("calendar.totalTokens")}{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {formatCount(totals.tokens)}
            </span>
          </span>
          <span>
            {t("calendar.totalRequests")}{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {formatCount(totals.requests)}
            </span>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto px-4 py-3">
        <div className="min-w-max">
          {/* Month labels, aligned with the week columns below. */}
          <div className="mb-1.5 ml-6 grid grid-flow-col gap-1 [grid-auto-columns:14px]">
            {monthLabels.map((label, index) => (
              <span
                key={index}
                className="overflow-visible whitespace-nowrap text-[10px] leading-none text-zinc-400"
              >
                {label ?? ""}
              </span>
            ))}
          </div>

          <div className="flex gap-1">
            {/* Weekday labels (Mon/Wed/Fri). */}
            <div className="grid w-5 shrink-0 grid-rows-7 gap-1">
              {WEEKDAY_KEYS.map((key, index) => (
                <span
                  key={key}
                  className="flex h-3.5 items-center text-[10px] leading-none text-zinc-400"
                >
                  {LABELED_ROWS.has(index) ? t(key) : ""}
                </span>
              ))}
            </div>

            {/* Contribution grid: columns = weeks, rows = Mon → Sun. */}
            <div className="grid grid-flow-col grid-rows-7 gap-1">
              {cells.map((day, index) =>
                day === null ? (
                  <span key={index} className="h-3.5 w-3.5" />
                ) : (
                  <span
                    key={day.date}
                    title={cellTitle(day, t)}
                    aria-label={cellTitle(day, t)}
                    className={clsx(
                      "h-3.5 w-3.5 rounded-sm transition-colors hover:ring-1 hover:ring-zinc-400/70",
                      CELL_LEVELS[levelOf(day.tokens, totals.max_tokens)],
                    )}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1.5 border-t border-zinc-100 px-4 py-2 text-[10px] text-zinc-400 dark:border-zinc-800/70">
        <span>{t("calendar.less")}</span>
        {CELL_LEVELS.map((level) => (
          <span key={level} className={clsx("h-3 w-3 rounded-sm", level)} />
        ))}
        <span>{t("calendar.more")}</span>
      </div>
    </div>
  );
}
