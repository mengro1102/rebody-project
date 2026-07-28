// Phase 4 — 주간 피드백 카드 (대시보드 하단)
//
// "적용하기" 1탭이 이 카드의 존재 이유다. 조언만 하고 끝나면 읽고 넘긴다.
// 실제 스케줄이 바뀌어야 다음 주 데이터가 달라진다.

import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useFeedbackStore } from "@/store/useFeedbackStore";
import { colors, radius, spacing, typography } from "@/lib/theme";

export function FeedbackCard() {
  const { latest, loading, applying, load, applyAdjustment } = useFeedbackStore();
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  if (!latest) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>주간 리포트</Text>
        <Text style={styles.empty}>
          일주일치 기록이 모이면 패턴을 정리해서 알려드릴게요.
        </Text>
      </View>
    );
  }

  const adjustment = latest.suggested_adjustment_json;
  const isApplied = applied || latest.applied_at !== null;

  const handleApply = async () => {
    try {
      const days = await applyAdjustment(latest.id);
      setApplied(true);
      Alert.alert(
        "적용했어요",
        days > 0
          ? `앞으로 ${days}일간의 식사 시간대에 반영했습니다. 언제든 다시 바꿀 수 있어요.`
          : "적용할 변경 사항이 없었어요.",
      );
    } catch (e) {
      Alert.alert("적용 실패", e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요.");
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>주간 리포트</Text>
        <Text style={styles.week}>{formatWeek(latest.week_start)}</Text>
      </View>

      <Text style={styles.summary}>{latest.summary_text}</Text>

      {adjustment && (
        <View style={styles.suggestion}>
          <Text style={styles.suggestionText}>
            식사 시간대를 {formatShift(adjustment.shift_minutes)} 조정하는 걸 제안드려요.
          </Text>

          {isApplied ? (
            <View style={styles.appliedBadge}>
              <Text style={styles.appliedText}>적용됨</Text>
            </View>
          ) : (
            <Pressable style={styles.applyBtn} onPress={handleApply} disabled={applying}>
              {applying ? (
                <ActivityIndicator color={colors.bg} size="small" />
              ) : (
                <Text style={styles.applyBtnText}>적용하기</Text>
              )}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function formatWeek(weekStart: string): string {
  const [, m, d] = weekStart.split("-");
  return `${Number(m)}월 ${Number(d)}일 주`;
}

function formatShift(minutes: number): string {
  const abs = Math.abs(minutes);
  const label = abs >= 60
    ? `${Math.floor(abs / 60)}시간${abs % 60 ? ` ${abs % 60}분` : ""}`
    : `${abs}분`;
  return minutes > 0 ? `${label} 뒤로` : `${label} 앞으로`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  label: { ...typography.subtitle, color: colors.text },
  week: { ...typography.caption, color: colors.textFaint },
  summary: { ...typography.body, color: colors.textMuted, lineHeight: 22 },
  empty: { ...typography.body, color: colors.textFaint, lineHeight: 21 },

  suggestion: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  suggestionText: { ...typography.caption, color: colors.text, flex: 1, lineHeight: 19 },

  applyBtn: {
    backgroundColor: colors.eating,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 84,
    alignItems: "center",
  },
  applyBtnText: { ...typography.caption, color: colors.bg, fontWeight: "600" },

  appliedBadge: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  appliedText: { ...typography.caption, color: colors.textFaint },
});
