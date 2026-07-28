# ReBody — 내가 해야 할 일 (순차 마일스톤)

최초 작성 2026-07-27 · **재검토 2026-07-28** (레포 실물 기준으로 상태 재확인)
**위에서부터 순서대로.** 각 마일스톤 끝의 **게이트**를 통과해야 다음으로 넘어갑니다.

```
M0  승인 대기 걸기        ← 지금 여기 (병렬 진행 가능)
M1  레포 정리             [푸시 완료. 누락 파일 복구됨]
M1.5 앱 셸 구축           ◀ 신설 — 화면은 있으나 앱이 없음
M2  백엔드 배포
M3  스캐너 정확도 검증     ◀ Go/No-Go 게이트
M4  앱 빌드·실기기 검증
M5  결제 연동
M6  스토어 등록
M7  단계적 출시
```

### 2026-07-28 재검토에서 확인된 사실

| 확인 항목 | 결과 |
|---|---|
| `npm test` | ✅ **63 tests / 3 suites 전부 통과** |
| `npm run typecheck` | ✅ **0 errors** (theme.ts `fontVariant` 오류 1건 수정 완료) |
| 마이그레이션 | 6개 존재 (`05_LAUNCH_CHECKLIST.md`의 "5개"는 오기) |
| Edge Function | 7개 존재 ✅ |
| cron 등록 | 마이그레이션에 `cron.schedule` 4건 ✅ |
| `.gitignore` / `.env.example` | ❗ 웹 업로드 과정에서 **누락돼 있었음 → 이번에 복구** |
| `app/` 라우트 · `assets/` · `babel.config.js` | ❌ **없음** → M1.5로 분리 |
| 로그인 / 동의 3분할 / 안전성(연령·BMI) 화면 | ❌ **없음** (스토어 로직만 존재) |
| `supabase/config.toml` | ❌ 없음 → M2에서 `supabase init` 필요 |

---

## M0 — 승인 대기 걸기 (오늘, 30분)

**늦으면 전부가 대기합니다. 다른 일 하기 전에 신청부터 걸어두세요.**

| # | 할 일 | 소요 | 상태 |
|---|---|---|---|
| 0-1 | 공공데이터포털 `식품영양성분DB정보`(15127578) 활용신청 | 자동승인 | ✅ 완료 |
| 0-2 | **Google Play 개발자 등록 $25** | 신원확인 수일 | ⬜ |
| 0-3 | Gemini API 키 발급 (Google AI Studio) | 즉시 | ⬜ |
| 0-4 | Supabase 프로젝트 생성 — **리전 `ap-northeast-2`(서울)** | 5분 | ⬜ |
| 0-5 | Firebase 프로젝트 → Android 앱 `com.rebody.app` 등록 → `google-services.json` 다운로드 | 10분 | ⬜ |
| 0-6 | Firebase 서비스 계정 키 발급 (FCM v1용) | 5분 | ⬜ |
| 0-7 | MFDS 인증키 **재발급** (대화에 노출된 키 폐기) | 즉시 | ⬜ |

> **0-4 리전 주의**: 건강정보를 국내에 저장해야 개인정보처리방침의 "국내 저장" 문구와 실제가 일치합니다. 나중에 리전 변경은 불가능합니다.

**게이트**: 0-2가 "검토 중"으로 넘어갔고, 0-3~0-6 키가 손에 있으면 통과.

---

## M1 — 레포 정리 (거의 완료)

