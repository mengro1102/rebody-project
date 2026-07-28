import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import type { WeeklyFeedbackRow } from "@/types/database";

interface FeedbackState {
  latest: WeeklyFeedbackRow | null;
  history: WeeklyFeedbackRow[];
  loading: boolean;
  applying: boolean;

  load: () => Promise<void>;
  /** "적용하기" 1탭. 서버 함수가 schedule_overrides를 앞으로 7일치 업서트한다. */
  applyAdjustment: (feedbackId: string) => Promise<number>;
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  latest: null,
  history: [],
  loading: false,
  applying: false,

  load: async () => {
    set({ loading: true });
    try {
      const { data } = await supabase
        .from("weekly_feedback")
        .select("*")
        .order("week_start", { ascending: false })
        .limit(12);

      const rows = (data ?? []) as WeeklyFeedbackRow[];
      set({ latest: rows[0] ?? null, history: rows });

      if (rows[0]) track("feedback_viewed", { week_start: rows[0].week_start });
    } finally {
      set({ loading: false });
    }
  },

  applyAdjustment: async (feedbackId) => {
    set({ applying: true });
    try {
      // 클라이언트가 schedule_overrides를 직접 쓰지 않는다 —
      // AI가 제안하지 않은 값이 들어갈 수 있기 때문. 서버 함수가 제안값만 반영한다.
      const { data, error } = await supabase.rpc("apply_feedback_adjustment", {
        p_feedback_id: feedbackId,
        p_days_ahead: 7,
      });

      if (error) throw new Error(error.message);

      const applied = Number(data ?? 0);
      track("feedback_applied", { days: applied });

      set({
        latest: get().latest?.id === feedbackId
          ? { ...get().latest!, applied_at: new Date().toISOString() }
          : get().latest,
        history: get().history.map((f) =>
          f.id === feedbackId ? { ...f, applied_at: new Date().toISOString() } : f,
        ),
      });

      return applied;
    } finally {
      set({ applying: false });
    }
  },
}));
