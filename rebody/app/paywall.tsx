// 무료 MVP 안내 화면.
//
// 수익화가 꺼져 있는 동안(docs/07_MONETIZATION_DEFERRED.md) 이 경로는 페이월이 아니라
// "왜 하루 3회인가"를 설명하는 화면이다. 결제할 수 없는 상태에서 업그레이드 유도 UI를
// 남겨두면 사용자를 속이는 것이고 심사에서도 문제가 된다.
//
// PaywallScreen 컴포넌트 자체는 src/screens/에 그대로 둔다 —
// 복무 종료 후 MONETIZATION_ENABLED만 켜면 되살아난다.

import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import PaywallScreen from "@/screens/PaywallScreen";
import { FREE_DAILY_SCANS } from "@/store/useSubscriptionStore";
import { env } from "@/lib/env";
import { colors, radius, spacing, typography } from "@/lib/theme";

export default function PaywallRoute() {
  if (env.monetizationEnabled) {
    return <PaywallScreen source="settings" onClose={() => router.back()} />;
  }
  return <FreeMvpNotice />;
}

function FreeMvpNotice() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>ReBody는 지금 무료입니다</Text>
      <Text style={styles.lead}>
        유료 플랜도, 광고도 없습니다. 모든 기능을 제한 없이 쓰실 수 있어요.
        다만 사진 분석 한 가지만 하루 {FREE_DAILY_SCANS}회로 제한하고 있습니다.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>왜 사진 분석만 제한하나요?</Text>
        <Text style={styles.cardBody}>
          음식 사진 인식은 외부 AI를 호출하는 유일한 기능이라 호출당 비용이 발생합니다.
          이 앱은 수익이 없어서 그 비용을 개인이 부담하고 있어요. 무제한으로 열어두면
          서비스를 계속 유지할 수 없습니다.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>한도를 다 쓰면요?</Text>
        <Text style={styles.cardBody}>
          자정이 지나면 다시 {FREE_DAILY_SCANS}회가 채워집니다. 그 전에도 음식 이름을 직접
          입력해 기록하실 수 있고, 단식 타이머·스케줄·주간 리포트는 제한 없이 동작합니다.
        </Text>
      </View>

      <Pressable
        style={styles.linkBtn}
        onPress={() => void Linking.openURL(env.privacyPolicyUrl)}
      >
        <Text style={styles.linkText}>개인정보처리방침 보기</Text>
      </Pressable>

      <Pressable style={styles.primary} onPress={() => router.back()}>
        <Text style={styles.primaryText}>알겠어요</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },

  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  lead: { ...typography.body, color: colors.textMuted, lineHeight: 22, marginBottom: spacing.lg },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  cardTitle: { ...typography.subtitle, color: colors.text },
  cardBody: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },

  linkBtn: { paddingVertical: spacing.md },
  linkText: { ...typography.caption, color: colors.fasting, textDecorationLine: "underline" },

  primary: {
    backgroundColor: colors.eating,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.md,
  },
  primaryText: { ...typography.subtitle, color: colors.bg },
});