| # | 할 일 | 상태 |
|---|---|---|
| 1-1 | `rebody.tar.gz` 압축 해제 | ✅ |
| 1-2 | GitHub `mengro1102/rebody-project` 레포 생성 | ✅ |
| 1-3 | 초기 커밋 & 푸시 | ✅ |
| 1-4 | **`.gitignore` · `.env.example` 복구** — 웹 UI 업로드가 점(.)으로 시작하는 파일을 빠뜨렸습니다 | ✅ 이번 커밋 |
| 1-5 | `npm run typecheck` 오류 수정 (`src/lib/theme.ts`) | ✅ 이번 커밋 |
| 1-6 | `rebody.tar.gz`를 레포에서 삭제 | ⬜ **직접** |
| 1-7 | 저장소 루트 구조 정리 — 지금은 `rebody-project/rebody/…` 2단입니다. `rebody/` 내용을 루트로 올리거나, 그대로 둘 거면 CI·EAS 경로를 `rebody/` 기준으로 고정 | ⬜ **직접** |
| 1-8 | `docs/04_PRIVACY_POLICY.md`용 **공개** 레포 별도 생성 → GitHub Pages 활성화 | ⬜ **직접** |
| 1-9 | 방침의 `{{운영자명}}`, `{{이메일주소}}` 치환 → `.env`의 `EXPO_PUBLIC_PRIVACY_POLICY_URL`도 같이 갱신 | ⬜ **직접** |

> **1-4가 중요한 이유**: `.gitignore`가 없는 상태에서 `google-services.json`이나 `.env`를 추가하면 그대로 커밋됩니다. 복구 전에 키 파일을 레포에 두지 마세요.

**게이트**: `npm test` 63개 통과(✅) + `npm run typecheck` 0 errors(✅) + 개인정보처리방침 공개 URL 확보.

---

## M1.5 — 앱 셸 구축 ◀ **신설** (M4의 선행 조건)

**현 상태: 화면 5개는 있는데 그 화면을 띄우는 앱이 없습니다.**
`package.json`의 `main`은 `expo-router/entry`인데 `app/` 디렉터리가 없어 라우트가 0개입니다.
`src/screens/*`를 import하는 코드도 레포 어디에도 없습니다. 이대로면 `npm start`도 `eas build`도 진행되지 않습니다.

| # | 할 일 | 비고 |
|---|---|---|
| 1.5-1 | `app/` 라우트 생성 — `_layout.tsx`(세션 가드) · `index` · `onboarding` · `scanner` · `settings/notifications` · `paywall` | `src/screens/*`를 연결만 하면 됨 |
| 1.5-2 | **로그인/회원가입 화면** | `useAuthStore.signUpWithEmail` 존재, UI 없음 |
| 1.5-3 | **동의 3분할 화면** (이용약관 / 민감정보 / 국외이전 / 선택 마케팅) | `grantConsents()` 존재, UI 없음 — **법적 필수** |
| 1.5-4 | **안전성 온보딩** (연령·BMI·임신 게이트) | `domain/safety.ts`의 `checkEligibility` 존재, 호출하는 화면 없음 — **Play 정책** |
| 1.5-5 | 계정 삭제 UI | `deleteAccount()`(`delete_my_account` RPC) 존재, 진입점 없음 — **Play 필수 요건** |
| 1.5-6 | ICS 내보내기 버튼 | `export-ics` 함수 존재, 클라이언트 호출 없음 |
| 1.5-7 | `babel.config.js` 추가 (`babel-preset-expo`) | Expo 빌드 전제 |
| 1.5-8 | `assets/` 이미지 4종 — `icon.png` · `splash.png` · `adaptive-icon.png` · `notification-icon.png` | `app.config.ts`가 참조 중. 없으면 빌드 실패 |

> 1.5-3·1.5-4·1.5-5는 **없으면 심사에서 막히거나 국내법 위반**입니다. 화면 작업 중 가장 먼저 하세요.
> 1.5-1~1.5-6은 코드 작업이라 저에게 넘기셔도 됩니다. 1.5-8(이미지)은 M6-1의 아이콘 작업과 함께 하는 게 효율적입니다.

**게이트**: `npm start`로 앱이 실행되고, 로그인 → 동의 → 안전성 게이트 → 프리셋 선택 → 대시보드까지 화면이 이어질 것.

---

## M2 — 백엔드 배포 (1~2시간)

