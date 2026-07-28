-- ReBody — Phase 1 core schema
--
-- 설계 원칙 (docs/00_ANALYSIS.md §2-7 참조):
--   * 스케줄의 "시각"은 timestamptz가 아니라 time(벽시계)로 저장한다.
--   * 스케줄의 "날짜"는 date(civil date)로 저장한다.
--   * 절대시각(instant) 변환은 앱 레이어에서 users.timezone 기준으로만 수행한다.
--   => 교대근무 자정 넘김 / 서버-클라이언트 TZ 불일치로 인한 하루 밀림 버그를 원천 차단.
--
--   실제 발생한 사건(단식 시작/종료 등)은 반대로 timestamptz로 저장한다. 이건 순간이지 벽시계가 아니다.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- enums
-- ─────────────────────────────────────────────────────────────
create type pattern_type   as enum ('fixed_weekly', 'rotating_cycle', 'irregular');
create type fasting_status as enum ('scheduled', 'in_progress', 'completed', 'broken', 'skipped');
create type nutrition_source as enum ('mfds_db', 'ai_estimate', 'user_manual');
create type plan_type      as enum ('free', 'pro');
create type notification_category as enum ('functional', 'nudge', 'marketing');
create type consent_kind   as enum (
  'terms_of_service',
  'privacy_policy',
  'sensitive_health_data',   -- 개인정보보호법 제23조: 민감정보 별도 동의
  'overseas_transfer',       -- 제28조의8: 국외이전 별도 동의 (Gemini API)
  'marketing'                -- 선택
);

-- ─────────────────────────────────────────────────────────────
-- users — auth.users를 확장하는 프로필. id는 auth.users.id와 동일.
-- ─────────────────────────────────────────────────────────────
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  timezone      text not null default 'Asia/Seoul',
  birth_year    int,                       -- 만 18세 미만 차단용 (생년월일 전체는 수집하지 않음)
  height_cm     numeric(5,1),
  weight_kg     numeric(5,1),
  is_premium    boolean not null default false,
  fcm_token     text,
  onboarded_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint users_height_sane check (height_cm is null or (height_cm between 100 and 250)),
  constraint users_weight_sane check (weight_kg is null or (weight_kg between 25 and 350))
);

comment on column public.users.birth_year is
  '연령 게이트(만 18세 이상) 전용. 생년월일 전체를 수집하지 않아 수집 최소화 원칙을 만족.';

-- ─────────────────────────────────────────────────────────────
-- consents — 동의 이력. 법정 증빙이므로 update 금지, append-only.
-- ─────────────────────────────────────────────────────────────
create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  kind          consent_kind not null,
  granted       boolean not null,
  policy_version text not null,            -- 예: '2026-07-27'
  granted_at    timestamptz not null default now(),
  user_agent    text
);

create index consents_user_kind_idx on public.consents (user_id, kind, granted_at desc);

comment on table public.consents is
  '동의 이력 append-only. 철회는 granted=false 행을 새로 추가하는 방식. 최신 상태는 v_current_consents 뷰 참조.';

create view public.v_current_consents as
select distinct on (user_id, kind)
  user_id, kind, granted, policy_version, granted_at
from public.consents
order by user_id, kind, granted_at desc;

-- ─────────────────────────────────────────────────────────────
-- schedule_patterns — 사용자의 근무 사이클 정의
-- ─────────────────────────────────────────────────────────────
create table public.schedule_patterns (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  pattern_type      pattern_type not null,
  preset_key        text,                  -- 'day_fixed' | 'night_fixed' | 'two_shift' | 'three_shift' | null(custom)
  cycle_length_days int  not null,
  cycle_anchor_date date not null,         -- civil date. cycle_day_index 0에 해당하는 날.
  raw_description   text,                  -- 사용자가 입력한 자유 텍스트 원문
  ai_confidence     numeric(3,2),          -- 0.00 ~ 1.00
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint cycle_length_range check (cycle_length_days between 1 and 28),
  constraint ai_confidence_range check (ai_confidence is null or (ai_confidence between 0 and 1))
);

-- 사용자당 활성 패턴은 하나만. "오늘 스케줄"이 비결정적이 되는 걸 막는다.
create unique index schedule_patterns_one_active_per_user
  on public.schedule_patterns (user_id)
  where is_active;

