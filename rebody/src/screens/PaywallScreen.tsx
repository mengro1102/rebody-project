// Phase 6 — 페이월
//
// BM 원칙: 최초 AI 스케줄 생성과 첫 주간 피드백은 무료다.
// 유료 전환 전에 핵심 가치를 증명하고, 반복 사용에만 과금한다.
// 스캔 한도를 1회가 아니라 3회로 둔 것도 같은 이유 — 습관이 붙기 전에 벽을 세우면
// 결제가 아니라 이탈이 나온다.

import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  getOfferings,
  purchase,
  restorePurchases,
  type Offering,
  type PaywallSource,
} from "@/features/billing/purchases";
import { trackPaywall } from "@/lib/analytics";
import { env } from "@/lib/env";
import { colors, radius, spacing, typography } from "@/lib/theme";

const BENEFITS = [
  { title: "무제한 음식 스캔", desc: "하루 3회 제한 없이 마음껏 기록하세요." },
  { title: "주간 피드백 재적용 무제한", desc: "제안을 여러 번 시험해 보며 나에게 맞는 시간대를 찾으세요." },
  { title: "상세 영양 분석", desc: "나트륨·식이섬유까지 확인할 수 있어요." },
];

export default function PaywallScreen({
  source = "settings",
  onClose,
}: {
  source?: PaywallSource;
  onClose?: () => void;
}) {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    trackPaywall("viewed", source);
    void (async () => {
      const list = await getOfferings();
      setOfferings(list);
      // 연간을 기본 선택 — 객단가와 유지율이 모두 높다.
      setSelected(list.find((o) => o.period === "annual")?.identifier ?? list[0]?.identifier ?? null);
    })();
  }, []);

  const handlePurchase = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await purchase(selected, source);
      if (res.ok) {
        Alert.alert("Pro가 활성화됐어요", "이제 제한 없이 사용하실 수 있습니다.");
        onClose?.();
        return;
      }
      if (!res.cancelled) Alert.alert("결제 실패", res.error ?? "다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    try {
      const ok = await restorePurchases();
      Alert.alert(
        ok ? "복원 완료" : "복원할 구독 없음",
        ok ? "Pro가 다시 활성화됐어요." : "이 계정으로 구매한 구독을 찾지 못했어요.",
      );
      if (ok) onClose?.();
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    trackPaywall("dismissed", source);
    onClose?.();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>ReBody Pro</Text>
      <Text style={styles.subtitle}>{sourceMessage(source)}</Text>

      <View style={styles.benefits}>
        {BENEFITS.map((b) => (
          <View key={b.title} style={styles.benefit}>
            <Text style={styles.benefitCheck}>✓</Text>
            <View style={styles.flex}>
              <Text style={styles.benefitTitle}>{b.title}</Text>
              <Text style={styles.benefitDesc}>{b.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {offerings.map((o) => (
        <Pressable
          key={o.identifier}
          onPress={() => setSelected(o.identifier)}
          style={[styles.plan, selected === o.identifier && styles.planSelected]}
        >
          <View style={styles.flex}>
            <Text style={styles.planTitle}>{o.title}</Text>
            {o.savingsPercent && <Text style={styles.planSaving}>{o.savingsPercent}% 절약</Text>}
          </View>
          <Text style={styles.planPrice}>{o.priceString}</Text>
        </Pressable>
      ))}

      <Pressable
        style={[styles.primaryBtn, (busy || !selected) && styles.btnDisabled]}
        onPress={handlePurchase}
        disabled={busy || !selected}
      >
        {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryBtnText}>시작하기</Text>}
      </Pressable>

      {/* Play 정책상 복원 경로를 반드시 노출해야 한다. */}
      <Pressable onPress={handleRestore} disabled={busy}>
        <Text style={styles.linkText}>구매 복원</Text>
      </Pressable>

      <Pressable onPress={handleDismiss}>
        <Text style={styles.linkFaint}>나중에 할게요</Text>
      </Pressable>

      <Text style={styles.legal}>
        구독은 자동 갱신되며 Google Play 계정에서 언제든 해지할 수 있습니다.
        해지하지 않으면 현재 기간 종료 24시간 전에 자동으로 갱신됩니다.
      </Text>
      <Pressable onPress={() => Linking.openURL(env.privacyPolicyUrl)}>
        <Text style={styles.linkFaint}>개인정보처리방침</Text>
      </Pressable>
    </ScrollView>
  );
}

function sourceMessage(source: PaywallSource): string {
  switch (source) {
    case "scan_limit":
      return "오늘 무료 스캔을 다 쓰셨네요. 계속 기록하시겠어요?";
    case "feedback_reapply":
      return "이번 주 피드백은 이미 한 번 적용하셨어요. 더 조정해 보시겠어요?";
    case "advanced_macro":
      return "나트륨·식이섬유까지 보려면 Pro가 필요해요.";
    default:
      return "제한 없이 기록하고, 매주 나에게 맞게 조정하세요.";
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  flex: { flex: 1 },

  title: { fontSize: 30, fontWeight: "700", color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xl, lineHeight: 22 },

  benefits: { marginBottom: spacing.xl },
  benefit: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  benefitCheck: { color: colors.eating, fontSize: 18, fontWeight: "700", lineHeight: 22 },
  benefitTitle: { ...typography.subtitle, color: colors.text },
  benefitDesc: { ...typography.caption, color: colors.textMuted, marginTop: 2, lineHeight: 18 },

  plan: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  planSelected: { borderColor: colors.eating, backgroundColor: colors.surfaceAlt },
  planTitle: { ...typography.subtitle, color: colors.text },
  planSaving: { ...typography.caption, color: colors.eating, marginTop: 2 },
  planPrice: { ...typography.subtitle, color: colors.text },

  primaryBtn: {
    backgroundColor: colors.eating,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryBtnText: { ...typography.subtitle, color: colors.bg },
  btnDisabled: { opacity: 0.5 },

  linkText: { ...typography.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  linkFaint: { ...typography.caption, color: colors.textFaint, textAlign: "center", marginTop: spacing.md, textDecorationLine: "underline" },
  legal: { ...typography.caption, color: colors.textFaint, lineHeight: 18, marginTop: spacing.xl, textAlign: "center" },
});
