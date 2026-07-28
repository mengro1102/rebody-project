# ReBody — Play Store 출시 체크리스트 (Phase 7)

## A. 착수 즉시 (승인 대기가 크리티컬 패스)

- [x] **공공데이터포털 API 키 신청** — `식품의약품안전처_식품영양성분DB정보` (data.go.kr/data/15127578)
      · 활용기간 2026-07-27 ~ 2028-07-27, 자동승인 완료
  - 이 API 하나가 **원재료성식품 / 가공식품 / 음식 3개 카테고리를 모두 포함**하는 통합 DB다.
    `전국통합식품영양성분정보(음식)표준데이터`(15100070) 등 표준데이터 시리즈는 같은 원천을
    카테고리별 파일로 나눠 배포하는 것이라 **추가 신청 불필요**. (아래 B-1 참조)
  - [ ] 발급 키로 `npm run probe:mfds` 실행 — **응답 필드명을 눈으로 확인**할 것.
        `supabase/functions/_shared/mfds.ts`의 `FIELD_MAPS`가 실제 스펙과 다르면 조용히 0kcal이 들어간다.
  - [ ] 요청주소 접미사가 `...FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02`(**02**)인지 확인.
        01은 구버전이라 404가 난다.

### B-1. 표준데이터를 추가로 받아야 하는 경우

Gemini가 인식한 음식명으로 실시간 조회하는 지금 구조에서는 OpenAPI 하나면 충분하다.
다만 아래 경우엔 표준데이터 파일 다운로드가 유리하다 — **Phase 3a 결과를 보고 판단**할 것.

| 상황 | 대응 |
|---|---|
| MFDS 매칭률이 60% 미만 | 표준데이터 CSV를 통째로 받아 Supabase에 적재 → 자체 인덱스로 fuzzy 검색 |
| 공공데이터 일일 호출 한도에 걸림 | 위와 동일 (외부 호출 자체를 제거) |
| 응답 지연이 p95 6초를 넘김 | 위와 동일 |

- 통합: data.go.kr/data/15100064/standard.do
- 음식: data.go.kr/data/15100070/standard.do
- 가공식품: data.go.kr/data/15100066/standard.do
- 원재료성식품: data.go.kr/data/15100065/standard.do
- [ ] **Google Play 개발자 등록 $25** — 신원 확인에 며칠 소요
- [ ] Gemini API 키 발급 (AI Studio) + 무료 티어 레이트리밋 확인
- [ ] Firebase 프로젝트 생성 → Android 앱(`com.rebody.app`) 등록 → `google-services.json`
- [ ] Supabase 프로젝트 생성 (리전 `ap-northeast-2` 서울)

## B. 인프라 배포

- [ ] `supabase link --project-ref <ref>`
- [ ] `supabase db push` — 마이그레이션 5개 적용
- [ ] Vault에 시크릿 등록 (cron이 Edge Function을 호출하는 데 필요)
  ```sql
  select vault.create_secret('<ref>.supabase.co', 'project_host');
  select vault.create_secret('<service-role-key>', 'service_role_key');
  ```
- [ ] `supabase secrets set --env-file supabase/.env.local` (GEMINI/MFDS/FCM)
- [ ] `supabase functions deploy` — 7개 함수
- [ ] `select jobname, schedule, active from cron.job;` 로 cron 4건 등록 확인
- [ ] **RLS 검증**: 다른 계정으로 로그인해 남의 `meal_logs`가 안 보이는지 실제로 확인
      (이건 코드 리뷰가 아니라 반드시 실측으로)

## C. Phase 3a — 스캐너 정확도 게이트

- [ ] 한식 사진 골든셋 50장 수집 → `eval/golden.json`에 정답 라벨
- [ ] `npm run eval:scanner` 실행
- [ ] 합격선 확인

| 지표 | 합격선 |
|---|---|
| 음식명 top-1 정확도 | ≥ 70% |
| MFDS 매칭률 | ≥ 60% |
| 칼로리 오차 ±25% 이내 | ≥ 70% |
| p95 응답시간 | ≤ 6초 |
| 1건당 비용 | ≤ $0.002 |

- [ ] 불합격 시 판단: 모델 승급 → 프롬프트 보강 → 피벗(스캐너를 보조 기능으로 격하)

## D. 앱 빌드

