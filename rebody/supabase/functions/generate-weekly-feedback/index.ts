// Phase 4 — 주간 AI 코칭 피드백
//
// 토큰·프라이버시 설계:
//   원본 로그(식사 사진, 개별 기록)를 Gemini에 보내지 않는다. DB의 get_weekly_stats()로
//   먼저 집계한 통계값만 전달한다. 입력 토큰이 1/10로 줄고, 국외이전되는 개인정보의
//   범위도 함께 줄어든다. (docs/00_ANALYSIS.md §2-1)
//
// 안전 설계:
//   단식 앱의 AI 코칭은 섭식장애를 악화시킬 수 있는 지점이다. 시스템 지시에
//   "칼로리 추가 제한·단식 연장·체중 감량 가속 권유 금지"를 하드 제약으로 고정한다.
//
// 호출 경로:
//   1) cron (service_role, body 없음)  → 전체 사용자 배치
//   2) 사용자 JWT + { week_start }     → 해당 사용자 1건 (Pro 재생성용)

import { fail, json, preflight, shortId } from "../_shared/http.ts";
import { adminClient, isServiceRoleCall, requireUser } from "../_shared/supabase.ts";
import { generateJSON, GeminiError, withRetry } from "../_shared/gemini.ts";

const SYSTEM_INSTRUCTION = `당신은 교대근무자의 식사·단식 습관을 돕는 한국어 코치입니다.

말투: 존댓말, 담백하게. 과장된 칭찬이나 죄책감을 자극하는 표현을 쓰지 마세요.

반드시 지킬 것:
- summary는 3문장 이내. 이번 주에 실제로 관찰된 것만 언급하세요.
- suggestion은 "지금 당장 실행 가능한 구체적 행동" 하나만. 추상적 조언 금지.
- 데이터가 부족하면(기록 3일 미만) 습관 형성 자체를 격려하고 조정 제안은 생략하세요.

절대 금지 (안전):
- 칼로리를 더 줄이라는 제안
- 단식 시간을 늘리라는 제안 (16시간을 넘기는 어떤 제안도 금지)
- 체중 감량 속도를 높이라는 제안
- 특정 음식군을 완전히 끊으라는 제안
- 의학적 진단이나 치료로 오인될 수 있는 표현
사용자가 힘들어 보이면 식사 창을 "넓히는" 방향으로 제안하세요.

조정 제안(suggested_adjustment)은 식사 시간대를 앞당기거나 뒤로 미루는 것만 가능합니다.
근무 시간이나 단식 길이는 건드리지 마세요.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    suggestion: { type: "string" },
    suggested_adjustment: {
      type: "object",
      nullable: true,
      properties: {
        kind: { type: "string", enum: ["shift_meal_window"] },
        shift_minutes: { type: "integer" },
        reason: { type: "string" },
      },
      required: ["kind", "shift_minutes"],
    },
  },
  required: ["summary", "suggestion"],
};

interface FeedbackOut {
  summary: string;
  suggestion: string;
  suggested_adjustment?: { kind: string; shift_minutes: number; reason?: string } | null;
}

/** 직전 주 월요일 (KST 기준). */
function lastWeekStart(): string {
  const nowKst = new Date(Date.now() + 9 * 3600_000);
  const dow = nowKst.getUTCDay();            // 0=일
  const daysSinceMonday = (dow + 6) % 7;
  const thisMonday = new Date(nowKst);
  thisMonday.setUTCDate(nowKst.getUTCDate() - daysSinceMonday);
  thisMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  return thisMonday.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const supabase = adminClient();
  const isCron = isServiceRoleCall(req);

  let targetUserIds: string[];
  let weekStart: string;

  if (isCron) {
    weekStart = lastWeekStart();
    // 지난 주에 기록이 하나라도 있는 사용자만. 휴면 사용자에게 토큰을 쓰지 않는다.
    const { data: active } = await supabase
      .from("meal_logs")
      .select("user_id")
      .gte("local_date", weekStart)
      .lt("local_date", addDays(weekStart, 7));
    targetUserIds = [...new Set((active ?? []).map((r) => r.user_id))];
    console.log(`[weekly-feedback] cron week=${weekStart} users=${targetUserIds.length}`);
  } else {
    const user = await requireUser(req);
    if (user instanceof Response) return user;
    const body = await req.json().catch(() => ({}));
    weekStart = typeof body.week_start === "string" ? body.week_start : lastWeekStart();
    targetUserIds = [user.id];
  }

  const generated: Array<{ user_id: string; week_start: string }> = [];
  const skipped: Array<{ user_id: string; reason: string }> = [];

  for (const userId of targetUserIds) {
    // 이미 생성됐으면 건너뛴다 (cron 중복 실행 대비)
    const { data: existing } = await supabase
      .from("weekly_feedback")
      .select("id")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .maybeSingle();

    if (existing && isCron) {
      skipped.push({ user_id: shortId(userId), reason: "already_exists" });
      continue;
    }

    const { data: stats, error: statsErr } = await supabase.rpc("get_weekly_stats", {
      p_user_id: userId,
      p_week_start: weekStart,
    });

    if (statsErr || !stats) {
      skipped.push({ user_id: shortId(userId), reason: "stats_failed" });
      continue;
    }

    const loggingDays = Number(stats.logging_days ?? 0);
    if (loggingDays === 0) {
      skipped.push({ user_id: shortId(userId), reason: "no_data" });
      continue;
    }

    let out: FeedbackOut;
    try {
      const res = await withRetry(() =>
        generateJSON<FeedbackOut>({
          systemInstruction: SYSTEM_INSTRUCTION,
          // 집계값만. 원본 로그는 보내지 않는다.
          prompt: `이번 주 집계 데이터입니다:\n${JSON.stringify(stats)}\n\n기록한 날: ${loggingDays}일`,
          maxOutputTokens: 700,
          temperature: 0.4,
          responseSchema: RESPONSE_SCHEMA,
        }), 2);
      out = res.data;
    } catch (e) {
      const ge = e instanceof GeminiError ? e : null;
      console.error(`[weekly-feedback] user=${shortId(userId)} 실패:`, ge?.message ?? e);
      skipped.push({ user_id: shortId(userId), reason: "ai_failed" });
      continue;
    }

    // 모델이 규칙을 어겨도 여기서 한 번 더 거른다. ±120분을 넘는 조정은 버린다.
    let adjustment: Record<string, unknown> | null = null;
    const adj = out.suggested_adjustment;
    if (adj && adj.kind === "shift_meal_window") {
      const shift = Math.trunc(Number(adj.shift_minutes));
      if (Number.isFinite(shift) && Math.abs(shift) <= 120 && shift !== 0) {
        adjustment = { kind: "shift_meal_window", shift_minutes: shift, reason: adj.reason ?? null };
      }
    }

    const { error: upsertErr } = await supabase.from("weekly_feedback").upsert({
      user_id: userId,
      week_start: weekStart,
      summary_text: `${out.summary.trim()}\n\n${out.suggestion.trim()}`,
      suggested_adjustment_json: adjustment,
      applied_at: null,
    }, { onConflict: "user_id,week_start" });

    if (upsertErr) {
      skipped.push({ user_id: shortId(userId), reason: upsertErr.message });
      continue;
    }

    generated.push({ user_id: shortId(userId), week_start: weekStart });

    // 푸시는 dispatch-scheduled-push가 weekly_feedback을 보고 알아서 발송한다.
  }

  return json({ week_start: weekStart, generated: generated.length, skipped });
});

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
