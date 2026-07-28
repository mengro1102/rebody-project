// 영양 계산 — 결과 모달의 중량 조절이 여기에 붙는다.

export interface Macros {
  calories: number | null;
  carbs_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  sodium_mg: number | null;
  fiber_g: number | null;
  /** MFDS 응답에 함께 실려 오는 값. 추가 호출 비용 없음. UI 노출은 Pro 티어. */
  sugar_g: number | null;
  saturated_fat_g: number | null;
}

export interface ScannedFood extends Macros {
  food_name: string;
  display_name: string;
  portion_g: number;
  source: "mfds_db" | "ai_estimate" | "user_manual";
  confidence: number;
  cache_hit?: boolean;
}

function scaleValue(v: number | null, factor: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * factor * 10) / 10;
}

/**
 * 중량을 바꿨을 때 매크로를 비례 재계산한다.
 * 슬라이더를 움직일 때마다 호출되므로 순수 함수로 유지 — 원본을 변형하지 않는다.
 */
export function rescalePortion(food: ScannedFood, newPortionG: number): ScannedFood {
  const from = food.portion_g;
  if (from <= 0 || newPortionG <= 0) return { ...food, portion_g: Math.max(newPortionG, 0) };

  const factor = newPortionG / from;
  return {
    ...food,
    portion_g: Math.round(newPortionG),
    calories: scaleValue(food.calories, factor),
    carbs_g: scaleValue(food.carbs_g, factor),
    protein_g: scaleValue(food.protein_g, factor),
    fat_g: scaleValue(food.fat_g, factor),
    sodium_mg: scaleValue(food.sodium_mg, factor),
    fiber_g: scaleValue(food.fiber_g, factor),
    sugar_g: scaleValue(food.sugar_g, factor),
    saturated_fat_g: scaleValue(food.saturated_fat_g, factor),
  };
}

export function sumMacros(foods: readonly Macros[]): Macros {
  const add = (a: number | null, b: number | null) =>
    a === null && b === null ? null : Math.round(((a ?? 0) + (b ?? 0)) * 10) / 10;

  return foods.reduce<Macros>(
    (acc, f) => ({
      calories: add(acc.calories, f.calories),
      carbs_g: add(acc.carbs_g, f.carbs_g),
      protein_g: add(acc.protein_g, f.protein_g),
      fat_g: add(acc.fat_g, f.fat_g),
      sodium_mg: add(acc.sodium_mg, f.sodium_mg),
      fiber_g: add(acc.fiber_g, f.fiber_g),
      sugar_g: add(acc.sugar_g, f.sugar_g),
      saturated_fat_g: add(acc.saturated_fat_g, f.saturated_fat_g),
    }),
    {
      calories: null, carbs_g: null, protein_g: null, fat_g: null,
      sodium_mg: null, fiber_g: null, sugar_g: null, saturated_fat_g: null,
    },
  );
}

/**
 * 탄단지 칼로리 비율. 도넛 차트용. 합이 0이면 null.
 * 필요한 세 필드만 받는다 — 호출부가 쓰지도 않는 나트륨·당류까지 채우게 만들 이유가 없다.
 */
export function macroRatio(
  m: Pick<Macros, "carbs_g" | "protein_g" | "fat_g">,
): { carbs: number; protein: number; fat: number } | null {
  const c = (m.carbs_g ?? 0) * 4;
  const p = (m.protein_g ?? 0) * 4;
  const f = (m.fat_g ?? 0) * 9;
  const total = c + p + f;
  if (total <= 0) return null;
  return {
    carbs: Math.round((c / total) * 100),
    protein: Math.round((p / total) * 100),
    fat: Math.round((f / total) * 100),
  };
}

export function sourceLabel(source: ScannedFood["source"]): { text: string; tone: "official" | "estimate" | "manual" } {
  switch (source) {
    case "mfds_db":
      return { text: "공식 데이터 기반", tone: "official" };
    case "user_manual":
      return { text: "직접 입력", tone: "manual" };
    default:
      return { text: "AI 추정치", tone: "estimate" };
  }
}

/** 식사 시각이 단식 구간 안에 있는지. meal_logs.is_within_fasting_window에 저장한다. */
export function isWithinFastingWindow(
  mealTime: Date,
  fastingWindow: { start: Date; end: Date } | null,
): boolean {
  if (!fastingWindow) return false;
  const t = mealTime.getTime();
  return t >= fastingWindow.start.getTime() && t < fastingWindow.end.getTime();
}
