import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { PlanType, UserSubscriptionRow } from "@/types/database";

interface SubscriptionState {
  subscription: UserSubscriptionRow | null;
  loading: boolean;

  load: () => Promise<void>;
  isPro: () => boolean;
  scansRemaining: (todayLocalDate: string, freeLimit?: number) => number;
}

export const FREE_DAILY_SCANS = 3;

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  subscription: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const { data } = await supabase.from("user_subscriptions").select("*").maybeSingle();
      set({ subscription: (data as UserSubscriptionRow | null) ?? null });
    } finally {
      set({ loading: false });
    }
  },

  isPro: () => {
    const s = get().subscription;
    if (!s || s.plan_type !== "pro") return false;
    return !s.expires_at || Date.parse(s.expires_at) > Date.now();
  },

  /**
   * 남은 스캔 횟수 — 표시용이다.
   * 실제 강제는 서버의 consume_scan_quota()가 한다. 이 값이 틀려도 우회는 불가능하다.
   */
  scansRemaining: (todayLocalDate, freeLimit = FREE_DAILY_SCANS) => {
    if (get().isPro()) return Infinity;
    const s = get().subscription;
    if (!s) return freeLimit;
    const used = s.last_scan_date === todayLocalDate ? s.ai_scan_count_today : 0;
    return Math.max(0, freeLimit - used);
  },
}));

export type { PlanType };
