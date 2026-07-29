import { router } from "expo-router";
import PaywallScreen from "@/screens/PaywallScreen";

export default function PaywallRoute() {
  return <PaywallScreen source="settings" onClose={() => router.back()} />;
}
