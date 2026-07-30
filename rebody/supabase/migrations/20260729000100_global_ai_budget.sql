-- 전역 AI 호출 상한 (docs/07_MONETIZATION_DEFERRED.md §5)
--
-- 왜 필요한가:
--   수익화를 보류했으므로 Gemini 호출 비용은 전액 운영자 개인 부담이다.
--   사용자당 3회/일(consume_scan_quota)은 **한 사람**의 남용을 막지만
--   **사용자 수 증가**는 막지 못한다. DAU가 3,000이 되면 월 $60이 넘는다.
--   총액에 천장이 필요하다.
--
-- 설계:
--   * 날짜별 1행. 원자적 증가 함수가 상한 초과 여부를 함께 반환한다.
--   * 상한에 닿으면 스캐너만 격하되고 타이머·스케줄·리포트는 그대로 동작한다.
--     (중단이 아니라 격하 — 사용자가 이탈하면 무료 앱의 유일한 자산인 리텐션을 잃는다)
--   * 날짜는 UTC 기준이다. 사용자 로컬 날짜가 아니라 **청구 기준**이 필요하기 때문이다.
--
-- 상한을 바꾸는 방법: app_settings의 값을 UPDATE 한다. 재배포가 필요 없다.

-- ─────────────────────────────────────────────────────────────
-- app_settings — 운영 파라미터 단일 테이블
-- 코드 상수로 두면 값을 바꿀 때마다 Edge Function을 재배포해야 한다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb       not null,
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;
-- 정책을 만들지 않는다 = service_role만 접근 가능. 클라이언트는 이 값을 볼 이유가 없다.

comment on table public.app_settings is
  '운영 파라미터. service_role 전용(RLS 정책 없음). Edge Function만 읽는다.';

insert into public.app_settings (key, value, description) values
  ('ai_daily_call_cap', '2000'::jsonb,
   '전역 Gemini 호출 일일 상한. 초과 시 스캐너만 격하된다. 2000건 ≈ 월 $21.'),
  ('ai_daily_warn_ratio', '0.8'::jsonb,
   '이 비율을 처음 넘는 순간 경고를 남긴다. 운영자가 상한 도달 전에 인지하기 위한 것.')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- ai_usage_daily — 날짜별 호출 집계
