// 생활 패턴 선택 + 자연어 보정 (하이브리드 온보딩)
//
// 흐름: 패턴 선택 → 기준값(기준일 또는 기상 시각) → (선택) 자유 텍스트 보정
// 자연어는 "처음부터 만들기"가 아니라 "이미 만들어진 것을 고치기"에만 쓴다.
// 오파싱 리스크와 토큰 비용이 둘 다 크게 줄어든다.
//
// 화면 설계 원칙: 첫 화면에는 "규칙적인 하루"만 펼쳐 두고 나머지는 접는다.
// 시장 대다수는 일반형이고, 교대·출장 그룹은 필요한 사람만 열어보면 된다.
// 프리셋을 9개 다 늘어놓으면 대다수 사용자가 "내 앱이 아닌가?" 하고 이탈한다.

import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  DEFAULT_PRESET_KEY,
  GROUP_LABELS,
  GROUP_ORDER,
  PRESET_LIST,
  presetsByGroup,
  type PresetGroup,
  type PresetKey,
} from "@/domain/presets";
import { useScheduleStore } from "@/store/useScheduleStore";
import { useAuthStore } from "@/store/useAuthStore";
import { todayInTimezone } from "@/domain/FastingScheduler";
import { track } from "@/lib/analytics";
import { colors, radius, spacing, typography } from "@/lib/theme";

type Step = "preset" | "anchor" | "refine" | "done";

