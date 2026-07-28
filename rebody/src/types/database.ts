// DB 스키마 타입.
// supabase gen types typescript --linked > src/types/database.gen.ts 로 자동 생성할 수도 있지만,
// MVP 단계에선 스키마가 자주 바뀌므로 손으로 관리한다. 마이그레이션과 함께 수정할 것.

export type PatternType = "fixed_weekly" | "rotating_cycle" | "irregular";
export type FastingStatus = "scheduled" | "in_progress" | "completed" | "broken" | "skipped";
export type NutritionSource = "mfds_db" | "ai_estimate" | "user_manual";
export type PlanType = "free" | "pro";
export type NotificationCategory = "functional" | "nudge" | "marketing";
export type ConsentKind =
  | "terms_of_service"
  | "privacy_policy"
  | "sensitive_health_data"
  | "overseas_transfer"
  | "marketing";

export interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  timezone: string;
  birth_year: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  is_premium: boolean;
  fcm_token: string | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsentRow {
  id: string;
  user_id: string;
  kind: ConsentKind;
  granted: boolean;
  policy_version: string;
  granted_at: string;
}

export interface SchedulePatternRow {
  id: string;
  user_id: string;
  pattern_type: PatternType;
  preset_key: string | null;
  cycle_length_days: number;
  cycle_anchor_date: string;
  raw_description: string | null;
  ai_confidence: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScheduleCycleDayRow {
  id: string;
  pattern_id: string;
  cycle_day_index: number;
  is_off_day: boolean;
  work_start: string | null;
  work_end: string | null;
  workout_start: string | null;
  workout_end: string | null;
  suggested_meal_window_start: string | null;
  suggested_meal_window_end: string | null;
  note: string | null;
}

export interface ScheduleOverrideRow {
  id: string;
  pattern_id: string;
  override_date: string;
  is_off_day: boolean;
  work_start: string | null;
  work_end: string | null;
  workout_start: string | null;
  workout_end: string | null;
  suggested_meal_window_start: string | null;
  suggested_meal_window_end: string | null;
  reason: string | null;
  created_at: string;
}

export interface FastingLogRow {
  id: string;
  user_id: string;
  local_date: string;
  target_start: string;
  target_end: string;
  actual_start: string | null;
  actual_end: string | null;
  status: FastingStatus;
  created_at: string;
  updated_at: string;
}

export interface MealLogRow {
  id: string;
  user_id: string;
  photo_url: string | null;
  meal_time: string;
  local_date: string;
  food_name: string;
  portion_g: number | null;
  total_calories: number | null;
  total_carbs: number | null;
  total_protein: number | null;
  total_fat: number | null;
  total_sodium_mg: number | null;
  total_fiber_g: number | null;
  total_sugar_g: number | null;
  total_saturated_fat_g: number | null;
  source: NutritionSource;
  ai_confidence: number | null;
  is_within_fasting_window: boolean;
  created_at: string;
}

export interface WeeklyFeedbackRow {
  id: string;
  user_id: string;
  week_start: string;
  summary_text: string;
  suggested_adjustment_json: {
    kind: "shift_meal_window";
    shift_minutes: number;
    reason?: string | null;
  } | null;
  applied_at: string | null;
  created_at: string;
}

export interface NotificationPreferencesRow {
  user_id: string;
  functional: boolean;
  nudge: boolean;
  marketing: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  updated_at: string;
}

export interface UserSubscriptionRow {
  user_id: string;
  plan_type: PlanType;
  ai_scan_count_today: number;
  last_scan_date: string | null;
  rc_app_user_id: string | null;
  rc_entitlement: string | null;
  expires_at: string | null;
  updated_at: string;
}