-- ─────────────────────────────────────────────────────────────
create table if not exists public.ai_usage_daily (
  usage_date   date primary key,
  call_count   int  not null default 0,
  -- 종류별 분해. 어느 기능이 비용을 쓰는지 봐야 상한을 조정할 수 있다.
  scan_count   int  not null default 0,
  nl_count     int  not null default 0,
  feedback_count int not null default 0,
  -- 경고를 이미 남겼는지. 한 번만 남긴다(로그 폭주 방지).
  warned_at    timestamptz,
  capped_at    timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.ai_usage_daily enable row level security;
-- 역시 service_role 전용.

comment on table public.ai_usage_daily is
  '전역 AI 호출 일일 집계. UTC 날짜 기준(청구 기준과 맞춘다).';

-- ─────────────────────────────────────────────────────────────
-- consume_ai_budget — 전역 예산을 원자적으로 차감
--
-- 반환:
--   allowed   — false면 호출자는 Gemini를 부르지 않고 격하 응답을 준다
--   used      — 차감 후 오늘 누적 호출 수
--   cap       — 현재 상한
--   warn      — 이번 호출이 경고선을 처음 넘었는가 (로그/알림용, 한 번만 true)
--
-- INSERT ... ON CONFLICT DO UPDATE 로 한 문장에 처리한다. 별도 락이 필요 없다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.consume_ai_budget(
  p_kind text default 'scan',
  p_usage_date date default (now() at time zone 'utc')::date
)
returns table (allowed boolean, used int, cap int, warn boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap        int;
  v_warn_ratio numeric;
  v_used       int;
  v_prev_warn  timestamptz;
begin
  select (value #>> '{}')::int into v_cap
    from public.app_settings where key = 'ai_daily_call_cap';
  select (value #>> '{}')::numeric into v_warn_ratio
    from public.app_settings where key = 'ai_daily_warn_ratio';

  -- 설정이 없으면 보수적인 기본값. 상한이 없는 상태로 열려 있는 것이 최악이다.
  v_cap := coalesce(v_cap, 2000);
  v_warn_ratio := coalesce(v_warn_ratio, 0.8);

  select call_count, warned_at into v_used, v_prev_warn
    from public.ai_usage_daily where usage_date = p_usage_date;
  v_used := coalesce(v_used, 0);

  if v_used >= v_cap then
    update public.ai_usage_daily
       set capped_at = coalesce(capped_at, now()), updated_at = now()
     where usage_date = p_usage_date;
    return query select false, v_used, v_cap, false;
    return;
  end if;

  insert into public.ai_usage_daily as u (usage_date, call_count, scan_count, nl_count, feedback_count)
  values (
    p_usage_date, 1,
    case when p_kind = 'scan'     then 1 else 0 end,
    case when p_kind = 'nl'       then 1 else 0 end,
    case when p_kind = 'feedback' then 1 else 0 end
  )
  on conflict (usage_date) do update
    set call_count     = u.call_count + 1,
        scan_count     = u.scan_count     + case when p_kind = 'scan'     then 1 else 0 end,
        nl_count       = u.nl_count       + case when p_kind = 'nl'       then 1 else 0 end,
        feedback_count = u.feedback_count + case when p_kind = 'feedback' then 1 else 0 end,
        updated_at     = now()
  returning u.call_count into v_used;

  -- 경고선을 처음 넘은 호출에서만 true를 돌려준다.
  if v_prev_warn is null and v_used >= floor(v_cap * v_warn_ratio) then
    update public.ai_usage_daily set warned_at = now() where usage_date = p_usage_date;
    return query select true, v_used, v_cap, true;
    return;
  end if;

  return query select true, v_used, v_cap, false;
end;
$$;

revoke all on function public.consume_ai_budget(text, date) from public, anon, authenticated;

comment on function public.consume_ai_budget is
  'service_role 전용. Gemini를 호출하는 모든 Edge Function이 호출 직전에 부른다.';

-- ─────────────────────────────────────────────────────────────
-- refund_ai_budget — 호출이 실패했을 때 되돌린다
-- 실패한 요청이 예산을 먹으면 상한이 실제보다 빨리 닫힌다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.refund_ai_budget(
  p_kind text default 'scan',
  p_usage_date date default (now() at time zone 'utc')::date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_usage_daily
     set call_count     = greatest(call_count - 1, 0),
         scan_count     = greatest(scan_count     - case when p_kind = 'scan'     then 1 else 0 end, 0),
         nl_count       = greatest(nl_count       - case when p_kind = 'nl'       then 1 else 0 end, 0),
         feedback_count = greatest(feedback_count - case when p_kind = 'feedback' then 1 else 0 end, 0),
         updated_at     = now()
   where usage_date = p_usage_date;
end;
$$;

revoke all on function public.refund_ai_budget(text, date) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 운영용 조회 뷰 — 최근 30일 사용량과 추정 비용
-- 단가는 gemini-3.1-flash-lite 기준 근사치다 (docs/01_COST.md).
-- ─────────────────────────────────────────────────────────────
create or replace view public.ai_usage_recent as
select
  usage_date,
  call_count,
  scan_count,
  nl_count,
  feedback_count,
  round(
    scan_count * 0.00035 + nl_count * 0.00048 + feedback_count * 0.00060,
    4
  ) as estimated_usd,
  capped_at is not null as was_capped
from public.ai_usage_daily
where usage_date > (now() at time zone 'utc')::date - 30
order by usage_date desc;

comment on view public.ai_usage_recent is
  '최근 30일 AI 사용량과 추정 비용. 월 청구액을 이 합계와 대조할 것.';
