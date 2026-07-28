// Phase 2 — 단식 스케줄 해석기
//
// 역할 분리:
//   cycle.ts            civil-date/벽시계 연산. 타임존 없음. 순수 함수.
//   FastingScheduler.ts 벽시계 → 절대시각(instant) 변환. 여기서만 타임존을 안다.
//
// 이 경계를 지키는 이유: 교대근무 앱에서 "하루가 밀리는" 버그는 사이클 계산에
// 타임존이 섞이면서 생긴다. 사이클은 달력의 문제고, 알림은 시계의 문제다. 섞지 않는다.
//
// 의존: luxon (IANA 타임존 처리).
//   Hermes에서 Intl이 필요하다. Expo SDK 53의 Android 기본 빌드는 Intl을 포함하지만,
//   커스텀 빌드에서 제거했다면 KST 고정 오프셋 폴백으로 떨어진다 (resolveZone 참조).

import { DateTime } from "luxon";
import {
  addDays,
  crossesMidnight,
  durationMinutes,
  resolveDay,
  toMinutes,
  type CycleDayRow,
  type IsoDate,
  type OverrideRow,
  type PatternRef,
  type ResolvedDay,
} from "./cycle";

export const DEFAULT_TIMEZONE = "Asia/Seoul";

export interface Interval {
  start: Date;
  end: Date;
}

export type FastingPhaseKey =
  | "digesting"
  | "glucose_stable"
  | "fat_burning"
  | "ketosis"
  | "deep";

export interface FastingPhase {
  key: FastingPhaseKey;
  label: string;
  description: string;
  /** 이 단계가 시작되는 단식 경과 시간 */
  fromHours: number;
}

// 단식 경과에 따른 대사 단계. 의학적 진단이 아니라 일반적 설명이라는 점을
// UI 카피에서 반드시 함께 밝힌다 (docs/00_ANALYSIS.md §2-4).
export const FASTING_PHASES: readonly FastingPhase[] = [
  { key: "digesting",      label: "소화 중",      description: "마지막 식사를 소화하고 있어요.",           fromHours: 0 },
  { key: "glucose_stable", label: "혈당 안정",    description: "혈당이 안정되기 시작하는 구간이에요.",     fromHours: 4 },
  { key: "fat_burning",    label: "지방 연소",    description: "저장된 에너지를 쓰기 시작하는 구간이에요.", fromHours: 12 },
  { key: "ketosis",        label: "케토시스",     description: "지방 대사가 활발해지는 구간이에요.",       fromHours: 16 },
  { key: "deep",           label: "깊은 단식",    description: "장시간 단식 구간입니다. 무리하지 마세요.",  fromHours: 20 },
];

export interface TodayPlan {
  resolved: ResolvedDay;
  /** 오늘의 식사 가능 구간. 자정을 넘기면 end가 다음 날이 된다. */
  eatingWindow: Interval | null;
  /** 식사 창 종료 → 다음 식사 창 시작. 단식 타이머의 기준. */
  fastingWindow: Interval | null;
  work: Interval | null;
  workout: Interval | null;
  isOffDay: boolean;
}

export interface FastingProgress {
  /** 0~1. 목표 대비 진행률 */
  ratio: number;
  elapsedMs: number;
  remainingMs: number;
  phase: FastingPhase;
  nextPhase: FastingPhase | null;
  /** 목표를 이미 넘겼는지 */
  isComplete: boolean;
}

/** Intl이 없는 런타임에서도 죽지 않게 KST 고정 오프셋으로 폴백한다. */
function resolveZone(timezone: string): string {
  const dt = DateTime.now().setZone(timezone);
  if (dt.isValid) return timezone;
  console.warn(`[FastingScheduler] 알 수 없는 타임존 '${timezone}' — UTC+9로 폴백`);
  return "UTC+9";
}

/** 사용자 타임존 기준의 '오늘' (civil date). */
export function todayInTimezone(timezone: string = DEFAULT_TIMEZONE): IsoDate {
  return DateTime.now().setZone(resolveZone(timezone)).toISODate()!;
}

/** civil date + 벽시계 → 절대시각. */
export function toInstant(date: IsoDate, time: string, timezone: string): Date {
  const [h, m] = time.split(":").map(Number) as [number, number];
  return DateTime.fromISO(date, { zone: resolveZone(timezone) })
    .set({ hour: h, minute: m, second: 0, millisecond: 0 })
    .toJSDate();
}

/**
 * 시작/종료 벽시계 쌍을 절대시각 구간으로. 자정을 넘기면 종료일을 하루 뒤로 민다.
 * 야간 근무(22:00~06:00)가 여기서 처리된다.
 */
