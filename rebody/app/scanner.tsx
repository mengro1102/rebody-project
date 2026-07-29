import { router } from "expo-router";
import ScannerScreen from "@/screens/ScannerScreen";

export default function ScannerRoute() {
  return (
    <ScannerScreen
      onDone={() => router.back()}
      // 쿼터 초과 → 페이월. back()으로 닫아버리면 전환 지점을 놓친다.
      onRequestUpgrade={() => router.replace("/paywall")}
    />
  );
}
