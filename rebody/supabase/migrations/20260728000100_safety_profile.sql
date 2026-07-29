-- 안전성 자가 문진 응답 저장 (docs/00_ANALYSIS.md §2-4)
--
-- checkEligibility()의 입력 중 나이·BMI는 users의 기존 컬럼에서 파생되지만,
-- 임신·수유 / 섭식장애 병력 / 혈당약 복용 응답은 저장할 곳이 없었다.
-- 로컬에만 두면 재설치 한 번으로 단식 차단이 풀린다 — 서버에 남겨야 하는 값이다.
--
-- 세 컬럼 모두 민감정보다. users 테이블은 20260727000200_rls_policies.sql에서
-- 이미 auth.uid() 기반 RLS가 걸려 있으므로 정책을 추가할 필요는 없다.

alter table public.users
  add column if not exists is_pregnant_or_nursing      boolean not null default false,
  add column if not exists has_eating_disorder_history boolean not null default false,
  add column if not exists has_diabetes_on_medication  boolean not null default false;

comment on column public.users.is_pregnant_or_nursing is
  '자가 문진 응답. true면 단식 스케줄 생성을 차단한다 (식사 기록은 계속 가능).';
comment on column public.users.has_eating_disorder_history is
  '자가 문진 응답. true면 단식 스케줄 생성을 차단한다.';
comment on column public.users.has_diabetes_on_medication is
  '자가 문진 응답. 차단이 아니라 경고 문구를 띄우는 조건이다.';
