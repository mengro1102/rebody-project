// 생활 패턴 프리셋
//
// 포지셔닝: 이 앱은 교대근무 전용이 아니다. 주간 직장인·학생·알바·프리랜서·은퇴·재택·
// 출장자·2·3교대를 하나의 사이클 엔진으로 덮는다. 교대근무는 이 모델이 다루는
// 가장 어려운 케이스일 뿐이다.
//
// 사이클 길이가 곧 패턴의 종류다:
//   1일  — 매일 같은 리듬 (기존 단식 앱이 유일하게 다루던 형태)
//   7일  — 요일마다 다른 리듬 (직장인·학생·알바)
//   6·8일 — 교대 로테이션
//
// 설계 의도: 완전 자유형 자연어 파싱은 V2로 이연했다. 1차는 프리셋으로 90%를 덮고,
// 나머지 10%만 자연어 보정(parse-schedule-nl)으로 처리한다. 사용자 입력 비용도,
// AI 토큰도, 오파싱 리스크도 이쪽이 훨씬 싸다.
//
// 식사 창 배치 원칙:
//   * 취침 직전 3시간은 피한다 (수면의 질)
//   * 활동 시작 직전에 첫 끼가 오도록 배치 (공복 활동 방지)
//   * 기본 16:8. 야간 활동·불규칙 패턴은 생체리듬 부담을 고려해 14:10으로 완화한다.

import type { PatternType } from "@/types/database";

export type PresetKey =
  | "everyday"
  | "day_fixed"
  | "student"
  | "gig"
  | "retired"
  | "night_fixed"
  | "two_shift"
  | "three_shift"
  | "travel";

export type PresetGroup = "regular" | "irregular" | "shift" | "travel";

/**
 * 기준값으로 무엇을 물을지.
 *   date      — 사이클 시작일 (요일·로테이션 기반 패턴)
 *   wake_time — 기상 시각 (매일 같은 리듬. 날짜는 의미가 없다)
 */
export type AnchorKind = "date" | "wake_time";

export interface PresetCycleDay {
  cycle_day_index: number;
  is_off_day: boolean;
  /**
   * 활동(근무·수업·알바 등) 시작/종료 벽시계.
   * 컬럼명은 work_*지만 의미는 "활동"이다 — 은퇴·재택 사용자에게는 기상·취침 구간을 담는다.
   * 이름을 바꾸면 DB 마이그레이션과 Edge Function을 함께 고쳐야 해서 라벨만 재정의했다.
   */
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
  group: PresetGroup;
  title: string;
  subtitle: string;
  description: string;
  patternType: PatternType;
  cycleLengthDays: number;
  anchorKind: AnchorKind;
  /** 온보딩에서 기준값을 물을 때 쓰는 문구 */
  anchorQuestion: string;
  /** anchorKind === "date"인 프리셋의 고정 일정 */
  days: PresetCycleDay[];
  /** anchorKind === "wake_time"인 프리셋은 기상 시각으로 일정을 만든다 */
  buildDays?: (wakeTime: string) => PresetCycleDay[];
}

export const GROUP_LABELS: Record<PresetGroup, { title: string; caption: string }> = {
  regular: { title: "규칙적인 하루", caption: "매일 또는 요일마다 반복되는 일정" },
  irregular: { title: "불규칙한 하루", caption: "고정 일정이 없거나 요일마다 다른 경우" },
  shift: { title: "교대 근무", caption: "며칠 단위로 도는 로테이션" },
  travel: { title: "출장 · 시차", caption: "시간대가 바뀌는 생활" },
};

const OFF = (i: number, mealStart = "10:00", mealEnd = "18:00"): PresetCycleDay => ({
  cycle_day_index: i,
  is_off_day: true,
  work_start: null,
  work_end: null,
  workout_start: null,
  workout_end: null,
  suggested_meal_window_start: mealStart,
  suggested_meal_window_end: mealEnd,
  note: "쉬는 날",
});

