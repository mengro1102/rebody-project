// Phase 3 — 하이브리드 푸드 스캐너
//
// 3단 파이프라인:
//   1) 인식   : Gemini에 사진 → 음식명 후보 + 추정 중량 (출력 256토큰 상한)
//   2) 영양   : 캐시 → MFDS 공공데이터 → 캐시 저장
//   3) 폴백   : MFDS 미매칭 시 Gemini 자체 추정치 사용, source='ai_estimate'로 표기
//
// 비용 통제 (docs/01_COST.md):
//   * Gemini 호출 전에 consume_scan_quota()로 서버에서 쿼터를 먼저 차감한다.
//     클라이언트가 세면 재설치·시계조작으로 무한 우회 → 그대로 비용 유출.
//   * Gemini 호출이 실패하면 refund_scan_quota()로 되돌린다. 실패한 요청 때문에
//     사용자가 쿼터를 잃으면 안 된다.
//   * 캐시 히트 시 Gemini 인식은 하되 MFDS 호출은 생략. (사진 없이 영양값은 못 구하므로
//     1단계는 생략 불가하지만, 2단계 외부 호출과 저장은 전부 절약된다)

import { fail, json, preflight, shortId } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { generateJSON, GeminiError, withRetry } from "../_shared/gemini.ts";
import { lookupMfds } from "../_shared/mfds.ts";
import { normalizeFoodName } from "../_shared/normalize.ts";
import { consumeAiBudget, refundAiBudget } from "../_shared/budget.ts";

