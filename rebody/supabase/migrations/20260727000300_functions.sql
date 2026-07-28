-- ReBody — 서버측 비즈니스 로직
--
-- 여기 있는 함수들은 "클라이언트를 믿으면 안 되는" 것들이다.
--   * 스캔 쿼터: 클라이언트가 세면 재설치/시계조작으로 우회 → Gemini 비용 유출
--   * 스케줄 해석: 푸시 스케줄러(서버)와 앱(클라이언트)이 같은 답을 내야 함
--   * 주간 집계: 원본 로그를 Gemini에 보내지 않기 위해 서버에서 미리 집계

-- ─────────────────────────────────────────────────────────────
-- consume_scan_quota — 스캔 1회를 원자적으로 차감
--
-- Edge Function이 Gemini를 호출하기 "전에" 반드시 먼저 호출한다.
-- FOR UPDATE row lock으로 동시 요청 이중 차감을 막는다.
-- 반환: (allowed, remaining, plan)
-- ─────────────────────────────────────────────────────────────
create or replace function public.consume_scan_quota(
  p_user_id   uuid,
  p_local_date date,
  p_free_limit int default 3
)
returns table (allowed boolean, remaining int, plan plan_type)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.user_subscriptions%rowtype;
  v_count int;
begin
  select * into v_sub
  from public.user_subscriptions
  where user_id = p_user_id
  for update;

  if not found then
    insert into public.user_subscriptions (user_id) values (p_user_id)
    returning * into v_sub;
  end if;

  -- Pro는 무제한. 카운트는 통계 목적으로만 올린다.
  if v_sub.plan_type = 'pro'
     and (v_sub.expires_at is null or v_sub.expires_at > now()) then
    update public.user_subscriptions
      set ai_scan_count_today = case when last_scan_date = p_local_date
                                     then ai_scan_count_today + 1 else 1 end,
          last_scan_date = p_local_date
    where user_id = p_user_id;
    return query select true, 2147483647, 'pro'::plan_type;
    return;
  end if;

  -- 날짜가 바뀌었으면 카운터 리셋. 별도 cron 없이 lazy reset으로 처리한다.
  v_count := case when v_sub.last_scan_date = p_local_date
                  then v_sub.ai_scan_count_today else 0 end;

  if v_count >= p_free_limit then
    return query select false, 0, 'free'::plan_type;
    return;
  end if;

  update public.user_subscriptions
    set ai_scan_count_today = v_count + 1,
        last_scan_date      = p_local_date
  where user_id = p_user_id;

  return query select true, (p_free_limit - v_count - 1), 'free'::plan_type;
end;
$$;

revoke all on function public.consume_scan_quota(uuid, date, int) from public, anon, authenticated;

comment on function public.consume_scan_quota is
  'service_role 전용. Edge Function(analyze-food-image)이 Gemini 호출 전에 부른다.';


-- ─────────────────────────────────────────────────────────────
-- refund_scan_quota — Gemini 호출이 실패했을 때 차감 복구
-- 사용자가 실패한 요청 때문에 쿼터를 잃으면 안 된다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.refund_scan_quota(p_user_id uuid, p_local_date date)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.user_subscriptions
     set ai_scan_count_today = greatest(ai_scan_count_today - 1, 0)
   where user_id = p_user_id and last_scan_date = p_local_date;
end;
$$;

revoke all on function public.refund_scan_quota(uuid, date) from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- resolve_schedule_for_date — 특정 날짜의 스케줄 해석
--
-- 우선순위: schedule_overrides > schedule_cycle_days
-- 사이클 인덱스: ((date - anchor) % len + len) % len
--   -- anchor보다 과거 날짜(음수 나머지)도 올바르게 처리하기 위한 이중 modulo.
--
-- 시각은 전부 벽시계(time)로 반환한다. 절대시각 변환은 호출자(앱/Edge)가 담당.
-- ─────────────────────────────────────────────────────────────
create or replace function public.resolve_schedule_for_date(
  p_pattern_id uuid,
  p_date       date
)
returns table (
  source        text,
  cycle_day_index int,
  is_off_day    boolean,
  work_start    time,
  work_end      time,
  workout_start time,
  workout_end   time,
  meal_start    time,
  meal_end      time
)
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_pattern public.schedule_patterns%rowtype;
  v_idx int;
