// 빈 상태 · 오류 상태 · 로딩 상태 공용 컴포넌트 (D6-2)
//
// 왜 따로 두는가: 무료 티어 Supabase는 미접속 시 일시정지되고, 모바일은 네트워크가
// 수시로 끊긴다. 이때 화면이 텅 비면 사용자는 "앱이 고장났다"고 판단하고 지운다.
// R3의 14일 테스트에서 테스터 1명이 이탈하면 카운터가 초기화되므로,
// 실패 상태를 말로 설명하는 것이 이 프로젝트에서는 기능 하나만큼 중요하다.
//
// 원칙: 무엇이 일어났는지 + 지금 할 수 있는 행동. "오류가 발생했습니다"로 끝내지 않는다.

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/lib/theme";

export function LoadingState({ label = "불러오는 중이에요" }: { label?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.eating} />
      <Text style={styles.body}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action && (
        <Pressable style={styles.primary} onPress={action.onPress}>
          <Text style={styles.primaryText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * 오류 상태. message를 사람이 읽을 수 있는 문장으로 바꿔서 보여준다.
 * 원문 오류는 접어두고(details) 재시도 버튼을 항상 제공한다.
 */
export function ErrorState({
  message,
  onRetry,
  hint,
}: {
  message?: string | null;
  onRetry?: () => void;
  hint?: string;
}) {
  const friendly = toFriendlyMessage(message);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{friendly.title}</Text>
      <Text style={styles.body}>{friendly.body}</Text>
      {hint && <Text style={styles.hint}>{hint}</Text>}
      {onRetry && (
        <Pressable style={styles.primary} onPress={onRetry}>
          <Text style={styles.primaryText}>다시 시도</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * 서버·네트워크 오류 문자열을 사용자 언어로 번역한다.
 *
 * Supabase 무료 티어의 일시정지는 사용자 입장에서 "네트워크 오류"와 구분되지 않는데,
 * 실제로는 잠시 뒤 자동 복구된다. 그 차이를 문장으로 알려줘야 사용자가 앱을 지우지 않는다.
 */
export function toFriendlyMessage(message?: string | null): { title: string; body: string } {
  const m = (message ?? "").toLowerCase();

  if (!message) {
    return {
      title: "잠시 문제가 있었어요",
      body: "다시 시도해 주세요. 계속 안 되면 잠시 후에 다시 열어봐 주세요.",
    };
  }
  if (m.includes("network") || m.includes("fetch") || m.includes("연결")) {
    return {
      title: "연결이 안 돼요",
      body: "네트워크 상태를 확인해 주세요. 기록한 내용은 사라지지 않습니다.",
    };
  }
  if (m.includes("timeout") || m.includes("504") || m.includes("503") || m.includes("깨우")) {
    return {
      title: "서버가 깨어나는 중이에요",
      body: "무료 서버라 한동안 사용이 없으면 잠들어요. 10~20초 뒤 다시 시도하면 정상 동작합니다.",
    };
  }
  if (m.includes("jwt") || m.includes("401") || m.includes("로그인")) {
    return {
      title: "다시 로그인이 필요해요",
      body: "보안을 위해 로그인 세션이 만료됐어요. 로그아웃 후 다시 로그인해 주세요.",
    };
  }
  return { title: "잠시 문제가 있었어요", body: message };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.bg,
  },
  title: { ...typography.subtitle, color: colors.text, textAlign: "center" },
  body: { ...typography.body, color: colors.textMuted, textAlign: "center", lineHeight: 21 },
  hint: { ...typography.caption, color: colors.textFaint, textAlign: "center" },
  primary: {
    backgroundColor: colors.eating,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  primaryText: { ...typography.subtitle, color: colors.bg },
});
