// 안전성 온보딩 — Play 민감 카테고리 대응 (docs/00_ANALYSIS.md §2-4)
//
// 단식 앱은 저체중·미성년·임신 사용자에게 실질적 위해가 될 수 있다.
// 여기서 받는 값은 프로필 장식이 아니라 **단식 기능의 하드 게이트 입력**이다.
//
// 차단되더라도 앱을 못 쓰게 하지 않는다. 단식 스케줄링만 끄고 식사 기록·영양 분석은 열어둔다.
// 앱 전체를 막으면 사용자는 안전장치가 없는 다른 앱으로 갈 뿐이다 (safety.ts 주석 참조).

import { useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useAuthStore } from "@/store/useAuthStore";
import { calculateBmi, checkEligibility, MEDICAL_DISCLAIMER, MIN_AGE } from "@/domain/safety";
import { colors, radius, spacing, typography } from "@/lib/theme";

export default function ProfileRoute() {
  const profile = useAuthStore((s) => s.profile);
  const updateProfile = useAuthStore((s) => s.updateProfile);

  const [birthYear, setBirthYear] = useState(profile?.birth_year ? String(profile.birth_year) : "");
  const [heightCm, setHeightCm] = useState(profile?.height_cm ? String(profile.height_cm) : "");
  const [weightKg, setWeightKg] = useState(profile?.weight_kg ? String(profile.weight_kg) : "");
  const [pregnant, setPregnant] = useState(false);
  const [eatingDisorder, setEatingDisorder] = useState(false);
  const [diabetes, setDiabetes] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nums = useMemo(
    () => ({
      birthYear: Number(birthYear),
      heightCm: Number(heightCm),
      weightKg: Number(weightKg),
    }),
    [birthYear, heightCm, weightKg],
  );

  const filled =
    Number.isFinite(nums.birthYear) && birthYear.length === 4 &&
    nums.heightCm > 0 && nums.weightKg > 0;

  // 저장 전에 미리 판정해 보여준다 — 다 입력하고 나서야 "안 됩니다"를 보는 것보다 낫다.
  const preview = useMemo(() => {
    if (!filled) return null;
    return checkEligibility({
      birthYear: nums.birthYear,
      heightCm: nums.heightCm,
      weightKg: nums.weightKg,
      isPregnantOrNursing: pregnant,
      hasEatingDisorderHistory: eatingDisorder,
      hasDiabetesOnMedication: diabetes,
    });
  }, [filled, nums, pregnant, eatingDisorder, diabetes]);

  const bmi = filled ? calculateBmi(nums.heightCm, nums.weightKg) : null;

  const submit = async () => {
    if (!filled) return;
    const thisYear = new Date().getFullYear();
    if (nums.birthYear < 1900 || nums.birthYear > thisYear) {
      setError("출생연도를 확인해 주세요.");
      return;
    }
    if (nums.heightCm < 100 || nums.heightCm > 250) {
      setError("키를 확인해 주세요. (100~250cm)");
      return;
    }
    if (nums.weightKg < 25 || nums.weightKg > 300) {
      setError("몸무게를 확인해 주세요. (25~300kg)");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const eligible = preview?.eligible ?? false;
      await updateProfile({
        birth_year: nums.birthYear,
        height_cm: nums.heightCm,
        weight_kg: nums.weightKg,
        is_pregnant_or_nursing: pregnant,
        has_eating_disorder_history: eatingDisorder,
        has_diabetes_on_medication: diabetes,
        // 단식이 차단된 사용자는 스케줄 단계를 건너뛰므로 여기서 온보딩을 끝낸다.
        // 스케줄을 만들 수 있는 사용자는 다음 화면에서 onboarded_at이 채워진다.
        ...(eligible ? {} : { onboarded_at: new Date().toISOString() }),
      });
      if (!eligible) router.replace("/");
      // 통과한 경우의 이동은 _layout 게이트가 처리한다.
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장에 실패했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.step}>2 / 3</Text>
        <Text style={styles.title}>안전하게 시작하기 위해{"\n"}몇 가지만 확인할게요</Text>
        <Text style={styles.lead}>
          단식이 권장되지 않는 조건이 있는지 확인하는 절차입니다. 입력값은 서버에 암호화되어
          저장되며 계정 삭제 시 함께 사라집니다.
        </Text>

        <Field label="출생연도" hint={`만 ${MIN_AGE}세 이상만 단식 기능을 이용할 수 있어요`}>
          <TextInput
            style={styles.input}
            value={birthYear}
            onChangeText={setBirthYear}
            keyboardType="number-pad"
            maxLength={4}
            placeholder="1995"
            placeholderTextColor={colors.textFaint}
          />
        </Field>

        <View style={styles.row}>
          <Field label="키 (cm)" style={styles.half}>
            <TextInput
              style={styles.input}
              value={heightCm}
              onChangeText={setHeightCm}
              keyboardType="decimal-pad"
              placeholder="172"
              placeholderTextColor={colors.textFaint}
            />
          </Field>
          <Field label="몸무게 (kg)" style={styles.half}>
            <TextInput
              style={styles.input}
              value={weightKg}
              onChangeText={setWeightKg}
              keyboardType="decimal-pad"
              placeholder="68"
              placeholderTextColor={colors.textFaint}
            />
          </Field>
        </View>

        {bmi !== null && (
          <Text style={styles.bmi}>
            BMI {bmi.toFixed(1)}
            {bmi < 18.5 ? " · 저체중 범위" : bmi < 23 ? " · 정상 범위" : " · 과체중 범위"}
          </Text>
        )}

        <Text style={styles.sectionTitle}>자가 문진</Text>
        <Toggle label="임신 중이거나 수유 중이에요" value={pregnant} onChange={setPregnant} />
        <Toggle
          label="섭식장애 병력이 있어요"
          value={eatingDisorder}
          onChange={setEatingDisorder}
        />
        <Toggle
          label="혈당 관련 약을 복용 중이에요"
          value={diabetes}
          onChange={setDiabetes}
        />

        {preview && !preview.eligible && (
          <View style={styles.blocked}>
            <Text style={styles.blockedTitle}>단식 스케줄 기능이 제공되지 않습니다</Text>
            <Text style={styles.blockedBody}>{preview.message}</Text>
          </View>
        )}

        {preview?.warnings.map((w) => (
          <View key={w} style={styles.warning}>
            <Text style={styles.warningText}>{w}</Text>
          </View>
        ))}

        <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.primary, (!filled || busy) && styles.disabled]}
          onPress={submit}
          disabled={!filled || busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.primaryText}>
              {preview && !preview.eligible ? "식사 기록만 사용하기" : "계속"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  hint,
  style,
  children,
}: {
  label: string;
  hint?: string;
  style?: object;
  children: ReactNode;
}) {
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Pressable style={styles.toggleRow} onPress={() => onChange(!value)}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.warning }}
        thumbColor={colors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.lg, paddingBottom: spacing.xl },

  step: { ...typography.caption, color: colors.eating, marginBottom: spacing.sm },
  title: { ...typography.title, color: colors.text, lineHeight: 30 },
  lead: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.lg },

  field: { marginBottom: spacing.md },
  row: { flexDirection: "row", gap: spacing.md },
  half: { flex: 1 },
  label: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  hint: { ...typography.caption, color: colors.textFaint, marginTop: spacing.xs },
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
  bmi: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.md },

  sectionTitle: {
    ...typography.subtitle,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  toggleLabel: { ...typography.body, color: colors.text, flex: 1 },

  blocked: {
    backgroundColor: colors.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  blockedTitle: { ...typography.subtitle, color: colors.danger },
  blockedBody: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },

  warning: {
    backgroundColor: colors.surfaceAlt,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  warningText: { ...typography.caption, color: colors.textMuted, lineHeight: 19 },

  disclaimer: { ...typography.caption, color: colors.textFaint, lineHeight: 18, marginTop: spacing.lg },
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
