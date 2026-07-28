// 사이클 해석 테스트
//
// 이 로직이 틀리면 교대근무자에게 하루씩 밀린 스케줄이 나가고, 그 위에 얹힌
// 단식 타이머·푸시·ICS가 전부 어긋난다. 앱에서 가장 조용히 크게 틀릴 수 있는 곳이라
// 여기에 테스트를 집중한다.

import {
  addDays,
  crossesMidnight,
  cycleDayIndex,
  daysBetween,
  durationMinutes,
  fromMinutes,
  resolveDay,
  shiftTime,
  toMinutes,
  type CycleDayRow,
  type OverrideRow,
} from "../src/domain/cycle";

describe("civil-date 연산", () => {
  it("월 경계를 넘어도 정확하다", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("윤년을 처리한다", () => {
    // 2028년은 윤년
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    // 2026년은 평년
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("음수 이동도 대칭이다", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-03-01", "2026-02-28")).toBe(-1);
  });

  it("daysBetween은 달력 일수를 센다", () => {
    expect(daysBetween("2026-07-27", "2026-08-03")).toBe(7);
    expect(daysBetween("2026-07-27", "2026-07-27")).toBe(0);
  });
});

describe("cycleDayIndex", () => {
  const anchor = "2026-07-27"; // 월요일

  it("사이클을 순환한다", () => {
    expect(cycleDayIndex(anchor, "2026-07-27", 6)).toBe(0);
    expect(cycleDayIndex(anchor, "2026-07-28", 6)).toBe(1);
    expect(cycleDayIndex(anchor, "2026-08-01", 6)).toBe(5);
    expect(cycleDayIndex(anchor, "2026-08-02", 6)).toBe(0); // 한 바퀴
  });

  it("anchor보다 과거인 날짜도 양수 인덱스를 낸다", () => {
    // JS의 %는 음수를 그대로 내므로(-1 % 6 === -1) 이중 modulo가 필요하다.
    expect(cycleDayIndex(anchor, "2026-07-26", 6)).toBe(5);
    expect(cycleDayIndex(anchor, "2026-07-21", 6)).toBe(0);
    expect(cycleDayIndex(anchor, "2026-07-20", 6)).toBe(5);
  });

  it("긴 기간에도 정확하다", () => {
    // 8일 사이클 3교대. 1년 뒤.
    expect(cycleDayIndex(anchor, "2027-07-27", 8)).toBe(365 % 8);
  });

  it("사이클 길이 1은 항상 0이다", () => {
    expect(cycleDayIndex(anchor, "2026-12-25", 1)).toBe(0);
  });

  it("사이클 길이가 0 이하면 던진다", () => {
    expect(() => cycleDayIndex(anchor, "2026-07-28", 0)).toThrow(RangeError);
  });
});

describe("벽시계 연산", () => {
  it("HH:mm ↔ 분 변환", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("23:59")).toBe(1439);
    expect(toMinutes("22:00:00")).toBe(1320); // 초 포함 형식도 허용
    expect(fromMinutes(570)).toBe("09:30");
  });

  it("자정 넘김을 판정한다", () => {
    expect(crossesMidnight("22:00", "06:00")).toBe(true);   // 야간 근무
    expect(crossesMidnight("09:00", "18:00")).toBe(false);  // 주간 근무
    expect(crossesMidnight("14:00", "22:00")).toBe(false);  // 오후 근무
    expect(crossesMidnight("09:00", "09:00")).toBe(true);   // 24시간 근무로 해석
  });

  it("자정을 넘기는 구간 길이를 정확히 잰다", () => {
    expect(durationMinutes("22:00", "06:00")).toBe(480);    // 8시간
    expect(durationMinutes("09:00", "18:00")).toBe(540);    // 9시간
    expect(durationMinutes("16:00", "04:00")).toBe(720);    // 12시간 식사 창
  });

  it("시각 이동은 자정을 wrap한다", () => {
    expect(shiftTime("23:30", 60)).toBe("00:30");
    expect(shiftTime("00:30", -60)).toBe("23:30");
    expect(shiftTime("08:00", 90)).toBe("09:30");
  });
});

describe("resolveDay", () => {
  const pattern = { cycle_anchor_date: "2026-07-27", cycle_length_days: 6 };

  const day = (i: number, over: Partial<CycleDayRow> = {}): CycleDayRow => ({
    cycle_day_index: i,
    is_off_day: false,
    work_start: "07:00",
    work_end: "19:00",
    workout_start: null,
    workout_end: null,
    suggested_meal_window_start: "06:00",
    suggested_meal_window_end: "20:00",
    ...over,
  });

  const cycleDays: CycleDayRow[] = [
    day(0),
    day(1),
    day(2, { work_start: "19:00", work_end: "07:00", suggested_meal_window_start: "17:00", suggested_meal_window_end: "05:00" }),
    day(3, { work_start: "19:00", work_end: "07:00", suggested_meal_window_start: "17:00", suggested_meal_window_end: "05:00" }),
    day(4, { is_off_day: true, work_start: null, work_end: null }),
    day(5, { is_off_day: true, work_start: null, work_end: null }),
  ];

  it("사이클에서 해당 날의 스케줄을 찾는다", () => {
    const r = resolveDay("2026-07-29", pattern, cycleDays);
    expect(r.source).toBe("cycle");
    expect(r.cycleDayIndex).toBe(2);
    expect(r.work_start).toBe("19:00");
    expect(r.work_end).toBe("07:00"); // 야간 근무
  });

  it("override가 사이클을 이긴다", () => {
    const overrides: OverrideRow[] = [{
      override_date: "2026-07-29",
      is_off_day: true,
      work_start: null,
      work_end: null,
      workout_start: null,
      workout_end: null,
      suggested_meal_window_start: "10:00",
      suggested_meal_window_end: "20:00",
    }];

    const r = resolveDay("2026-07-29", pattern, cycleDays, overrides);
    expect(r.source).toBe("override");
    expect(r.is_off_day).toBe(true);
    expect(r.cycleDayIndex).toBeNull();
    expect(r.suggested_meal_window_start).toBe("10:00");
  });

  it("다른 날짜의 override는 영향을 주지 않는다", () => {
    const overrides: OverrideRow[] = [{
      override_date: "2026-08-15",
      is_off_day: true,
      work_start: null, work_end: null,
      workout_start: null, workout_end: null,
      suggested_meal_window_start: null, suggested_meal_window_end: null,
    }];

    const r = resolveDay("2026-07-29", pattern, cycleDays, overrides);
    expect(r.source).toBe("cycle");
  });

  it("사이클에 해당 인덱스 행이 없으면 휴무로 떨어진다", () => {
    // 데이터가 깨져도 앱이 죽으면 안 된다.
    const r = resolveDay("2026-07-29", pattern, [day(0), day(1)]);
    expect(r.source).toBe("none");
    expect(r.is_off_day).toBe(true);
    expect(r.cycleDayIndex).toBe(2);
  });

  it("사이클이 한 바퀴 돌아도 같은 날 스케줄이 나온다", () => {
    const a = resolveDay("2026-07-29", pattern, cycleDays);
    const b = resolveDay("2026-08-04", pattern, cycleDays); // +6일
    expect(b.cycleDayIndex).toBe(a.cycleDayIndex);
    expect(b.work_start).toBe(a.work_start);
  });
});
