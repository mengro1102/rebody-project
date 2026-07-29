import { create } from "zustand";
import { DateTime } from "luxon";
import { supabase, invokeEdge } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import {
  DEFAULT_TIMEZONE,
  getPlansForRange,
  getTodayPlan,
  todayInTimezone,
  type TodayPlan,
} from "@/domain/FastingScheduler";
import {
  buildPresetDays,
  getPreset,
  shiftWallClock,
  type PresetKey,
} from "@/domain/presets";
import type {
  ScheduleCycleDayRow,
  ScheduleOverrideRow,
  SchedulePatternRow,
} from "@/types/database";
import { addDays } from "@/domain/cycle";

/** 시간대 변경 시 스케줄을 어떻게 다룰지. changeTimezone 주석 참조. */
export type TimezoneChangeMode = "local" | "keep_home";

interface NlParseResult {
  status: "applied" | "needs_clarification";
  confidence: number;
  summary?: string;
  follow_up_question?: string;
  applied?: number[];
  cycle_days?: ScheduleCycleDayRow[];
}

interface ScheduleState {
  pattern: SchedulePatternRow | null;
  cycleDays: ScheduleCycleDayRow[];
  overrides: ScheduleOverrideRow[];
  timezone: string;
  loading: boolean;
  error: string | null;

  load: (timezone?: string) => Promise<void>;
  createFromPreset: (
    key: PresetKey,
    anchorDate: string,
    timezone?: string,
    options?: { wakeTime?: string },
  ) => Promise<string>;
  refineWithText: (text: string) => Promise<NlParseResult>;
  updateCycleDay: (index: number, patch: Partial<ScheduleCycleDayRow>) => Promise<void>;
  changeTimezone: (nextTimezone: string, mode: TimezoneChangeMode) => Promise<void>;
  todayPlan: () => TodayPlan | null;
  weekPlans: (days?: number) => TodayPlan[];
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  pattern: null,
  cycleDays: [],
  overrides: [],
  timezone: DEFAULT_TIMEZONE,
  loading: false,
  error: null,

