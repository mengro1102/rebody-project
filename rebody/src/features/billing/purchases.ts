// Phase 6 — Google Play Billing (RevenueCat 경유)
//
// ⚠️ 실행 전제
//   1. react-native-purchases는 네이티브 모듈이다 → Expo Go에서 동작하지 않는다.
//      development build가 필요하다.
//   2. Play Console에 앱이 등록되고 내부 테스트 트랙에 최소 1회 배포된 뒤에야
//      인앱상품이 조회된다. 그 전까지는 EXPO_PUBLIC_BILLING_MODE=mock으로 UI만 확인한다.
//
// BM 원칙 (원문 착수 문서 유지):
//   무료 — 최초 AI 스케줄 생성, 첫 주간 피드백. 유료 전환 전에 핵심 가치를 증명한다.
//   유료 — 무제한 스캔, 피드백 재적용 무제한, 상세 매크로(나트륨·식이섬유).
//
// 구독 상태의 진실은 서버(user_subscriptions)다. RevenueCat 웹훅이 그걸 갱신하고,
// 클라이언트는 UI 낙관적 갱신만 한다. 클라이언트 판정을 믿으면 우회가 가능하다.

import { env } from "@/lib/env";
import { trackPaywall } from "@/lib/analytics";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";

export const ENTITLEMENT_PRO = "pro";

export interface Offering {
  identifier: string;
  title: string;
  priceString: string;
  period: "monthly" | "annual";
  /** 연간 상품의 월 환산 절약률 */
  savingsPercent?: number;
}

export type PaywallSource = "scan_limit" | "feedback_reapply" | "advanced_macro" | "settings";

interface PurchasesModule {
  configure: (opts: { apiKey: string; appUserID?: string | null }) => void;
  getOfferings: () => Promise<any>;
  purchasePackage: (pkg: any) => Promise<any>;
  restorePurchases: () => Promise<any>;
  logIn: (userId: string) => Promise<any>;
  logOut: () => Promise<any>;
}

let Purchases: PurchasesModule | null = null;

/** mock 모드에서 페이월 UI를 확인하기 위한 더미 상품. */
const MOCK_OFFERINGS: Offering[] = [
  { identifier: "rebody_pro_monthly", title: "월간", priceString: "₩4,900", period: "monthly" },
  { identifier: "rebody_pro_annual", title: "연간", priceString: "₩39,000", period: "annual", savingsPercent: 34 },
];

export function isBillingAvailable(): boolean {
  return env.billingMode === "live" && Purchases !== null;
}

/**
 * 앱 시작 시 1회 호출. mock 모드거나 네이티브 모듈이 없으면 조용히 건너뛴다 —
 * 여기서 throw하면 Play Console 등록 전에는 앱이 아예 못 뜬다.
 */
export async function initBilling(appUserId?: string): Promise<void> {
  if (env.billingMode !== "live") {
    console.log("[billing] mock 모드 — 실제 결제가 비활성화되어 있습니다.");
    return;
  }
  if (!env.revenueCatAndroidKey) {
    console.warn("[billing] EXPO_PUBLIC_REVENUECAT_ANDROID_KEY 미설정");
    return;
  }

  try {
    // 네이티브 모듈이 없는 환경(Expo Go)에서 import 자체가 터지지 않도록 동적 로드.
    const mod = await import("react-native-purchases");
    Purchases = (mod.default ?? mod) as unknown as PurchasesModule;
    Purchases.configure({ apiKey: env.revenueCatAndroidKey, appUserID: appUserId ?? null });
  } catch (e) {
    console.warn("[billing] react-native-purchases 로드 실패 (development build 필요):", e);
    Purchases = null;
  }
}

export async function getOfferings(): Promise<Offering[]> {
  if (!isBillingAvailable()) return MOCK_OFFERINGS;

  try {
    const offerings = await Purchases!.getOfferings();
    const packages = offerings?.current?.availablePackages ?? [];
    return packages.map((p: any) => ({
      identifier: p.identifier,
      title: p.packageType === "ANNUAL" ? "연간" : "월간",
      priceString: p.product?.priceString ?? "",
      period: p.packageType === "ANNUAL" ? "annual" : "monthly",
    }));
  } catch (e) {
    console.warn("[billing] 상품 조회 실패:", e);
    return MOCK_OFFERINGS;
  }
}

export interface PurchaseResult {
  ok: boolean;
  cancelled?: boolean;
  error?: string;
}

export async function purchase(
  offeringId: string,
  source: PaywallSource,
): Promise<PurchaseResult> {
  trackPaywall("trial_started", source);

  if (!isBillingAvailable()) {
    return { ok: false, error: "결제는 정식 빌드에서만 이용할 수 있어요." };
  }

  try {
    const offerings = await Purchases!.getOfferings();
    const pkg = (offerings?.current?.availablePackages ?? []).find(
      (p: any) => p.identifier === offeringId,
    );
    if (!pkg) return { ok: false, error: "상품을 찾을 수 없습니다." };

    const { customerInfo } = await Purchases!.purchasePackage(pkg);
    const active = Boolean(customerInfo?.entitlements?.active?.[ENTITLEMENT_PRO]);

    if (active) {
      trackPaywall("purchased", source);
      // 서버 반영은 RevenueCat 웹훅이 한다. 여기서는 화면을 즉시 갱신하기 위해 다시 읽는다.
      await useSubscriptionStore.getState().load();
      return { ok: true };
    }

    return { ok: false, error: "결제가 완료되지 않았습니다." };
  } catch (e: any) {
    if (e?.userCancelled) return { ok: false, cancelled: true };
    console.warn("[billing] 결제 실패:", e);
    return { ok: false, error: "결제 처리 중 문제가 발생했어요. 잠시 후 다시 시도해 주세요." };
  }
}

/** 기기 변경·재설치 시 복원. Play 정책상 페이월에 반드시 노출해야 한다. */
export async function restorePurchases(): Promise<boolean> {
  if (!isBillingAvailable()) return false;
  try {
    const info = await Purchases!.restorePurchases();
    const active = Boolean(info?.entitlements?.active?.[ENTITLEMENT_PRO]);
    if (active) await useSubscriptionStore.getState().load();
    return active;
  } catch (e) {
    console.warn("[billing] 복원 실패:", e);
    return false;
  }
}

export async function identifyUser(userId: string): Promise<void> {
  if (!isBillingAvailable()) return;
  try {
    await Purchases!.logIn(userId);
  } catch (e) {
    console.warn("[billing] 사용자 연결 실패:", e);
  }
}
