// 전역 AI 예산 게이트 (docs/07_MONETIZATION_DEFERRED.md §5)
//
// Gemini를 호출하는 Edge Function은 호출 **직전**에 consume()을 부르고,
// 호출이 실패하면 refund()로 되돌린다. 사용자당 쿼터와는 별개의 층이다:
//
//   사용자당 쿼터  — 한 사람의 남용을 막는다 (consume_scan_quota)
//   전역 예산      — 사용자 수 증가로 총액이 터지는 것을 막는다 (여기)
//
// 수익이 0인 동안에는 이 층이 실질적인 지출 한도다.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AiCallKind = "scan" | "nl" | "feedback";

export interface BudgetVerdict {
  allowed: boolean;
  used: number;
  cap: number;
  /** 경고선(기본 80%)을 이번 호출이 처음 넘었는가. 한 번만 true가 된다. */
  warn: boolean;
}

/**
 * 전역 예산에서 1회를 차감한다.
 *
 * 실패 시(RPC 오류) **허용**으로 처리한다 — 집계 테이블 문제로 서비스를 멈추는 것은
 * 과잉 대응이다. 상한의 목적은 폭주 방어이고, 그 경우엔 호출 자체가 성공하고 있다.
 */
export async function consumeAiBudget(
  supabase: SupabaseClient,
  kind: AiCallKind,
): Promise<BudgetVerdict> {
  const { data, error } = await supabase.rpc("consume_ai_budget", { p_kind: kind });

  if (error) {
    console.error("[budget] 예산 확인 실패(허용으로 처리):", error.message);
    return { allowed: true, used: 0, cap: 0, warn: false };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const verdict: BudgetVerdict = {
    allowed: row?.allowed ?? true,
    used: row?.used ?? 0,
    cap: row?.cap ?? 0,
    warn: row?.warn ?? false,
  };

  if (verdict.warn) {
    // 운영자가 보는 신호. Supabase 로그에서 이 문자열로 알림을 걸어둘 수 있다.
    console.warn(
      `[budget][ALERT] 일일 AI 예산 ${verdict.used}/${verdict.cap} 도달 (경고선 초과). ` +
        `kind=${kind}. 상한 조정은 app_settings.ai_daily_call_cap.`,
    );
  }
  if (!verdict.allowed) {
    console.error(
      `[budget][CAPPED] 일일 상한 ${verdict.cap} 도달 — ${kind} 호출을 차단했습니다.`,
    );
  }

  return verdict;
}

/** 호출이 실패했을 때 예산을 되돌린다. 실패한 요청이 상한을 먹으면 안 된다. */
export async function refundAiBudget(
  supabase: SupabaseClient,
  kind: AiCallKind,
): Promise<void> {
  const { error } = await supabase.rpc("refund_ai_budget", { p_kind: kind });
  if (error) console.error("[budget] 예산 환불 실패:", error.message);
}
