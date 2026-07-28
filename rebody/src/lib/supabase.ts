import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// anon key는 공개돼도 되는 값이다 — 실제 접근 통제는 전부 RLS가 한다.
// (supabase/migrations/20260727000200_rls_policies.sql)
// service_role key는 절대 이 파일에 오면 안 된다.

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // RN에는 URL 기반 세션 감지가 없다.
    detectSessionInUrl: false,
  },
});

/** Edge Function 호출 공통 래퍼. 에러 본문을 사람이 읽을 수 있는 메시지로 바꾼다. */
export interface EdgeError {
  code: string;
  message: string;
  [key: string]: unknown;
}

export class EdgeFunctionError extends Error {
  constructor(readonly code: string, message: string, readonly detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "EdgeFunctionError";
  }
}

export async function invokeEdge<T>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T | { error: EdgeError }>(name, {
    body: body ?? {},
  });

  if (error) {
    // supabase-js는 non-2xx를 FunctionsHttpError로 던지고 본문을 context에 담는다.
    const parsed = await extractEdgeError(error);
    throw new EdgeFunctionError(parsed.code, parsed.message, parsed);
  }

  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error: EdgeError }).error;
    throw new EdgeFunctionError(e.code, e.message, e);
  }

  return data as T;
}

async function extractEdgeError(error: unknown): Promise<EdgeError> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return body.error as EdgeError;
    } catch {
      // 본문이 JSON이 아닌 경우 — 아래 기본 메시지로 떨어진다.
    }
  }
  return {
    code: "network_error",
    message: "연결에 실패했어요. 네트워크 상태를 확인하고 다시 시도해 주세요.",
  };
}
