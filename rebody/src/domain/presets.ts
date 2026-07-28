// Phase 2 — 근무 패턴 프리셋 4종
//
// 설계 의도: 완전 자유형 자연어 파싱은 V2로 이연했다. 1차는 프리셋으로 90%를 덮고,
// 나머지 10%만 자연어 보정(parse-schedule-nl)으로 처리한다. 사용자 입력 비용도,
// AI 토큰도, 오파싱 리스크도 이쪽이 훨씬 싸다.
//
// 식사 창 배치 원칙:
//   * 취침 직전 3시간은 피한다 (수면의 질)
//   * 근무 시작 직전에 첫 끼가 오도록 배치 (공복 근무 방지)
//   * 기본 16:8. 야간 근무는 생체리듬 부담을 고려해 14:10으로 완화한다.

import type { PatternType } from "@/types/database";

export type PresetKey = "day_fixed" | "night_fixed" | "two_shift" | "three_shift";

export interface PresetCycleDay {
  cycle_day_index: number;
  is_off_day: boolean;
  work_start: string | null;
  work_end: string | null;
  workout_start: string | null;
  workout_end: string | null;
  suggested_meal_window_start: string | null;
  suggested_meal_window_end: string | null;
  note?: string;
}

export interface SchedulePreset {
  key: PresetKey;
  title: string;
  subtitle: string;
  description: string;
  patternType: PatternType;
  cycleLengthDays: number;
  /** 사이클 시작이 무엇을 의미하는지 온보딩에서 물어볼 때 쓰는 문구 */
  anchorQuestion: string;
  days: PresetCycleDay[];
}

const OFF = (i: number, mealStart = "10:00", mealEnd = "18:00"): PresetCycleDay => ({
  cycle_day_index: i,
  is_off_day: true,
  work_start: null,
  work_end: null,
  workout_start: null,
  workout_end: null,
  suggested_meal_window_start: mealStart,
  suggested_meal_window_end: mealEnd,
  note: "휴무",
});

