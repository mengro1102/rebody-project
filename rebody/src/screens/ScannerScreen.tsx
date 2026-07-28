// Phase 3 — 푸드 스캐너 (촬영 → 분석 → 편집 가능 결과)
//
// 결과를 그대로 저장하지 않고 반드시 사용자 확인을 거친다. AI 추정은 틀릴 수 있고,
// 틀린 값이 조용히 쌓이면 Phase 4의 주간 피드백까지 오염된다.
// 중량을 조절하면 매크로가 비례 재계산된다 (domain/nutrition.rescalePortion).

import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { useMealStore } from "@/store/useMealStore";
import { useScheduleStore } from "@/store/useScheduleStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useSubscriptionStore } from "@/store/useSubscriptionStore";
import { rescalePortion, sourceLabel, type ScannedFood } from "@/domain/nutrition";
import { NUTRITION_ESTIMATE_DISCLAIMER } from "@/domain/safety";
import { EdgeFunctionError } from "@/lib/supabase";
import { colors, radius, spacing, typography } from "@/lib/theme";

// Gemini 입력 토큰은 이미지 해상도에 비례한다. 음식 식별에는 1024px이면 충분하고,
// 그 이상은 정확도 이득 없이 비용만 늘린다.
const MAX_WIDTH = 1024;
const JPEG_QUALITY = 0.7;