-- ─────────────────────────────────────────────────────────────
-- schedule_cycle_days — 사이클 내 각 날짜의 기본 스케줄 (벽시계)
-- ─────────────────────────────────────────────────────────────
create table public.schedule_cycle_days (
  id                          uuid primary key default gen_random_uuid(),
  pattern_id                  uuid not null references public.schedule_patterns(id) on delete cascade,
  cycle_day_index             int  not null,      -- 0 .. cycle_length_days-1
  is_off_day                  boolean not null default false,
  work_start                  time,
  work_end                    time,               -- work_end <= work_start 이면 자정 넘김
  workout_start               time,
  workout_end                 time,
  suggested_meal_window_start time,
  suggested_meal_window_end   time,               -- 동일하게 자정 넘김 허용
  note                        text,

  constraint cycle_day_index_nonneg check (cycle_day_index >= 0),
  unique (pattern_id, cycle_day_index)
);

comment on column public.schedule_cycle_days.work_end is
  '벽시계 시각. work_end <= work_start 이면 익일로 넘어가는 야간 근무로 해석한다.';

-- ─────────────────────────────────────────────────────────────
-- schedule_overrides — 특정 날짜 예외. 사이클보다 우선한다.
-- ─────────────────────────────────────────────────────────────
create table public.schedule_overrides (
  id                          uuid primary key default gen_random_uuid(),
  pattern_id                  uuid not null references public.schedule_patterns(id) on delete cascade,
  override_date               date not null,
  is_off_day                  boolean not null default false,
  work_start                  time,
  work_end                    time,
  workout_start               time,
  workout_end                 time,
  suggested_meal_window_start time,
  suggested_meal_window_end   time,
  reason                      text,               -- 'ai_suggestion' | 'user_edit' | ...
  created_at                  timestamptz not null default now(),

  -- 원문 스키마 누락분. 이게 없으면 같은 날짜 중복 override로 스케줄이 비결정적이 된다.
  unique (pattern_id, override_date)
);

create index schedule_overrides_lookup_idx
  on public.schedule_overrides (pattern_id, override_date);

-- ─────────────────────────────────────────────────────────────
-- fasting_logs — 단식 세션. 여긴 실제 사건이므로 timestamptz.
-- ─────────────────────────────────────────────────────────────
create table public.fasting_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  local_date    date not null,             -- 사용자 로컬 기준 "이 단식이 속한 날". 집계 키.
  target_start  timestamptz not null,
  target_end    timestamptz not null,
  actual_start  timestamptz,
  actual_end    timestamptz,
  status        fasting_status not null default 'scheduled',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint fasting_target_order check (target_end > target_start),
  -- 안전장치: 24시간 초과 단식 타깃 금지 (docs/00_ANALYSIS.md §2-4)
  constraint fasting_target_max_24h check (target_end - target_start <= interval '24 hours'),
  constraint fasting_actual_order check (actual_end is null or actual_start is null or actual_end >= actual_start)
);

create unique index fasting_logs_one_per_local_date
  on public.fasting_logs (user_id, local_date);
create index fasting_logs_user_time_idx
  on public.fasting_logs (user_id, target_start desc);

-- ─────────────────────────────────────────────────────────────
-- meal_logs
-- ─────────────────────────────────────────────────────────────
create table public.meal_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  photo_url     text,                      -- storage 경로. 원본 URL이 아니라 object path.
  meal_time     timestamptz not null default now(),
  local_date    date not null,
  food_name     text not null,
  portion_g     numeric(7,1),
  total_calories numeric(7,1),
  total_carbs   numeric(7,1),
  total_protein numeric(7,1),
  total_fat     numeric(7,1),
  total_sodium_mg numeric(8,1),
  total_fiber_g numeric(6,1),
  source        nutrition_source not null,
  ai_confidence numeric(3,2),
  is_within_fasting_window boolean not null default false,
  created_at    timestamptz not null default now(),

  constraint meal_macros_nonneg check (
    coalesce(total_calories,0) >= 0 and coalesce(total_carbs,0) >= 0 and
    coalesce(total_protein,0) >= 0 and coalesce(total_fat,0) >= 0
  )
);

create index meal_logs_user_time_idx on public.meal_logs (user_id, meal_time desc);
create index meal_logs_user_date_idx on public.meal_logs (user_id, local_date);

