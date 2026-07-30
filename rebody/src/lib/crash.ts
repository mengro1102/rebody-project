// 크래시 리포팅 어댑터 (D6-1)
//
// Crashlytics(@react-native-firebase/crashlytics)는 네이티브 모듈이라 development build와
// google-services.json이 있어야 동작한다. 그게 준비되기 전에도 코드 경로를 완성해 두기 위해
// analytics.ts와 같은 방식의 얇은 어댑터를 둔다. 네이티브가 없으면 콘솔로 떨어진다.
//
// ⚠️ 리포트에 건강 데이터·음식명·칼로리를 절대 싣지 말 것.
//    Play Console Data Safety 신고와 실제 전송이 어긋나면 정책 위반이다.
//    화면 이름·기능 키워드 같은 비식별 컨텍스트만 허용한다.

import { isProduction } from "./env";

interface CrashImpl {
  recordError: (error: Error, jsErrorName?: string) => Promise<void> | void;
  log: (message: string) => Promise<void> | void;
  setAttribute: (key: string, value: string) => Promise<void> | void;
}

let impl: CrashImpl | null = null;

/**
 * 네이티브 Crashlytics를 연결한다. R1(development build) 이후 app/_layout.tsx에서 호출한다.
 *
 *   import crashlytics from "@react-native-firebase/crashlytics";
 *   initCrashReporting(crashlytics());
 */
export function initCrashReporting(nativeImpl: CrashImpl) {
  impl = nativeImpl;
}

export function isCrashReportingActive(): boolean {
  return impl !== null;
}

/** 치명적이지 않은 오류를 기록한다. 사용자 플로우는 계속 진행돼야 한다. */
export function recordError(error: unknown, context?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));

  if (!impl) {
    // 네이티브가 없을 때도 개발 중에는 보여야 한다. 프로덕션에서는 조용히 넘긴다.
    if (!isProduction) console.error(`[crash]${context ? ` (${context})` : ""}`, err);
    return;
  }

  void impl.log(context ?? "unknown_context");
  void impl.recordError(err, context);
}

/** 크래시 직전 경로를 남긴다. 스택만으로는 재현 경로를 알 수 없는 경우가 많다. */
export function breadcrumb(message: string): void {
  if (!impl) {
    if (!isProduction) console.log(`[crash:breadcrumb] ${message}`);
    return;
  }
  void impl.log(message);
}

/** 비식별 컨텍스트만. 사용자 식별자·건강 데이터 금지. */
export function setCrashContext(key: string, value: string): void {
  if (!impl) return;
  void impl.setAttribute(key, value);
}