begin
  select * into v_pattern from public.schedule_patterns where id = p_pattern_id;
  if not found then
    return;
  end if;

  -- 1) override 우선
  return query
    select 'override'::text, null::int, o.is_off_day,
           o.work_start, o.work_end, o.workout_start, o.workout_end,
           o.suggested_meal_window_start, o.suggested_meal_window_end
    from public.schedule_overrides o
    where o.pattern_id = p_pattern_id and o.override_date = p_date;

  if found then
    return;
  end if;

  -- 2) 사이클 폴백
  v_idx := ((p_date - v_pattern.cycle_anchor_date) % v_pattern.cycle_length_days
            + v_pattern.cycle_length_days) % v_pattern.cycle_length_days;

  return query
    select 'cycle'::text, d.cycle_day_index, d.is_off_day,
           d.work_start, d.work_end, d.workout_start, d.workout_end,
           d.suggested_meal_window_start, d.suggested_meal_window_end
    from public.schedule_cycle_days d
    where d.pattern_id = p_pattern_id and d.cycle_day_index = v_idx;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- get_weekly_stats — 주간 피드백용 집계
--
-- 원본 로그를 Gemini에 보내지 않기 위한 함수. 토큰 비용과 프라이버시를 동시에 줄인다.
-- (docs/00_ANALYSIS.md §4, docs/01_COST.md)
-- ─────────────────────────────────────────────────────────────
create or replace function public.get_weekly_stats(
  p_user_id    uuid,
  p_week_start date
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_week_end date := p_week_start + 7;
  v_result jsonb;
begin
  select jsonb_build_object(
    'week_start', p_week_start,
    'fasting', (
      select jsonb_build_object(
        'planned',   count(*),
        'completed', count(*) filter (where status = 'completed'),
        'broken',    count(*) filter (where status = 'broken'),
        'avg_actual_hours', round(avg(
          extract(epoch from (coalesce(actual_end, now()) - actual_start)) / 3600.0
        ) filter (where actual_start is not null)::numeric, 1),
        'avg_target_hours', round(avg(
          extract(epoch from (target_end - target_start)) / 3600.0
        )::numeric, 1)
      )
      from public.fasting_logs
      where user_id = p_user_id and local_date >= p_week_start and local_date < v_week_end
    ),
    'meals', (
      select jsonb_build_object(
        'count',        count(*),
        'avg_calories', round(avg(total_calories)::numeric, 0),
        'avg_carbs_g',  round(avg(total_carbs)::numeric, 0),
        'avg_protein_g',round(avg(total_protein)::numeric, 0),
        'avg_fat_g',    round(avg(total_fat)::numeric, 0),
        'within_fasting_window_count', count(*) filter (where is_within_fasting_window),
        'late_night_count', count(*) filter (
          where extract(hour from meal_time at time zone
                        coalesce((select timezone from public.users where id = p_user_id), 'Asia/Seoul')
               ) between 0 and 4
        )
      )
      from public.meal_logs
      where user_id = p_user_id and local_date >= p_week_start and local_date < v_week_end
    ),
    'logging_days', (
      select count(distinct local_date)
      from public.meal_logs
      where user_id = p_user_id and local_date >= p_week_start and local_date < v_week_end
    )
  ) into v_result;

  return v_result;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- delete_my_account — 사용자 자기 데이터 삭제 (Play Console 필수 요건)
--
-- Google Play는 계정 삭제 요청 경로를 앱 내에 제공할 것을 요구한다.
-- auth.users를 지우면 on delete cascade로 전부 정리된다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- storage 객체는 cascade 대상이 아니므로 명시 삭제
  delete from storage.objects
   where bucket_id = 'meal-photos'
     and (storage.foldername(name))[1] = v_uid::text;

  delete from auth.users where id = v_uid;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;