| # | 할 일 |
|---|---|
| 2-0 | `supabase init` — `supabase/config.toml`이 없어 `link`/`db push`가 바로 실패합니다 |
| 2-1 | `cp .env.example .env` → Supabase URL / anon key 입력 |
| 2-2 | `supabase link --project-ref <ref>` |
| 2-3 | `supabase db push` — 마이그레이션 **6개** 적용 |
| 2-4 | Vault에 시크릿 등록 (cron이 Edge Function 호출에 사용) |
| 2-5 | `supabase secrets set --env-file supabase/.env.local` — GEMINI / MFDS / FCM |
| 2-6 | `supabase functions deploy` — Edge Function **7개** |
| 2-7 | **MFDS 실호출 검증** (아래 2-7 상세) |
| 2-8 | **RLS 실측 검증** (아래 2-8 상세) |
| 2-9 | cron 4건 등록 확인 |

```sql
-- 2-4
select vault.create_secret('<project-ref>.supabase.co', 'project_host');
select vault.create_secret('<service-role-key>',        'service_role_key');

-- 2-9
select jobname, schedule, active from cron.job;
```

### 2-7. MFDS 실호출 — 가장 조용히 크게 틀릴 수 있는 지점

```bash
MFDS_SERVICE_KEY=<재발급 키> npx tsx scripts/probe-mfds.ts 김치찌개
```

- 12개 필드를 `OK` / `MISS`로 자동 검증합니다.
- **전부 `OK`** → 수정 불필요, 다음으로.
- **`MISS` 하나라도 있음** → 그 출력을 저에게 주세요. `FIELD_MAPS`를 맞추겠습니다.
- `SERVING_SIZE`가 `"100g"` 형태인지 함께 확인. 이 값이 모든 영양소의 분모입니다.

> 매핑이 어긋나면 **에러 없이 0kcal이 저장**됩니다. "동작하는 것처럼 보이는데 값이 다 0"이 가장 잡기 어려운 상태입니다.

### 2-8. RLS 실측 — 코드 리뷰로 대체하지 마세요

1. 테스트 계정 A, B 생성
2. A로 로그인 → 식사 기록 1건 저장
3. B로 로그인 → `meal_logs` 조회
4. **A의 기록이 보이면 안 됩니다.** 보이면 즉시 중단하고 정책 재확인.

**게이트**: 2-7 전부 OK + 2-8 통과 + cron 4건 `active=true`.

---

## M3 — 스캐너 정확도 검증 ◀ **Go/No-Go 게이트** (반나절)

앱을 만들기 전에 합니다. 여기서 방향이 갈립니다. (M1.5와 병렬 진행 가능 — 이 검증에는 앱이 필요 없습니다.)

| # | 할 일 |
|---|---|
| 3-1 | `eval/golden/` 디렉터리 생성 후 한식 사진 **30~50장** 수집 — 현재 `eval/`은 존재하지 않습니다 |
| 3-2 | `eval/golden.json`에 정답 라벨 작성 |
| 3-3 | 테스트 계정을 `user_subscriptions.plan_type = 'pro'`로 변경 (쿼터 우회) |
| 3-4 | 해당 계정 JWT를 `EVAL_USER_JWT`에 설정 (`SUPABASE_URL`, `SUPABASE_ANON_KEY`도 함께) |
| 3-5 | `npm run eval:scanner` 실행 |

```json
// eval/golden.json
[
  { "file": "01.jpg", "food_name": "김치찌개", "calories": 320 },
  { "file": "02.jpg", "food_name": "제육볶음", "calories": 450 }
]
```

### 합격선

| 지표 | 기준 |
|---|---|
| 음식명 top-1 정확도 | ≥ 70% |
| MFDS 매칭률 | ≥ 60% |
| 칼로리 오차 ±25% 이내 | ≥ 70% |
| p95 응답시간 | ≤ 6초 |
| 1건당 비용 | ≤ $0.002 |

### 판정

