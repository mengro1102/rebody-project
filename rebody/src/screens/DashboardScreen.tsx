// Phase 2 — 단식 타이머 대시보드
//
// 이 화면이 앱의 홈이다. 교대근무자가 아침에 눈 뜨자마자 보는 질문은 하나다:
// "지금 먹어도 되나?" 그 답이 화면 최상단에 1초 안에 보여야 한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useScheduleStore } from "@/store/useScheduleStore";
import { useFastingStore } from "@/store/useFastingStore";
import { useMealStore } from "@/store/useMealStore";
import { useAuthStore } from "@/store/useAuthStore";
import {
  formatDuration,
  getFastingProgress,
  type TodayPlan,
} from "@/domain/FastingScheduler";
import { sumMacros } from "@/domain/nutrition";
import { MEDICAL_DISCLAIMER } from "@/domain/safety";
import { colors, radius, spacing, typography } from "@/lib/theme";
import { FeedbackCard } from "@/components/FeedbackCard";

export default function DashboardScreen() {
  const profile = useAuthStore((s) => s.profile);
  const timezone = profile?.timezone ?? "Asia/Seoul";

  const { pattern, loading, load, todayPlan } = useScheduleStore();
  const fasting = useFastingStore();
  const meals = useMealStore();

  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);

  const plan = todayPlan();

  // 1초 틱. 화면이 보이는 동안만 돌린다 — 백그라운드에서 배터리를 먹으면 안 된다.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void load(timezone);
    void fasting.load(timezone);
    void meals.loadToday(timezone);
  }, [timezone]);

  // 오늘 단식 구간이 아직 예약되지 않았으면 등록한다.
  // 푸시 디스패처가 fasting_logs를 보고 알림을 보내므로, 이게 없으면 알림도 안 온다.
  useEffect(() => {
    if (plan?.fastingWindow && !fasting.current) {
      void fasting.scheduleToday(plan.fastingWindow, timezone);
    }
  }, [plan?.fastingWindow?.start.getTime(), fasting.current?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(timezone), fasting.load(timezone), meals.loadToday(timezone)]);
    setRefreshing(false);
  }, [timezone]);

  const state = useMemo(() => deriveState(plan, now), [plan, now]);
  const todayMacros = useMemo(
    () => sumMacros(meals.todayMeals.map((m) => ({
      calories: m.total_calories,
      carbs_g: m.total_carbs,
      protein_g: m.total_protein,
      fat_g: m.total_fat,
      sodium_mg: m.total_sodium_mg,
      fiber_g: m.total_fiber_g,
      sugar_g: m.total_sugar_g,
      saturated_fat_g: m.total_saturated_fat_g,
    }))),
    [meals.todayMeals],
  );

  if (loading && !pattern) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.eating} />
      </View>
    );
  }

  if (!pattern) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>스케줄이 아직 없어요</Text>
        <Text style={styles.emptyBody}>
          생활 패턴을 등록하면 나에게 맞는 단식 시간을 자동으로 잡아드릴게요.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />
      }
    >
      {/* ── 지금 상태 ─────────────────────────────────── */}
      <View style={[styles.hero, { borderColor: state.accent }]}>
        <Text style={[styles.heroLabel, { color: state.accent }]}>{state.label}</Text>
        <Text style={styles.heroTimer}>{state.timer}</Text>
        <Text style={styles.heroCaption}>{state.caption}</Text>

        {state.progress !== null && (
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round(state.progress * 100)}%`, backgroundColor: state.accent },
              ]}
            />
          </View>
        )}

        {state.phase && (
          <View style={styles.phaseRow}>
            <Text style={styles.phaseLabel}>{state.phase.label}</Text>
            <Text style={styles.phaseDesc}>{state.phase.description}</Text>
          </View>
        )}
      </View>

      {/* ── 오늘 일정 ─────────────────────────────────── */}
      <Section title="오늘 일정">
        {plan?.isOffDay && <Row label="근무" value="휴무" />}
        {plan?.work && (
          <Row label="근무" value={`${fmt(plan.work.start)} – ${fmt(plan.work.end)}`} />
        )}
        {plan?.workout && (
          <Row label="운동" value={`${fmt(plan.workout.start)} – ${fmt(plan.workout.end)}`} />
        )}
        {plan?.eatingWindow && (
          <Row
            label="식사 가능"
            value={`${fmt(plan.eatingWindow.start)} – ${fmt(plan.eatingWindow.end)}`}
            accent={colors.eating}
          />
        )}
        {plan?.resolved.source === "override" && (
          <Text style={styles.overrideNote}>오늘은 조정된 일정이 적용되어 있어요.</Text>
        )}
      </Section>

      {/* ── 오늘 섭취 ─────────────────────────────────── */}
      <Section title="오늘 섭취">
        {meals.todayMeals.length === 0 ? (
          <Text style={styles.emptyBody}>아직 기록이 없어요. 사진 한 장이면 30초면 끝나요.</Text>
        ) : (
          <>
            <Text style={styles.calorieBig}>
              {Math.round(todayMacros.calories ?? 0)}
              <Text style={styles.calorieUnit}> kcal</Text>
            </Text>
            <View style={styles.macroRow}>
              <Macro label="탄수" value={todayMacros.carbs_g} />
              <Macro label="단백" value={todayMacros.protein_g} />
              <Macro label="지방" value={todayMacros.fat_g} />
            </View>
            <Text style={styles.mealCount}>{meals.todayMeals.length}건 기록됨</Text>
          </>
        )}
      </Section>

      <FeedbackCard />

      <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>
    </ScrollView>
  );
}

interface DerivedState {
  label: string;
  timer: string;
  caption: string;
  accent: string;
  progress: number | null;
  phase: { label: string; description: string } | null;
}

/** 지금이 단식 중인지 식사 가능한지 판정하고 카운트다운 문구를 만든다. */
function deriveState(plan: TodayPlan | null, now: Date): DerivedState {
  if (!plan) {
    return { label: "일정 없음", timer: "--:--:--", caption: "", accent: colors.textMuted, progress: null, phase: null };
  }

  const t = now.getTime();

  if (plan.eatingWindow && t >= plan.eatingWindow.start.getTime() && t < plan.eatingWindow.end.getTime()) {
    return {
      label: "식사 가능",
      timer: formatDuration(plan.eatingWindow.end.getTime() - t),
      caption: `${fmt(plan.eatingWindow.end)}에 식사 창이 닫혀요`,
      accent: colors.eating,
      progress: null,
      phase: null,
    };
  }

  if (plan.fastingWindow && t >= plan.fastingWindow.start.getTime() && t < plan.fastingWindow.end.getTime()) {
    const p = getFastingProgress(plan.fastingWindow, now);
    return {
      label: "단식 중",
      timer: formatDuration(p.remainingMs),
      caption: `${fmt(plan.fastingWindow.end)}에 식사 창이 열려요`,
      accent: colors.fasting,
      progress: p.ratio,
      phase: p.phase,
    };
  }

  if (plan.eatingWindow && t < plan.eatingWindow.start.getTime()) {
    return {
      label: "식사 대기",
      timer: formatDuration(plan.eatingWindow.start.getTime() - t),
      caption: `${fmt(plan.eatingWindow.start)}부터 식사할 수 있어요`,
      accent: colors.fasting,
      progress: null,
      phase: null,
    };
  }

  return {
    label: plan.isOffDay ? "휴무" : "일정 없음",
    timer: "--:--:--",
    caption: "오늘은 지정된 식사 창이 없어요",
    accent: colors.textMuted,
    progress: null,
    phase: null,
  };
}

function fmt(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, accent ? { color: accent } : null]}>{value}</Text>
    </View>
  );
}

function Macro({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={styles.macro}>
      <Text style={styles.macroValue}>{Math.round(value ?? 0)}g</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.lg },

  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  heroLabel: { ...typography.subtitle, marginBottom: spacing.sm },
  heroTimer: { ...typography.mono, color: colors.text },
  heroCaption: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },

  progressTrack: {
    width: "100%",
    height: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: radius.pill },

  phaseRow: { marginTop: spacing.md, alignItems: "center" },
  phaseLabel: { ...typography.caption, color: colors.text, fontWeight: "600" },
  phaseDesc: { ...typography.caption, color: colors.textFaint, marginTop: 2, textAlign: "center" },

  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.subtitle, color: colors.text, marginBottom: spacing.sm },

  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs },
  rowLabel: { ...typography.body, color: colors.textMuted },
  rowValue: { ...typography.body, color: colors.text, fontVariant: ["tabular-nums"] },
  overrideNote: { ...typography.caption, color: colors.warning, marginTop: spacing.sm },

  calorieBig: { fontSize: 34, fontWeight: "700", color: colors.text },
  calorieUnit: { fontSize: 16, color: colors.textMuted, fontWeight: "400" },
  macroRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm },
  macro: { alignItems: "flex-start" },
  macroValue: { ...typography.subtitle, color: colors.text },
  macroLabel: { ...typography.caption, color: colors.textFaint },
  mealCount: { ...typography.caption, color: colors.textFaint, marginTop: spacing.sm },

  emptyTitle: { ...typography.title, color: colors.text, marginBottom: spacing.sm },
  emptyBody: { ...typography.body, color: colors.textMuted, textAlign: "center", lineHeight: 22 },

  disclaimer: {
    ...typography.caption,
    color: colors.textFaint,
    lineHeight: 18,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
