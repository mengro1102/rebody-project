// 동의 3분할 — 법적 필수 화면 (docs/00_ANALYSIS.md §2-1)
//
// 개인정보보호법상 아래 두 가지는 이용약관 동의와 **분리해서** 받아야 한다.
//   * 민감정보(건강) 처리       — 제23조
//   * 개인정보 국외 이전         — 제28조의8
//
// 그래서 "전체 동의" 하나로 끝내는 UI를 쓰지 않는다. 항목별 체크가 원본이고,
// 전체 동의는 편의 기능일 뿐이다. 동의 시각·버전은 consents 테이블에 append-only로 남는다.

import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { REQUIRED_CONSENTS, useAuthStore } from "@/store/useAuthStore";
import type { ConsentKind } from "@/types/database";
import { env } from "@/lib/env";
import { MEDICAL_DISCLAIMER } from "@/domain/safety";
import { colors, radius, spacing, typography } from "@/lib/theme";

interface Item {
  kind: ConsentKind;
  required: boolean;
  title: string;
  body: string;
  link?: string;
}

const ITEMS: Item[] = [
  {
    kind: "terms_of_service",
    required: true,
    title: "이용약관 동의",
    body: "ReBody 서비스 이용에 관한 기본 약관입니다.",
    link: env.privacyPolicyUrl,
  },
  {
    kind: "privacy_policy",
    required: true,
    title: "개인정보 수집·이용 동의",
    body: "이메일, 생년, 키·몸무게, 활동 일정을 수집합니다. 계정 삭제 시 전부 파기됩니다.",
    link: env.privacyPolicyUrl,
  },
  {
    kind: "sensitive_health_data",
    required: true,
    title: "민감정보(건강정보) 처리 동의",
    body:
      "단식 기록, 식사 기록, 체중은 개인정보보호법상 민감정보입니다. " +
      "단식 스케줄 산출과 주간 리포트 생성에만 사용하며, 국내(서울) 리전에 저장합니다.",
  },
  {
    kind: "overseas_transfer",
    required: true,
    title: "개인정보 국외 이전 동의",
    body:
      "음식 사진과 일정 문장을 Google LLC(미국)의 Gemini API로 전송해 분석합니다. " +
      "이전 항목: 사진·입력 문장·집계된 영양 통계 / 이전 시점: 기능 사용 시 / 보유 기간: 처리 즉시 파기. " +
      "동의를 거부하시면 사진 분석과 자연어 일정 보정을 이용하실 수 없습니다.",
  },
  {
    kind: "marketing",
    required: false,
    title: "마케팅 정보 수신 동의 (선택)",
    body: "새 기능과 이벤트 소식을 받아보실 수 있습니다. 동의하지 않아도 모든 기능을 쓸 수 있습니다.",
  },
];

export default function ConsentRoute() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grantConsents = useAuthStore((s) => s.grantConsents);

  const allRequiredChecked = REQUIRED_CONSENTS.every((k) => checked[k]);
  const allChecked = ITEMS.every((i) => checked[i.kind]);

  const toggle = (kind: ConsentKind) =>
    setChecked((prev) => ({ ...prev, [kind]: !prev[kind] }));

  const toggleAll = () => {
    const next = !allChecked;
    setChecked(Object.fromEntries(ITEMS.map((i) => [i.kind, next])));
  };

  const submit = async () => {
    if (!allRequiredChecked) return;
    setBusy(true);
    setError(null);
    try {
      // 필수는 granted=true, 선택(마케팅)은 사용자가 고른 값 그대로 기록한다.
      // 거부 이력도 남겨야 나중에 "동의한 적 없음"을 증명할 수 있다.
      await grantConsents(REQUIRED_CONSENTS, true);
      await grantConsents(["marketing"], Boolean(checked.marketing));
      // 이동은 _layout의 게이트가 처리한다.
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.step}>1 / 3</Text>
        <Text style={styles.title}>시작하기 전에{"\n"}동의가 필요합니다</Text>
        <Text style={styles.lead}>
          건강정보를 다루는 앱이라 항목별로 따로 확인받습니다. 각 항목을 눌러 확인해 주세요.
        </Text>

        <Pressable style={styles.allRow} onPress={toggleAll}>
          <Check on={allChecked} />
          <Text style={styles.allText}>전체 동의 (선택 항목 포함)</Text>
        </Pressable>

        {ITEMS.map((item) => (
          <Pressable key={item.kind} style={styles.card} onPress={() => toggle(item.kind)}>
            <View style={styles.cardHead}>
              <Check on={Boolean(checked[item.kind])} />
              <Text style={styles.cardTitle}>
                {item.required ? "[필수] " : ""}
                {item.title}
              </Text>
            </View>
            <Text style={styles.cardBody}>{item.body}</Text>
            {item.link && (
              <Pressable onPress={() => void Linking.openURL(item.link!)} hitSlop={8}>
                <Text style={styles.link}>전문 보기</Text>
              </Pressable>
            )}
          </Pressable>
        ))}

        <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.primary, (!allRequiredChecked || busy) && styles.disabled]}
          onPress={submit}
          disabled={!allRequiredChecked || busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryText}>
              {allRequiredChecked ? "동의하고 계속" : "필수 항목에 동의해 주세요"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <View style={[styles.check, on && styles.checkOn]}>
      {on && <Text style={styles.checkMark}>✓</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.lg, paddingBottom: spacing.xl },

  step: { ...typography.caption, color: colors.eating, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.text, lineHeight: 30 },
  lead: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.lg },

  allRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  allText: { ...typography.subtitle, color: colors.text },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { ...typography.subtitle, color: colors.text, flex: 1 },
  cardBody: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },
  link: { ...typography.caption, color: colors.fasting, textDecorationLine: "underline" },

  check: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.eating, borderColor: colors.eating },
  checkMark: { color: colors.bg, fontSize: 14, fontWeight: "700" },

  disclaimer: {
    ...typography.caption,
    color: colors.textFaint,
    lineHeight: 18,
    marginTop: spacing.lg,
  },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.md },

  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  primary: {
    backgroundColor: colors.eating,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryText: { ...typography.subtitle, color: colors.bg },
  disabled: { opacity: 0.45 },
});
