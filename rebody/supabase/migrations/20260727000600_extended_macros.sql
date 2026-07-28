-- ReBody — 당류·포화지방산 수집
--
-- 15127578 스펙 확인 결과 AMT_NUM7(당류), AMT_NUM24(포화지방산)이 같은 응답에
-- 이미 실려 온다. 추가 API 호출 비용이 0인데 컬럼이 없어서 버리고 있었다.
--
-- 지금 저장해 두는 이유: 나중에 필요해졌을 때 과거 데이터는 소급해서 만들 수 없다.
-- 대사 리셋이 앱의 전제인 만큼 당류는 사실상 1급 지표이고, Pro 티어의
-- '상세 매크로'를 확장할 때 바로 쓸 수 있다. UI 노출은 별도 작업.

alter table public.food_nutrition_cache
  add column if not exists sugar_g         numeric(7,1),
  add column if not exists saturated_fat_g numeric(7,1);

alter table public.meal_logs
  add column if not exists total_sugar_g         numeric(7,1),
  add column if not exists total_saturated_fat_g numeric(7,1);

comment on column public.food_nutrition_cache.sugar_g is
  'MFDS AMT_NUM7(당류). serving_size_g 기준값.';
comment on column public.food_nutrition_cache.saturated_fat_g is
  'MFDS AMT_NUM24(포화지방산). serving_size_g 기준값.';

-- 기존 캐시 행은 이 컬럼이 null이다. 다음 조회 때 upsert로 자연히 채워지므로
-- 별도 백필은 하지 않는다.
