// Gemini 호출 래퍼
//
// 비용 설계 (docs/01_COST.md):
//   gemini-3.1-flash-lite 기준 입력 $0.125 / 출력 $0.750 per 1M tokens.
//   출력 단가가 입력의 6배이므로 maxOutputTokens와 structured output이 비용 통제의 전부다.
//   그래서 이 모듈은 generationConfig를 옵셔널로 두지 않고 필수로 받는다.
//
// 모델 ID는 하드코딩하지 않는다. 단가 변동/모델 종료 시 재배포 없이 교체하기 위함.
//   GEMINI_MODEL 기본값: gemini-3.1-flash-lite

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function geminiModel(): string {
  return Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";
}

export interface InlineImage {
  mimeType: string;
  /** base64, data URI prefix 없이 */
  data: string;
}

export interface GenerateOptions {
  systemInstruction?: string;
  prompt: string;
  image?: InlineImage;
  /** 출력 토큰 상한. 비용 직결이므로 필수. */
  maxOutputTokens: number;
  /** 응답 JSON 스키마. 서술형 장문 출력을 원천 차단한다. */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
}

export interface GenerateResult<T> {
  data: T;
  usage: { promptTokens: number; outputTokens: number; totalTokens: number };
  raw: string;
}

export class GeminiError extends Error {
  constructor(message: string, readonly status: number, readonly retriable: boolean) {
    super(message);
    this.name = "GeminiError";
  }
}

/** JSON 응답을 강제하는 generateContent 호출. */
export async function generateJSON<T>(opts: GenerateOptions): Promise<GenerateResult<T>> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY 미설정", 500, false);

  const parts: Record<string, unknown>[] = [{ text: opts.prompt }];
  if (opts.image) {
    parts.push({ inline_data: { mime_type: opts.image.mimeType, data: opts.image.data } });
  }

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens,
      responseMimeType: "application/json",
      ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    },
  };

  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/models/${geminiModel()}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new GeminiError(
      e instanceof Error && e.name === "AbortError" ? "Gemini 응답 시간 초과" : "Gemini 연결 실패",
      504,
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 404 = 모델 ID가 유효하지 않음. GEMINI_MODEL을 확인하라는 신호를 남긴다.
    const hint = res.status === 404 ? ` (GEMINI_MODEL='${geminiModel()}' 확인 필요)` : "";
    throw new GeminiError(
      `Gemini ${res.status}${hint}: ${text.slice(0, 300)}`,
      res.status,
      res.status === 429 || res.status >= 500,
    );
  }

  const payload = await res.json();
  const candidate = payload?.candidates?.[0];

  // maxOutputTokens에 걸려 잘리면 JSON이 깨진다. 원인을 명확히 구분해서 던진다.
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new GeminiError("응답이 토큰 상한에 걸려 잘렸습니다. maxOutputTokens 상향 필요.", 502, false);
  }
  if (candidate?.finishReason === "SAFETY") {
    throw new GeminiError("안전 필터에 의해 차단된 요청입니다.", 422, false);
  }

  const text: string = candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new GeminiError("Gemini 빈 응답", 502, true);

  let parsed: T;
  try {
    parsed = JSON.parse(stripCodeFence(text)) as T;
  } catch {
    throw new GeminiError(`Gemini JSON 파싱 실패: ${text.slice(0, 200)}`, 502, false);
  }

  const um = payload?.usageMetadata ?? {};
  return {
    data: parsed,
    usage: {
      promptTokens: um.promptTokenCount ?? 0,
      outputTokens: um.candidatesTokenCount ?? 0,
      totalTokens: um.totalTokenCount ?? 0,
    },
    raw: text,
  };
}

/** responseMimeType을 줘도 모델이 가끔 ```json 펜스를 붙인다. */
function stripCodeFence(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

/** 429/5xx에 한해 지수 백오프 재시도. 무료 티어 레이트리밋 대응. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!(e instanceof GeminiError) || !e.retriable || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 2 ** i * 800 + Math.random() * 400));
    }
  }
  throw lastErr;
}
