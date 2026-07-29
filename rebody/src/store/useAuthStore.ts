import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { ConsentKind, ConsentRow, UserRow } from "@/types/database";

// 동의 문구를 바꿀 때마다 올린다. 이전 버전 동의자에게 재동의를 받는 기준이 된다.
export const POLICY_VERSION = "2026-07-27";

/**
 * 이 4종이 없으면 앱을 쓸 수 없다.
 * 민감정보(건강)와 국외이전은 개인정보보호법상 이용약관과 **분리해서** 받아야 한다
 * (제23조 / 제28조의8). 마케팅은 선택이므로 여기 넣지 않는다.
 */
export const REQUIRED_CONSENTS: ConsentKind[] = [
  "terms_of_service",
  "privacy_policy",
  "sensitive_health_data",
  "overseas_transfer",
];

interface AuthState {
  session: Session | null;
  profile: UserRow | null;
  consents: ConsentRow[] | null;
  loading: boolean;
  initialized: boolean;

  init: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  loadConsents: () => Promise<void>;
  updateProfile: (patch: Partial<UserRow>) => Promise<void>;
  grantConsents: (kinds: ConsentKind[], granted?: boolean) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  consents: null,
  loading: false,
  initialized: false,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    set({ session: data.session });
    if (data.session) {
      await Promise.all([get().refreshProfile(), get().loadConsents()]);
    }
    // 세션·프로필·동의를 모두 읽은 뒤에 initialized를 올린다.
    // 먼저 올리면 게이트가 "동의 없음"으로 오판해 온보딩을 다시 띄운다.
    set({ initialized: true });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session });
      if (session) {
        void get().refreshProfile();
        void get().loadConsents();
      } else {
        set({ profile: null, consents: null });
      }
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

  /** 현재 정책 버전의 동의 이력을 읽어온다. append-only라 같은 kind가 여러 건일 수 있다. */
  loadConsents: async () => {
    const userId = get().session?.user.id;
    if (!userId) return;
    const { data, error } = await supabase
      .from("consents")
      .select("*")
      .eq("user_id", userId)
      .eq("policy_version", POLICY_VERSION)
      .order("granted_at", { ascending: true });
    if (error) {
      console.warn("[auth] 동의 이력 조회 실패:", error.message);
      return;
    }
    set({ consents: (data ?? []) as ConsentRow[] });
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
    await get().loadConsents();
  },

  deleteAccount: async () => {
    // Play Console 필수 요건 — 앱 내 계정 삭제 경로.
    const { error } = await supabase.rpc("delete_my_account");
    if (error) throw new Error(error.message);
    await supabase.auth.signOut();
    set({ session: null, profile: null, consents: null });
  },
}));

/**
 * 필수 동의가 모두 유효한지. kind별 **최신** 행만 본다 —
 * consents는 append-only라 철회(granted=false) 후 재동의한 이력이 함께 쌓인다.
 */
export function hasRequiredConsents(consents: ConsentRow[] | null): boolean {
  if (!consents) return false;
  const latest = new Map<ConsentKind, boolean>();
  for (const row of consents) latest.set(row.kind, row.granted);
  return REQUIRED_CONSENTS.every((kind) => latest.get(kind) === true);
}

/** 안전성 온보딩(생년·키·몸무게)이 채워졌는지. 단식 기능 게이트의 입력값이다. */
export function hasSafetyProfile(profile: UserRow | null): boolean {
  return Boolean(profile?.birth_year && profile?.height_cm && profile?.weight_kg);
}

/** Supabase 인증 에러를 사용자에게 보여줄 한국어로 바꾼다. */
function mapAuthError(message: string): string {
  if (message.includes("Invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (message.includes("User already registered")) return "이미 가입된 이메일입니다.";
  if (message.includes("Password should be")) return "비밀번호는 6자 이상이어야 합니다.";
  if (message.includes("Email not confirmed")) return "이메일 인증을 완료해 주세요.";
  return "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}
