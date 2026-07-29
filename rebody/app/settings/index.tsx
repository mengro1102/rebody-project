// 설정 — 계정 삭제 경로가 여기 있다.
//
// 앱 내 계정 삭제는 Play Console 필수 요건이다. 링크로 웹에 떠넘기지 않고
// 앱 안에서 끝나야 하며, 삭제 후 실제로 데이터가 사라져야 한다
// (delete_my_account RPC → 사진 포함 전부 삭제).

import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

import { useAuthStore } from "@/store/useAuthStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { clearFcmToken } from "@/features/notifications/registerPush";
import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";
import { MEDICAL_DISCLAIMER } from "@/domain/safety";
import { colors, radius, spacing, typography } from "@/lib/theme";

export default function SettingsRoute() {
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);

  const { subscription, load: loadSubscription, isPro } = useSubscriptionStore();
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadSubscription();
  }, []);

  const handleExportIcs = async () => {
    setExporting(true);
    try {
      const uri = await downloadIcs();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "text/calendar",
          dialogTitle: "ReBody 단식 스케줄 내보내기",
          UTI: "com.apple.ical.ics",
        });
      } else {
        Alert.alert("내보내기 완료", `파일이 저장됐어요:\n${uri}`);
      }
    } catch (e) {
      Alert.alert("내보내기 실패", e instanceof Error ? e.message : "다시 시도해 주세요.");
    } finally {
      setExporting(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert("로그아웃", "이 기기에서 로그아웃할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "로그아웃",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              // 토큰을 먼저 비운다. 안 그러면 다음 로그인 사용자에게 이전 사용자의 알림이 간다.
              await clearFcmToken();
              await signOut();
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  /** 2단계 확인. 첫 알림은 무엇이 사라지는지 알리고, 두 번째에서만 실제로 지운다. */
  const handleDeleteAccount = () => {
    Alert.alert(
      "계정을 삭제할까요?",
      "단식·식사 기록, 업로드한 사진, 스케줄이 모두 삭제되며 복구할 수 없습니다.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "계속",
          style: "destructive",
          onPress: () =>
            Alert.alert("정말 삭제할까요?", "이 작업은 되돌릴 수 없습니다.", [
              { text: "취소", style: "cancel" },
              {
                text: "삭제",
                style: "destructive",
                onPress: () => {
                  void (async () => {
                    setBusy(true);
                    try {
                      await clearFcmToken();
                      await deleteAccount();
                      router.replace("/sign-in");
                    } catch (e) {
                      Alert.alert(
                        "삭제 실패",
                        e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  })();
                },
              },
            ]),
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Section title="계정">
        <Row label="이메일" value={profile?.email ?? "-"} />
        <Row label="시간대" value={profile?.timezone ?? "-"} />
        <Row
          label="플랜"
          value={isPro() ? "Pro" : "무료"}
          action={isPro() ? undefined : { text: "업그레이드", onPress: () => router.push("/paywall") }}
        />
        {subscription?.expires_at && (
          <Row label="다음 갱신" value={subscription.expires_at.slice(0, 10)} />
        )}
      </Section>

      <Section title="알림 및 일정">
        <Button label="알림 설정" onPress={() => router.push("/settings/notifications")} />
        <Button
          label={exporting ? "내보내는 중…" : "캘린더로 내보내기 (.ics)"}
          onPress={handleExportIcs}
          disabled={exporting}
        />
      </Section>

      <Section title="약관 및 정책">
        <Button
          label="개인정보처리방침"
          onPress={() => void Linking.openURL(env.privacyPolicyUrl)}
        />
      </Section>

      <Section title="기타">
        <Button label="로그아웃" onPress={handleSignOut} disabled={busy} />
        <Button label="계정 삭제" onPress={handleDeleteAccount} disabled={busy} destructive />
      </Section>

      {busy && <ActivityIndicator color={colors.textMuted} style={styles.busy} />}

      <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>
      <Text style={styles.version}>ReBody · {env.appEnv}</Text>
    </ScrollView>
  );
}

/**
 * export-ics는 text/calendar를 그대로 돌려주는 GET 엔드포인트라
 * functions.invoke(JSON 파싱)로는 받을 수 없다. 직접 fetch해서 파일로 저장한다.
 */
async function downloadIcs(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("로그인이 필요합니다.");

  const res = await fetch(`${env.supabaseUrl}/functions/v1/export-ics?weeks=4`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.supabaseAnonKey },
  });

  if (!res.ok) {
    const body = await res.text();
    // Edge Function은 실패 시 {error:{message}} JSON을 준다.
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      throw new Error(parsed.error?.message ?? "내보내기에 실패했어요.");
    } catch {
      throw new Error("내보내기에 실패했어요.");
    }
  }

  const ics = await res.text();
  const uri = `${FileSystem.cacheDirectory}rebody-schedule.ics`;
  await FileSystem.writeAsStringAsync(uri, ics, { encoding: FileSystem.EncodingType.UTF8 });
  return uri;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: { text: string; onPress: () => void };
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        <Text style={styles.rowValue}>{value}</Text>
        {action && (
          <Pressable onPress={action.onPress} hitSlop={8}>
            <Text style={styles.rowAction}>{action.text}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      style={[styles.row, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },

  section: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
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
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowLabel: { ...typography.body, color: colors.text, flex: 1 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowValue: { ...typography.body, color: colors.textMuted },
  rowAction: { ...typography.caption, color: colors.eating },
  chevron: { ...typography.subtitle, color: colors.textFaint },
  destructive: { color: colors.danger },
  disabled: { opacity: 0.5 },

  busy: { marginVertical: spacing.md },
  disclaimer: { ...typography.caption, color: colors.textFaint, lineHeight: 18, marginTop: spacing.md },
  version: { ...typography.caption, color: colors.textFaint, marginTop: spacing.md, textAlign: "center" },
});
