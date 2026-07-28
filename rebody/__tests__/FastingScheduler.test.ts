// 단식 스케줄러 테스트 — 벽시계 → 절대시각 변환 계층
//
// 가장 중요한 케이스는 야간 근무(자정 넘김)다. 여기가 틀리면 야간 근무자에게
// 단식 종료 알림이 12시간 어긋나서 간다.

import {
  formatDuration,
  getFastingProgress,
  getPlanForDate,
  toInstant,
  type SchedulerInput,
} from "../src/domain/FastingScheduler";
import type { CycleDayRow } from "../src/domain/cycle";

const TZ = "Asia/Seoul";

/** KST 벽시계를 UTC ISO로. 기대값을 눈으로 검증 가능하게 하기 위한 헬퍼. */
function kst(iso: string): string {
  return iso;
}

describe("toInstant", () => {
  it("KST 벽시계를 올바른 절대시각으로 바꾼다", () => {
    // 2026-07-27 09:00 KST = 2026-07-27 00:00 UTC
    const d = toInstant("2026-07-27", "09:00", TZ);
    expect(d.toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("자정 시각도 정확하다", () => {
    const d = toInstant("2026-07-27", "00:00", TZ);
    expect(d.toISOString()).toBe("2026-07-26T15:00:00.000Z");
  });
});

describe("getPlanForDate — 주간 고정", () => {
  const cycleDays: CycleDayRow[] = Array.from({ length: 7 }, (_, i) => ({
    cycle_day_index: i,
    is_off_day: i >= 5,
    work_start: i < 5 ? "09:00" : null,
    work_end: i < 5 ? "18:00" : null,
    workout_start: null,
    workout_end: null,
    suggested_meal_window_start: "08:00",
    suggested_meal_window_end: "16:00",
  }));

  const input: SchedulerInput = {
    pattern: { cycle_anchor_date: "2026-07-27", cycle_length_days: 7 },
    cycleDays,
    timezone: TZ,
  };

  it("식사 창을 절대시각으로 낸다", () => {
    const plan = getPlanForDate("2026-07-27", input);
    expect(plan.eatingWindow).not.toBeNull();
    expect(plan.eatingWindow!.start.toISOString()).toBe("2026-07-26T23:00:00.000Z"); // 08:00 KST
    expect(plan.eatingWindow!.end.toISOString()).toBe("2026-07-27T07:00:00.000Z");   // 16:00 KST
  });

  it("단식 구간은 식사 종료 → 다음 날 식사 시작이다", () => {
    const plan = getPlanForDate("2026-07-27", input);
    expect(plan.fastingWindow).not.toBeNull();
    // 16:00 → 다음 날 08:00 = 16시간
    const hours =
      (plan.fastingWindow!.end.getTime() - plan.fastingWindow!.start.getTime()) / 3_600_000;
    expect(hours).toBe(16);
  });

  it("근무 구간이 같은 날 안에서 닫힌다", () => {
    const plan = getPlanForDate("2026-07-27", input);
    expect(plan.work).not.toBeNull();
    const hours = (plan.work!.end.getTime() - plan.work!.start.getTime()) / 3_600_000;
    expect(hours).toBe(9);
  });

  it("휴무일에는 근무 구간이 없다", () => {
    const plan = getPlanForDate("2026-08-01", input); // index 5 = 휴무
    expect(plan.isOffDay).toBe(true);
    expect(plan.work).toBeNull();
  });
});

describe("getPlanForDate — 야간 근무 (자정 넘김)", () => {
  const cycleDays: CycleDayRow[] = [
    {
      cycle_day_index: 0,
      is_off_day: false,
      work_start: "22:00",
      work_end: "06:00",           // 익일
      workout_start: null,
      workout_end: null,
      suggested_meal_window_start: "16:00",
      suggested_meal_window_end: "04:00",  // 익일
    },
  ];

  const input: SchedulerInput = {
    pattern: { cycle_anchor_date: "2026-07-27", cycle_length_days: 1 },
    cycleDays,
    timezone: TZ,
  };

  it("근무 종료가 다음 날로 넘어간다", () => {
    const plan = getPlanForDate("2026-07-27", input);
    expect(plan.work!.start.toISOString()).toBe("2026-07-27T13:00:00.000Z"); // 22:00 KST
    expect(plan.work!.end.toISOString()).toBe("2026-07-27T21:00:00.000Z");   // 익일 06:00 KST
    const hours = (plan.work!.end.getTime() - plan.work!.start.getTime()) / 3_600_000;
    expect(hours).toBe(8);
  });

  it("식사 창도 다음 날로 넘어간다", () => {
    const plan = getPlanForDate("2026-07-27", input);
    const hours =
      (plan.eatingWindow!.end.getTime() - plan.eatingWindow!.start.getTime()) / 3_600_000;
    expect(hours).toBe(12); // 16:00 → 익일 04:00
  });

  it("단식 구간이 음수가 되지 않는다", () => {
    // 식사 창이 자정을 넘기므로 종료(익일 04:00)가 다음 식사 시작(익일 16:00)보다 앞선다.
    const plan = getPlanForDate("2026-07-27", input);
    expect(plan.fastingWindow).not.toBeNull();
    expect(plan.fastingWindow!.end.getTime()).toBeGreaterThan(plan.fastingWindow!.start.getTime());
    const hours =
      (plan.fastingWindow!.end.getTime() - plan.fastingWindow!.start.getTime()) / 3_600_000;
    expect(hours).toBe(12); // 익일 04:00 → 익일 16:00
  });
});

describe("getPlanForDate — 휴무가 끼어 있을 때", () => {
  const cycleDays: CycleDayRow[] = [
    {
      cycle_day_index: 0, is_off_day: false,
      work_start: "09:00", work_end: "18:00",
      workout_start: null, workout_end: null,
      suggested_meal_window_start: "08:00", suggested_meal_window_end: "16:00",
    },
    {
      // 식사 창이 지정되지 않은 날
      cycle_day_index: 1, is_off_day: true,
      work_start: null, work_end: null,
      workout_start: null, workout_end: null,
      suggested_meal_window_start: null, suggested_meal_window_end: null,
    },
    {
      cycle_day_index: 2, is_off_day: false,
      work_start: "09:00", work_end: "18:00",
      workout_start: null, workout_end: null,
      suggested_meal_window_start: "08:00", suggested_meal_window_end: "16:00",
    },
  ];

  const input: SchedulerInput = {
    pattern: { cycle_anchor_date: "2026-07-27", cycle_length_days: 3 },
    cycleDays,
    timezone: TZ,
  };

  it("식사 창이 없는 날을 건너뛰고 다음 식사 창을 찾는다", () => {
    const plan = getPlanForDate("2026-07-27", input);
    // 07-27 16:00 → (07-28은 식사 창 없음) → 07-29 08:00 = 40시간
    const hours =
      (plan.fastingWindow!.end.getTime() - plan.fastingWindow!.start.getTime()) / 3_600_000;
    expect(hours).toBe(40);
  });
});

describe("getFastingProgress", () => {
  const window = {
    start: new Date("2026-07-27T07:00:00.000Z"),
    end: new Date("2026-07-27T23:00:00.000Z"), // 16시간
  };

  it("시작 시점의 진행률은 0이다", () => {
    const p = getFastingProgress(window, window.start);
    expect(p.ratio).toBe(0);
    expect(p.phase.key).toBe("digesting");
  });

  it("경과에 따라 단계가 바뀐다", () => {
    const at = (h: number) => new Date(window.start.getTime() + h * 3_600_000);
    expect(getFastingProgress(window, at(2)).phase.key).toBe("digesting");
    expect(getFastingProgress(window, at(5)).phase.key).toBe("glucose_stable");
    expect(getFastingProgress(window, at(13)).phase.key).toBe("fat_burning");
    expect(getFastingProgress(window, at(17)).phase.key).toBe("ketosis");
    expect(getFastingProgress(window, at(21)).phase.key).toBe("deep");
  });

  it("목표를 넘기면 완료로 표시하고 비율은 1을 넘지 않는다", () => {
    const after = new Date(window.end.getTime() + 3_600_000);
    const p = getFastingProgress(window, after);
    expect(p.isComplete).toBe(true);
    expect(p.ratio).toBe(1);
  });

  it("시작 전이면 경과가 음수로 새지 않는다", () => {
    const before = new Date(window.start.getTime() - 3_600_000);
    const p = getFastingProgress(window, before);
    expect(p.elapsedMs).toBe(0);
    expect(p.ratio).toBe(0);
  });
});

describe("formatDuration", () => {
  it("HH:MM:SS로 포맷한다", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(3_661_000)).toBe("01:01:01");
    expect(formatDuration(16 * 3_600_000)).toBe("16:00:00");
  });

  it("음수는 0으로 클램프한다", () => {
    // 카운트다운이 0을 지날 때 "-1:59:59" 같은 게 보이면 안 된다.
    expect(formatDuration(-5000)).toBe("00:00:00");
  });
});
