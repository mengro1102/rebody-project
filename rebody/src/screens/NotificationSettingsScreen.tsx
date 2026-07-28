// Phase 5 — 알림 설정
//
// Android 13+ 요건이자 동의 준수 항목이다. 카테고리별 독립 토글이 없으면
// 사용자는 "전부 끄기"밖에 못 하고, 그러면 단식 알림(핵심 기능)까지 죽는다.
//
// 마케팅은 기본 off. 켜는 건 사용자의 명시적 행위여야 한다.

import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { requestPushPermission } from "@/features/notifications/registerPush";
import { track } from "@/lib/analytics";
import { colors, radius, spacing, typography } from "@/lib/theme";
import type { NotificationPreferencesRow } from "@/types/database";

interface CategoryDef {
  key: "functional" | "nudge" | "marketing";
  title: string;
  description: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: "functional",
    title: "기능성 알림",
    description: "단식 시작·종료 30분 전 알림. 내가 설정한 일정에 대한 알림이에요.",
  },
  {
    key: "nudge",
    title: "기록 리마인더",
    description: "식사 창이 닫히기 전 기록이 비어 있으면 알려드려요. 하루 최대 1회.",
  },
  {
    key: "marketing",
    title: "소식 및 혜택",
    description: "새 기능과 이벤트 안내. 언제든 끌 수 있어요.",
  },
];

export default function NotificationSettingsScreen() {
  const [prefs, setPrefs] = useState<NotificationPreferencesRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissionAsked, setPermissionAsked] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("notification_preferences").select("*").maybeSingle();
      setPrefs(data as NotificationPreferencesRow | null);
      setLoading(false);
    })();
  }, []);

  const toggle = async (key: CategoryDef["key"], value: boolean) => {
    if (!prefs) return;

    // 낙관적 갱신 — 스위치가 즉시 반응해야 한다.
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });

    const { error } = await supabase
      .from("notification_preferences")
      .update({ [key]: value })
      .eq("user_id", prefs.user_id);

    if (error) {
      setPrefs(previous);
      Alert.alert("저장 실패", "설정을 저장하지 못했어요. 다시 시도해 주세요.");
      return;
    }

    // 하나라도 켰는데 시스템 권한이 없으면 그때 요청한다.
    // 설정 화면에 들어오자마자 다이얼로그를 띄우면 거절률이 훨씬 높다.
    if (value && !permissionAsked) {
      setPermissionAsked(true);
      track("push_permission_soft_ask", { source: "settings" });
      const outcome = await requestPushPermission();
      if (outcome === "denied") {
        Alert.alert(
          "알림이 꺼져 있어요",
          "휴대폰 설정 > 앱 > ReBody > 알림에서 켤 수 있어요.",
        );
      }
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={styles.center}>
        <Text style={styles.body}>알림 설정을 불러오지 못했어요.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>알림</Text>

      {CATEGORIES.map((c) => (
        <View key={c.key} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{c.title}</Text>
            <Text style={styles.rowDesc}>{c.description}</Text>
          </View>
          <Switch
            value={prefs[c.key]}
            onValueChange={(v) => toggle(c.key, v)}
            trackColor={{ false: colors.border, true: colors.eating }}
            thumbColor={colors.text}
          />
        </View>
      ))}

      <View style={styles.note}>
        <Text style={styles.noteTitle}>조용한 시간</Text>
        <Text style={styles.noteBody}>
          {prefs.quiet_hours_start && prefs.quiet_hours_end
            ? `${prefs.quiet_hours_start.slice(0, 5)} – ${prefs.quiet_hours_end.slice(0, 5)} 사이에는 리마인더를 보내지 않아요.`
            : "야간 근무 후 낮에 주무신다면, 수면 시간대를 설정해 두면 그 시간엔 리마인더가 오지 않아요."}
        </Text>
        <Text style={styles.noteFaint}>
          단식 시작·종료 알림은 직접 설정하신 일정이라 조용한 시간에도 전달됩니다.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },

  title: { ...typography.title, color: colors.text, marginBottom: spacing.lg },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1 },
  rowTitle: { ...typography.subtitle, color: colors.text },
  rowDesc: { ...typography.caption, color: colors.textMuted, marginTop: 2, lineHeight: 18 },

  note: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  noteTitle: { ...typography.subtitle, color: colors.text, marginBottom: spacing.xs },
  noteBody: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },
  noteFaint: { ...typography.caption, color: colors.textFaint, lineHeight: 19, marginTop: spacing.sm },

  body: { ...typography.body, color: colors.textMuted },
});
