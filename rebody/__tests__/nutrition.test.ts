import {
  isWithinFastingWindow,
  macroRatio,
  rescalePortion,
  sourceLabel,
  sumMacros,
  type ScannedFood,
} from "../src/domain/nutrition";
import { calculateBmi, checkEligibility, clampFastingHours } from "../src/domain/safety";
import { normalizeFoodName, similarity } from "../supabase/functions/_shared/normalize";

const chicken: ScannedFood = {
  food_name: "닭가슴살",
  display_name: "닭가슴살",
  portion_g: 100,
  calories: 165,
  carbs_g: 0,
  protein_g: 31,
  fat_g: 3.6,
  sodium_mg: 74,
  fiber_g: 0,
  sugar_g: 0,
  saturated_fat_g: 1.0,
  source: "mfds_db",
  confidence: 0.9,
};

describe("rescalePortion", () => {
  it("중량에 비례해 매크로를 재계산한다", () => {
    const r = rescalePortion(chicken, 150);
    expect(r.portion_g).toBe(150);
    expect(r.calories).toBeCloseTo(247.5, 1);
    expect(r.protein_g).toBeCloseTo(46.5, 1);
  });

  it("원본을 변형하지 않는다", () => {
    rescalePortion(chicken, 200);
    expect(chicken.portion_g).toBe(100);
    expect(chicken.calories).toBe(165);
  });

  it("당류·포화지방산도 함께 비례 재계산한다", () => {
    // MFDS 응답에 함께 실려 오는 값이라 스케일링에서 빠지면 조용히 원본 값이 남는다.
    const r = rescalePortion(chicken, 200);
    expect(r.saturated_fat_g).toBeCloseTo(2.0, 1);
    expect(r.sugar_g).toBe(0);
  });

  it("null 매크로는 null로 남는다", () => {
    const r = rescalePortion({ ...chicken, fiber_g: null }, 200);
    expect(r.fiber_g).toBeNull();
  });

  it("0 이하 중량으로 나누기를 시도하지 않는다", () => {
    const r = rescalePortion({ ...chicken, portion_g: 0 }, 100);
    expect(Number.isFinite(r.portion_g)).toBe(true);
  });
});

describe("sumMacros", () => {
  it("여러 음식의 매크로를 합산한다", () => {
    const total = sumMacros([chicken, rescalePortion(chicken, 50)]);
    expect(total.calories).toBeCloseTo(247.5, 1);
    expect(total.protein_g).toBeCloseTo(46.5, 1);
  });

  it("빈 배열은 전부 null이다", () => {
    expect(sumMacros([]).calories).toBeNull();
  });
});

describe("macroRatio", () => {
  it("칼로리 기준 비율을 낸다 (지방은 9kcal/g)", () => {
    const r = macroRatio({ carbs_g: 50, protein_g: 50, fat_g: 0 });
    expect(r).toEqual({ carbs: 50, protein: 50, fat: 0 });
  });

  it("전부 0이면 null", () => {
    expect(macroRatio({ carbs_g: 0, protein_g: 0, fat_g: 0 })).toBeNull();
  });
});

describe("sourceLabel", () => {
  it("출처에 따라 배지가 달라진다", () => {
    expect(sourceLabel("mfds_db").tone).toBe("official");
    expect(sourceLabel("ai_estimate").tone).toBe("estimate");
    expect(sourceLabel("user_manual").tone).toBe("manual");
  });
});

describe("isWithinFastingWindow", () => {
  const w = { start: new Date("2026-07-27T07:00:00Z"), end: new Date("2026-07-27T23:00:00Z") };

  it("구간 안이면 true", () => {
    expect(isWithinFastingWindow(new Date("2026-07-27T12:00:00Z"), w)).toBe(true);
  });

  it("구간 밖이면 false", () => {
    expect(isWithinFastingWindow(new Date("2026-07-27T06:00:00Z"), w)).toBe(false);
    expect(isWithinFastingWindow(new Date("2026-07-27T23:30:00Z"), w)).toBe(false);
  });

  it("종료 시각 정각은 포함하지 않는다", () => {
    expect(isWithinFastingWindow(w.end, w)).toBe(false);
  });

  it("단식 구간이 없으면 false", () => {
    expect(isWithinFastingWindow(new Date(), null)).toBe(false);
  });
});

describe("normalizeFoodName — 캐시 히트율이 곧 비용 절감률", () => {
  it("띄어쓰기 요동을 흡수한다", () => {
    expect(normalizeFoodName("닭 가슴살")).toBe(normalizeFoodName("닭가슴살"));
  });

  it("수량·단위를 제거한다", () => {
    expect(normalizeFoodName("닭가슴살 100g")).toBe(normalizeFoodName("닭가슴살"));
    expect(normalizeFoodName("김치찌개 1인분")).toBe(normalizeFoodName("김치찌개"));
  });

  it("괄호 부연을 제거한다", () => {
    expect(normalizeFoodName("김치찌개(돼지고기)")).toBe(normalizeFoodName("김치찌개"));
  });

  it("조리법 수식어를 제거한다", () => {
    expect(normalizeFoodName("닭가슴살 구운것")).toBe(normalizeFoodName("닭가슴살"));
  });

  it("서로 다른 음식은 구분한다", () => {
    expect(normalizeFoodName("김치찌개")).not.toBe(normalizeFoodName("된장찌개"));
  });
});

describe("similarity", () => {
  it("동일 이름은 1", () => {
    expect(similarity("김치찌개", "김치 찌개")).toBe(1);
  });

  it("무관한 이름은 낮다", () => {
    expect(similarity("김치찌개", "아이스크림")).toBeLessThan(0.3);
  });

  it("부분 포함은 중간값", () => {
    const s = similarity("김치찌개", "돼지고기 김치찌개");
    expect(s).toBeGreaterThan(0.4);
    expect(s).toBeLessThan(1);
  });
});

describe("safety", () => {
  it("BMI를 계산한다", () => {
    expect(calculateBmi(175, 70)).toBeCloseTo(22.86, 1);
  });

  it("저체중은 단식 스케줄을 차단한다", () => {
    const r = checkEligibility({ heightCm: 175, weightKg: 55, birthYear: 1995 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("underweight");
  });

  it("미성년자를 차단한다", () => {
    const r = checkEligibility({ birthYear: new Date().getFullYear() - 15 });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("under_age");
  });

  it("임신·수유 중을 차단한다", () => {
    const r = checkEligibility({ birthYear: 1995, isPregnantOrNursing: true });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("pregnancy_or_nursing");
  });

  it("정상 범위는 통과시킨다", () => {
    const r = checkEligibility({ heightCm: 175, weightKg: 75, birthYear: 1995 });
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("BMI 하단은 통과시키되 경고를 남긴다", () => {
    const r = checkEligibility({ heightCm: 175, weightKg: 60, birthYear: 1995 });
    expect(r.eligible).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("단식 시간을 안전 범위로 자른다", () => {
    expect(clampFastingHours(36)).toEqual({ hours: 24, clamped: true });
    expect(clampFastingHours(4)).toEqual({ hours: 8, clamped: true });
    expect(clampFastingHours(16)).toEqual({ hours: 16, clamped: false });
  });
});
