import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { todayInTimezone, type Interval } from "@/domain/FastingScheduler";
import { clampFastingHours } from "@/domain/safety";
import type { FastingLogRow } from "@/types/database";

interface FastingState {
  current: FastingLogRow | null;
  history: FastingLogRow[];
  loading: boolean;

  load: (timezone: string) => Promise<void>;
  /** 오늘 계획된 단식 구간을 fasting_logs에 예약 등록한다. 이미 있으면 갱신. */
  scheduleToday: (window: Interval, timezone: string) => Promise<void>;
  start: () => Promise<void>;
  complete: () => Promise<void>;
  breakFast: () => Promise<void>;
}

export const useFastingStore = create<FastingState>((set, get) => ({
  current: null,
  history: [],
  loading: false,

  load: async (timezone) => {
    set({ loading: true });
    try {
      const today = todayInTimezone(timezone);

      const [{ data: current }, { data: history }] = await Promise.all([
        supabase
          .from("fasting_logs")
          .select("*")
          .eq("local_date", today)
          .maybeSingle(),
        supabase
          .from("fasting_logs")
          .select("*")
          .order("local_date", { ascending: false })
          .limit(30),
      ]);

      set({
        current: (current as FastingLogRow | null) ?? null,
        history: (history ?? []) as FastingLogRow[],
      });
    } finally {
      set({ loading: false });
    }
  },

  scheduleToday: async (window, timezone) => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;

    const hours = (window.end.getTime() - window.start.getTime()) / 3_600_000;
    const { hours: safeHours, clamped } = clampFastingHours(hours);

    // 24시간 제약은 DB에도 걸려 있다(fasting_target_max_24h). 여기서 먼저 자르는 건
    // 사용자가 저장 실패 에러를 보지 않게 하기 위함.
    const targetEnd = clamped
      ? new Date(window.start.getTime() + safeHours * 3_600_000)
      : window.end;

    const { data, error } = await supabase
      .from("fasting_logs")
      .upsert(
        {
          user_id: userId,
          local_date: todayInTimezone(timezone),
          target_start: window.start.toISOString(),
          target_end: targetEnd.toISOString(),
          status: "scheduled",
        },
        { onConflict: "user_id,local_date" },
      )
      .select()
      .single();

    if (error) {
      console.warn("[fasting] 예약 실패:", error.message);
      return;
    }
    set({ current: data as FastingLogRow });
  },

  start: async () => {
    const current = get().current;
    if (!current) return;

    const { data, error } = await supabase
      .from("fasting_logs")
      .update({ status: "in_progress", actual_start: new Date().toISOString() })
      .eq("id", current.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    set({ current: data as FastingLogRow });
    track("fasting_started");
  },

  complete: async () => {
    const current = get().current;
    if (!current) return;

    const { data, error } = await supabase
      .from("fasting_logs")
      .update({ status: "completed", actual_end: new Date().toISOString() })
      .eq("id", current.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    set({ current: data as FastingLogRow });

    const hours = current.actual_start
      ? (Date.now() - Date.parse(current.actual_start)) / 3_600_000
      : 0;
    track("fasting_completed", { hours: Math.round(hours * 10) / 10 });
  },

  /**
   * 중도 종료. 'broken'은 실패가 아니라 데이터일 뿐이다 —
   * UI에서 부정적 표현("실패", "포기")을 쓰지 않는다. 죄책감 유발은 이탈을 부른다.
   */
  breakFast: async () => {
    const current = get().current;
    if (!current) return;

    const { data, error } = await supabase
      .from("fasting_logs")
      .update({ status: "broken", actual_end: new Date().toISOString() })
      .eq("id", current.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    set({ current: data as FastingLogRow });

    const hours = current.actual_start
      ? (Date.now() - Date.parse(current.actual_start)) / 3_600_000
      : 0;
    track("fasting_broken", { hours: Math.round(hours * 10) / 10 });
  },
}));