export default function PresetSelectScreen({ onComplete }: { onComplete?: () => void }) {
  const profile = useAuthStore((s) => s.profile);
  const timezone = profile?.timezone ?? "Asia/Seoul";

  const { createFromPreset, refineWithText } = useScheduleStore();

  const [step, setStep] = useState<Step>("preset");
  const [selected, setSelected] = useState<PresetKey>(DEFAULT_PRESET_KEY);
  const [openGroups, setOpenGroups] = useState<PresetGroup[]>(["regular"]);
  const [anchorDate, setAnchorDate] = useState(() => todayInTimezone(timezone));
  const [wakeTime, setWakeTime] = useState("07:00");
  const [refineText, setRefineText] = useState("");
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preset = PRESET_LIST.find((p) => p.key === selected) ?? null;
  const needsWakeTime = preset?.anchorKind === "wake_time";

  const toggleGroup = (g: PresetGroup) =>
    setOpenGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const handleCreate = async () => {
    if (!preset) return;

    if (needsWakeTime) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(wakeTime)) {
        Alert.alert("시각 형식", "24시간제 HH:MM으로 입력해 주세요. 예: 07:30");
        return;
      }
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      Alert.alert("날짜 형식", "YYYY-MM-DD 형식으로 입력해 주세요. 예: 2026-07-27");
      return;
    }

    setBusy(true);
    try {
      // 1일 사이클은 기준일이 의미를 갖지 않으므로 오늘로 고정한다.
      const anchor = needsWakeTime ? todayInTimezone(timezone) : anchorDate;
      await createFromPreset(preset.key, anchor, timezone, { wakeTime });
      setStep("refine");
    } catch (e) {
      Alert.alert("오류", e instanceof Error ? e.message : "스케줄 생성에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const handleRefine = async () => {
    if (!refineText.trim()) return;
    setBusy(true);
    setFollowUp(null);
    try {
      const result = await refineWithText(refineText.trim());
      if (result.status === "needs_clarification") {
        // 확신이 낮으면 서버가 DB를 건드리지 않았다. 되묻고 다시 받는다.
        setFollowUp(result.follow_up_question ?? "조금 더 구체적으로 알려주시겠어요?");
        return;
      }
      setRefineText("");
      finish();
    } catch (e) {
      Alert.alert(
        "분석 실패",
        e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요. 프리셋 값은 그대로 저장되어 있어요.",
      );
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    track("onboarding_complete", { preset: selected });
    setStep("done");
    onComplete?.();
  };

  // ── 1) 생활 패턴 선택 ────────────────────────────────────
  if (step === "preset") {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>어떤 하루를 보내세요?</Text>
        <Text style={styles.subtitle}>
          정확히 맞지 않아도 괜찮아요. 다음 단계에서 말로 고칠 수 있어요.
        </Text>

        {GROUP_ORDER.map((group) => {
          const items = presetsByGroup(group);
          const open = openGroups.includes(group);
          const label = GROUP_LABELS[group];
          const selectedHere = items.some((p) => p.key === selected);

          return (
            <View key={group} style={styles.group}>
              <Pressable style={styles.groupHeader} onPress={() => toggleGroup(group)}>
                <View style={styles.flex}>
                  <Text style={styles.groupTitle}>
                    {label.title}
                    {!open && selectedHere ? " · 선택됨" : ""}
                  </Text>
                  <Text style={styles.groupCaption}>{label.caption}</Text>
                </View>
                <Text style={styles.groupChevron}>{open ? "−" : "+"}</Text>
              </Pressable>

              {open &&
                items.map((p) => (
                  <Pressable
                    key={p.key}
                    onPress={() => setSelected(p.key)}
                    style={[styles.card, selected === p.key && styles.cardSelected]}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>{p.title}</Text>
                      <Text style={styles.cardBadge}>
                        {p.cycleLengthDays === 1 ? "매일 반복" : `${p.cycleLengthDays}일 주기`}
                      </Text>
                    </View>
                    <Text style={styles.cardSubtitle}>{p.subtitle}</Text>
                    <Text style={styles.cardDesc}>{p.description}</Text>
                  </Pressable>
                ))}
            </View>
          );
        })}

        <Pressable style={styles.primaryBtn} onPress={() => setStep("anchor")}>
          <Text style={styles.primaryBtnText}>다음</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ── 2) 기준값 (기준일 또는 기상 시각) ────────────────────
  if (step === "anchor") {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{preset?.anchorQuestion}</Text>
        <Text style={styles.subtitle}>
          {needsWakeTime
            ? "이 시각을 기준으로 첫 끼와 단식 시간을 잡아드려요. 나중에 바꿀 수 있어요."
            : "이 날짜를 기준으로 사이클이 반복돼요. 나중에 바꿀 수 있어요."}
        </Text>

        {needsWakeTime ? (
          <>
            <TextInput
              style={styles.input}
              value={wakeTime}
              onChangeText={setWakeTime}
              placeholder="07:00"
              placeholderTextColor={colors.textFaint}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              maxLength={5}
            />
            <View style={styles.quickRow}>
              {["05:30", "06:30", "07:30", "09:00"].map((t) => (
                <Pressable key={t} style={styles.quickChip} onPress={() => setWakeTime(t)}>
                  <Text style={styles.quickChipText}>{t}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <TextInput
            style={styles.input}
            value={anchorDate}
            onChangeText={setAnchorDate}
            placeholder="2026-07-27"
            placeholderTextColor={colors.textFaint}
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
            maxLength={10}
          />
        )}

        <View style={styles.btnRow}>
          <Pressable style={styles.secondaryBtn} onPress={() => setStep("preset")}>
            <Text style={styles.secondaryBtnText}>이전</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, styles.flex, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={handleCreate}
          >
            {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryBtnText}>스케줄 만들기</Text>}
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // ── 3) 자연어 보정 (선택) ────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>고칠 부분이 있나요?</Text>
      <Text style={styles.subtitle}>
        한 문장으로 말해주시면 반영해드려요. 없으면 건너뛰어도 됩니다.
      </Text>

      <View style={styles.examples}>
        <Text style={styles.exampleLabel}>이렇게 말해보세요</Text>
        <Text style={styles.exampleText}>· "수요일은 오후 2시부터 10시까지 알바예요"</Text>
        <Text style={styles.exampleText}>· "화·목은 저녁 7시에 운동해요"</Text>
        <Text style={styles.exampleText}>· "주말에는 10시쯤 첫 끼를 먹고 싶어요"</Text>
      </View>

      <TextInput
        style={[styles.input, styles.textarea]}
        value={refineText}
        onChangeText={setRefineText}
        placeholder="예: 금요일은 오후에 일정이 있어요"
        placeholderTextColor={colors.textFaint}
        multiline
        maxLength={500}
      />
      <Text style={styles.counter}>{refineText.length}/500</Text>

      {followUp && (
        <View style={styles.followUp}>
          <Text style={styles.followUpLabel}>확인이 필요해요</Text>
          <Text style={styles.followUpText}>{followUp}</Text>
        </View>
      )}

      <View style={styles.btnRow}>
        <Pressable style={styles.secondaryBtn} onPress={finish}>
          <Text style={styles.secondaryBtnText}>건너뛰기</Text>
        </Pressable>
        <Pressable
          style={[styles.primaryBtn, styles.flex, (busy || !refineText.trim()) && styles.btnDisabled]}
          disabled={busy || !refineText.trim()}
          onPress={handleRefine}
        >
          {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryBtnText}>반영하기</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  flex: { flex: 1 },

  title: { ...typography.title, color: colors.text, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 21 },

  group: { marginBottom: spacing.md },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  groupTitle: { ...typography.subtitle, color: colors.text },
  groupCaption: { ...typography.caption, color: colors.textFaint, marginTop: 2 },
  groupChevron: { ...typography.title, color: colors.textMuted, paddingHorizontal: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardSelected: { borderColor: colors.eating, backgroundColor: colors.surfaceAlt },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { ...typography.subtitle, color: colors.text },
  cardBadge: { ...typography.caption, color: colors.textFaint },
  cardSubtitle: { ...typography.body, color: colors.eating, marginTop: 2 },
  cardDesc: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 18 },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  textarea: { minHeight: 96, textAlignVertical: "top" },
  counter: { ...typography.caption, color: colors.textFaint, textAlign: "right", marginTop: spacing.xs },

  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  quickChip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  quickChipText: { ...typography.caption, color: colors.text },

  examples: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  exampleLabel: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  exampleText: { ...typography.caption, color: colors.text, lineHeight: 20 },

  followUp: {
    backgroundColor: colors.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  followUpLabel: { ...typography.caption, color: colors.warning, marginBottom: spacing.xs },
  followUpText: { ...typography.body, color: colors.text, lineHeight: 21 },

  btnRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  primaryBtn: {
    backgroundColor: colors.eating,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryBtnText: { ...typography.subtitle, color: colors.bg },
  secondaryBtn: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  secondaryBtnText: { ...typography.subtitle, color: colors.textMuted },
  btnDisabled: { opacity: 0.4 },
});