  load: async (timezone) => {
    set({ loading: true, error: null });
    try {
      const tz = timezone ?? get().timezone;

      const { data: pattern, error } = await supabase
        .from("schedule_patterns")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!pattern) {
        set({ pattern: null, cycleDays: [], overrides: [], timezone: tz });
        return;
      }

      const today = todayInTimezone(tz);

      const [{ data: days }, { data: overrides }] = await Promise.all([
        supabase
          .from("schedule_cycle_days")
          .select("*")
          .eq("pattern_id", pattern.id)
          .order("cycle_day_index"),
        // 과거 override는 대시보드에 필요 없다. 어제~+28일만 가져온다.
        supabase
          .from("schedule_overrides")
          .select("*")
          .eq("pattern_id", pattern.id)
          .gte("override_date", addDays(today, -1))
          .lte("override_date", addDays(today, 28)),
      ]);

      set({
        pattern: pattern as SchedulePatternRow,
        cycleDays: (days ?? []) as ScheduleCycleDayRow[],
        overrides: (overrides ?? []) as ScheduleOverrideRow[],
        timezone: tz,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "스케줄을 불러오지 못했습니다." });
    } finally {
      set({ loading: false });
    }
  },

  createFromPreset: async (key, anchorDate, timezone, options) => {
    const preset = getPreset(key);
    const presetDays = buildPresetDays(preset, options?.wakeTime);
    const tz = timezone ?? get().timezone;
    set({ loading: true, error: null });

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("로그인이 필요합니다.");

      // 활성 패턴은 사용자당 하나만 존재할 수 있다(부분 유니크 인덱스).
      // 새로 만들기 전에 기존 것을 비활성화한다.
      await supabase
        .from("schedule_patterns")
        .update({ is_active: false })
        .eq("user_id", userId)
        .eq("is_active", true);

      const { data: pattern, error } = await supabase
        .from("schedule_patterns")
        .insert({
          user_id: userId,
          pattern_type: preset.patternType,
          preset_key: preset.key,
          cycle_length_days: preset.cycleLengthDays,
          cycle_anchor_date: anchorDate,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw new Error(error.message);

      const rows = presetDays.map((d) => ({
        pattern_id: pattern.id,
        cycle_day_index: d.cycle_day_index,
        is_off_day: d.is_off_day,
        work_start: d.work_start,
        work_end: d.work_end,
        workout_start: d.workout_start,
        workout_end: d.workout_end,
        suggested_meal_window_start: d.suggested_meal_window_start,
        suggested_meal_window_end: d.suggested_meal_window_end,
        note: d.note ?? null,
      }));

      const { error: daysError } = await supabase.from("schedule_cycle_days").insert(rows);
      if (daysError) throw new Error(daysError.message);

      track("preset_selected", { preset: preset.key, cycle_length: preset.cycleLengthDays });

      await get().load(tz);
      return pattern.id as string;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "스케줄 생성에 실패했습니다.";
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ loading: false });
    }
  },

  /**
   * 프리셋 위에 자연어 보정을 얹는다.
   * confidence가 낮으면 서버가 DB를 건드리지 않고 되묻기만 한다 —
   * 스케줄을 잘못 잡으면 이후 타이머·푸시가 전부 어긋나므로 틀리느니 묻는 게 싸다.
   */
  refineWithText: async (text) => {
    const pattern = get().pattern;
    if (!pattern) throw new Error("먼저 프리셋을 선택해 주세요.");

    track("schedule_nl_submitted", { length: text.length });

    const result = await invokeEdge<NlParseResult>("parse-schedule-nl", {
      pattern_id: pattern.id,
      text,
    });

    if (result.status === "needs_clarification") {
      track("schedule_nl_clarification", { confidence: result.confidence });
      return result;
    }

    if (result.cycle_days) {
      set({ cycleDays: result.cycle_days });
    } else {
      await get().load();
    }
    return result;
  },

  updateCycleDay: async (index, patch) => {
    const pattern = get().pattern;
    if (!pattern) return;

    const { error } = await supabase
      .from("schedule_cycle_days")
      .update(patch)
      .eq("pattern_id", pattern.id)
      .eq("cycle_day_index", index);

    if (error) throw new Error(error.message);

    set({
      cycleDays: get().cycleDays.map((d) =>
        d.cycle_day_index === index ? { ...d, ...patch } : d,
      ),
    });
  },

  /**
   * 시간대 변경 — 출장·이주 대응.
   *
   * 스케줄 시각은 벽시계(time)로 저장돼 있고 절대시각 변환은 표시 계층에서만 일어난다.
   * 따라서 두 가지 선택이 가능하다:
   *
   *   local     — 시간대만 바꾼다. "아침 8시에 첫 끼"라는 규칙이 도착지 현지 시각으로 옮겨간다.
   *               현지 생활에 맞추는 쪽 (대부분의 출장자가 원하는 것).
   *   keep_home — 벽시계 시각을 오프셋 차이만큼 밀어, 한국에서 먹던 **절대 시각**을 유지한다.
   *               짧은 출장에서 생체리듬을 흔들지 않으려는 경우.
   *
   * 사이클 인덱스 계산에는 타임존을 절대 끌어들이지 않는다 — 여기서 섞으면 하루가 밀린다.
   */
  changeTimezone: async (nextTimezone, mode) => {
    const { pattern, cycleDays } = get();

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error("로그인이 필요합니다.");

    const prevTimezone = get().timezone;

    if (mode === "keep_home" && pattern && cycleDays.length > 0) {
      const deltaMinutes = offsetDeltaMinutes(prevTimezone, nextTimezone);
      if (deltaMinutes !== 0) {
        const shifted = cycleDays.map((d) => ({
          ...d,
          work_start: shiftOrNull(d.work_start, deltaMinutes),
          work_end: shiftOrNull(d.work_end, deltaMinutes),
          workout_start: shiftOrNull(d.workout_start, deltaMinutes),
          workout_end: shiftOrNull(d.workout_end, deltaMinutes),
          suggested_meal_window_start: shiftOrNull(d.suggested_meal_window_start, deltaMinutes),
          suggested_meal_window_end: shiftOrNull(d.suggested_meal_window_end, deltaMinutes),
        }));

        // 행 수가 최대 28개라 순차 업데이트로 충분하다.
        for (const day of shifted) {
          const { error } = await supabase
            .from("schedule_cycle_days")
            .update({
              work_start: day.work_start,
              work_end: day.work_end,
              workout_start: day.workout_start,
              workout_end: day.workout_end,
              suggested_meal_window_start: day.suggested_meal_window_start,
              suggested_meal_window_end: day.suggested_meal_window_end,
            })
            .eq("id", day.id);
          if (error) throw new Error(error.message);
        }
        set({ cycleDays: shifted });
      }
    }

    const { error } = await supabase
      .from("users")
      .update({ timezone: nextTimezone })
      .eq("id", userId);
    if (error) throw new Error(error.message);

    track("timezone_changed", { mode, from: prevTimezone, to: nextTimezone });
    await get().load(nextTimezone);
  },

  todayPlan: () => {
    const { pattern, cycleDays, overrides, timezone } = get();
    if (!pattern) return null;
    return getTodayPlan({ pattern, cycleDays, overrides, timezone });
  },

  weekPlans: (days = 7) => {
    const { pattern, cycleDays, overrides, timezone } = get();
    if (!pattern) return [];
    return getPlansForRange(todayInTimezone(timezone), days, {
      pattern,
      cycleDays,
      overrides,
      timezone,
    });
  },
}));

/**
 * 두 타임존의 현재 오프셋 차이(분). now 기준으로 계산하므로 DST가 자동 반영된다.
 * "지금 이동한다"는 전제라 이 근사가 맞다 — 미래 시점의 DST 전환까지 따지지 않는다.
 */
function offsetDeltaMinutes(fromTz: string, toTz: string): number {
  const now = DateTime.now();
  const from = now.setZone(fromTz).offset;
  const to = now.setZone(toTz).offset;
  return to - from;
}

function shiftOrNull(time: string | null, deltaMinutes: number): string | null {
  return time === null ? null : shiftWallClock(time, deltaMinutes);
}