function toInterval(
  date: IsoDate,
  start: string | null,
  end: string | null,
  timezone: string,
): Interval | null {
  if (!start || !end) return null;
  const endDate = crossesMidnight(start, end) ? addDays(date, 1) : date;
  return { start: toInstant(date, start, timezone), end: toInstant(endDate, end, timezone) };
}

export interface SchedulerInput {
  pattern: PatternRef;
  cycleDays: readonly CycleDayRow[];
  overrides?: readonly OverrideRow[];
  timezone?: string;
}

/**
 * 특정 날짜의 계획을 절대시각으로 해석한다.
 * 단식 구간은 "오늘 식사 창 종료 → 다음 식사가 있는 날의 식사 창 시작"으로 정의한다.
 * 휴무일이 끼면 다음 식사 창을 찾을 때까지 최대 7일 전진한다.
 */
export function getPlanForDate(date: IsoDate, input: SchedulerInput): TodayPlan {
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const overrides = input.overrides ?? [];
  const resolved = resolveDay(date, input.pattern, input.cycleDays, overrides);

  const eatingWindow = toInterval(
    date,
    resolved.suggested_meal_window_start,
    resolved.suggested_meal_window_end,
    timezone,
  );

  let fastingWindow: Interval | null = null;
  if (eatingWindow && resolved.suggested_meal_window_end) {
    const next = findNextEatingWindowStart(date, input, timezone);
    // 다음 식사 창이 오늘 식사 종료보다 뒤에 있어야 유효한 단식 구간이다.
    if (next && next.getTime() > eatingWindow.end.getTime()) {
      fastingWindow = { start: eatingWindow.end, end: next };
    }
  }

  return {
    resolved,
    eatingWindow,
    fastingWindow,
    work: toInterval(date, resolved.work_start, resolved.work_end, timezone),
    workout: toInterval(date, resolved.workout_start, resolved.workout_end, timezone),
    isOffDay: resolved.is_off_day,
  };
}

export function getTodayPlan(input: SchedulerInput): TodayPlan {
  return getPlanForDate(todayInTimezone(input.timezone ?? DEFAULT_TIMEZONE), input);
}

/** 다음 식사 창 시작 시각. 휴무 등으로 비어 있으면 최대 7일 뒤까지 찾는다. */
function findNextEatingWindowStart(
  fromDate: IsoDate,
  input: SchedulerInput,
  timezone: string,
): Date | null {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(fromDate, i);
    const r = resolveDay(d, input.pattern, input.cycleDays, input.overrides ?? []);
    if (r.suggested_meal_window_start) {
      return toInstant(d, r.suggested_meal_window_start, timezone);
    }
  }
  return null;
}

/** 진행 중인 단식의 경과·단계 계산. */
export function getFastingProgress(
  window: Interval,
  now: Date = new Date(),
): FastingProgress {
  const total = window.end.getTime() - window.start.getTime();
  const elapsedMs = Math.max(0, now.getTime() - window.start.getTime());
  const remainingMs = window.end.getTime() - now.getTime();
  const elapsedHours = elapsedMs / 3_600_000;

  let phase = FASTING_PHASES[0]!;
  let nextPhase: FastingPhase | null = null;
  for (let i = 0; i < FASTING_PHASES.length; i++) {
    const p = FASTING_PHASES[i]!;
    if (elapsedHours >= p.fromHours) {
      phase = p;
      nextPhase = FASTING_PHASES[i + 1] ?? null;
    }
  }

  return {
    ratio: total > 0 ? Math.min(1, Math.max(0, elapsedMs / total)) : 0,
    elapsedMs,
    remainingMs,
    phase,
    nextPhase,
    isComplete: remainingMs <= 0,
  };
}

/** 'HH:MM:SS' 카운트다운 표기. 음수는 0으로 클램프한다. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

/** 식사 창 길이(시간). "16:8" 같은 표기를 만들 때 쓴다. */
export function fastingRatioLabel(day: ResolvedDay): string | null {
  const { suggested_meal_window_start: s, suggested_meal_window_end: e } = day;
  if (!s || !e) return null;
  const eatHours = Math.round(durationMinutes(s, e) / 60);
  return `${24 - eatHours}:${eatHours}`;
}

/** N일치 계획을 한 번에. 주간 뷰/ICS 미리보기용. */
export function getPlansForRange(
  startDate: IsoDate,
  days: number,
  input: SchedulerInput,
): TodayPlan[] {
  return Array.from({ length: days }, (_, i) => getPlanForDate(addDays(startDate, i), input));
}

export { toMinutes };