-- ─────────────────────────────────────────────────────────────
-- food_nutrition_cache — Gemini/MFDS 호출 절감의 핵심
--
-- 원문은 food_name_normalized 단일 PK였으나, 그러면 AI 추정치가 공식 데이터를
-- 덮어쓴다. (food_name_normalized, source) 복합키로 분리하고 조회 시 mfds_db를 우선한다.
-- ─────────────────────────────────────────────────────────────
create table public.food_nutrition_cache (
  food_name_normalized text not null,
  source        nutrition_source not null,
  display_name  text not null,
  serving_size_g numeric(7,1) not null default 100,   -- 아래 영양소는 이 중량 기준
  calories      numeric(7,1),
  carbs_g       numeric(7,1),
  protein_g     numeric(7,1),
  fat_g         numeric(7,1),
  sodium_mg     numeric(8,1),
  fiber_g       numeric(6,1),
  mfds_food_code text,
  hit_count     int not null default 0,
  matched_at    timestamptz not null default now(),

  primary key (food_name_normalized, source)
);

create index food_cache_hits_idx on public.food_nutrition_cache (hit_count desc);

comment on table public.food_nutrition_cache is
  '전역 캐시(사용자 무관). 개인정보 없음 → 전체 read 허용, write는 service_role만.';

-- ─────────────────────────────────────────────────────────────
-- user_subscriptions — 플랜 + 스캔 쿼터
-- ─────────────────────────────────────────────────────────────
create table public.user_subscriptions (
  user_id            uuid primary key references public.users(id) on delete cascade,
  plan_type          plan_type not null default 'free',
  ai_scan_count_today int not null default 0,
  last_scan_date     date,
  rc_app_user_id     text,                 -- RevenueCat app user id
  rc_entitlement     text,
  expires_at         timestamptz,
  updated_at         timestamptz not null default now(),

  constraint scan_count_nonneg check (ai_scan_count_today >= 0)
);

-- ─────────────────────────────────────────────────────────────
-- weekly_feedback — Phase 4
-- ─────────────────────────────────────────────────────────────
create table public.weekly_feedback (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  week_start    date not null,             -- 월요일 기준
  summary_text  text not null,
  suggested_adjustment_json jsonb,
  applied_at    timestamptz,
  created_at    timestamptz not null default now(),

  unique (user_id, week_start)
);

-- ─────────────────────────────────────────────────────────────
-- 알림
-- ─────────────────────────────────────────────────────────────
create table public.notification_preferences (
  user_id    uuid primary key references public.users(id) on delete cascade,
  functional boolean not null default true,   -- 단식 시작/종료 알림
  nudge      boolean not null default true,   -- 미기록 넛지
  marketing  boolean not null default false,  -- 기본 off (동의 기반)
  quiet_hours_start time,                     -- 야간 근무자 배려: 수면 시간대 무음
  quiet_hours_end   time,
  updated_at timestamptz not null default now()
);

create table public.push_notification_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  notification_type text not null,            -- 'fasting_start' | 'fasting_end_soon' | 'unlogged_meal' | 'weekly_feedback_ready'
  category          notification_category not null default 'functional',
  dedup_key         text,                     -- 동일 이벤트 중복 발송 방지
  sent_at           timestamptz not null default now(),
  delivered         boolean not null default false,
  opened            boolean not null default false,
  opened_at         timestamptz,
  error             text
);

create unique index push_logs_dedup_idx
  on public.push_notification_logs (user_id, dedup_key)
  where dedup_key is not null;
create index push_logs_user_idx on public.push_notification_logs (user_id, sent_at desc);

-- ─────────────────────────────────────────────────────────────
-- system_heartbeat — Supabase 무료 티어 슬립 방지
--
-- 원문은 no-op Edge Function이었으나, no-op은 "DB 활동"으로 집계되지 않을 수 있어
-- 일시정지를 확실히 막지 못한다. 실제 write를 발생시킨다.
-- ─────────────────────────────────────────────────────────────
create table public.system_heartbeat (
  id         int primary key default 1,
  pinged_at  timestamptz not null default now(),
  ping_count bigint not null default 0,
  constraint singleton check (id = 1)
);

insert into public.system_heartbeat (id) values (1) on conflict do nothing;

-- ─────────────────────────────────────────────────────────────
-- updated_at 자동 갱신
-- ─────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_touch              before update on public.users              for each row execute function public.touch_updated_at();
create trigger schedule_patterns_touch  before update on public.schedule_patterns  for each row execute function public.touch_updated_at();
create trigger fasting_logs_touch       before update on public.fasting_logs       for each row execute function public.touch_updated_at();
create trigger user_subscriptions_touch before update on public.user_subscriptions for each row execute function public.touch_updated_at();
create trigger notification_prefs_touch before update on public.notification_preferences for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 신규 가입 시 프로필/구독/알림설정 자동 생성
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
    on conflict (id) do nothing;
  insert into public.user_subscriptions (user_id) values (new.id)
    on conflict (user_id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
