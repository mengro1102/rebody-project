import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { ConsentKind, UserRow } from "@/types/database";

// 동의 문구를 바꿀 때마다 올린다. 이전 버전 동의자에게 재동의를 받는 기준이 된다.
export const POLICY_VERSION = "2026-07-27";

interface AuthState {
  session: Session | null;
  profile: UserRow | null;
  loading: boolean;
  initialized: boolean;

  init: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: Partial<UserRow>) => Promise<void>;
  grantConsents: (kinds: ConsentKind[], granted?: boolean) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: false,
  initialized: false,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, initialized: true });
    if (data.session) await get().refreshProfile();

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session });
      if (session) void get().refreshProfile();
      else set({ profile: null });
    });
  },

  signInWithEmail: async (email, password) => {
    set({ loading: true });
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(mapAuthError(error.message));
      await get().refreshProfile();
    } finally {
      set({ loading: false });
    }
  },

  signUpWithEmail: async (email, password) => {
    set({ loading: true });
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw new Error(mapAuthError(error.message));
      // users / user_subscriptions / notification_preferences 행은
      // handle_new_user 트리거가 만든다. 클라이언트에서 insert하지 않는다.
      await get().refreshProfile();
    } finally {
      set({ loading: false });
    }
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },

  refreshProfile: async () => {
    const userId = get().session?.user.id;
    if (!userId) return;
    const { data, error } = await supabase.from("users").select("*").eq("id", userId).maybeSingle();
    if (error) {
      console.warn("[auth] 프로필 조회 실패:", error.message);
      return;
    }
    set({ profile: data as UserRow | null });
  },

  updateProfile: async (patch) => {
    const userId = get().session?.user.id;
    if (!userId) throw new Error("로그인이 필요합니다.");
    const { data, error } = await supabase
      .from("users")
      .update(patch)
      .eq("id", userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    set({ profile: data as UserRow });
  },

  /**
   * 동의 기록. consents는 append-only이므로 매번 새 행이 쌓인다 (법정 증빙).
   * 민감정보(건강)·국외이전 동의는 이용약관과 반드시 분리해서 받아야 한다.
   */
  grantConsents: async (kinds, granted = true) => {
    const userId = get().session?.user.id;
    if (!userId) throw new Error("로그인이 필요합니다.");

    const rows = kinds.map((kind) => ({
      user_id: userId,
      kind,
      granted,
      policy_version: POLICY_VERSION,
    }));

    const { error } = await supabase.from("consents").insert(rows);
    if (error) throw new Error(error.message);
  },

  deleteAccount: async () => {
    // Play Console 필수 요건 — 앱 내 계정 삭제 경로.
    const { error } = await supabase.rpc("delete_my_account");
    if (error) throw new Error(error.message);
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },
}));

/** Supabase 인증 에러를 사용자에게 보여줄 한국어로 바꾼다. */
function mapAuthError(message: string): string {
  if (message.includes("Invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (message.includes("User already registered")) return "이미 가입된 이메일입니다.";
  if (message.includes("Password should be")) return "비밀번호는 6자 이상이어야 합니다.";
  if (message.includes("Email not confirmed")) return "이메일 인증을 완료해 주세요.";
  return "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}
