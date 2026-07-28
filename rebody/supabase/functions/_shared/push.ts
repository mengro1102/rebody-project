// 푸시 발송 공통 로직
//
// send-push(단건 API)와 dispatch-scheduled-push(배치 cron)가 함께 쓴다.
// Edge Function 디렉터리끼리 index.ts를 직접 import하면 Deno.serve가 중복 실행되므로
// 로직은 반드시 _shared에 둔다.

import { adminClient } from "./supabase.ts";
import { sendPush } from "./fcm.ts";
import { toMinutes } from "./cycle.ts";
import { shortId } from "./http.ts";

export type Category = "functional" | "nudge" | "marketing";

export interface SendRequest {
  user_id: string;
  notification_type: string;
  category: Category;
  title: string;
  body: string;
  data?: Record<string, string>;
  dedup_key?: string;
  /** 조용한 시간을 무시한다. 사용자가 직접 설정한 단식 시각 알림에만 사용. */
  ignore_quiet_hours?: boolean;
}

export interface DeliverResult {
  ok: boolean;
  reason?: string;
}

const CHANNEL_BY_CATEGORY: Record<Category, string> = {
  functional: "rebody-functional",
  nudge: "rebody-nudge",
  marketing: "rebody-marketing",
};

export async function deliver(p: SendRequest): Promise<DeliverResult> {
  const supabase = adminClient();

  const { data: user } = await supabase
    .from("users")
    .select("fcm_token, timezone")
    .eq("id", p.user_id)
    .maybeSingle();

  if (!user?.fcm_token) return { ok: false, reason: "no_token" };

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("functional, nudge, marketing, quiet_hours_start, quiet_hours_end")
    .eq("user_id", p.user_id)
    .maybeSingle();

  // 설정 행이 없으면 기능성만 허용 — 안전한 기본값.
  const allowed = prefs ? Boolean(prefs[p.category]) : p.category === "functional";
  if (!allowed) return { ok: false, reason: "category_disabled" };

  if (!p.ignore_quiet_hours && prefs?.quiet_hours_start && prefs?.quiet_hours_end) {
    if (inQuietHours(user.timezone ?? "Asia/Seoul", prefs.quiet_hours_start, prefs.quiet_hours_end)) {
      return { ok: false, reason: "quiet_hours" };
    }
  }

  // dedup — 유니크 인덱스 위반이면 이미 보낸 것이다.
  // cron이 15분마다 도는 구조라 이게 없으면 같은 알림이 반복 발송된다.
  if (p.dedup_key) {
    const { error } = await supabase.from("push_notification_logs").insert({
      user_id: p.user_id,
      notification_type: p.notification_type,
      category: p.category,
      dedup_key: p.dedup_key,
      delivered: false,
    });
    if (error) {
      if (error.code === "23505") return { ok: false, reason: "duplicate" };
      console.error("[push] 로그 기록 실패:", error.message);
    }
  }

  const res = await sendPush({
    token: user.fcm_token,
    title: p.title,
    body: p.body,
    data: p.data,
    channelId: CHANNEL_BY_CATEGORY[p.category],
  });

  if (res.ok) {
    if (p.dedup_key) {
      await supabase.from("push_notification_logs")
        .update({ delivered: true })
        .eq("user_id", p.user_id)
        .eq("dedup_key", p.dedup_key);
    } else {
      await supabase.from("push_notification_logs").insert({
        user_id: p.user_id,
        notification_type: p.notification_type,
        category: p.category,
        delivered: true,
      });
    }
    return { ok: true };
  }

  // 죽은 토큰은 비운다. 안 그러면 매 cron마다 같은 실패를 반복한다.
  if (res.invalidToken) {
    await supabase.from("users").update({ fcm_token: null }).eq("id", p.user_id);
  }

  console.warn(`[push] user=${shortId(p.user_id)} 실패: ${res.error}`);
  if (p.dedup_key) {
    await supabase.from("push_notification_logs")
      .update({ error: res.error.slice(0, 300) })
      .eq("user_id", p.user_id)
      .eq("dedup_key", p.dedup_key);
  }

  return { ok: false, reason: res.error };
}

/** 조용한 시간은 자정을 넘길 수 있다 (야간 근무자의 주간 수면: 08:00~15:00). */
function inQuietHours(tz: string, start: string, end: string): boolean {
  const now = nowMinutesInTz(tz);
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

function nowMinutesInTz(tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    const d = new Date();
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}
