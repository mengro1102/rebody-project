// Supabase 무료 티어 슬립 방지 (Phase 1)
//
// 원문 착수 문서는 "no-op function"이었으나, 아무 것도 하지 않으면 DB 활동으로
// 집계되지 않아 7일 미활동 일시정지를 확실히 막지 못한다.
// 실제 write를 발생시켜 DB를 확실히 깨운다.
//
// pg_cron이 매일 호출한다 (migrations/20260727000400_cron.sql)

import { json, preflight } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const supabase = adminClient();

  const { data, error } = await supabase
    .from("system_heartbeat")
    .update({ pinged_at: new Date().toISOString() })
    .eq("id", 1)
    .select("pinged_at, ping_count")
    .single();

  if (error) {
    console.error("[keepalive] 실패:", error.message);
    return json({ ok: false, error: error.message }, 500);
  }

  return json({ ok: true, pinged_at: data.pinged_at, ping_count: data.ping_count });
});