export default function ScannerScreen({ onDone }: { onDone?: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const profile = useAuthStore((s) => s.profile);
  const timezone = profile?.timezone ?? "Asia/Seoul";

  const { scan, saveMeals, scanning, quotaRemaining } = useMealStore();
  const todayPlan = useScheduleStore((s) => s.todayPlan);
  const isPro = useSubscriptionStore((s) => s.isPro);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [results, setResults] = useState<ScannedFood[] | null>(null);
  const [saving, setSaving] = useState(false);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>카메라 권한이 필요해요</Text>
        <Text style={styles.body}>
          식사 사진을 찍어 영양성분을 분석합니다. 사진은 분석 후 본인만 볼 수 있게 저장돼요.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>권한 허용하기</Text>
        </Pressable>
      </View>
    );
  }

  const handleCapture = async () => {
    if (!cameraRef.current || scanning) return;

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1, skipProcessing: true });
      if (!photo?.uri) return;

      setPhotoUri(photo.uri);

      // 리사이즈 + base64. 원본을 그대로 보내면 입력 토큰과 전송 시간이 몇 배로 늘어난다.
      const processed = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: MAX_WIDTH } }],
        { compress: JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );

      if (!processed.base64) throw new Error("이미지 처리에 실패했습니다.");

      const res = await scan(processed.base64, timezone);
      setResults(res.items);
    } catch (e) {
      setPhotoUri(null);
      if (e instanceof EdgeFunctionError) {
        if (e.code === "quota_exceeded") {
          Alert.alert("오늘 스캔을 모두 사용했어요", e.message, [
            { text: "닫기", style: "cancel" },
            { text: "Pro 알아보기", onPress: () => onDone?.() },
          ]);
          return;
        }
        Alert.alert("분석 실패", e.message);
        return;
      }
      Alert.alert("오류", e instanceof Error ? e.message : "다시 시도해 주세요.");
    }
  };

  const handleSave = async () => {
    if (!results?.length) return;
    setSaving(true);
    try {
      await saveMeals(results, {
        timezone,
        fastingWindow: todayPlan()?.fastingWindow ?? null,
      });
      setResults(null);
      setPhotoUri(null);
      onDone?.();
    } catch (e) {
      Alert.alert("저장 실패", e instanceof Error ? e.message : "다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const updateItem = (index: number, next: ScannedFood) => {
    setResults((prev) => prev?.map((it, i) => (i === index ? next : it)) ?? null);
  };

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />

      <View style={styles.overlay}>
        {!isPro() && quotaRemaining !== null && (
          <View style={styles.quotaBadge}>
            <Text style={styles.quotaText}>오늘 {quotaRemaining}회 남음</Text>
          </View>
        )}

        <Pressable
          style={[styles.shutter, scanning && styles.shutterBusy]}
          onPress={handleCapture}
          disabled={scanning}
        >
          {scanning ? <ActivityIndicator color={colors.bg} /> : <View style={styles.shutterInner} />}
        </Pressable>

        <Text style={styles.hint}>
          {scanning ? "분석 중이에요…" : "음식이 화면에 가득 차게 찍어주세요"}
        </Text>
      </View>

      {/* ── 결과 편집 모달 ─────────────────────────── */}
      <Modal visible={!!results} animationType="slide" transparent onRequestClose={() => setResults(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>이렇게 기록할까요?</Text>

            <ScrollView style={styles.sheetScroll}>
              {photoUri && <Image source={{ uri: photoUri }} style={styles.preview} />}

              {results?.map((item, i) => (
                <FoodResultCard
                  key={`${item.food_name}-${i}`}
                  food={item}
                  onChange={(next) => updateItem(i, next)}
                />
              ))}

              {results?.some((r) => r.source === "ai_estimate") && (
                <Text style={styles.disclaimer}>{NUTRITION_ESTIMATE_DISCLAIMER}</Text>
              )}
            </ScrollView>

            <View style={styles.sheetActions}>
              <Pressable style={styles.secondaryBtn} onPress={() => { setResults(null); setPhotoUri(null); }}>
                <Text style={styles.secondaryBtnText}>다시 찍기</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, styles.flex, saving && styles.btnDisabled]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryBtnText}>기록하기</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** 개별 음식 카드. 중량 조절 시 매크로가 비례 재계산된다. */
function FoodResultCard({
  food,
  onChange,
}: {
  food: ScannedFood;
  onChange: (next: ScannedFood) => void;
}) {
  const badge = sourceLabel(food.source);

  const step = (delta: number) => {
    const next = Math.max(5, food.portion_g + delta);
    onChange(rescalePortion(food, next));
  };

  return (
    <View style={styles.foodCard}>
      <View style={styles.foodHeader}>
        <Text style={styles.foodName}>{food.display_name}</Text>
        <View
          style={[
            styles.badge,
            { backgroundColor: badge.tone === "official" ? colors.official + "22" : colors.estimate + "22" },
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              { color: badge.tone === "official" ? colors.official : colors.estimate },
            ]}
          >
            {badge.text}
          </Text>
        </View>
      </View>

      <View style={styles.portionRow}>
        <Pressable style={styles.stepBtn} onPress={() => step(-25)}>
          <Text style={styles.stepBtnText}>−</Text>
        </Pressable>
        <Text style={styles.portionValue}>{food.portion_g}g</Text>
        <Pressable style={styles.stepBtn} onPress={() => step(25)}>
          <Text style={styles.stepBtnText}>+</Text>
        </Pressable>
      </View>

      <Text style={styles.calories}>
        {Math.round(food.calories ?? 0)}
        <Text style={styles.caloriesUnit}> kcal</Text>
      </Text>

      <View style={styles.macroRow}>
        <MacroChip label="탄" value={food.carbs_g} />
        <MacroChip label="단" value={food.protein_g} />
        <MacroChip label="지" value={food.fat_g} />
        {food.sodium_mg !== null && <MacroChip label="나트륨" value={food.sodium_mg} unit="mg" />}
      </View>
    </View>
  );
}

function MacroChip({ label, value, unit = "g" }: { label: string; value: number | null; unit?: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={styles.chipValue}>
        {Math.round(value ?? 0)}
        {unit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  flex: { flex: 1 },
  camera: { flex: 1 },

  overlay: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    alignItems: "center",
    paddingBottom: spacing.xl,
    paddingTop: spacing.lg,
  },
  quotaBadge: {
    backgroundColor: "rgba(15,17,21,0.8)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.md,
  },
  quotaText: { ...typography.caption, color: colors.text },

  shutter: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: colors.text,
    alignItems: "center", justifyContent: "center",
    borderWidth: 4, borderColor: "rgba(255,255,255,0.35)",
  },
  shutterBusy: { opacity: 0.6 },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.eating },
  hint: { ...typography.caption, color: colors.text, marginTop: spacing.md, textShadowColor: "#000", textShadowRadius: 4 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    maxHeight: "88%",
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center", marginVertical: spacing.sm,
  },
  sheetTitle: { ...typography.title, color: colors.text, marginBottom: spacing.md },
  sheetScroll: { marginBottom: spacing.md },

  preview: { width: "100%", height: 160, borderRadius: radius.md, marginBottom: spacing.md },

  foodCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  foodHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  foodName: { ...typography.subtitle, color: colors.text, flex: 1 },
  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  badgeText: { ...typography.caption, fontSize: 11, fontWeight: "600" },

  portionRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  stepBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center", justifyContent: "center",
  },
  stepBtnText: { fontSize: 20, color: colors.text, lineHeight: 22 },
  portionValue: { ...typography.subtitle, color: colors.text, minWidth: 64, textAlign: "center", fontVariant: ["tabular-nums"] },

  calories: { fontSize: 28, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
  caloriesUnit: { fontSize: 14, color: colors.textMuted, fontWeight: "400" },

  macroRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  chip: { flexDirection: "row", gap: 4, backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  chipLabel: { ...typography.caption, color: colors.textFaint },
  chipValue: { ...typography.caption, color: colors.text, fontVariant: ["tabular-nums"] },

  disclaimer: { ...typography.caption, color: colors.textFaint, lineHeight: 18, marginTop: spacing.sm },

  sheetActions: { flexDirection: "row", gap: spacing.sm },
  primaryBtn: { backgroundColor: colors.eating, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: "center" },
  primaryBtnText: { ...typography.subtitle, color: colors.bg },
  secondaryBtn: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignItems: "center" },
  secondaryBtnText: { ...typography.subtitle, color: colors.textMuted },
  btnDisabled: { opacity: 0.5 },

  title: { ...typography.title, color: colors.text, marginBottom: spacing.sm, textAlign: "center" },
  body: { ...typography.body, color: colors.textMuted, textAlign: "center", lineHeight: 22, marginBottom: spacing.lg },
});
