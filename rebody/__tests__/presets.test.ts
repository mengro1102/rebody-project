// 생활 패턴 프리셋 테스트
//
// 프리셋이 틀리면 온보딩 직후부터 잘못된 단식 시각이 나가고, 사용자는 그게 틀렸다는
// 사실조차 모른다. 특히 기상 시각으로 창을 만드는 프리셋은 자정을 넘기는 경우가 있어
// 랩어라운드를 반드시 확인해야 한다.

import {
  buildPresetDays,
  getPreset,
  PRESET_LIST,
  presetsByGroup,
  shiftWallClock,
  windowFromWake,
  DEFAULT_PRESET_KEY,
  GROUP_ORDER,
} from "../src/domain/presets";

describe("shiftWallClock", () => {
  it("분 단위로 민다", () => {
    expect(shiftWallClock("08:00", 90)).toBe("09:30");
    expect(shiftWallClock("08:00", -90)).toBe("06:30");
  });

  it("자정을 넘기면 랩어라운드한다", () => {
    expect(shiftWallClock("23:30", 60)).toBe("00:30");
    expect(shiftWallClock("00:30", -60)).toBe("23:30");
  });

  it("하루를 넘는 시차도 처리한다 (서울 → 로스앤젤레스 -16시간)", () => {
    expect(shiftWallClock("08:00", -16 * 60)).toBe("16:00");
  });
});

describe("windowFromWake", () => {
  it("첫 끼는 기상 1시간 뒤, 창 길이는 지정한 시간만큼", () => {
    expect(windowFromWake("07:00", 8)).toEqual({ start: "08:00", end: "16:00" });
    expect(windowFromWake("07:00", 10)).toEqual({ start: "08:00", end: "18:00" });
  });

  it("늦게 일어나면 창이 자정을 넘길 수 있다", () => {
    // 16시 기상(야간 생활) → 17:00~03:00. end < start는 자정 넘김을 뜻하며 정상이다.
    expect(windowFromWake("16:00", 10)).toEqual({ start: "17:00", end: "03:00" });
  });
});

describe("buildPresetDays", () => {
  it("wake_time 프리셋은 기상 시각으로 하루를 만든다", () => {
    const days = buildPresetDays(getPreset("everyday"), "06:30");
    expect(days).toHaveLength(1);
    expect(days[0]?.cycle_day_index).toBe(0);
    expect(days[0]?.suggested_meal_window_start).toBe("07:30");
    // everyday는 16:8
    expect(days[0]?.suggested_meal_window_end).toBe("15:30");
  });

  it("은퇴·재택은 14:10으로 더 넓게 잡는다", () => {
    const days = buildPresetDays(getPreset("retired"), "08:00");
    expect(days[0]?.suggested_meal_window_start).toBe("09:00");
    expect(days[0]?.suggested_meal_window_end).toBe("19:00");
    // 고정 일정이 없으므로 활동 구간은 비어 있어야 한다.
    expect(days[0]?.work_start).toBeNull();
  });

  it("date 프리셋은 기상 시각을 무시하고 고정 일정을 쓴다", () => {
    const days = buildPresetDays(getPreset("day_fixed"), "03:00");
    expect(days).toHaveLength(7);
    expect(days[0]?.work_start).toBe("09:00");
  });

  it("기상 시각을 주지 않으면 기본값 07:00을 쓴다", () => {
    expect(buildPresetDays(getPreset("everyday"))[0]?.suggested_meal_window_start).toBe("08:00");
  });
});

describe("프리셋 목록의 무결성", () => {
  it("모든 프리셋의 사이클 길이가 DB 제약(1~28) 안에 있다", () => {
    for (const p of PRESET_LIST) {
      expect(p.cycleLengthDays).toBeGreaterThanOrEqual(1);
      expect(p.cycleLengthDays).toBeLessThanOrEqual(28);
    }
  });

  it("date 프리셋의 일정 개수가 사이클 길이와 일치한다", () => {
    for (const p of PRESET_LIST.filter((x) => x.anchorKind === "date")) {
      expect(p.days).toHaveLength(p.cycleLengthDays);
    }
  });

  it("cycle_day_index가 0부터 빠짐없이 채워져 있다", () => {
    for (const p of PRESET_LIST) {
      const days = buildPresetDays(p, "07:00");
      const indices = days.map((d) => d.cycle_day_index).sort((a, b) => a - b);
      expect(indices).toEqual(Array.from({ length: p.cycleLengthDays }, (_, i) => i));
    }
  });

  it("wake_time 프리셋에는 buildDays가 있다", () => {
    for (const p of PRESET_LIST.filter((x) => x.anchorKind === "wake_time")) {
      expect(p.buildDays).toBeDefined();
    }
  });

  it("모든 프리셋이 정확히 한 그룹에 속하고, 그룹은 비어 있지 않다", () => {
    const counted = GROUP_ORDER.flatMap((g) => presetsByGroup(g));
    expect(counted).toHaveLength(PRESET_LIST.length);
    for (const g of GROUP_ORDER) expect(presetsByGroup(g).length).toBeGreaterThan(0);
  });

  it("기본 선택은 일반 그룹의 매일 반복 패턴이다", () => {
    const preset = getPreset(DEFAULT_PRESET_KEY);
    expect(preset.group).toBe("regular");
    expect(preset.cycleLengthDays).toBe(1);
  });

  it("모든 식사 창이 채워져 있다 — null이면 단식 시각을 계산할 수 없다", () => {
    for (const p of PRESET_LIST) {
      for (const d of buildPresetDays(p, "07:00")) {
        expect(d.suggested_meal_window_start).toBeTruthy();
        expect(d.suggested_meal_window_end).toBeTruthy();
      }
    }
  });
});
