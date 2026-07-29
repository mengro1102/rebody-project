// 시간대 변경 — 출장·이주 대응.
//
// 스케줄 시각은 벽시계(time)로 저장되고 절대시각 변환은 표시 계층에서만 일어난다.
// 그래서 시간대를 바꿀 때 두 가지 의도가 갈린다. 사용자에게 물어야 하는 지점이고,
// 잘못 고르면 단식 시각이 통째로 어긋나므로 결과를 미리 보여준 뒤 고르게 한다.

import { useMemo, useState } from "react";
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
import { router } from "expo-router";
import { DateTime } from "luxon";

import { useAuthStore } from "@/store/useAuthStore";
import { useScheduleStore, type TimezoneChangeMode } from "@/store/useScheduleStore";
import { shiftWallClock } from "@/domain/presets";
import { colors, radius, spacing, typography } from "@/lib/theme";

const COMMON_ZONES = [
  { id: "Asia/Seoul", label: "서울" },
  { id: "Asia/Tokyo", label: "도쿄" },
  { id: "Asia/Shanghai", label: "상하이·베이징" },
  { id: "Asia/Singapore", label: "싱가포르" },
  { id: "Asia/Dubai", label: "두바이" },
  { id: "Europe/London", label: "런던" },
  { id: "Europe/Paris", label: "파리·베를린" },
  { id: "America/New_York", label: "뉴욕" },
  { id: "America/Los_Angeles", label: "로스앤젤레스" },
  { id: "Australia/Sydney", label: "시드니" },
];

export default function TimezoneRoute() {
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const current = profile?.timezone ?? "Asia/Seoul";

  const cycleDays = useScheduleStore((s) => s.cycleDays);
  const changeTimezone = useScheduleStore((s) => s.changeTimezone);

  const [target, setTarget] = useState(current);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const delta = useMemo(() => {
    const now = DateTime.now();
    const from = now.setZone(current).offset;
    const to = now.setZone(target).offset;
    return Number.isFinite(to - from) ? to - from : 0;
  }, [current, target]);

  // 대표값으로 첫 사이클 날의 식사 창 시작 시각을 쓴다.
  const sampleStart = cycleDays[0]?.suggested_meal_window_start ?? null;
  const changed = target !== current;

  const apply = (mode: TimezoneChangeMode) => {
    if (!changed) return;
    setBusy(true);
    void (async () => {
      try {
        await changeTimezone(target, mode);
        await refreshProfile();
        Alert.alert("변경 완료", `시간대가 ${target}(으)로 바뀌었어요.`);
        router.back();
      } catch (e) {
        Alert.alert("변경 실패", e instanceof Error ? e.message : "다시 시도해 주세요.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.lead}>
        지금 시간대는 <Text style={styles.strong}>{current}</Text> 입니다.
        이동하셨다면 도착지를 골라주세요.
      </Text>

      <View style={styles.card}>
        {COMMON_ZONES.map((z) => (
          <Pressable
            key={z.id}
            style={[styles.row, target === z.id && styles.rowSelected]}
            onPress={() => setTarget(z.id)}
          >
            <View style={styles.flex}>
              <Text style={styles.rowLabel}>{z.label}</Text>
              <Text style={styles.rowSub}>{z.id}</Text>
            </View>
            <Text style={styles.rowTime}>{DateTime.now().setZone(z.id).toFormat("HH:mm")}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>목록에 없나요?</Text>
      <View style={styles.customRow}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={custom}
          onChangeText={setCustom}
          placeholder="Europe/Madrid"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={styles.applyBtn}
          onPress={() => {
            const tz = custom.trim();
            if (!DateTime.now().setZone(tz).isValid) {
              Alert.alert("확인 필요", "IANA 형식으로 입력해 주세요. 예: Europe/Madrid");
              return;
            }
            setTarget(tz);
          }}
        >
          <Text style={styles.applyBtnText}>확인</Text>
        </Pressable>
      </View>

      {changed && (
        <>
          <Text style={styles.sectionTitle}>스케줄을 어떻게 할까요?</Text>
          <Text style={styles.deltaText}>
            시차 {delta >= 0 ? "+" : "−"}
            {Math.floor(Math.abs(delta) / 60)}시간
            {Math.abs(delta) % 60 ? ` ${Math.abs(delta) % 60}분` : ""}
          </Text>

          <Pressable style={styles.option} onPress={() => apply("local")} disabled={busy}>
            <Text style={styles.optionTitle}>현지 시각에 맞추기</Text>
            <Text style={styles.optionBody}>
              지금의 생활 리듬을 그대로 도착지 시각에 옮깁니다.
              {sampleStart && ` 첫 끼는 현지 ${sampleStart}에 유지돼요.`}
            </Text>
            <Text style={styles.optionHint}>대부분의 출장·이주에 이쪽이 맞습니다.</Text>
          </Pressable>

          <Pressable style={styles.option} onPress={() => apply("keep_home")} disabled={busy}>
            <Text style={styles.optionTitle}>한국 시각 유지하기</Text>
            <Text style={styles.optionBody}>
              먹는 <Text style={styles.strong}>실제 순간</Text>을 바꾸지 않습니다.
              {sampleStart &&
                ` 첫 끼가 현지 ${shiftWallClock(sampleStart, delta)}로 옮겨져요.`}
            </Text>
            <Text style={styles.optionHint}>
              2~3일 짧은 출장에서 생체리듬을 흔들지 않으려는 경우에 쓰세요.
            </Text>
          </Pressable>
        </>
      )}

      {busy && <ActivityIndicator color={colors.textMuted} style={styles.busy} />}

      <Text style={styles.note}>
        사이클(며칠 주기로 도는지)은 시간대와 무관하게 그대로 유지됩니다. 바뀌는 것은 시각뿐이에요.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  flex: { flex: 1 },
  strong: { color: colors.text, fontWeight: "700" },

  lead: { ...typography.body, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 21 },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowSelected: { backgroundColor: colors.surfaceAlt },
  rowLabel: { ...typography.body, color: colors.text },
  rowSub: { ...typography.caption, color: colors.textFaint },
  rowTime: { ...typography.body, color: colors.textMuted, fontVariant: ["tabular-nums"] },

  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  customRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  applyBtn: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  applyBtnText: { ...typography.body, color: colors.text },

  deltaText: { ...typography.caption, color: colors.fasting, marginBottom: spacing.sm },

  option: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  optionTitle: { ...typography.subtitle, color: colors.eating },
  optionBody: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },
  optionHint: { ...typography.caption, color: colors.textFaint },

  busy: { marginVertical: spacing.md },
  note: { ...typography.caption, color: colors.textFaint, lineHeight: 18, marginTop: spacing.lg },
});
