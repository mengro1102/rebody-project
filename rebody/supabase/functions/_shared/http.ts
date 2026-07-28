// 공통 HTTP 유틸 (CORS / 응답 헬퍼)

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

export function fail(code: string, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return json({ error: { code, message, ...extra } }, status);
}

/** Edge Function 로그는 그대로 노출되므로, 사용자 식별자는 앞 8자만 남긴다. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
