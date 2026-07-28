// 안전장치 — 원문 착수 문서에 없던 항목 (docs/00_ANALYSIS.md §2-4)
//
// 단식 앱은 Google Play의 민감 카테고리다. 저체중 사용자에게 장시간 단식을 권하는 앱은
// 정책 위반 소지이자 실질적 위해다. 여기서 정하는 규칙은 UI 문구가 아니라 하드 게이트다.
//
// 이 모듈은 "판정"만 한다. 의학적 조언을 생성하지 않는다.

export const MIN_AGE = 18;
export const MIN_SAFE_BMI = 18.5;
export const MAX_FASTING_HOURS = 24;
export const RECOMMENDED_MAX_FASTING_HOURS = 16;

export type BlockReason =
  | "under_age"
  | "underweight"
  | "pregnancy_or_nursing"
  | "medical_condition";

export interface EligibilityInput {
  birthYear?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  /** 온보딩 자가 문진 응답 */
  isPregnantOrNursing?: boolean;
  hasEatingDisorderHistory?: boolean;
  hasDiabetesOnMedication?: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: BlockReason | null;
  /** 사용자에게 그대로 보여줄 한국어 문구 */
  message: string | null;
  /** 차단은 아니지만 경고를 띄워야 하는 경우 */
  warnings: string[];
}

export function calculateBmi(heightCm: number, weightKg: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/**
 * 단식 스케줄 생성 자격 판정.
 *
 * 차단 시에도 앱을 못 쓰게 하지는 않는다 — 식사 기록·영양 분석은 계속 쓸 수 있고,
 * 단식 스케줄링만 비활성화한다. 앱 전체를 막으면 사용자는 그냥 다른 앱으로 가서
 * 안전장치가 없는 채로 같은 일을 한다.
 */
export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const warnings: string[] = [];

  if (input.birthYear) {
    const age = new Date().getFullYear() - input.birthYear;
    if (age < MIN_AGE) {
      return {
        eligible: false,
        reason: "under_age",
        message:
          "단식 스케줄 기능은 만 18세 이상만 이용할 수 있어요. 식사 기록과 영양 분석은 계속 사용하실 수 있습니다.",
        warnings,
      };
    }
  }

  if (input.isPregnantOrNursing) {
    return {
      eligible: false,
      reason: "pregnancy_or_nursing",
      message:
        "임신 중이거나 수유 중일 때는 단식을 권장하지 않습니다. 식사 기록 기능만 이용해 주세요.",
      warnings,
    };
  }

  if (input.hasEatingDisorderHistory) {
    return {
      eligible: false,
      reason: "medical_condition",
      message:
        "섭식장애 병력이 있으신 경우 단식 스케줄 기능을 제공하지 않습니다. 전문가와 상담해 주세요.",
      warnings,
    };
  }

  if (input.heightCm && input.weightKg) {
    const bmi = calculateBmi(input.heightCm, input.weightKg);
    if (bmi < MIN_SAFE_BMI) {
      return {
        eligible: false,
        reason: "underweight",
        message:
          `현재 BMI가 ${bmi.toFixed(1)}로 저체중 범위예요. 이 경우 단식은 권장되지 않습니다. ` +
          "식사 기록으로 충분한 섭취를 확인하는 쪽을 추천드려요.",
        warnings,
      };
    }
    if (bmi < 20) {
      warnings.push("BMI가 정상 범위 하단이에요. 단식 시간을 무리하게 늘리지 마세요.");
    }
  }

  if (input.hasDiabetesOnMedication) {
    warnings.push(
      "혈당 관련 약을 복용 중이시라면 단식 시작 전에 반드시 담당 의료진과 상의해 주세요.",
    );
  }

  return { eligible: true, reason: null, message: null, warnings };
}

/**
 * 단식 목표 시간을 안전 범위로 자른다.
 * DB에도 24시간 제약이 걸려 있지만(fasting_target_max_24h), 클라이언트에서 먼저
 * 잘라야 사용자가 저장 실패 에러를 보지 않는다.
 */
export function clampFastingHours(hours: number): { hours: number; clamped: boolean } {
  if (hours > MAX_FASTING_HOURS) return { hours: MAX_FASTING_HOURS, clamped: true };
  if (hours < 8) return { hours: 8, clamped: true };
  return { hours, clamped: false };
}

/** 앱 곳곳에 상시 노출하는 면책 고지. 임의로 축약하지 말 것. */
export const MEDICAL_DISCLAIMER =
  "ReBody가 제공하는 정보는 일반적인 건강 정보이며 의학적 진단·치료·처방을 대체하지 않습니다. " +
  "지병이 있거나 약을 복용 중이라면 시작 전에 의료진과 상의해 주세요.";

export const NUTRITION_ESTIMATE_DISCLAIMER =
  "AI 추정치는 실제 섭취량과 차이가 있을 수 있어요. 정확한 값이 필요하면 직접 수정해 주세요.";
