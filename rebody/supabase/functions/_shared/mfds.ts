// 식약처(MFDS) 식품영양성분 공공데이터 어댑터
//
// 기준 스펙: 공공데이터포털 15127578 '식품의약품안전처_식품영양성분DB정보'
//   엔드포인트: https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02
//   출력 필드 194개 (참고문서 '출력메세지_식품영양성분DB정보.xlsx'로 확인 완료)
//
// 확정된 핵심 필드:
//   FOOD_NM_KR    식품명
//   FOOD_CD       식품코드
//   DB_GRP_NM     데이터구분명 (원재료성식품 / 가공식품 / 음식)
//   SERVING_SIZE  영양성분함량기준량  ← AMT_NUM* 값들의 분모. 보통 "100g"
//   AMT_NUM1  에너지(kcal)   AMT_NUM3  단백질(g)   AMT_NUM4  지방(g)
//   AMT_NUM6  탄수화물(g)    AMT_NUM7  당류(g)     AMT_NUM8  식이섬유(g)
//   AMT_NUM13 나트륨(mg)     AMT_NUM24 포화지방산(g)
//
// ⚠️ 분모를 틀리면 조용히 값이 어긋난다
// SERVING_SIZE(영양성분함량기준량)만이 AMT_NUM*의 분모다.
// NUTRI_AMOUNT_SERVING(1회 섭취참고량), Z10500(식품중량), DISH_ONE_SERVING(1회분량 참고량)은
// 전부 다른 개념이라 분모로 쓰면 예외 없이 틀린 칼로리가 나온다. 폴백 후보로도 쓰지 않는다.
//
// 표준데이터 CSV(15100064~15100070)를 적재하는 경로도 열어두기 위해 한글 컬럼 맵을
// 보조로 남겨둔다. 매핑 실패는 예외가 아니라 null로 떨어뜨려 상위가 AI 추정치로 폴백하게 한다.

import { normalizeFoodName, similarity } from "./normalize.ts";

export interface MfdsNutrition {
  displayName: string;
  foodCode: string | null;
  /** DB_GRP_NM — '원재료성식품' | '가공식품' | '음식' */
  group: string | null;
  /** 영양성분함량기준량(g). 아래 영양소 값들의 분모다. */
  servingSizeG: number;
  /** 기준량이 mL로 표기돼 1g/mL로 근사한 경우 true */
  servingApproximated: boolean;
  calories: number | null;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
  sodiumMg: number | null;
  fiberG: number | null;
  sugarG: number | null;
  saturatedFatG: number | null;
  /** 검색어와 매칭된 행의 이름 유사도. 낮으면 상위에서 폐기한다. */
  matchScore: number;
}

type Row = Record<string, unknown>;

interface FieldMap {
  name: string[];
  code: string[];
  /** 영양성분함량기준량 전용. 다른 '1회량' 필드를 절대 섞지 말 것 (파일 상단 주석 참조). */
  serving: string[];
  group: string[];
  calories: string[];
  carbs: string[];
  protein: string[];
  fat: string[];
  sodium: string[];
  fiber: string[];
  sugar: string[];
  saturatedFat: string[];
}

const FIELD_MAPS: FieldMap[] = [
  // 15127578 식품영양성분DB정보 — 확정 스펙. 이게 기본 경로다.
  {
    name: ["FOOD_NM_KR"],
    code: ["FOOD_CD"],
    serving: ["SERVING_SIZE"],
    group: ["DB_GRP_NM"],
    calories: ["AMT_NUM1"],
    carbs: ["AMT_NUM6"],
    protein: ["AMT_NUM3"],
    fat: ["AMT_NUM4"],
    sodium: ["AMT_NUM13"],
    fiber: ["AMT_NUM8"],
    sugar: ["AMT_NUM7"],
    saturatedFat: ["AMT_NUM24"],
  },
  // 표준데이터 CSV(15100064~15100070) 적재 경로용 보조 맵.
  // Phase 3a에서 매칭률이 낮아 CSV를 직접 적재하게 될 때를 대비한 것.
  {
    name: ["식품명", "음식명"],
    code: ["식품코드"],
    serving: ["영양성분함량기준량"],
    group: ["데이터구분명"],
    calories: ["에너지(kcal)", "에너지"],
    carbs: ["탄수화물(g)", "탄수화물"],
    protein: ["단백질(g)", "단백질"],
    fat: ["지방(g)", "지방"],
    sodium: ["나트륨(mg)", "나트륨"],
    fiber: ["식이섬유(g)", "총 식이섬유"],
    sugar: ["당류(g)", "당류"],
    saturatedFat: ["포화지방산(g)", "포화지방산"],
  },
];

function pick(row: Row, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
  }
  return undefined;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  // 스펙상 모든 값이 문자열이다. "1,234.5", "-", "N/A" 등이 섞여 들어온다.
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * SERVING_SIZE(영양성분함량기준량) 파싱. "100g", "100mL", "100 g" 형태로 온다.
 * mL은 물 기준 1g/mL로 근사한다 — 국·찌개류에서 오차가 있지만, 이 값을 못 쓰면
 * 아예 매칭을 버려야 해서 근사 쪽이 낫다.
 */
function parseServing(v: unknown): { grams: number; approximated: boolean } | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  const n = num(s);
  if (n === null || n <= 0) return null;
  return { grams: n, approximated: /ml|밀리리터/i.test(s) };
}

