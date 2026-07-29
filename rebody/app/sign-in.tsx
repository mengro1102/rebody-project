// 로그인 · 회원가입.
//
// 여기서는 동의를 받지 않는다. 계정을 먼저 만들고, 동의는 다음 화면에서
// 항목별로 분리해 받는다 — 가입 버튼 하나에 여러 동의를 묶는 것이 바로
// 개인정보보호법이 금지하는 형태다 (docs/00_ANALYSIS.md §2-1).

import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuthStore } from "@/store/useAuthStore";
import { colors, radius, spacing, typography } from "@/lib/theme";

type Mode = "sign_in" | "sign_up";

export default function SignInRoute() {
  const [mode, setMode] = useState<Mode>("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loading = useAuthStore((s) => s.loading);
  const signIn = useAuthStore((s) => s.signInWithEmail);
  const signUp = useAuthStore((s) => s.signUpWithEmail);

  const submit = async () => {
    setError(null);
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("이메일 주소를 확인해 주세요.");
      return;
    }
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }
    try {
      if (mode === "sign_in") await signIn(trimmed, password);
      else await signUp(trimmed, password);
      // 이동은 _layout의 게이트가 처리한다. 여기서 router를 직접 부르지 않는다.
    } catch (e) {
      setError(e instanceof Error ? e.message : "다시 시도해 주세요.");
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.wordmark}>Re:Body</Text>
        <Text style={styles.tagline}>내 생활 패턴에 맞춘 간헐적 단식</Text>

        <View style={styles.form}>
          <Text style={styles.label}>이메일</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            placeholder="you@example.com"
            placeholderTextColor={colors.textFaint}
          />

          <Text style={styles.label}>비밀번호</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType={mode === "sign_up" ? "newPassword" : "password"}
            placeholder="6자 이상"
            placeholderTextColor={colors.textFaint}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.primary, loading && styles.disabled]}
            onPress={submit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Text style={styles.primaryText}>
                {mode === "sign_in" ? "로그인" : "가입하기"}
              </Text>
            )}
          </Pressable>

          <Pressable
            style={styles.switch}
            onPress={() => {
              setMode(mode === "sign_in" ? "sign_up" : "sign_in");
              setError(null);
            }}
          >
            <Text style={styles.switchText}>
              {mode === "sign_in"
                ? "처음이신가요? 회원가입"
                : "이미 계정이 있으신가요? 로그인"}
            </Text>
          </Pressable>
        </View>

        <Text style={styles.notice}>
          다음 화면에서 이용약관과 개인정보 처리에 대한 동의를 항목별로 받습니다.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },

  wordmark: { ...typography.display, color: colors.text, textAlign: "center" },
  tagline: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },

  form: { gap: spacing.sm },
  label: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
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

  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },

  primary: {
    backgroundColor: colors.eating,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  primaryText: { ...typography.subtitle, color: colors.bg },
  disabled: { opacity: 0.6 },

  switch: { alignItems: "center", paddingVertical: spacing.md },
  switchText: { ...typography.caption, color: colors.textMuted },

  notice: {
    ...typography.caption,
    color: colors.textFaint,
    textAlign: "center",
    marginTop: spacing.xl,
  },
});