- [ ] `eas init` → `app.config.ts`의 `EAS_PROJECT_ID` 채우기
- [ ] `eas build --profile development --platform android` (RevenueCat·FCM 테스트용)
- [ ] 실기기에서 확인
  - [ ] 푸시 권한 소프트 애스크 → 시스템 다이얼로그 순서
  - [ ] 알림 채널 3개가 Android 설정에 분리 표시되는지
  - [ ] 카메라 촬영 → 분석 → 편집 → 저장 전체 플로우
  - [ ] 무료 4번째 스캔이 402로 막히는지 (**앱 재설치 후에도 막히는지** — 서버 쿼터 검증)
  - [ ] 야간 근무 프리셋에서 단식 종료 시각이 12시간 어긋나지 않는지
  - [ ] ICS 내보내기 → Google 캘린더에서 시각이 맞는지
  - [ ] 계정 삭제 → 재로그인 불가 + 데이터 소멸

## E. 스토어 등록 자산

- [ ] 앱 아이콘 512×512 (워드마크에는 `Re:Body`, 스토어 등록명은 `ReBody`)
- [ ] 피처 그래픽 1024×500
- [ ] 스크린샷 최소 2장 (권장 4~8장) — 대시보드 / 스캐너 결과 / 주간 리포트 / 온보딩
- [ ] 짧은 설명 80자 이내
- [ ] 자세한 설명 4000자 이내 (**"체중 감량 보장", "치료" 같은 표현 금지**)
- [ ] 개인정보처리방침 URL 게시 및 Play Console 입력
- [ ] Data Safety 신고 (`03_DATA_SAFETY.md`)
- [ ] 콘텐츠 등급 설문
- [ ] 앱 카테고리: 건강/피트니스
- [ ] 타겟 연령: 18세 이상

## F. 인앱상품 (Phase 6)

- [ ] Play Console에 구독 상품 등록: `rebody_pro_monthly`, `rebody_pro_annual`
- [ ] **내부 테스트 트랙에 1회 배포** (이게 있어야 인앱상품이 조회된다)
- [ ] RevenueCat 프로젝트 연결 + Play 서비스 계정 키 업로드
- [ ] Entitlement `pro` 생성 및 상품 매핑
- [ ] RevenueCat 웹훅 → `user_subscriptions` 갱신 엔드포인트 연결
- [ ] 라이선스 테스터 계정으로 결제 → 복원 → 해지 전체 검증

## G. 단계적 출시

```
내부 테스트 (1~3명, 3일)
   → 비공개 테스트 (10~20명, 1주)
      → 프로덕션 20%   ← eas.json submit.production.rollout = 0.2
         → 48시간 관찰: 크래시율 < 1%, ANR < 0.5%
            → 50%
               → 24시간 관찰
                  → 100%
```

- [ ] Crashlytics 연동 및 첫 크래시 수신 확인
- [ ] 롤아웃 각 단계에서 Play Console 'Android vitals' 확인
- [ ] 리뷰 알림 설정 (초기 1~2주는 매일 확인)

## H. 운영 시작 후

- [ ] `system_heartbeat.pinged_at`이 매일 갱신되는지 (Supabase 슬립 방지 동작 확인)
- [ ] `food_nutrition_cache` 히트율 모니터링 — 이게 곧 Gemini 비용
  ```sql
  select source, count(*), sum(hit_count),
         round(sum(hit_count)::numeric / nullif(count(*),0), 1) as avg_hits
    from food_nutrition_cache group by source;
  ```
- [ ] `push_notification_logs`에서 실패 사유 분포 확인 (`no_token` / `quiet_hours` / `duplicate`)
- [ ] Gemini 실제 청구액이 추정($1~3/월)과 맞는지 첫 달 대조
- [ ] EAS 빌드 잔여 쿼터 확인 — JS 변경은 `eas update`로만 배포

## I. 하지 말아야 할 것

- ❌ `service_role` 키를 앱 번들에 넣기
- ❌ RLS 없이 테이블 추가하기 (새 테이블마다 정책도 함께)
- ❌ 스캔 쿼터를 클라이언트에서만 세기
- ❌ Analytics 이벤트에 칼로리·음식명·건강 데이터 넣기
- ❌ 스토어 설명에 "치료", "체중 감량 보장", "의학적 효과" 표현 쓰기
- ❌ 민감정보·국외이전 동의를 이용약관에 묶어서 한 번에 받기
