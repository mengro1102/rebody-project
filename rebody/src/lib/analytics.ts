// Phase 6/7 — 이벤트 트래킹
//
// Firebase Analytics를 Expo에서 쓰려면 @react-native-firebase/analytics(네이티브)가 필요하다.
// 여기서는 얇은 어댑터만 두고, 네이티브 모듈이 없으면 콘솔로 떨어뜨린다.
// development build 전에도 퍼널 로직을 검증할 수 있게 하기 위한 구조.
//
// ⚠️ 이벤트 파라미터에 개인 식별정보·건강 데이터를 절대 넣지 말 것.
//    Play Console Data Safety 신고 내용과 실제 전송이 어긋나면 정책 위반이 된다.

import { isProduction } from "./env";

export type AnalyticsEvent =
  // 온보딩
  | "onboarding_start"
  | "consent_granted"
  | "preset_selected"
  | "schedule_nl_submitted"
  | "schedule_nl_clarification"
  | "onboarding_complete"
  | "eligibility_blocked"
  // 코어
  | "fasting_started"
  | "fasting_completed"
  | "fasting_broken"
  | "food_scan_attempt"
  | "food_scan_success"
  | "food_scan_failed"
  | "food_scan_quota_exceeded"
  | "meal_logged"
  | "ics_exported"
  // 시간대 변경 — 출장 사용자 비중을 보는 지표. 지역명은 개인정보가 아니지만
  // 이동 이력이 되므로 IANA 존 이름 외에는 아무것도 싣지 않는다.
  | "timezone_changed"
  // 피드백
  | "feedback_viewed"
  | "feedback_applied"
  // 페이월 퍼널
  | "paywall_viewed"
  | "paywall_trial_started"
  | "paywall_purchased"
  | "paywall_dismissed"
  | "subscription_cancelled"
  // 알림
  | "push_permission_soft_ask"
  | "push_permission_granted"
  | "push_permission_denied"
  | "push_opened";

type Params = Record<string, string | number | boolean>;

let nativeAnalytics: { logEvent: (name: string, params?: Params) => Promise<void> } | null = null;

/** 네이티브 모듈이 있으면 연결한다. 없으면 no-op으로 남는다. */
export function initAnalytics(impl: typeof nativeAnalytics) {
  nativeAnalytics = impl;
}

export function track(event: AnalyticsEvent, params?: Params): void {
  if (nativeAnalytics) {
    void nativeAnalytics.logEvent(event, params).catch(() => {
      // 분석 실패가 사용자 플로우를 막아선 안 된다.
    });
    return;
  }
  if (!isProduction) {
    console.log(`[analytics] ${event}`, params ?? {});
  }
}

/** 페이월 퍼널 전용 헬퍼. 진입 지점을 항상 함께 남긴다 — 없으면 전환율 분석이 불가능하다. */
export function trackPaywall(
  step: "viewed" | "trial_started" | "purchased" | "dismissed",
  source: "scan_limit" | "feedback_reapply" | "advanced_macro" | "settings",
): void {
  const map = {
    viewed: "paywall_viewed",
    trial_started: "paywall_trial_started",
    purchased: "paywall_purchased",
    dismissed: "paywall_dismissed",
  } as const;
  track(map[step], { source });
}
