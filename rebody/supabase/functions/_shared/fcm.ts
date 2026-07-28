// FCM HTTP v1
//
// 레거시 서버 키(Authorization: key=...) 방식은 종료됐다. v1은 서비스 계정으로
// RS256 JWT를 서명해 OAuth2 access token을 받아야 한다. Deno에는 google-auth 라이브러리가
// 없으므로 WebCrypto로 직접 서명한다.
//
// 필요한 환경변수:
//   FCM_PROJECT_ID       Firebase 프로젝트 ID
//   FCM_CLIENT_EMAIL     서비스 계정 이메일
//   FCM_PRIVATE_KEY      서비스 계정 개인키 (PEM, 개행은 \n 이스케이프 허용)

interface CachedToken {
  token: string;
  expiresAt: number;
}
let tokenCache: CachedToken | null = null;

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  // 토큰은 1시간짜리. 55분까지 재사용해서 불필요한 왕복을 없앤다.
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const clientEmail = Deno.env.get("FCM_CLIENT_EMAIL");
  const privateKey = Deno.env.get("FCM_PRIVATE_KEY");
  if (!clientEmail || !privateKey) {
    throw new Error("FCM 서비스 계정 환경변수 미설정 (FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY)");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  );

  const jwt = `${header}.${claim}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth2 토큰 발급 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + 55 * 60 * 1000 };
  return tokenCache.token;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** 딥링크 등. FCM data는 문자열 값만 허용한다. */
  data?: Record<string, string>;
  /** Android 알림 채널 ID. 앱에서 미리 만들어 둔 것과 일치해야 한다. */
  channelId?: string;
}

export type PushResult =
  | { ok: true }
  | { ok: false; error: string; /** 토큰이 만료/삭제된 경우 DB에서 비워야 한다 */ invalidToken: boolean };

export async function sendPush(msg: PushMessage): Promise<PushResult> {
  const projectId = Deno.env.get("FCM_PROJECT_ID");
  if (!projectId) return { ok: false, error: "FCM_PROJECT_ID 미설정", invalidToken: false };

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), invalidToken: false };
  }

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: msg.token,
          notification: { title: msg.title, body: msg.body },
          data: msg.data ?? {},
          android: {
            priority: "high",
            notification: {
              channel_id: msg.channelId ?? "rebody-functional",
              default_sound: true,
            },
          },
        },
      }),
    },
  );

  if (res.ok) return { ok: true };

  const text = await res.text().catch(() => "");
  // UNREGISTERED / INVALID_ARGUMENT = 토큰이 죽었다. 계속 재시도해봐야 소용없다.
  const invalidToken =
    res.status === 404 ||
    text.includes("UNREGISTERED") ||
    text.includes("registration-token-not-registered");

  return { ok: false, error: `FCM ${res.status}: ${text.slice(0, 200)}`, invalidToken };
}
