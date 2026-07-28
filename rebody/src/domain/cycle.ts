// 사이클 해석 — 순수 civil-date 연산 (타임존 무관)
//
// ⚠️ 이 파일은 supabase/functions/_shared/cycle.ts 와 동일한 로직이어야 한다.
//    Deno(Edge)와 Hermes(RN)는 모듈 시스템이 달라 한 파일을 공유할 수 없다.
//    로직 변경 시 반드시 양쪽을 함께 수정할 것. __tests__/cycle.test.ts가 이 계약을 검증한다.
//
// 핵심 원칙: 여기서는 타임존을 일절 쓰지 않는다. 'YYYY-MM-DD' 정수 연산만.
// 교대근무 앱에서 하루가 밀리는 버그는 거의 전부 이 계층에 TZ를 섞으면서 생긴다.
// 벽시계 → 절대시각 변환은 FastingScheduler.ts에서만 한다.

export type IsoDate = string; // 'YYYY-MM-DD'

/** 1970-01-01 기준 일수. */
export function toEpochDay(iso: IsoDate): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromEpochDay(day: number): IsoDate {
  const dt = new Date(day * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  return fromEpochDay(toEpochDay(iso) + n);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/**
 * 해당 날짜의 사이클 인덱스.
 * anchor보다 과거인 날짜는 JS의 % 가 음수를 내므로(-1 % 4 === -1) 이중 modulo로 정규화한다.
 */
export function cycleDayIndex(anchor: IsoDate, target: IsoDate, cycleLength: number): number {
  if (cycleLength <= 0) throw new RangeError("cycleLength는 1 이상이어야 합니다");
  const diff = daysBetween(anchor, target);
  return ((diff % cycleLength) + cycleLength) % cycleLength;
}

/** 'HH:mm' 또는 'HH:mm:ss' → 자정 기준 분. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

export function fromMinutes(mins: number): string {
  const norm = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`;
}

/**
 * 종료 시각이 시작 시각보다 같거나 이르면 자정을 넘긴 것으로 본다.
 * 야간 22:00~06:00과 2교대 14:00~22:00을 한 규칙으로 처리한다.
 */
export function crossesMidnight(start: string, end: string): boolean {
  return toMinutes(end) <= toMinutes(start);
}

/** 자정 넘김을 고려한 구간 길이(분). */
export function durationMinutes(start: string, end: string): number {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return e > s ? e - s : 1440 - s + e;
}

/** 시각을 분 단위로 이동시킨다. 자정을 넘겨도 wrap된다. */
export function shiftTime(time: string, minutes: number): string {
  return fromMinutes(toMinutes(time) + minutes);
}

export interface DaySchedule {
  is_off_day: boolean;
  work_start: string | null;
  work_end: string | null;
  workout_start: string | null;
  workout_end: string | null;
  suggested_meal_window_start: string | null;
  suggested_meal_window_end: string | null;
}

export interface CycleDayRow extends DaySchedule {
  cycle_day_index: number;
}

export interface OverrideRow extends DaySchedule {
  override_date: IsoDate;
}

export interface PatternRef {
  cycle_anchor_date: IsoDate;
  cycle_length_days: number;
}

export interface ResolvedDay extends DaySchedule {
  date: IsoDate;
  source: "override" | "cycle" | "none";
  cycleDayIndex: number | null;
}

const EMPTY: DaySchedule = {
  is_off_day: true,
  work_start: null,
  work_end: null,
  workout_start: null,
  workout_end: null,
  suggested_meal_window_start: null,
  suggested_meal_window_end: null,
};

/**
 * 특정 날짜의 스케줄 해석. override > cycle 순.
 * DB의 resolve_schedule_for_date()와 동일한 규칙이어야 한다.
 */
export function resolveDay(
  date: IsoDate,
  pattern: PatternRef,
  cycleDays: readonly CycleDayRow[],
  overrides: readonly OverrideRow[] = [],
): ResolvedDay {
  const ov = overrides.find((o) => o.override_date === date);
  if (ov) return { ...pickSchedule(ov), date, source: "override", cycleDayIndex: null };

  const idx = cycleDayIndex(pattern.cycle_anchor_date, date, pattern.cycle_length_days);
  const day = cycleDays.find((d) => d.cycle_day_index === idx);
  if (!day) return { ...EMPTY, date, source: "none", cycleDayIndex: idx };

  return { ...pickSchedule(day), date, source: "cycle", cycleDayIndex: idx };
}

function pickSchedule(d: DaySchedule): DaySchedule {
  return {
    is_off_day: d.is_off_day,
    work_start: d.work_start,
    work_end: d.work_end,
    workout_start: d.workout_start,
    workout_end: d.workout_end,
    suggested_meal_window_start: d.suggested_meal_window_start,
    suggested_meal_window_end: d.suggested_meal_window_end,
  };
}
