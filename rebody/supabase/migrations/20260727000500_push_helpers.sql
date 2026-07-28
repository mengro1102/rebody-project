-- ReBody — 푸시 디스패처 보조 함수
--
-- 미기록 넛지 대상 선별. dispatch-scheduled-push가 15분마다 호출한다.
--
-- 왜 SQL로 하는가: 사용자마다 타임존과 식사 창이 달라서, 이걸 Edge Function에서 하려면
-- 전 사용자를 끌어와 루프를 돌아야 한다. 대상은 보통 한 자릿수인데 전수 조회는 낭비다.

create or replace function public.get_unlogged_meal_candidates(
  p_window_minutes int default 15,
  p_lead_minutes   int default 30
)
returns table (user_id uuid, local_date date, meal_window_end time)
language plpgsql stable security definer set search_path = public
as $$
declare
  r record;
  v_local_date date;
  v_now_min int;
  v_end_min int;
  v_target_min int;
  v_idx int;
  v_end time;
  v_off boolean;
begin
  for r in
    select p.id as pattern_id, p.user_id, p.cycle_anchor_date, p.cycle_length_days,
           coalesce(u.timezone, 'Asia/Seoul') as tz
      from public.schedule_patterns p
      join public.users u on u.id = p.user_id
      join public.notification_preferences np on np.user_id = p.user_id
     where p.is_active
       and np.nudge                       -- 넛지 토글이 꺼져 있으면 애초에 후보에서 뺀다
       and u.fcm_token is not null
  loop
    v_local_date := (now() at time zone r.tz)::date;
    v_now_min    := extract(hour from (now() at time zone r.tz))::int * 60
                  + extract(minute from (now() at time zone r.tz))::int;

    -- override 우선
    select o.suggested_meal_window_end, o.is_off_day
      into v_end, v_off
      from public.schedule_overrides o
     where o.pattern_id = r.pattern_id and o.override_date = v_local_date;

    if not found then
      v_idx := ((v_local_date - r.cycle_anchor_date) % r.cycle_length_days
                + r.cycle_length_days) % r.cycle_length_days;
      select d.suggested_meal_window_end, d.is_off_day
        into v_end, v_off
        from public.schedule_cycle_days d
       where d.pattern_id = r.pattern_id and d.cycle_day_index = v_idx;
    end if;

    if v_end is null or coalesce(v_off, false) then
      continue;
    end if;

    v_end_min := extract(hour from v_end)::int * 60 + extract(minute from v_end)::int;

    -- 식사 창 종료 p_lead_minutes 전이 지금 폴링 창 [now, now+window) 안에 들어오는가
    v_target_min := v_end_min - p_lead_minutes;
    if v_target_min < 0 then
      v_target_min := v_target_min + 1440;   -- 식사 창이 자정 직후에 끝나는 경우
    end if;

    if not (v_now_min >= v_target_min and v_now_min < v_target_min + p_window_minutes) then
      continue;
    end if;

    -- 오늘 식사 기록이 이미 있으면 넛지 불필요
    if exists (
      select 1 from public.meal_logs m
       where m.user_id = r.user_id and m.local_date = v_local_date
    ) then
      continue;
    end if;

    user_id := r.user_id;
    local_date := v_local_date;
    meal_window_end := v_end;
    return next;
  end loop;
end;
$$;

revoke all on function public.get_unlogged_meal_candidates(int, int) from public, anon, authenticated;

comment on function public.get_unlogged_meal_candidates is
  'service_role 전용. dispatch-scheduled-push가 15분마다 호출.';


-- ─────────────────────────────────────────────────────────────
-- apply_feedback_adjustment — 주간 피드백의 "적용하기" 1탭 처리
--
-- 클라이언트가 schedule_overrides를 직접 쓰게 하면 AI가 제안하지 않은 값도
-- 넣을 수 있다. 제안된 조정만 정확히 반영되도록 서버에서 처리한다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.apply_feedback_adjustment(
  p_feedback_id uuid,
  p_days_ahead  int default 7
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fb public.weekly_feedback%rowtype;
  v_shift int;
  v_pattern public.schedule_patterns%rowtype;
  v_tz text;
  v_date date;
  v_idx int;
  v_day record;
  v_applied int := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_fb from public.weekly_feedback where id = p_feedback_id and user_id = v_uid;
  if not found then
    raise exception 'feedback not found';
  end if;
  if v_fb.applied_at is not null then
    return 0;   -- 이미 적용됨. 중복 적용 시 식사 창이 계속 밀린다.
  end if;

  if v_fb.suggested_adjustment_json is null
     or v_fb.suggested_adjustment_json->>'kind' <> 'shift_meal_window' then
    return 0;
  end if;

  v_shift := (v_fb.suggested_adjustment_json->>'shift_minutes')::int;
  -- 서버측 재검증. Edge Function에서 이미 걸렀지만 여기서도 막는다.
  if v_shift = 0 or abs(v_shift) > 120 then
    return 0;
  end if;

  select * into v_pattern from public.schedule_patterns
   where user_id = v_uid and is_active limit 1;
  if not found then
    return 0;
  end if;

  select coalesce(timezone, 'Asia/Seoul') into v_tz from public.users where id = v_uid;

  for i in 0 .. p_days_ahead - 1 loop
    v_date := (now() at time zone v_tz)::date + i;
    v_idx := ((v_date - v_pattern.cycle_anchor_date) % v_pattern.cycle_length_days
              + v_pattern.cycle_length_days) % v_pattern.cycle_length_days;

    select * into v_day from public.schedule_cycle_days
     where pattern_id = v_pattern.id and cycle_day_index = v_idx;

    if not found
       or v_day.suggested_meal_window_start is null
       or v_day.suggested_meal_window_end is null then
      continue;
    end if;

    insert into public.schedule_overrides (
      pattern_id, override_date, is_off_day,
      work_start, work_end, workout_start, workout_end,
      suggested_meal_window_start, suggested_meal_window_end, reason
    ) values (
      v_pattern.id, v_date, v_day.is_off_day,
      v_day.work_start, v_day.work_end, v_day.workout_start, v_day.workout_end,
      (v_day.suggested_meal_window_start + make_interval(mins => v_shift))::time,
      (v_day.suggested_meal_window_end   + make_interval(mins => v_shift))::time,
      'ai_suggestion'
    )
    on conflict (pattern_id, override_date) do update
      set suggested_meal_window_start = excluded.suggested_meal_window_start,
          suggested_meal_window_end   = excluded.suggested_meal_window_end,
          reason = 'ai_suggestion';

    v_applied := v_applied + 1;
  end loop;

  update public.weekly_feedback set applied_at = now() where id = p_feedback_id;
  return v_applied;
end;
$$;

grant execute on function public.apply_feedback_adjustment(uuid, int) to authenticated;
