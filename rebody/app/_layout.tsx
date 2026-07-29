// 앱 셸 — 라우팅과 게이트만 담당한다. 화면 로직은 src/screens/*에 있다.
//
// 게이트 순서가 곧 법적·정책적 요구사항의 순서다. 순서를 바꾸지 말 것:
//   세션 없음        → 로그인
//   필수 동의 없음    → 동의 3분할   (개인정보보호법 제23조·제28조의8)
//   안전성 정보 없음  → 안전 온보딩  (Play 민감 카테고리 정책)
//   스케줄 없음       → 프리셋 선택
//   전부 통과         → 대시보드
//
// 동의를 받기 전에는 건강 데이터를 입력받는 화면조차 띄우면 안 된다.

import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack, router, useRootNavigationState, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";

import {
  hasRequiredConsents,
  hasSafetyProfile,
  useAuthStore,
} from "@/store/useAuthStore";
import { handleNotificationResponse, setupChannels } from "@/features/notifications/registerPush";
import { initBilling } from "@/features/billing/purchases";
import { colors } from "@/lib/theme";

export default function RootLayout() {
  const init = useAuthStore((s) => s.init);
  const initialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    void init();
    // 알림 채널은 권한과 무관하게 미리 만들어 둔다. 채널이 없으면 첫 푸시가 조용히 사라진다.
    void setupChannels();
  }, []);

  useGate();
  useNotificationRouting();
  useBilling();

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {initialized ? (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding/consent" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="onboarding/profile" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="onboarding/schedule" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="scanner" options={{ title: "음식 기록", presentation: "modal" }} />
          <Stack.Screen name="paywall" options={{ title: "ReBody Pro", presentation: "modal" }} />
          <Stack.Screen name="feedback" options={{ title: "주간 리포트" }} />
          <Stack.Screen name="settings/index" options={{ title: "설정" }} />
          <Stack.Screen name="settings/notifications" options={{ title: "알림 설정" }} />
          <Stack.Screen name="settings/timezone" options={{ title: "시간대 변경" }} />
        </Stack>
      ) : (
        <Splash />
      )}
    </SafeAreaProvider>
  );
}

/**
 * 온보딩 게이트. 조건이 맞을 때만 리다이렉트하고, 이미 목적지에 있으면 아무것도 하지 않는다.
 * (같은 경로로 replace를 반복하면 무한 루프가 된다.)
 */
function useGate() {
  const navigationState = useRootNavigationState();
  const segments = useSegments();

  const initialized = useAuthStore((s) => s.initialized);
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const consents = useAuthStore((s) => s.consents);

  useEffect(() => {
    // 네비게이터가 마운트되기 전에 router를 건드리면 크래시한다.
    if (!navigationState?.key || !initialized) return;

    const current = "/" + segments.join("/");
    const go = (to: string) => {
      if (current !== to) router.replace(to);
    };

    if (!session) {
      go("/sign-in");
      return;
    }

    if (!hasRequiredConsents(consents)) {
      go("/onboarding/consent");
      return;
    }

    // 프로필을 아직 못 읽었으면 판단을 미룬다 — 없다고 단정하면 온보딩이 다시 뜬다.
    if (!profile) return;

    if (!hasSafetyProfile(profile)) {
      go("/onboarding/profile");
      return;
    }

    // 온보딩 완료의 단일 기준은 onboarded_at이다. 스케줄 유무로 판단하지 않는다 —
    // 안전 게이트에 걸린 사용자는 스케줄 없이 식사 기록만 쓰는 것이 정상 상태이고,
    // pattern으로 판단하면 그 사용자가 온보딩에 영원히 갇힌다.
    if (!profile.onboarded_at) {
      go("/onboarding/schedule");
      return;
    }

    if (segments[0] === "onboarding" || segments[0] === "sign-in") {
      router.replace("/");
    }
  }, [
    navigationState?.key,
    initialized,
    session?.user.id,
    profile?.id,
    profile?.birth_year,
    profile?.height_cm,
    profile?.weight_kg,
    profile?.onboarded_at,
    consents?.length,
    segments.join("/"),
  ]);
}

/** 알림 탭 → 딥링크. 콜드 스타트(앱이 꺼진 상태에서 탭)도 함께 처리한다. */
function useNotificationRouting() {
  useEffect(() => {
    let mounted = true;

    void (async () => {
      const initial = await Notifications.getLastNotificationResponseAsync();
      if (!mounted || !initial) return;
      const path = await handleNotificationResponse(initial);
      if (path) router.push(path);
    })();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      void (async () => {
        const path = await handleNotificationResponse(response);
        if (path) router.push(path);
      })();
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
}

/** RevenueCat 초기화. mock 모드에서는 내부적으로 no-op이다. */
function useBilling() {
  const userId = useAuthStore((s) => s.session?.user.id);
  useEffect(() => {
    if (!userId) return;
    void initBilling(userId);
  }, [userId]);
}

function Splash() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator color={colors.eating} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
});