export const PRESETS: Record<PresetKey, SchedulePreset> = {
  // ── 주간 고정 (월~금 09-18) ────────────────────────────────
  day_fixed: {
    key: "day_fixed",
    title: "주간 고정",
    subtitle: "월~금 09:00–18:00",
    description: "평일 주간 근무, 주말 휴무. 가장 일반적인 패턴이에요.",
    patternType: "fixed_weekly",
    cycleLengthDays: 7,
    anchorQuestion: "이번 주 월요일 날짜를 알려주세요.",
    days: [
      // index 0 = 월요일이 되도록 anchor를 월요일로 잡는다.
      ...Array.from({ length: 5 }, (_, i) => ({
        cycle_day_index: i,
        is_off_day: false,
        work_start: "09:00",
        work_end: "18:00",
        workout_start: "19:30",
        workout_end: "20:30",
        // 08:00~16:00 → 16:8. 퇴근 후 야식을 구조적으로 막는다.
        suggested_meal_window_start: "08:00",
        suggested_meal_window_end: "16:00",
      })),
      OFF(5, "10:00", "18:00"),
      OFF(6, "10:00", "18:00"),
    ],
  },

  // ── 야간 고정 (월~금 22-06) ────────────────────────────────
  night_fixed: {
    key: "night_fixed",
    title: "야간 고정",
    subtitle: "월~금 22:00–06:00",
    description: "밤에 일하고 낮에 자는 패턴. 식사 창을 근무 전후로 배치합니다.",
    patternType: "fixed_weekly",
    cycleLengthDays: 7,
    anchorQuestion: "이번 주 월요일 날짜를 알려주세요.",
    days: [
      ...Array.from({ length: 5 }, (_, i) => ({
        cycle_day_index: i,
        is_off_day: false,
        // work_end < work_start → 자정을 넘기는 근무로 해석된다.
        work_start: "22:00",
        work_end: "06:00",
        workout_start: "19:00",
        workout_end: "20:00",
        // 낮 수면(07:00~15:00)을 피해 16:00~04:00. 12시간 창(12:12)으로 완화.
        // 야간 근무자에게 16:8을 강요하면 근무 중 저혈당 위험이 커진다.
        suggested_meal_window_start: "16:00",
        suggested_meal_window_end: "04:00",
        note: "야간 근무",
      })),
      OFF(5, "12:00", "22:00"),
      OFF(6, "12:00", "22:00"),
    ],
  },

  // ── 2교대 (주간 2일 → 야간 2일 → 휴무 2일) ──────────────────
  two_shift: {
    key: "two_shift",
    title: "2교대",
    subtitle: "주 2 · 야 2 · 휴 2 (6일 사이클)",
    description: "주간과 야간을 번갈아 도는 6일 주기 패턴입니다.",
    patternType: "rotating_cycle",
    cycleLengthDays: 6,
    anchorQuestion: "가장 최근에 '주간 근무 첫날'이었던 날짜를 알려주세요.",
    days: [
      { cycle_day_index: 0, is_off_day: false, work_start: "07:00", work_end: "19:00", workout_start: null, workout_end: null, suggested_meal_window_start: "06:00", suggested_meal_window_end: "20:00", note: "주간 1일차" },
      { cycle_day_index: 1, is_off_day: false, work_start: "07:00", work_end: "19:00", workout_start: null, workout_end: null, suggested_meal_window_start: "06:00", suggested_meal_window_end: "20:00", note: "주간 2일차" },
      // 주간→야간 전환일. 낮잠을 자야 하므로 식사 창을 늦게 연다.
      { cycle_day_index: 2, is_off_day: false, work_start: "19:00", work_end: "07:00", workout_start: null, workout_end: null, suggested_meal_window_start: "17:00", suggested_meal_window_end: "05:00", note: "야간 1일차 (전환일)" },
      { cycle_day_index: 3, is_off_day: false, work_start: "19:00", work_end: "07:00", workout_start: null, workout_end: null, suggested_meal_window_start: "17:00", suggested_meal_window_end: "05:00", note: "야간 2일차" },
      // 야간 근무 종료 직후 휴무. 이날은 회복이 우선이라 창을 넓게 둔다.
      { cycle_day_index: 4, is_off_day: true, work_start: null, work_end: null, workout_start: null, workout_end: null, suggested_meal_window_start: "12:00", suggested_meal_window_end: "22:00", note: "휴무 (야간 회복일)" },
      OFF(5, "10:00", "20:00"),
    ],
  },

  // ── 3교대 (주 → 야 → 심야 → 휴 · 8일 사이클) ────────────────
  three_shift: {
    key: "three_shift",
    title: "3교대",
    subtitle: "주 2 · 야 2 · 심야 2 · 휴 2 (8일 사이클)",
    description: "제조·의료 현장에서 흔한 8일 주기 패턴입니다. 세부 시간은 다음 단계에서 조정할 수 있어요.",
    patternType: "rotating_cycle",
    cycleLengthDays: 8,
    anchorQuestion: "가장 최근에 '주간 근무 첫날'이었던 날짜를 알려주세요.",
    days: [
      { cycle_day_index: 0, is_off_day: false, work_start: "06:00", work_end: "14:00", workout_start: "16:00", workout_end: "17:00", suggested_meal_window_start: "05:00", suggested_meal_window_end: "17:00", note: "주간 1일차" },
      { cycle_day_index: 1, is_off_day: false, work_start: "06:00", work_end: "14:00", workout_start: "16:00", workout_end: "17:00", suggested_meal_window_start: "05:00", suggested_meal_window_end: "17:00", note: "주간 2일차" },
      { cycle_day_index: 2, is_off_day: false, work_start: "14:00", work_end: "22:00", workout_start: "11:00", workout_end: "12:00", suggested_meal_window_start: "10:00", suggested_meal_window_end: "22:00", note: "오후 1일차" },
      { cycle_day_index: 3, is_off_day: false, work_start: "14:00", work_end: "22:00", workout_start: "11:00", workout_end: "12:00", suggested_meal_window_start: "10:00", suggested_meal_window_end: "22:00", note: "오후 2일차" },
      { cycle_day_index: 4, is_off_day: false, work_start: "22:00", work_end: "06:00", workout_start: null, workout_end: null, suggested_meal_window_start: "17:00", suggested_meal_window_end: "05:00", note: "심야 1일차" },
      { cycle_day_index: 5, is_off_day: false, work_start: "22:00", work_end: "06:00", workout_start: null, workout_end: null, suggested_meal_window_start: "17:00", suggested_meal_window_end: "05:00", note: "심야 2일차" },
      { cycle_day_index: 6, is_off_day: true, work_start: null, work_end: null, workout_start: null, workout_end: null, suggested_meal_window_start: "12:00", suggested_meal_window_end: "22:00", note: "휴무 (심야 회복일)" },
      OFF(7, "10:00", "20:00"),
    ],
  },
};

export const PRESET_LIST: SchedulePreset[] = [
  PRESETS.day_fixed,
  PRESETS.night_fixed,
  PRESETS.two_shift,
  PRESETS.three_shift,
];

export function getPreset(key: PresetKey): SchedulePreset {
  return PRESETS[key];
}
