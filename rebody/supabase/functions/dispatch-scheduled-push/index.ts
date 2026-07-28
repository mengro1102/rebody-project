// Phase 5 — 예약 푸시 디스패처 (cron: 15분마다)
//
// 왜 15분 폴링인가:
//   사용자마다 타임존이 다르고, 교대근무라 단식 시작·종료 시각이 매일 달라진다.
//   "매일 오전 9시 일괄 발송" 모델이 성립하지 않는다. 짧은 주기로 돌면서
//   지금 창에 걸리는 대상만 골라내는 게 가장 단순하고 정확하다.
//
// 발송 종류:
//   fasting_start        단식 시작 시각 도래       (functional)
//   fasting_end_soon     단식 종료 30분 전         (functional)
//   unlogged_meal        식사 창 종료 30분 전 미기록 (nudge)
//   weekly_feedback_ready 주간 피드백 생성됨        (functional)
//
// 중복 발송은 dedup_key로 막는다. 폴링 방식의 필연적 리스크라 여기가 핵심이다.

import { fail, json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceRoleCall } from "../_shared/supabase.ts";
import { deliver } from "../_shared/push.ts";

const WINDOW_MINUTES = 15;   // cron 주기와 일치시킬 것
const END_SOON_LEAD = 30;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (!isServiceRoleCall(req)) return fail("forbidden", "허용되지 않은 호출입니다.", 403);

  const supabase = adminClient();
  const now = Date.now();
  const sent = { fasting_start: 0, fasting_end_soon: 0, unlogged_meal: 0, weekly_feedback_ready: 0 };

  // ── 1) 단식 시작 ────────────────────────────────────────
  // target_start가 [now, now+15m) 구간에 들어온 예약 단식
  {
    const { data: rows } = await supabase
      .from("fasting_logs")
      .select("id, user_id, target_start, target_end, local_date")
      .eq("status", "scheduled")
      .gte("target_start", new Date(now).toISOString())
      .lt("target_start", new Date(now + WINDOW_MINUTES * 60_000).toISOString());

    for (const r of rows ?? []) {
      const res = await deliver({
        user_id: r.user_id,
        notification_type: "fasting_start",
        category: "functional",
        title: "단식 시작",
        body: "지금부터 단식 구간이에요. 물과 무가당 음료는 괜찮습니다.",
        data: { screen: "dashboard", fasting_log_id: r.id },
        dedup_key: `fasting_start:${r.id}`,
        ignore_quiet_hours: true, // 사용자가 직접 설정한 스케줄이므로 조용한 시간보다 우선
      });
      if (res.ok) sent.fasting_start++;
    }
  }

  // ── 2) 단식 종료 30분 전 ────────────────────────────────
  {
    const from = new Date(now + END_SOON_LEAD * 60_000).toISOString();
    const to = new Date(now + (END_SOON_LEAD + WINDOW_MINUTES) * 60_000).toISOString();

    const { data: rows } = await supabase
      .from("fasting_logs")
      .select("id, user_id, target_end")
      .in("status", ["scheduled", "in_progress"])
      .gte("target_end", from)
      .lt("target_end", to);

    for (const r of rows ?? []) {
      const res = await deliver({
        user_id: r.user_id,
        notification_type: "fasting_end_soon",
        category: "functional",
        title: "30분 뒤 식사 시간",
        body: "곧 식사 창이 열려요. 무엇을 먹을지 미리 정해두면 과식을 줄일 수 있어요.",
        data: { screen: "dashboard", fasting_log_id: r.id },
        dedup_key: `fasting_end_soon:${r.id}`,
        ignore_quiet_hours: true,
      });
      if (res.ok) sent.fasting_end_soon++;
    }
  }

  // ── 3) 주간 피드백 도착 ─────────────────────────────────
  {
    // 최근 2시간 내 생성됐고 아직 알림을 안 보낸 것
    const { data: rows } = await supabase
      .from("weekly_feedback")
      .select("id, user_id, week_start")
      .gte("created_at", new Date(now - 2 * 3600_000).toISOString());

    for (const r of rows ?? []) {
      const res = await deliver({
        user_id: r.user_id,
        notification_type: "weekly_feedback_ready",
        category: "functional",
        title: "이번 주 리포트가 도착했어요",
        body: "지난 한 주의 단식·식사 패턴을 정리했습니다.",
        data: { screen: "feedback", week_start: r.week_start },
        dedup_key: `weekly_feedback:${r.id}`,
      });
      if (res.ok) sent.weekly_feedback_ready++;
    }
  }

  // ── 4) 미기록 넛지 ──────────────────────────────────────
  // 오늘 식사 창이 끝나가는데 meal_logs가 0건인 사용자.
  // 넛지는 과하면 이탈 요인이라 하루 1회로 제한한다(dedup_key에 날짜 포함).
  {
    const { data: candidates } = await supabase.rpc("get_unlogged_meal_candidates", {
      p_window_minutes: WINDOW_MINUTES,
      p_lead_minutes: END_SOON_LEAD,
    }).catch(() => ({ data: null }));

    for (const c of (candidates ?? []) as Array<{ user_id: string; local_date: string }>) {
      const res = await deliver({
        user_id: c.user_id,
        notification_type: "unlogged_meal",
        category: "nudge",
        title: "오늘 식사 기록이 비어 있어요",
        body: "사진 한 장이면 30초면 끝납니다.",
        data: { screen: "scanner" },
        dedup_key: `unlogged_meal:${c.user_id}:${c.local_date}`,
      });
      if (res.ok) sent.unlogged_meal++;
    }
  }

  console.log("[dispatch-push]", JSON.stringify(sent));
  return json({ ok: true, sent });
});
