// Phase 5 — FCM 토큰 등록 및 권한 요청
//
// Android 13+(API 33)부터 POST_NOTIFICATIONS는 런타임 권한이다.
// 시스템 다이얼로그는 앱 생애 통틀어 사실상 한 번뿐이고, 여기서 거절당하면
// 사용자가 설정 앱까지 직접 들어가야 복구된다. 그래서 소프트 애스크(앱 내 설명 화면)를
// 먼저 띄우고, 사용자가 "허용할게요"를 누른 뒤에만 시스템 요청을 올린다.
//
// 알림 채널은 카테고리별로 분리한다. Android 설정에서 사용자가 넛지만 끄고
// 기능성 알림은 남기는 선택을 할 수 있어야 한다 (동의 준수 + 이탈 방지).

import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";

export const CHANNELS = {
  functional: {
    id: "rebody-functional",
    name: "단식 알림",
    description: "단식 시작·종료 등 내가 설정한 일정 알림",
    importance: Notifications.AndroidImportance.HIGH,
  },
  nudge: {
    id: "rebody-nudge",
    name: "기록 리마인더",
    description: "식사 기록을 잊었을 때 알려드려요",
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  marketing: {
    id: "rebody-marketing",
    name: "소식 및 혜택",
    description: "새 기능과 이벤트 안내",
    importance: Notifications.AndroidImportance.LOW,
  },
} as const;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function setupChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  for (const ch of Object.values(CHANNELS)) {
    await Notifications.setNotificationChannelAsync(ch.id, {
      name: ch.name,
      description: ch.description,
      importance: ch.importance,
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

export type PermissionOutcome = "granted" | "denied" | "unavailable";

/**
 * 시스템 권한 요청 → FCM 토큰 발급 → DB 저장.
 * 반드시 소프트 애스크 화면에서 사용자가 동의한 뒤에만 호출할 것.
 */
export async function requestPushPermission(): Promise<PermissionOutcome> {
  if (!Device.isDevice) {
    // 에뮬레이터에서는 FCM 토큰이 발급되지 않는다.
    console.warn("[push] 실기기에서만 동작합니다.");
    return "unavailable";
  }

  await setupChannels();

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }

  if (status !== "granted") {
    track("push_permission_denied");
    return "denied";
  }

  track("push_permission_granted");

  try {
    const token = await Notifications.getDevicePushTokenAsync();
    await saveFcmToken(String(token.data));
  } catch (e) {
    console.warn("[push] 토큰 발급 실패:", e);
    return "unavailable";
  }

  return "granted";
}

export async function saveFcmToken(token: string): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;

  const { error } = await supabase
    .from("users")
    .update({ fcm_token: token })
    .eq("id", data.user.id);

  if (error) console.warn("[push] 토큰 저장 실패:", error.message);
}

/** 로그아웃 시 토큰을 비운다. 안 그러면 다음 로그인 사용자에게 알림이 간다. */
export async function clearFcmToken(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  await supabase.from("users").update({ fcm_token: null }).eq("id", data.user.id);
}

export interface PushPayload {
  screen?: string;
  fasting_log_id?: string;
  week_start?: string;
}

/**
 * 알림 탭 처리. 열람 로그를 남기고 딥링크 대상을 반환한다.
 * 반환값을 expo-router의 router.push()에 넘긴다.
 */
export async function handleNotificationResponse(
  response: Notifications.NotificationResponse,
): Promise<string | null> {
  const data = response.notification.request.content.data as PushPayload;
  track("push_opened", { screen: data.screen ?? "unknown" });

  const { data: userData } = await supabase.auth.getUser();
  if (userData.user) {
    // 최근 발송 건을 열람 처리. 정확한 매칭이 필요해지면 dedup_key를 payload에 실어 보낼 것.
    await supabase
      .from("push_notification_logs")
      .update({ opened: true, opened_at: new Date().toISOString() })
      .eq("user_id", userData.user.id)
      .eq("opened", false)
      .order("sent_at", { ascending: false })
      .limit(1);
  }

  switch (data.screen) {
    case "scanner": return "/scanner";
    case "feedback": return "/feedback";
    case "dashboard": return "/";
    default: return null;
  }
}
