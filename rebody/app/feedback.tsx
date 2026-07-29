// 주간 리포트 전용 화면. 푸시(screen=feedback)의 딥링크 목적지이기도 하다.

import { ScrollView, StyleSheet, Text, View } from "react-native";
import { FeedbackCard } from "@/components/FeedbackCard";
import { MEDICAL_DISCLAIMER } from "@/domain/safety";
import { colors, spacing, typography } from "@/lib/theme";

export default function FeedbackRoute() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        지난 주 기록을 바탕으로 정리한 내용이에요. 제안은 눌러서 바로 스케줄에 반영할 수 있습니다.
      </Text>
      <FeedbackCard />
      <View style={styles.footer}>
        <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  lead: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md },
  footer: { marginTop: spacing.xl },
  disclaimer: { ...typography.caption, color: colors.textFaint, lineHeight: 18 },
});