- **GO** → M4로. 스캐너를 1급 기능으로 유지.
- **NO-GO** → 순서대로 시도:
  1. `GEMINI_MODEL=gemini-3.5-flash-lite`로 승급 후 재측정 (비용 재확인)
  2. 프롬프트에 한식 카테고리 힌트 주입
  3. MFDS 매칭률만 낮다면 → 표준데이터 CSV([15100064](https://www.data.go.kr/data/15100064/standard.do))를 Supabase에 적재해 자체 검색으로 전환
  4. 그래도 미달 → **피벗**: "사진 스캔"을 "텍스트 검색 우선 + 사진 보조"로 격하

> **NO-GO는 프로젝트 중단 사유가 아닙니다.** 이 앱의 차별점은 스캐너가 아니라 교대근무 사이클 스케줄링입니다. 판단 대상은 "스캐너의 위상"이지 프로젝트가 아닙니다.

**게이트**: GO 판정, 또는 피벗 방향 확정.

---

## M4 — 앱 빌드 · 실기기 검증 (1~2일)

**선행 조건: M1.5 완료.** 앱 셸이 없으면 이 단계는 시작할 수 없습니다.

| # | 할 일 |
|---|---|
| 4-1 | `eas init` → `app.config.ts`의 `EAS_PROJECT_ID` 채우기 |
| 4-2 | `google-services.json`을 프로젝트 루트에 배치 (커밋 금지 — `.gitignore` 복구됨) |
| 4-3 | `eas build --profile development --platform android` |
| 4-4 | 실기기 설치 후 아래 체크리스트 전수 확인 |

### 실기기 체크리스트

- [ ] 회원가입 → **동의 3분할**(약관 / 민감정보 / 국외이전)이 개별 체크되는가
- [ ] 프리셋 4종 선택 → 사이클 기준일 입력 → 스케줄 생성
- [ ] 자연어 보정 ("금요일은 오후 근무예요") → 반영 또는 되묻기
- [ ] **야간 근무 프리셋에서 단식 종료 시각이 12시간 어긋나지 않는가** ← 가장 중요
- [ ] 대시보드 타이머가 1초마다 갱신되는가
- [ ] 카메라 촬영 → 분석 → 중량 조절 → 저장 전체 플로우
- [ ] **무료 4번째 스캔이 402로 막히는가**
- [ ] **앱 삭제 후 재설치해도 여전히 막히는가** ← 서버 쿼터 검증
- [ ] 푸시 소프트 애스크 → 시스템 다이얼로그 순서
- [ ] Android 설정에 알림 채널 3개가 분리 표시되는가
- [ ] ICS 내보내기 → Google 캘린더에서 시각이 맞는가
- [ ] BMI 18.5 미만 입력 시 단식 기능이 차단되는가
- [ ] 계정 삭제 → 재로그인 불가 + 사진까지 소멸

**게이트**: 위 항목 전부 통과. 특히 야간 근무 시각과 쿼터 우회 불가 2건.

---

## M5 — 결제 연동 (M0-2 승인 후, 반나절)

**Play Console 등록이 끝나야 시작할 수 있습니다.**

| # | 할 일 |
|---|---|
| 5-1 | Play Console에 앱 생성 |
| 5-2 | 구독 상품 등록: `rebody_pro_monthly`, `rebody_pro_annual` |
| 5-3 | **내부 테스트 트랙에 1회 배포** ← 이게 있어야 인앱상품이 조회됨 |
| 5-4 | RevenueCat 프로젝트 생성 → Play 서비스 계정 키 업로드 |
| 5-5 | Entitlement `pro` 생성 및 상품 매핑 |
| 5-6 | RevenueCat 웹훅 → `user_subscriptions` 갱신 엔드포인트 연결 |
| 5-7 | `.env`의 `EXPO_PUBLIC_BILLING_MODE=live`로 전환 |
| 5-8 | 라이선스 테스터 계정으로 결제 → 복원 → 해지 전 과정 검증 |

> 5-6 주의: RevenueCat 웹훅을 받을 Edge Function은 **아직 없습니다**. 이 시점에 하나 추가해야 합니다.

**게이트**: 결제 후 `user_subscriptions.plan_type`이 `pro`로 바뀌고, 스캔 무제한이 실제로 풀리는지 확인.

---

## M6 — 스토어 등록 (1일)

| # | 할 일 |
|---|---|
| 6-1 | 앱 아이콘 512×512 (Figma 무료 플랜) — 워드마크 `Re:Body`, 등록명 `ReBody` · M1.5-8의 `assets/` 4종도 여기서 함께 |
| 6-2 | 피처 그래픽 1024×500 |
| 6-3 | 스크린샷 4~8장 (대시보드 / 스캐너 결과 / 주간 리포트 / 온보딩) |
| 6-4 | 짧은 설명 80자 · 자세한 설명 4000자 |
| 6-5 | 개인정보처리방침 URL 입력 (M1-8에서 만든 것) |
| 6-6 | **Data Safety 신고** — `docs/03_DATA_SAFETY.md` 표를 그대로 옮김 |
| 6-7 | 콘텐츠 등급 설문 · 카테고리(건강/피트니스) · 타겟 연령 18세 이상 |
| 6-8 | 건강 앱 추가 선언 (의료기기 아님 + 안전장치 설명) |

### 설명문에 쓰면 안 되는 표현
"치료" · "체중 감량 보장" · "의학적 효과" · "질병 개선" — 심사 반려 사유입니다.

**게이트**: Play Console 모든 필수 섹션 초록불.

---

## M7 — 단계적 출시 (1~2주)

```
내부 테스트 (1~3명, 3일)
  → 비공개 테스트 (10~20명, 1주)
    → 프로덕션 20%   ← eas.json의 rollout: 0.2
      → 48시간 관찰: 크래시율 <1%, ANR <0.5%
        → 50% → 24시간 관찰
          → 100%
```

| # | 할 일 |
|---|---|
| 7-1 | Crashlytics 연동 및 첫 크래시 수신 확인 |
| 7-2 | `eas build --profile production` → `eas submit` |
| 7-3 | 각 롤아웃 단계에서 Play Console 'Android vitals' 확인 |
| 7-4 | 초기 1~2주는 리뷰 매일 확인 |

---

## 운영 시작 후 (상시)

```sql
-- 캐시 히트율 = Gemini 비용 절감률
select source, count(*), sum(hit_count),
       round(sum(hit_count)::numeric / nullif(count(*),0), 1) as avg_hits
  from food_nutrition_cache group by source;

-- Supabase 슬립 방지가 돌고 있는지
select pinged_at, ping_count from system_heartbeat;

-- 푸시 실패 사유 분포
select notification_type, error, count(*)
  from push_notification_logs
 where not delivered group by 1, 2;
```

- Gemini 첫 달 청구액이 추정($1~3)과 맞는지 대조
- JS/UI 변경은 `eas update`로만 배포 (빌드 쿼터 절약)

---

## 절대 하지 말 것

- ❌ `service_role` 키를 앱 번들이나 `EXPO_PUBLIC_*`에 넣기
- ❌ RLS 없이 테이블 추가 (새 테이블마다 정책도 함께)
- ❌ 스캔 쿼터를 클라이언트에서만 세기
- ❌ Analytics 이벤트에 칼로리·음식명·건강 데이터 넣기
- ❌ 민감정보·국외이전 동의를 이용약관에 묶어서 한 번에 받기
- ❌ `.env`, `google-services.json`, `play-service-account.json` 커밋

---

## 지금 저에게 넘기실 것

| 시점 | 넘길 것 | 제가 할 일 |
|---|---|---|
| M1.5 착수 시 | "앱 셸 만들어줘" 한마디 | `app/` 라우트 + 로그인·동의·안전성 온보딩 화면 구현 |
| M2-7 후 | `probe-mfds` 출력에 `MISS`가 있으면 그 출력 | `FIELD_MAPS` 수정 |
| M3-5 후 | `eval/results/*.json` | 결과 해석 및 피벗 여부 판단 |
| M4 중 | 실패한 체크리스트 항목 | 원인 분석 및 수정 |
| M5-6 시점 | Play/RevenueCat 설정 완료 알림 | RevenueCat 웹훅 수신 Edge Function 작성 |
