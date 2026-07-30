// 루트 에러 바운더리 (D6-1)
//
// React 렌더 중 예외가 나면 RN은 기본적으로 빨간 화면(개발) 또는 흰 화면(프로덕션)을 띄운다.
// 프로덕션의 흰 화면은 사용자에게 "앱이 죽었다"로 읽히고 그대로 이탈로 이어진다.
// 여기서 잡아 설명과 복구 버튼을 주고, 크래시는 리포팅으로 넘긴다.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { recordError } from "@/lib/crash";
import { isProduction } from "@/lib/env";
import { colors, radius, spacing, typography } from "@/lib/theme";

interface Props {
  children: ReactNode;
  /** 복구 시도. 보통 상태를 초기화하고 홈으로 보낸다. */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // componentStack은 개인정보를 담지 않는다 — 컴포넌트 이름만 들어간다.
    recordError(error, `render:${info.componentStack?.split("\n")[1]?.trim() ?? "unknown"}`);
  }

  private reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>예상치 못한 문제가 생겼어요</Text>
          <Text style={styles.body}>
            기록한 내용은 서버에 저장돼 있어 사라지지 않았어요. 아래 버튼으로 화면을 다시 불러와 주세요.
            같은 문제가 반복되면 앱을 완전히 종료한 뒤 다시 열어봐 주세요.
          </Text>

          {/* 프로덕션에서는 스택을 노출하지 않는다. 사용자에게 의미가 없고 불안만 준다. */}
          {!isProduction && (
            <View style={styles.debug}>
              <Text style={styles.debugLabel}>개발 모드 진단</Text>
              <Text style={styles.debugText}>{error.message}</Text>
            </View>
          )}

          <Pressable style={styles.primary} onPress={this.reset}>
            <Text style={styles.primaryText}>다시 불러오기</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { ...typography.title, color: colors.text },
  body: { ...typography.body, color: colors.textMuted, lineHeight: 22 },
  debug: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  debugLabel: { ...typography.caption, color: colors.danger },
  debugText: { ...typography.caption, color: colors.textMuted },
  primary: {
    backgroundColor: colors.eating,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  primaryText: { ...typography.subtitle, color: colors.bg },
});
