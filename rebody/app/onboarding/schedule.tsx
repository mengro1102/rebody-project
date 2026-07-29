// 온보딩 3단계 — 생활 패턴 프리셋 선택.
// 화면 자체는 src/screens/PresetSelectScreen.tsx에 있고 여기서는 완료 처리만 한다.

import { router } from "expo-router";
import PresetSelectScreen from "@/screens/PresetSelectScreen";
import { useAuthStore } from "@/store/useAuthStore";

export default function ScheduleRoute() {
  const updateProfile = useAuthStore((s) => s.updateProfile);

  return (
    <PresetSelectScreen
      onComplete={() => {
        // onboarded_at이 온보딩 완료의 단일 기준이다 (_layout 게이트가 이 값을 본다).
        void updateProfile({ onboarded_at: new Date().toISOString() });
        router.replace("/");
      }}
    />
  );
}
