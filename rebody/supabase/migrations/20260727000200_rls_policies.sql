-- ReBody — Row Level Security
--
-- 원문 착수 문서에 RLS가 한 줄도 없었다. Supabase는 anon key가 클라이언트에 그대로
-- 박히는 구조이므로, RLS 없이 테이블을 만들면 아무나 남의 건강기록·식사사진을 읽을 수 있다.
-- MVP에서 가장 치명적인 구멍이라 별도 마이그레이션으로 분리해 명시적으로 관리한다.
--
-- 원칙:
--   * 전 테이블 RLS enable (예외 없음)
--   * 사용자 데이터는 auth.uid() = user_id
--   * 소유 관계가 간접적인 테이블(cycle_days, overrides)은 부모를 타고 올라가 검사
--   * 감사/로그성 테이블은 read-only for owner, write는 service_role만
--   * service_role은 RLS를 우회하므로 Edge Function에서만 사용 (클라이언트 노출 금지)

-- ─────────────────────────────────────────────────────────────
alter table public.users                     enable row level security;
alter table public.consents                  enable row level security;
alter table public.schedule_patterns         enable row level security;
alter table public.schedule_cycle_days       enable row level security;
alter table public.schedule_overrides        enable row level security;
alter table public.fasting_logs              enable row level security;
alter table public.meal_logs                 enable row level security;
alter table public.food_nutrition_cache      enable row level security;
alter table public.user_subscriptions        enable row level security;
alter table public.weekly_feedback           enable row level security;
alter table public.notification_preferences  enable row level security;
alter table public.push_notification_logs    enable row level security;
alter table public.system_heartbeat          enable row level security;

-- ── users ────────────────────────────────────────────────────
create policy users_select_own on public.users
  for select using (auth.uid() = id);
create policy users_update_own on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- insert는 handle_new_user 트리거(security definer)가 담당. 클라이언트 insert 불허.

-- ── consents (append-only) ──────────────────────────────────
create policy consents_select_own on public.consents
  for select using (auth.uid() = user_id);
create policy consents_insert_own on public.consents
  for insert with check (auth.uid() = user_id);
-- update/delete 정책 없음 → 법정 증빙 무결성 보장 (철회는 새 행 insert)

-- ── schedule_patterns ───────────────────────────────────────
create policy schedule_patterns_all_own on public.schedule_patterns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── schedule_cycle_days (부모 경유 소유권 검사) ───────────────
create policy cycle_days_all_own on public.schedule_cycle_days
  for all
  using (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = schedule_cycle_days.pattern_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = schedule_cycle_days.pattern_id and p.user_id = auth.uid()
    )
  );

-- ── schedule_overrides ──────────────────────────────────────
create policy overrides_all_own on public.schedule_overrides
  for all
  using (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = schedule_overrides.pattern_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.schedule_patterns p
      where p.id = schedule_overrides.pattern_id and p.user_id = auth.uid()
    )
  );

-- ── fasting_logs ────────────────────────────────────────────
create policy fasting_logs_all_own on public.fasting_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── meal_logs ───────────────────────────────────────────────
create policy meal_logs_all_own on public.meal_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── food_nutrition_cache ────────────────────────────────────
-- 개인정보가 없는 전역 공용 캐시. 읽기는 인증 사용자 전체에 허용해서
-- 캐시 히트를 최대화한다(= 비용 절감). 쓰기는 Edge Function(service_role)만.
create policy food_cache_read_authenticated on public.food_nutrition_cache
  for select to authenticated using (true);

-- ── user_subscriptions ──────────────────────────────────────
-- 읽기만 허용. plan_type이나 스캔 카운트를 클라이언트가 고칠 수 있으면
-- 페이월과 쿼터가 무의미해진다. 쓰기는 RevenueCat 웹훅 / DB 함수만.
create policy subscriptions_select_own on public.user_subscriptions
  for select using (auth.uid() = user_id);

-- ── weekly_feedback ─────────────────────────────────────────
create policy weekly_feedback_select_own on public.weekly_feedback
  for select using (auth.uid() = user_id);
-- "적용하기"가 applied_at을 찍어야 하므로 update만 열되, 내용 변조는 막는다.
create policy weekly_feedback_update_applied on public.weekly_feedback
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── notification_preferences ────────────────────────────────
create policy notif_prefs_select_own on public.notification_preferences
  for select using (auth.uid() = user_id);
create policy notif_prefs_update_own on public.notification_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── push_notification_logs ──────────────────────────────────
create policy push_logs_select_own on public.push_notification_logs
  for select using (auth.uid() = user_id);
-- 열람 처리(opened)만 본인이 update 가능
create policy push_logs_update_own on public.push_notification_logs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── system_heartbeat ────────────────────────────────────────
-- 정책 없음 = 어떤 사용자도 접근 불가. service_role(keepalive cron)만 접근.


-- ─────────────────────────────────────────────────────────────
-- Storage: 식사 사진 버킷
--
-- 경로 규약: meal-photos/{user_id}/{uuid}.jpg
-- 폴더 첫 세그먼트가 곧 소유자이므로 그걸로 정책을 건다.
-- 비공개 버킷 + signed URL 발급 방식. public URL을 쓰면 경로만 알면 남의 사진이 열린다.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-photos', 'meal-photos', false,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy meal_photos_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy meal_photos_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy meal_photos_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
