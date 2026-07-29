// 홈 — 대시보드 + 하단 액션바.
// 탭 네비게이터를 쓰지 않는 이유: 화면이 4개뿐이고, 그중 스캐너와 페이월은 모달이다.
// 탭바를 두면 세로 공간을 상시로 잃는데, 이 앱의 홈은 타이머가 커야 한다.

import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import DashboardScreen from "@/screens/DashboardScreen";
import { colors, radius, spacing, typography } from "@/lib/theme";

export default function HomeRoute() {
  return (
    <SafeAreaView style={styles.flex} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>Re:Body</Text>
        <Pressable onPress={() => router.push("/settings")} hitSlop={12}>
          <Text style={styles.headerAction}>설정</Text>
        </Pressable>
      </View>

      <View style={styles.flex}>
        <DashboardScreen />
      </View>

      <View style={styles.actionBar}>
        <Pressable style={styles.secondary} onPress={() => router.push("/feedback")}>
          <Text style={styles.secondaryText}>주간 리포트</Text>
        </Pressable>
        <Pressable style={styles.primary} onPress={() => router.push("/scanner")}>
          <Text style={styles.primaryText}>식사 기록하기</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  wordmark: { ...typography.subtitle, color: colors.text },
  headerAction: { ...typography.caption, color: colors.textMuted },

  actionBar: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primary: {
    flex: 2,
    backgroundColor: colors.eating,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryText: { ...typography.subtitle, color: colors.bg },
  secondary: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  secondaryText: { ...typography.caption, color: colors.text },
});
