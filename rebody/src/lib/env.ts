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

export const env = {
  supabaseUrl: required("EXPO_PUBLIC_SUPABASE_URL", process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required("EXPO_PUBLIC_SUPABASE_ANON_KEY", process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),

  appEnv: (process.env.EXPO_PUBLIC_ENV ?? "development") as "development" | "preview" | "production",

  // Play Console 등록 전에는 mock. react-native-purchases는 Expo Go에서 동작하지 않는다.
  billingMode: (process.env.EXPO_PUBLIC_BILLING_MODE ?? "mock") as "mock" | "live",
  revenueCatAndroidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "",

  privacyPolicyUrl:
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? "https://mengro1102.github.io/rebody-policy/",
} as const;

export const isProduction = env.appEnv === "production";
