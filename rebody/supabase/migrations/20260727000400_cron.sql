-- ReBody — 스케줄된 작업 (pg_cron + pg_net)
--
-- Supabase Scheduled Functions는 내부적으로 pg_cron + pg_net으로 Edge Function을 호출한다.
-- service_role key를 SQL에 하드코딩하면 안 되므로 Vault에서 읽는다.
--
-- 사전 준비 (Supabase Dashboard > Project Settings > Vault):
--   vault.create_secret('<project-ref>.supabase.co', 'project_host')
--   vault.create_secret('<service-role-key>',        'service_role_key')

create extension if not exists pg_cron  with schema extensions;
create extension if not exists pg_net   with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- Edge Function 호출 헬퍼
-- ─────────────────────────────────────────────────────────────
create or replace function public.invoke_edge_function(
  p_name text,
  p_body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_host text;
  v_key  text;
  v_req_id bigint;
begin
  select decrypted_secret into v_host from vault.decrypted_secrets where name = 'project_host';
  select decrypted_secret into v_key  from vault.decrypted_secrets where name = 'service_role_key';

  if v_host is null or v_key is null then
    raise warning 'invoke_edge_function: vault secrets missing (project_host / service_role_key)';
    return null;
  end if;

  select net.http_post(
    url     := 'https://' || v_host || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_key
               ),
    body    := p_body,
    timeout_milliseconds := 30000
  ) into v_req_id;

  return v_req_id;
end;
$$;

revoke all on function public.invoke_edge_function(text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 1) keepalive — 매일 09:00 KST (00:00 UTC)
--    Supabase 무료 프로젝트 7일 미활동 일시정지 방지.
--    Edge Function 호출과 DB write를 둘 다 발생시킨다.
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'rebody-keepalive',
  '0 0 * * *',
  $$
    update public.system_heartbeat
       set pinged_at = now(), ping_count = ping_count + 1
     where id = 1;
    select public.invoke_edge_function('keepalive-ping');
  $$
);

-- ─────────────────────────────────────────────────────────────
-- 2) 푸시 디스패치 — 15분마다
--    사용자별 타임존이 제각각이고 교대근무라 시각이 매일 달라지므로,
--    "정각에 일괄 발송"이 아니라 짧은 주기로 돌면서 발송 대상만 골라낸다.
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'rebody-push-dispatch',
  '*/15 * * * *',
  $$ select public.invoke_edge_function('dispatch-scheduled-push'); $$
);

-- ─────────────────────────────────────────────────────────────
-- 3) 주간 피드백 생성 — 매주 월요일 08:00 KST (일요일 23:00 UTC)
--    직전 주(월~일) 데이터를 대상으로 한다.
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'rebody-weekly-feedback',
  '0 23 * * 0',
  $$ select public.invoke_edge_function('generate-weekly-feedback'); $$
);

-- ─────────────────────────────────────────────────────────────
-- 4) 캐시 위생 — 매월 1일. AI 추정치 캐시 중 오래되고 거의 안 쓰인 것 정리.
--    공식 데이터(mfds_db)는 만료시키지 않는다.
-- ─────────────────────────────────────────────────────────────
select cron.schedule(
  'rebody-cache-prune',
  '0 18 1 * *',
  $$
    delete from public.food_nutrition_cache
     where source = 'ai_estimate'
       and matched_at < now() - interval '90 days'
       and hit_count < 3;
  $$
);

-- 등록 확인:  select jobname, schedule, active from cron.job;
-- 해제:       select cron.unschedule('rebody-keepalive');