const FREE_DAILY_SCANS = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const SYSTEM_INSTRUCTION = `당신은 한국 음식 사진을 식별하는 전문가입니다.

규칙:
- 한국 음식(한식)일 가능성을 우선 고려하세요. 예: 김치찌개, 제육볶음, 비빔밥, 닭가슴살 샐러드.
- food_name은 식약처 식품영양성분DB에서 검색될 법한 일반명으로 쓰세요.
  브랜드명·수식어·조리법 설명을 붙이지 마세요. ("백종원 김치찌개" X → "김치찌개" O)
- estimated_weight_g는 사진에 보이는 1인분 실제 섭취량(g)입니다. 그릇 무게는 제외하세요.
- 여러 음식이 한 상에 있으면 items 배열에 각각 넣되 최대 4개까지만 넣으세요.
- 음식이 아니거나 식별 불가하면 items를 빈 배열로 두세요.
- 칼로리/영양 추정치(fallback_*)는 해당 중량 기준 값입니다.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          food_name: { type: "string" },
          estimated_weight_g: { type: "number" },
          confidence: { type: "number" },
          fallback_calories: { type: "number" },
          fallback_carbs_g: { type: "number" },
          fallback_protein_g: { type: "number" },
          fallback_fat_g: { type: "number" },
        },
        required: ["food_name", "estimated_weight_g", "confidence"],
      },
    },
  },
  required: ["items"],
};

interface RecognizedItem {
  food_name: string;
  estimated_weight_g: number;
  confidence: number;
  fallback_calories?: number;
  fallback_carbs_g?: number;
  fallback_protein_g?: number;
  fallback_fat_g?: number;
}

interface AnalyzedItem {
  food_name: string;
  display_name: string;
  portion_g: number;
  calories: number | null;
  carbs_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  sodium_mg: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  saturated_fat_g: number | null;
  source: "mfds_db" | "ai_estimate";
  confidence: number;
  cache_hit: boolean;
}

/** 100g 기준값을 실제 섭취 중량으로 비례 환산. */
function scale(per: number | null, servingG: number, portionG: number): number | null {
  if (per === null || !Number.isFinite(per) || servingG <= 0) return null;
  return Math.round((per * portionG / servingG) * 10) / 10;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("method_not_allowed", "POST만 허용됩니다.", 405);

  const user = await requireUser(req);
  if (user instanceof Response) return user;

  let body: { image_base64?: string; mime_type?: string; local_date?: string };
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", "잘못된 요청 형식입니다.", 400);
  }

  const { image_base64, mime_type = "image/jpeg" } = body;
  if (!image_base64) return fail("bad_request", "이미지가 필요합니다.", 400);

  // base64는 원본의 약 4/3 크기
  if (image_base64.length * 0.75 > MAX_IMAGE_BYTES) {
    return fail("image_too_large", "이미지가 너무 큽니다. 앱에서 압축 후 다시 시도해 주세요.", 413);
  }

  // local_date는 클라이언트가 자기 타임존 기준으로 보낸다. 쿼터 리셋 기준일이 되므로
  // 시계 조작으로 쿼터를 리셋하지 못하도록 서버 UTC 날짜 ±1일 범위로 제한한다.
  const localDate = clampLocalDate(body.local_date);

  const supabase = adminClient();

  // ── 쿼터 차감 (Gemini 호출 전) ───────────────────────────
  const { data: quota, error: quotaErr } = await supabase.rpc("consume_scan_quota", {
    p_user_id: user.id,
    p_local_date: localDate,
    p_free_limit: FREE_DAILY_SCANS,
  });

  if (quotaErr) {
    console.error("[analyze-food] 쿼터 확인 실패:", quotaErr.message);
    return fail("internal", "일시적인 오류가 발생했습니다.", 500);
  }

  const q = Array.isArray(quota) ? quota[0] : quota;
  if (!q?.allowed) {
    return fail(
      "quota_exceeded",
      `사진 분석은 하루 ${FREE_DAILY_SCANS}회까지 이용할 수 있어요. 자정이 지나면 다시 채워집니다. ` +
        "그전에도 음식 이름을 직접 입력해 기록하실 수 있어요.",
      402,
      { plan: q?.plan ?? "free", remaining: 0, free_daily_limit: FREE_DAILY_SCANS },
    );
  }

  // ── 전역 예산 확인 (사용자 쿼터를 통과한 뒤, Gemini 호출 전) ──
  // 수익이 0이므로 총 호출량에 천장이 필요하다 (docs/07_MONETIZATION_DEFERRED.md §5).
  // 상한에 닿아도 앱을 멈추지 않는다 — 스캐너만 격하하고 직접 입력을 안내한다.
  const budget = await consumeAiBudget(supabase, "scan");
  if (!budget.allowed) {
    await supabase.rpc("refund_scan_quota", { p_user_id: user.id, p_local_date: localDate });
    return fail(
      "ai_budget_exhausted",
      "지금은 사진 분석 요청이 많아 잠시 쉬고 있어요. 음식 이름을 직접 입력하면 바로 기록됩니다. " +
        "자정이 지나면 다시 이용하실 수 있어요.",
      503,
      { fallback: "manual_entry", retry_after_utc_midnight: true },
    );
  }

  // ── 1단계: 인식 ──────────────────────────────────────────
  let recognized: RecognizedItem[];
  try {
    const out = await withRetry(() =>
      generateJSON<{ items: RecognizedItem[] }>({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: "이 사진에 있는 음식을 식별하고 섭취 중량을 추정해 주세요.",
        image: { mimeType: mime_type, data: image_base64 },
        // 인식 결과는 짧다. 256이면 4개 항목까지 충분하고, 여기가 비용의 대부분을 결정한다.
        maxOutputTokens: 256,
        temperature: 0.1,
        responseSchema: RESPONSE_SCHEMA,
      }), 2);
    recognized = out.data.items ?? [];
    console.log(`[analyze-food] user=${shortId(user.id)} items=${recognized.length} tokens=${out.usage.totalTokens}`);
  } catch (e) {
    // 실패했으니 쿼터와 전역 예산을 모두 돌려준다.
    await supabase.rpc("refund_scan_quota", { p_user_id: user.id, p_local_date: localDate });
    await refundAiBudget(supabase, "scan");
    const ge = e instanceof GeminiError ? e : null;
    console.error(`[analyze-food] user=${shortId(user.id)} 인식 실패:`, e);
    return fail(
      "ai_unavailable",
      ge?.status === 429
        ? "AI 요청이 몰려 잠시 지연되고 있어요. 곧 다시 시도해 주세요."
        : "사진을 분석하지 못했습니다. 직접 입력으로 기록할 수 있어요.",
      503,
      { fallback: "manual_entry" },
    );
  }

  if (recognized.length === 0) {
    // 사용자 쿼터는 돌려준다(사용자 잘못이 아니다). 전역 예산은 돌려주지 않는다 —
    // Gemini 호출이 실제로 일어나 비용이 발생했으므로 집계에 남아야 한다.
    await supabase.rpc("refund_scan_quota", { p_user_id: user.id, p_local_date: localDate });
    return fail(
      "no_food_detected",
      "사진에서 음식을 찾지 못했어요. 음식이 잘 보이게 다시 찍거나 직접 입력해 주세요.",
      422,
      { fallback: "manual_entry" },
    );
  }

  // ── 2~3단계: 영양정보 (캐시 → MFDS → AI 폴백) ────────────
  const results: AnalyzedItem[] = [];

  for (const item of recognized.slice(0, 4)) {
    const portionG = clampPortion(item.estimated_weight_g);
    const normalized = normalizeFoodName(item.food_name);

    // 캐시 조회. mfds_db를 ai_estimate보다 우선한다.
    const { data: cached } = await supabase
      .from("food_nutrition_cache")
      .select("*")
      .eq("food_name_normalized", normalized)
      .order("source", { ascending: true }) // 'ai_estimate' < 'mfds_db' 이므로 아래서 직접 고른다
      .limit(2);

    const cacheRow =
      cached?.find((c) => c.source === "mfds_db") ?? cached?.[0] ?? null;

    if (cacheRow) {
      // 캐시 히트 — MFDS 호출도, 캐시 write도 생략된다.
      await supabase
        .from("food_nutrition_cache")
        .update({ hit_count: (cacheRow.hit_count ?? 0) + 1 })
        .eq("food_name_normalized", cacheRow.food_name_normalized)
        .eq("source", cacheRow.source);

      const s = Number(cacheRow.serving_size_g) || 100;
      results.push({
        food_name: item.food_name,
        display_name: cacheRow.display_name,
        portion_g: portionG,
        calories: scale(cacheRow.calories, s, portionG),
        carbs_g: scale(cacheRow.carbs_g, s, portionG),
        protein_g: scale(cacheRow.protein_g, s, portionG),
        fat_g: scale(cacheRow.fat_g, s, portionG),
        sodium_mg: scale(cacheRow.sodium_mg, s, portionG),
        fiber_g: scale(cacheRow.fiber_g, s, portionG),
        sugar_g: scale(cacheRow.sugar_g, s, portionG),
        saturated_fat_g: scale(cacheRow.saturated_fat_g, s, portionG),
        source: cacheRow.source,
        confidence: item.confidence ?? 0.5,
        cache_hit: true,
      });
      continue;
    }

    // 캐시 미스 → MFDS 조회
    const mfds = await lookupMfds(item.food_name);

    if (mfds && mfds.calories !== null) {
      await supabase.from("food_nutrition_cache").upsert({
        food_name_normalized: normalized,
        source: "mfds_db",
        display_name: mfds.displayName,
        serving_size_g: mfds.servingSizeG,
        calories: mfds.calories,
        carbs_g: mfds.carbsG,
        protein_g: mfds.proteinG,
        fat_g: mfds.fatG,
        sodium_mg: mfds.sodiumMg,
        fiber_g: mfds.fiberG,
        sugar_g: mfds.sugarG,
        saturated_fat_g: mfds.saturatedFatG,
        mfds_food_code: mfds.foodCode,
        matched_at: new Date().toISOString(),
      }, { onConflict: "food_name_normalized,source" });

      const s = mfds.servingSizeG;
      results.push({
        food_name: item.food_name,
        display_name: mfds.displayName,
        portion_g: portionG,
        calories: scale(mfds.calories, s, portionG),
        carbs_g: scale(mfds.carbsG, s, portionG),
        protein_g: scale(mfds.proteinG, s, portionG),
        fat_g: scale(mfds.fatG, s, portionG),
        sodium_mg: scale(mfds.sodiumMg, s, portionG),
        fiber_g: scale(mfds.fiberG, s, portionG),
        sugar_g: scale(mfds.sugarG, s, portionG),
        saturated_fat_g: scale(mfds.saturatedFatG, s, portionG),
        source: "mfds_db",
        confidence: Math.min(item.confidence ?? 0.5, mfds.matchScore),
        cache_hit: false,
      });
      continue;
    }

    // MFDS 미매칭 → Gemini 자체 추정치 폴백
    // fallback_* 는 estimated_weight_g 기준 값이므로 serving_size_g에 그 중량을 넣는다.
    const fb = {
      calories: numOrNull(item.fallback_calories),
      carbs: numOrNull(item.fallback_carbs_g),
      protein: numOrNull(item.fallback_protein_g),
      fat: numOrNull(item.fallback_fat_g),
    };

    if (fb.calories !== null) {
      await supabase.from("food_nutrition_cache").upsert({
        food_name_normalized: normalized,
        source: "ai_estimate",
        display_name: item.food_name,
        serving_size_g: portionG,
        calories: fb.calories,
        carbs_g: fb.carbs,
        protein_g: fb.protein,
        fat_g: fb.fat,
        matched_at: new Date().toISOString(),
      }, { onConflict: "food_name_normalized,source" });
    }

    results.push({
      food_name: item.food_name,
      display_name: item.food_name,
      portion_g: portionG,
      calories: fb.calories,
      carbs_g: fb.carbs,
      protein_g: fb.protein,
      fat_g: fb.fat,
      sodium_mg: null,
      fiber_g: null,
      sugar_g: null,
      saturated_fat_g: null,
      source: "ai_estimate",
      confidence: item.confidence ?? 0.4,
      cache_hit: false,
    });
  }

  return json({
    items: results,
    quota: { remaining: q.remaining, plan: q.plan, free_daily_limit: FREE_DAILY_SCANS },
    // UI가 "공식 데이터 기반" / "추정치" 배지를 띄우는 데 쓴다.
    has_estimate: results.some((r) => r.source === "ai_estimate"),
  });
});

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
}

/** 비현실적인 중량 추정치를 자른다. 5g 미만/3kg 초과는 인식 오류로 본다. */
function clampPortion(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(Math.max(Math.round(n), 5), 3000);
}

/**
 * 클라이언트가 보낸 로컬 날짜를 서버 UTC 날짜 ±1일로 제한한다.
 * 이 범위면 지구상 모든 타임존을 커버하면서, 기기 시계를 미래로 돌려
 * 쿼터를 리셋하는 우회는 막을 수 있다.
 */
function clampLocalDate(input?: string): string {
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return todayUtc;

  const diffDays = Math.abs(
    (Date.parse(`${input}T00:00:00Z`) - Date.parse(`${todayUtc}T00:00:00Z`)) / 86_400_000,
  );
  return diffDays <= 1 ? input : todayUtc;
}
