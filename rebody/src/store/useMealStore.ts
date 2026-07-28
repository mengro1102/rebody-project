import { create } from "zustand";
import { supabase, invokeEdge, EdgeFunctionError } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { todayInTimezone } from "@/domain/FastingScheduler";
import { isWithinFastingWindow, type ScannedFood } from "@/domain/nutrition";
import type { MealLogRow } from "@/types/database";

interface ScanResponse {
  items: ScannedFood[];
  quota: { remaining: number; plan: "free" | "pro"; free_daily_limit: number };
  has_estimate: boolean;
}

interface MealState {
  todayMeals: MealLogRow[];
  scanning: boolean;
  scanResult: ScannedFood[] | null;
  quotaRemaining: number | null;
  loading: boolean;

  loadToday: (timezone: string) => Promise<void>;
  scan: (imageBase64: string, timezone: string) => Promise<ScanResponse>;
  clearScanResult: () => void;
  saveMeals: (
    foods: ScannedFood[],
    opts: {
      timezone: string;
      photoPath?: string | null;
      fastingWindow?: { start: Date; end: Date } | null;
      mealTime?: Date;
    },
  ) => Promise<void>;
  deleteMeal: (id: string) => Promise<void>;
}

export const useMealStore = create<MealState>((set, get) => ({
  todayMeals: [],
  scanning: false,
  scanResult: null,
  quotaRemaining: null,
  loading: false,

  loadToday: async (timezone) => {
    set({ loading: true });
    try {
      const { data } = await supabase
        .from("meal_logs")
        .select("*")
        .eq("local_date", todayInTimezone(timezone))
        .order("meal_time", { ascending: false });
      set({ todayMeals: (data ?? []) as MealLogRow[] });
    } finally {
      set({ loading: false });
    }
  },

  scan: async (imageBase64, timezone) => {
    set({ scanning: true, scanResult: null });
    track("food_scan_attempt");

    try {
      const res = await invokeEdge<ScanResponse>("analyze-food-image", {
        image_base64: imageBase64,
        mime_type: "image/jpeg",
        // 쿼터 리셋 기준일. 서버가 UTC ±1일로 클램프하므로 시계 조작으로는 못 늘린다.
        local_date: todayInTimezone(timezone),
      });

      set({ scanResult: res.items, quotaRemaining: res.quota.remaining });
      track("food_scan_success", {
        item_count: res.items.length,
        has_estimate: res.has_estimate,
        cache_hits: res.items.filter((i) => i.cache_hit).length,
      });
      return res;
    } catch (e) {
      if (e instanceof EdgeFunctionError && e.code === "quota_exceeded") {
        set({ quotaRemaining: 0 });
        track("food_scan_quota_exceeded");
      } else {
        track("food_scan_failed", {
          code: e instanceof EdgeFunctionError ? e.code : "unknown",
        });
      }
      throw e;
    } finally {
      set({ scanning: false });
    }
  },

  clearScanResult: () => set({ scanResult: null }),

  saveMeals: async (foods, opts) => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error("로그인이 필요합니다.");

    const mealTime = opts.mealTime ?? new Date();
    const withinFasting = isWithinFastingWindow(mealTime, opts.fastingWindow ?? null);

    const rows = foods.map((f) => ({
      user_id: userId,
      photo_url: opts.photoPath ?? null,
      meal_time: mealTime.toISOString(),
      local_date: todayInTimezone(opts.timezone),
      food_name: f.display_name || f.food_name,
      portion_g: f.portion_g,
      total_calories: f.calories,
      total_carbs: f.carbs_g,
      total_protein: f.protein_g,
      total_fat: f.fat_g,
      total_sodium_mg: f.sodium_mg,
      total_fiber_g: f.fiber_g,
      total_sugar_g: f.sugar_g,
      total_saturated_fat_g: f.saturated_fat_g,
      source: f.source,
      ai_confidence: f.confidence,
      is_within_fasting_window: withinFasting,
    }));

    const { error } = await supabase.from("meal_logs").insert(rows);
    if (error) throw new Error(error.message);

    track("meal_logged", {
      item_count: rows.length,
      within_fasting: withinFasting,
      source: foods[0]?.source ?? "unknown",
    });

    set({ scanResult: null });
    await get().loadToday(opts.timezone);
  },

  deleteMeal: async (id) => {
    const { error } = await supabase.from("meal_logs").delete().eq("id", id);
    if (error) throw new Error(error.message);
    set({ todayMeals: get().todayMeals.filter((m) => m.id !== id) });
  },
}));
