// 환경변수 접근 단일 창구.
// EXPO_PUBLIC_ 접두사가 붙은 값은 JS 번들에 그대로 박힌다는 점을 잊지 말 것.
// Gemini/MFDS/FCM 키는 여기 오면 안 된다 — Edge Function 전용이다.

function required(name: string, value: string | undefined): string {
  if (!value) {
    // 앱 시작 시점에 바로 터뜨린다. 런타임 깊은 곳에서 undefined로 실패하면 원인 추적이 어렵다.
    throw new Error(
      `[env] ${name} 가 설정되지 않았습니다. .env.example을 참고해 .env를 만들어 주세요.`,
    );
  }
  return value;
}

/**
 * 수익화 전면 차단 스위치 (docs/07_MONETIZATION_DEFERRED.md).
 *
 * 운영자가 전문연구요원 복무 중이라 영리 활동을 하지 않는다. MVP는 무료로만 배포한다.
 * 환경변수가 아니라 **소스 상수**인 것이 의도다 — 빌드 설정을 잘못 만져서
 * 결제 UI가 켜지는 사고를 막는다. 복무 종료 후 이 값을 true로 되돌리는 것이 복원의 시작점이다.
 */
export const MONETIZATION_ENABLED = false as boolean;

export const env = {
  supabaseUrl: required("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required("EXPO_PUBLIC_SUPABASE_ANON_KEY", process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),

  appEnv: (process.env.EXPO_PUBLIC_ENV ?? "development") as "development" | "preview" | "production",

  monetizationEnabled: MONETIZATION_ENABLED,

  // 수익화가 꺼져 있는 동안에는 환경변수와 무관하게 항상 mock이다.
  // react-native-purchases는 Expo Go에서도 동작하지 않으므로 mock이 안전한 기본값이다.
  billingMode: (MONETIZATION_ENABLED
    ? (process.env.EXPO_PUBLIC_BILLING_MODE ?? "mock")
    : "mock") as "mock" | "live",
  revenueCatAndroidKey: MONETIZATION_ENABLED
    ? (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "")
    : "",

  privacyPolicyUrl:
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? "https://mengro1102.github.io/rebody-policy/",
} as const;

export const isProduction = env.appEnv === "production";
