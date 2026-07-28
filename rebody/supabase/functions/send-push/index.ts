// Phase 5 — 단건 푸시 발송 API
//
// service_role만 호출할 수 있다. 사용자 JWT로 임의 발송이 가능하면 스팸 벡터가 된다.
// 실제 발송 로직은 _shared/push.ts (dispatch-scheduled-push와 공유).

import { fail, json, preflight } from "../_shared/http.ts";
import { isServiceRoleCall } from "../_shared/supabase.ts";
import { deliver, type SendRequest } from "../_shared/push.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return fail("method_not_allowed", "POST만 허용됩니다.", 405);
  if (!isServiceRoleCall(req)) return fail("forbidden", "허용되지 않은 호출입니다.", 403);

  let payload: SendRequest;
  try {
    payload = await req.json();
  } catch {
    return fail("bad_request", "잘못된 요청 형식입니다.", 400);
  }

  if (!payload.user_id || !payload.title || !payload.body) {
    return fail("bad_request", "user_id, title, body가 필요합니다.", 400);
  }

  const result = await deliver(payload);
  // 배치 호출자가 개별 실패로 중단되지 않도록 항상 200으로 응답하고 결과를 본문에 담는다.
  return json(result);
});