/** "HH:MM" + 분 → "HH:MM" (24시간 랩어라운드). 벽시계 연산이므로 타임존을 모른다. */
function addMinutes(time: string, minutes: number): string {
  const [h = "0", m = "0"] = time.split(":");
  const total = (Number(h) * 60 + Number(m) + minutes + 1440 * 10) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 기상 시각으로 식사 창을 만든다.
 * 첫 끼는 기상 +1시간(기상 직후 섭취를 피한다), 창 길이는 eatingHours.
 * 16:8이면 8시간, 14:10이면 10시간.
 */
function windowFromWake(wakeTime: string, eatingHours: number) {
  const start = addMinutes(wakeTime, 60);
  return { start, end: addMinutes(start, eatingHours * 60) };
}

export const PRESETS: Record<PresetKey, SchedulePreset> = {
  // ── 매일 같은 리듬 (1일 사이클) ────────────────────────────
  // 기존 단식 앱들이 유일하게 다루던 형태. 시장 대다수가 여기 속하므로 기본 선택이다.
  everyday: {
    key: "everyday",
    group: "regular",
    title: "매일 같은 리듬",
    subtitle: "요일 구분 없이 비슷한 시간에 자고 일어남",
    description: "가장 일반적인 형태예요. 기상 시각만 알려주시면 16:8 창을 잡아드릴게요.",
    patternType: "fixed_weekly",
    cycleLengthDays: 1,
    anchorKind: "wake_time",
    anchorQuestion: "보통 몇 시에 일어나세요?",
    days: [],
    buildDays: (wakeTime) => {
      const w = windowFromWake(wakeTime, 8);
      return [
        {
          cycle_day_index: 0,
          is_off_day: false,
          work_start: addMinutes(wakeTime, 120),
          work_end: addMinutes(wakeTime, 660),
          workout_start: null,
          workout_end: null,
          suggested_meal_window_start: w.start,
          suggested_meal_window_end: w.end,
          note: "매일 반복",
        },
      ];
    },
  },

  // ── 주간 고정 (월~금 09-18) ────────────────────────────────
  day_fixed: {
    key: "day_fixed",
    group: "regular",
    title: "주간 직장인",
    subtitle: "월~금 09:00–18:00",
    description: "평일 출근, 주말 휴무. 퇴근 후 야식을 구조적으로 막는 창으로 잡아드려요.",
    patternType: "fixed_weekly",
    cycleLengthDays: 7,
    anchorKind: "date",
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
        // 08:00~16:00 → 16:8.
        suggested_meal_window_start: "08:00",
        suggested_meal_window_end: "16:00",
      })),
      OFF(5, "10:00", "18:00"),
      OFF(6, "10:00", "18:00"),
    ],
  },

  // ── 학생 · 수험생 (평일 등교 + 야간 자습) ───────────────────
  student: {
    key: "student",
    group: "regular",
    title: "학생 · 수험생",
    subtitle: "평일 08:00–16:00 + 야간 자습",
    description:
      "수업과 자습으로 저녁이 늦어지는 패턴이에요. 늦은 야식 대신 이른 저녁으로 창을 당깁니다.",
    patternType: "fixed_weekly",
    cycleLengthDays: 7,
    anchorKind: "date",
    anchorQuestion: "이번 주 월요일 날짜를 알려주세요.",
    days: [
      ...Array.from({ length: 5 }, (_, i) => ({
        cycle_day_index: i,
        is_off_day: false,
        work_start: "08:00",
        work_end: "22:00",
        workout_start: null,
        workout_end: null,
        // 07:00~19:00 = 12:12. 성장기·수험 스트레스를 고려해 16:8을 강요하지 않는다.
        suggested_meal_window_start: "07:00",
        suggested_meal_window_end: "19:00",
        note: "수업 · 자습",
      })),
      OFF(5, "09:00", "19:00"),
      OFF(6, "09:00", "19:00"),
    ],
  },

  // ── 알바 · 프리랜서 (요일마다 다름) ─────────────────────────
  // 요일별 실제 일정은 사람마다 달라 기본값을 좁게 잡으면 전부 틀린다.
  // 넓은 창으로 시작해 자연어 보정이나 직접 편집으로 좁히게 한다.
  gig: {
    key: "gig",
    group: "irregular",
    title: "알바 · 프리랜서",
    subtitle: "요일마다 시간이 다름",
    description:
      "요일별로 일정이 달라지는 경우예요. 넉넉한 창으로 시작한 뒤 다음 단계에서 요일별로 고쳐주세요.",
    patternType: "irregular",
    cycleLengthDays: 7,
    anchorKind: "date",
    anchorQuestion: "이번 주 월요일 날짜를 알려주세요.",
    days: Array.from({ length: 7 }, (_, i) => ({
      cycle_day_index: i,
      is_off_day: false,
      work_start: null,
      work_end: null,
      workout_start: null,
      workout_end: null,
      // 09:00~21:00 = 12:12. 일정이 확정되면 자연어 보정으로 좁힌다.
      suggested_meal_window_start: "09:00",
      suggested_meal_window_end: "21:00",
      note: `${["월", "화", "수", "목", "금", "토", "일"][i]}요일 — 일정을 알려주시면 조정돼요`,
    })),
  },

  // ── 은퇴 · 재택 (고정 일정 없음) ────────────────────────────
  retired: {
    key: "retired",
    group: "irregular",
    title: "은퇴 · 재택",
    subtitle: "정해진 출근 시간이 없음",
    description:
      "출퇴근 기준점이 없는 경우예요. 기상 시각만으로 창을 잡고, 무리하지 않는 14:10으로 시작합니다.",
    patternType: "fixed_weekly",
    cycleLengthDays: 1,
    anchorKind: "wake_time",
    anchorQuestion: "보통 몇 시에 일어나세요?",
    days: [],
    buildDays: (wakeTime) => {
      // 14:10 — 고정 일정이 없으면 식사 시각이 흔들리기 쉽다. 창을 넓게 둬야 지켜진다.
      const w = windowFromWake(wakeTime, 10);
      return [
        {
          cycle_day_index: 0,
          is_off_day: true,
          work_start: null,
          work_end: null,
          workout_start: addMinutes(wakeTime, 120),
          workout_end: addMinutes(wakeTime, 180),
          suggested_meal_window_start: w.start,
          suggested_meal_window_end: w.end,
          note: "매일 반복",
        },
      ];
    },
  },

  // ── 야간 고정 (월~금 22-06) ────────────────────────────────
  night_fixed: {
    key: "night_fixed",
    group: "shift",
    title: "야간 고정",
    subtitle: "월~금 22:00–06:00",
    description: "밤에 일하고 낮에 자는 패턴. 식사 창을 근무 전후로 배치합니다.",
    patternType: "fixed_weekly",
    cycleLengthDays: 7,
    anchorKind: "date",
    anchorQuestion: "이번 주 월요일 날짜를 알려주세요.",
    days: [
      ...Array.from({ length: 5 }, (_, i) => ({
        cycle_day_index: i,
        is_off_day: false,
        // work_end < work_start → 자정을 넘기는 일정으로 해석된다.
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
    group: "shift",
    title: "2교대",
    subtitle: "주 2 · 야 2 · 휴 2 (6일 사이클)",
    description: "주간과 야간을 번갈아 도는 6일 주기 패턴입니다.",
    patternType: "rotating_cycle",
    cycleLengthDays: 6,
    anchorKind: "date",
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
    group: "shift",
    title: "3교대",
    subtitle: "주 2 · 야 2 · 심야 2 · 휴 2 (8일 사이클)",
    description: "제조·의료 현장에서 흔한 8일 주기 패턴입니다. 세부 시간은 다음 단계에서 조정할 수 있어요.",
    patternType: "rotating_cycle",
    cycleLengthDays: 8,
    anchorKind: "date",
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

  // ── 출장 · 시차 ────────────────────────────────────────────
  // 시차 대응의 본체는 프리셋이 아니라 **타임존 전환**이다 (설정 → 시간대 변경).
  // 스케줄은 벽시계로 저장돼 있으므로, 도착지에서 시간대만 바꾸면 현지 시각 기준으로
  // 그대로 재배치된다. 여기서는 이동으로 흔들리는 날을 견디도록 창을 넓게 잡는다.
  travel: {
    key: "travel",
    group: "travel",
    title: "출장 · 시차 적응",
    subtitle: "시간대가 자주 바뀜",
    description:
      "이동이 잦아 시간대가 바뀌는 경우예요. 넉넉한 14:10 창으로 시작하고, 도착하면 설정에서 시간대만 바꾸면 됩니다.",
    patternType: "irregular",
    cycleLengthDays: 1,
    anchorKind: "wake_time",
    anchorQuestion: "지금 머무는 곳에서 보통 몇 시에 일어나세요?",
    days: [],
    buildDays: (wakeTime) => {
      const w = windowFromWake(wakeTime, 10);
      return [
        {
          cycle_day_index: 0,
          is_off_day: false,
          work_start: null,
          work_end: null,
          workout_start: null,
          workout_end: null,
          suggested_meal_window_start: w.start,
          suggested_meal_window_end: w.end,
          note: "이동일에는 창을 넓게 유지",
        },
      ];
    },
  },
};

/**
 * 화면 노출 순서. 일반형이 위에 오는 것이 중요하다 —
 * 시장 대다수는 규칙적인 하루를 살고, 교대·출장은 차별점을 증명하는 선택지다.
 */
export const PRESET_LIST: SchedulePreset[] = [
  PRESETS.everyday,
  PRESETS.day_fixed,
  PRESETS.student,
  PRESETS.gig,
  PRESETS.retired,
  PRESETS.night_fixed,
  PRESETS.two_shift,
  PRESETS.three_shift,
  PRESETS.travel,
];

export const GROUP_ORDER: PresetGroup[] = ["regular", "irregular", "shift", "travel"];

/** 첫 화면 기본 선택. 대다수 사용자가 여기서 멈추게 하는 것이 목표다. */
export const DEFAULT_PRESET_KEY: PresetKey = "everyday";

export function presetsByGroup(group: PresetGroup): SchedulePreset[] {
  return PRESET_LIST.filter((p) => p.group === group);
}

export function getPreset(key: PresetKey): SchedulePreset {
  return PRESETS[key];
}

/**
 * 저장할 사이클 일정을 만든다.
 * wake_time 프리셋은 기상 시각으로 생성하고, date 프리셋은 고정 일정을 그대로 쓴다.
 */
export function buildPresetDays(preset: SchedulePreset, wakeTime?: string): PresetCycleDay[] {
  if (preset.anchorKind === "wake_time") {
    if (!preset.buildDays) throw new Error(`${preset.key}: buildDays가 없습니다.`);
    return preset.buildDays(wakeTime ?? "07:00");
  }
  return preset.days;
}

export { addMinutes as shiftWallClock, windowFromWake };
