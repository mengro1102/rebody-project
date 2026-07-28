import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fail } from "./http.ts";

/** RLS를 우회하는 관리자 클라이언트. 절대 클라이언트로 새어나가면 안 된다. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** 호출자의 JWT를 그대로 물고 가는 클라이언트. RLS가 그대로 적용된다. */
export function userClient(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    },
  );
}

export interface AuthedUser {
  id: string;
  email: string | null;
  timezone: string;
}

/**
 * Authorization 헤더의 JWT를 검증하고 프로필을 반환한다.
 * 실패 시 Response를 반환하므로 호출부에서 그대로 return 하면 된다.
 */
export async function requireUser(req: Request): Promise<AuthedUser | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return fail("unauthenticated", "인증이 필요합니다.", 401);
  }

  const admin = adminClient();
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) {
    return fail("unauthenticated", "세션이 만료되었습니다. 다시 로그인해 주세요.", 401);
  }

  const { data: profile } = await admin
    .from("users")
    .select("timezone")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    timezone: profile?.timezone ?? "Asia/Seoul",
  };
}

/** cron(service_role)에서만 호출되어야 하는 함수 보호용. */
export function isServiceRoleCall(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return key.length > 0 && auth === `Bearer ${key}`;
}
