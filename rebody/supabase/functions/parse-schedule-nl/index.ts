// Phase 2 — 프리셋 위에 자연어 보정을 얹는 하이브리드 스케줄 파서
//
// 설계 의도:
//   자유 텍스트만으로 3교대를 완전 자동 파싱하는 건 MVP 범위 밖이다(V2 이연).
//   여기서는 "이미 선택된 프리셋"을 기준선으로 두고, 사용자의 한 문장 보정만 반영한다.
//   모델이 처음부터 만들어 내는 게 아니라 diff만 내게 하므로 출력 토큰이 짧고 오류도 적다.
//
// 확신이 낮으면(<0.6) 스케줄을 확정하지 않고 되묻는다. 교대근무 스케줄을 잘못 잡으면
// 이후 단식 타이머·푸시가 전부 어긋나므로, 틀리느니 한 번 더 묻는 쪽이 싸다.

import { fail, json, preflight, shortId } from "../_shared/http.ts";
import { adminClient, requireUser } from "../_shared/supabase.ts";
import { generateJSON, GeminiError, withRetry } from "../_shared/gemini.ts";

const CONFIDENCE_THRESHOLD = 0.6;

const SYSTEM_INSTRUCTION = `당신은 교대근무자의 근무 스케줄을 구조화하는 도우미입니다.

규칙:
- 사용자가 이미 선택한 프리셋(baseline)이 주어집니다. 사용자의 보정 문장에 명시적으로
  언급된 부분만 수정하세요. 언급되지 않은 날은 절대 건드리지 마세요.
- 모든 시각은 24시간제 "HH:MM" 벽시계입니다. 타임존을 적용하지 마세요.
- 야간 근무처럼 자정을 넘기는 경우 종료 시각이 시작 시각보다 작게 표기됩니다
  (예: 22:00~06:00). 이는 정상이며 그대로 두세요.
- 식사 가능 시간대(meal window)는 근무·운동 시간과 충돌하지 않게, 기상 후 활동 시간대
  안에 8~10시간 범위로 제안하세요.
- 문장이 모호하거나 어느 날짜에 적용할지 알 수 없으면 adjustments를 비우고
  confidence를 0.5 미만으로 두고 follow_up_question에 한국어로 한 문장만 되물으세요.
- 건강 조언, 단식 시간 연장 권유, 칼로리 제한 제안은 절대 하지 마세요. 스케줄 구조화만 합니다.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    confidence: { type: "number" },
    follow_up_question: { type: "string", nullable: true },
    adjustments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cycle_day_index: { type: "integer" },
          is_off_day: { type: "boolean", nullable: true },
          work_start: { type: "string", nullable: true },
          work_end: { type: "string", nullable: true },
          workout_start: { type: "string", nullable: true },
          workout_end: { type: "string", nullable: true },
          suggested_meal_window_start: { type: "string", nullable: true },
          suggested_meal_window_end: { type: "string", nullable: true },
        },
        required: ["cycle_day_index"],
      },
    },
    summary: { type: "string" },
  },
  required: ["confidence", "adjustments", "summary"],
};

interface Adjustment {
  cycle_day_index: number;
  is_off_day?: boolean | null;
  work_start?: string | null;
  work_end?: string | null;
  workout_start?: string | null;
  workout_end?: string | null;
  suggested_meal_window_start?: string | null;
  suggested_meal_window_end?: string | null;
}

interface ParseResult {
  confidence: number;
  follow_up_question?: string | null;
  adjustments: Adjustment[];
  summary: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 모델이 "25:00" 같은 값을 뱉는 경우가 있다. 스키마로는 못 막으니 여기서 거른다. */
function sanitizeTime(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, 5);
  return TIME_RE.test(t) ? t : undefined;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("method_not_allowed", "POST만 허용됩니다.", 405);

  const user = await requireUser(req);
  if (user instanceof Response) return user;

  let body: { pattern_id?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", "잘못된 요청 형식입니다.", 400);
  }

  const { pattern_id, text } = body;
  if (!pattern_id || !text?.trim()) {
    return fail("bad_request", "pattern_id와 text가 필요합니다.", 400);
  }
  if (text.length > 500) {
    // 입력 토큰 방어. 500자면 어떤 교대 설명도 충분하다.
    return fail("bad_request", "설명은 500자 이내로 입력해 주세요.", 400);
  }

  const supabase = adminClient();

  // 소유권 확인 — service_role은 RLS를 우회하므로 여기서 직접 검사해야 한다.
  const { data: pattern, error: patternErr } = await supabase
    .from("schedule_patterns")
    .select("id, user_id, pattern_type, preset_key, cycle_length_days, cycle_anchor_date")
    .eq("id", pattern_id)
    .maybeSingle();

  if (patternErr || !pattern) return fail("not_found", "스케줄 패턴을 찾을 수 없습니다.", 404);
  if (pattern.user_id !== user.id) return fail("forbidden", "권한이 없습니다.", 403);

  const { data: baseline } = await supabase
    .from("schedule_cycle_days")
    .select("cycle_day_index, is_off_day, work_start, work_end, workout_start, workout_end, suggested_meal_window_start, suggested_meal_window_end")
    .eq("pattern_id", pattern_id)
    .order("cycle_day_index");

  const prompt = [
    `사이클 길이: ${pattern.cycle_length_days}일 (cycle_day_index는 0부터 ${pattern.cycle_length_days - 1}까지)`,
    `선택한 프리셋: ${pattern.preset_key ?? "custom"}`,
    "",
    "현재 baseline 스케줄:",
    JSON.stringify(baseline ?? [], null, 0),
    "",
    "사용자의 보정 요청:",
    text.trim(),
  ].join("\n");

  let result: ParseResult;
  let usage;
  try {
    const out = await withRetry(() =>
      generateJSON<ParseResult>({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt,
        // diff만 내면 되므로 512로 충분하다. 출력 단가가 입력의 6배라 여기가 비용의 핵심.
        maxOutputTokens: 512,
        temperature: 0.1,
        responseSchema: RESPONSE_SCHEMA,
      })
    );
    result = out.data;
    usage = out.usage;
  } catch (e) {
    const ge = e instanceof GeminiError ? e : null;
    console.error(`[parse-schedule-nl] user=${shortId(user.id)} 실패:`, e);
    return fail(
      "ai_unavailable",
      ge?.status === 429
        ? "AI 요청이 일시적으로 몰렸습니다. 잠시 후 다시 시도해 주세요."
        : "스케줄 분석에 실패했습니다. 프리셋 값을 직접 수정할 수도 있습니다.",
      503,
    );
  }

  const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));

  // 확신이 낮으면 DB를 건드리지 않고 되묻는다.
  if (confidence < CONFIDENCE_THRESHOLD || result.adjustments.length === 0) {
    await supabase.from("schedule_patterns")
      .update({ raw_description: text.trim(), ai_confidence: confidence })
      .eq("id", pattern_id);

    return json({
      status: "needs_clarification",
      confidence,
      follow_up_question:
        result.follow_up_question?.trim() ||
        "어느 요일(또는 사이클 며칠째)에 적용할지 알려주시겠어요?",
      applied: [],
    });
  }

  // 적용 — 유효한 필드만 골라서 업데이트한다. undefined는 "언급 없음"이므로 건드리지 않는다.
  const applied: number[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];

  for (const adj of result.adjustments) {
    const idx = Number(adj.cycle_day_index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pattern.cycle_length_days) {
      rejected.push({ index: idx, reason: "사이클 범위 밖" });
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (typeof adj.is_off_day === "boolean") patch.is_off_day = adj.is_off_day;

    for (const field of [
      "work_start", "work_end", "workout_start", "workout_end",
      "suggested_meal_window_start", "suggested_meal_window_end",
    ] as const) {
      const v = sanitizeTime(adj[field]);
      if (v !== undefined) patch[field] = v;
    }

    if (Object.keys(patch).length === 0) continue;

    const { error } = await supabase
      .from("schedule_cycle_days")
      .update(patch)
      .eq("pattern_id", pattern_id)
      .eq("cycle_day_index", idx);

    if (error) rejected.push({ index: idx, reason: error.message });
    else applied.push(idx);
  }

  await supabase.from("schedule_patterns")
    .update({ raw_description: text.trim(), ai_confidence: confidence })
    .eq("id", pattern_id);

  const { data: updated } = await supabase
    .from("schedule_cycle_days")
    .select("*")
    .eq("pattern_id", pattern_id)
    .order("cycle_day_index");

  console.log(`[parse-schedule-nl] user=${shortId(user.id)} applied=${applied.length} tokens=${usage.totalTokens}`);

  return json({
    status: "applied",
    confidence,
    summary: result.summary,
    applied,
    rejected,
    cycle_days: updated ?? [],
  });
});