/**
 * 카테고리 가중치. Gemini가 식별한 건 대부분 조리된 '음식'이므로
 * 같은 이름이면 음식 > 원재료성식품 > 가공식품 순으로 고른다.
 *
 * 이게 없으면 "김치찌개"에 브랜드 레토르트(가공식품) 행이 먼저 걸려서
 * 1인분 실제 섭취량과 동떨어진 값이 나온다.
 */
function groupBonus(group: string | null): number {
  if (!group) return 0;
  if (group.includes("음식")) return 0.15;
  if (group.includes("원재료")) return 0.05;
  return 0; // 가공식품
}

/** 응답 행에 가장 잘 맞는 필드맵을 고른다. 음식명과 칼로리를 둘 다 뽑을 수 있어야 한다. */
function detectMap(row: Row): FieldMap | null {
  for (const m of FIELD_MAPS) {
    if (pick(row, m.name) !== undefined && pick(row, m.calories) !== undefined) return m;
  }
  return null;
}

/** data.go.kr 응답에서 행 배열을 꺼낸다. 구조가 데이터셋마다 다르다. */
function extractRows(payload: unknown): Row[] {
  const p = payload as Record<string, any>;
  const candidates = [
    p?.body?.items,
    p?.response?.body?.items,
    p?.response?.body?.items?.item,
    p?.I2790?.row,
    p?.items,
    p?.data,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Row[];
    if (c && typeof c === "object") return [c as Row];
  }
  return [];
}

export interface MfdsLookupOptions {
  /** 이 값 미만의 매칭 점수는 버리고 AI 추정치로 폴백한다. */
  minScore?: number;
  timeoutMs?: number;
}

/**
 * 음식명으로 MFDS 영양정보를 조회한다.
 * 실패(키 없음/타임아웃/매칭 없음)는 예외가 아니라 null을 반환한다 —
 * 스캐너는 MFDS가 죽어도 AI 추정치로 계속 동작해야 한다.
 */
export async function lookupMfds(
  foodName: string,
  opts: MfdsLookupOptions = {},
): Promise<MfdsNutrition | null> {
  const serviceKey = Deno.env.get("MFDS_SERVICE_KEY");
  if (!serviceKey) {
    console.warn("[mfds] MFDS_SERVICE_KEY 미설정 — AI 추정치로 폴백");
    return null;
  }

  // 15127578 '식품영양성분DB정보'의 요청주소. 접미사가 02다 (01은 구버전 — 404).
  const base = Deno.env.get("MFDS_API_BASE") ??
    "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02";
  const nameParam = Deno.env.get("MFDS_NAME_PARAM") ?? "FOOD_NM_KR";

  const url = new URL(base);
  url.searchParams.set("serviceKey", serviceKey);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "20");
  url.searchParams.set("type", "json");
  url.searchParams.set(nameParam, foodName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6_000);

  let payload: unknown;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[mfds] HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    // 인증 실패 시 JSON 대신 XML 에러를 돌려준다.
    if (text.trimStart().startsWith("<")) {
      console.warn("[mfds] XML 응답 — serviceKey 또는 엔드포인트 확인 필요");
      return null;
    }
    payload = JSON.parse(text);
  } catch (e) {
    console.warn(`[mfds] 조회 실패: ${e instanceof Error ? e.message : e}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  const rows = extractRows(payload);
  if (rows.length === 0) return null;

  const map = detectMap(rows[0]);
  if (!map) {
    console.warn("[mfds] 알 수 없는 응답 스키마 — FIELD_MAPS 갱신 필요:", Object.keys(rows[0]).slice(0, 15));
    return null;
  }

  const scored = rows
    .map((row) => {
      const name = String(pick(row, map.name) ?? "");
      const group = (pick(row, map.group) as string | undefined) ?? null;
      const nameScore = similarity(foodName, name);
      // 이름 유사도에 카테고리 가중치를 얹되, 순수 유사도는 따로 들고 간다
      // (minScore 판정은 가중치 없는 값으로 해야 엉뚱한 음식이 통과하지 않는다).
      return { row, name, group, nameScore, rank: nameScore + groupBonus(group) };
    })
    .filter((r) => r.name.length > 0)
    .sort((a, b) => b.rank - a.rank);

  const best = scored[0];
  const minScore = opts.minScore ?? 0.45;
  if (!best || best.nameScore < minScore) return null;

  // SERVING_SIZE만이 AMT_NUM*의 분모다. 파싱에 실패하면 100g으로 가정하되
  // 로그를 남긴다 — 이게 잦으면 스케일이 통째로 틀어지고 있다는 신호다.
  const serving = parseServing(pick(best.row, map.serving));
  if (!serving) {
    console.warn(
      `[mfds] SERVING_SIZE 파싱 실패 (food=${best.name}) — 100g으로 가정. ` +
      `원값: ${JSON.stringify(pick(best.row, map.serving))}`,
    );
  }

  return {
    displayName: best.name,
    foodCode: (pick(best.row, map.code) as string | undefined) ?? null,
    group: best.group,
    servingSizeG: serving?.grams ?? 100,
    servingApproximated: serving?.approximated ?? false,
    calories: num(pick(best.row, map.calories)),
    carbsG: num(pick(best.row, map.carbs)),
    proteinG: num(pick(best.row, map.protein)),
    fatG: num(pick(best.row, map.fat)),
    sodiumMg: num(pick(best.row, map.sodium)),
    fiberG: num(pick(best.row, map.fiber)),
    sugarG: num(pick(best.row, map.sugar)),
    saturatedFatG: num(pick(best.row, map.saturatedFat)),
    matchScore: best.nameScore,
  };
}

export { normalizeFoodName };
