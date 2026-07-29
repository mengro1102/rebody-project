# ReBody — 실행 로드맵 (Phase 0 ~ 7)

> **2026-07-28 포지셔닝 확정 — 타깃은 "교대근무자"가 아니라 "모든 생활 패턴"입니다.**
> 제품 정의는 **간헐적 단식 스케줄링**이고, 차별점은 *사용자의 사이클을 이해한다*는 점입니다.
> 주간 직장인 · 학생 · 알바 · 프리랜서 · 은퇴자 · 재택 · 시차가 바뀌는 출장자 · 2·3교대 근무자를
> 하나의 사이클 엔진으로 전부 덮습니다. 교대근무는 **가장 어려운 케이스이자 신뢰의 증거**로 쓰되,
> 스토어 문구와 온보딩의 1순위 문장은 일반 사용자 언어여야 합니다.
> 이 결정이 코드에 미치는 영향은 `06_MY_TASKS.md`의 **M1.6**에 항목으로 정리했습니다.

원문 착수 문서의 Phase 1~7을 유지하되, **Phase 0(법무·계정 선행)** 을 신설하고
**Phase 3a(스캐너 정확도 스파이크)** 를 Phase 2보다 앞으로 당겼습니다. 근거는 `00_ANALYSIS.md` §3.

```
Phase 0  법무·계정 선행         ── 코드 없음. 승인 대기가 크리티컬 패스
   │
Phase 1  인프라 (DB/RLS/Edge)   ✅ 이 저장소에 구현됨
   │
Phase 3a 스캐너 정확도 스파이크  ◀── Go/No-Go 게이트
   │     └ 불합격 시: 스캐너를 보조 기능으로 격하 (프로젝트 중단 아님)
Phase 2  스케줄 온보딩 + 타이머  ✅ 구현됨
Phase 3b 스캐너 UI              ✅ 구현됨
Phase 4  주간 AI 코칭           ✅ 구현됨
Phase 5  FCM 푸시               ✅ 구현됨
Phase 6  페이월 (Play Billing)  ⚠️ Play Console 등록 후에만 실동작
Phase 7  QA · 스토어 출시 준비    📄 문서 구비됨
```

---

## Phase 0 — 법무·계정 선행 (코드 없음 / 착수 즉시 시작)

승인에 시간이 걸리는 것부터 신청합니다. 이게 늦으면 나머지가 다 대기합니다.

- [ ] **공공데이터포털 API 키 신청** — 승인 1~2일 소요. 가장 먼저.
      - `전국통합식품영양성분정보(음식)표준데이터` (data.go.kr/data/15100070)
      - `식품의약품안전처_식품영양성분DB정보` (data.go.kr/data/15127578)
- [ ] **Google Play 개발자 등록 $25** — 신원확인에 며칠 걸릴 수 있음
- [ ] Google AI Studio에서 Gemini API 키 발급 + 무료 티어 레이트리밋 확인
- [ ] Firebase 프로젝트 생성 (Android 앱 등록 → `google-services.json`)
- [ ] Supabase 프로젝트 생성 (리전: `ap-northeast-2` 서울)
- [ ] **개인정보처리방침 확정 및 공개 URL 확보** (`04_PRIVACY_POLICY.md` → GitHub Pages)
- [ ] 동의 문구 3종 확정: 이용약관 / 민감정보(건강) 별도 동의 / 국외이전 별도 동의

---

## Phase 1 — 인프라 ✅

| 산출물 | 경로 |
|---|---|
| 코어 스키마 | `supabase/migrations/20260727000100_init_core.sql` |
| RLS 정책 | `supabase/migrations/20260727000200_rls_policies.sql` |
| DB 함수 (쿼터/스케줄 해석) | `supabase/migrations/20260727000300_functions.sql` |
| cron 스케줄 | `supabase/migrations/20260727000400_cron.sql` |
| 슬립 방지 | `supabase/functions/keepalive-ping/` |
| Zustand 스토어 | `src/store/` |
| Supabase 클라이언트 | `src/lib/supabase.ts` |
| EAS Android 전용 프로필 | `eas.json` |

검증:
```bash
supabase start && supabase db reset   # 마이그레이션 전체 재적용
npm test                              # 스케줄러 유닛 테스트
```

---

## Phase 3a — 스캐너 정확도 스파이크 (Go/No-Go 게이트)

**앱 없이 Edge Function만으로 수행합니다.**

1. 한식 사진 골든셋 50장 수집 (`eval/golden/*.jpg`), 정답 라벨을 `eval/golden.json`에 기록
2. `npx tsx scripts/eval-food-scanner.ts` 실행
3. 합격선

| 지표 | 합격선 |
|---|---|
| 음식명 top-1 정확도 | ≥ 70% |
| MFDS DB 매칭률 | ≥ 60% |
| 칼로리 오차 ±25% 이내 비율 | ≥ 70% |
| p95 응답시간 | ≤ 6초 |
| 1건당 비용 | ≤ $0.002 |

4. 판정
   - **합격** → Phase 2로 진행, 스캐너를 1급 기능으로 유지
   - **불합격** → 순서대로 시도
     1. `GEMINI_MODEL=gemini-3.5-flash-lite`로 승급 후 재측정 (비용 재확인)
     2. 프롬프트에 한식 카테고리 힌트 주입
     3. 그래도 미달이면 **피벗**: "사진 스캔" → "텍스트 검색 우선 + 사진은 보조 입력". 스캐너를 홈에서 내리고 스케줄링을 전면에.

---

## Phase 2 — 스케줄 온보딩 + 타이머 ✅

- 프리셋 4종: 주간 고정 / 야간 고정 / 2교대 / 3교대 → `src/domain/presets.ts`
- 자연어 보정: `supabase/functions/parse-schedule-nl/` (confidence < 0.6 → 되묻기)
- 사이클 해석: `src/domain/cycle.ts` (순수 civil-date 연산) + `src/domain/FastingScheduler.ts` (instant 변환)
- 타이머 대시보드: `src/screens/DashboardScreen.tsx`
- ICS 내보내기: `supabase/functions/export-ics/` (TZID=Asia/Seoul, 변환 없음)

---

## Phase 3b — 스캐너 UI ✅

- `supabase/functions/analyze-food-image/` — 인식 → 캐시 → MFDS → 폴백 3단
- `src/screens/ScannerScreen.tsx` — 촬영 → 로딩 → 편집 가능 결과 모달(중량 조절 시 매크로 비례 재계산)
- 쿼터: `consume_scan_quota()` DB 함수로 서버 강제 (무료 3회/일)

---

## Phase 4 — 주간 AI 코칭 ✅

- `supabase/functions/generate-weekly-feedback/` — **집계값만** Gemini에 전달 (원본 로그 미전송 = 토큰·프라이버시 동시 절감)
- `weekly_feedback` 테이블 + 대시보드 피드백 카드
- "적용하기" 1탭 → `schedule_overrides` 업서트

---

## Phase 5 — FCM 푸시 ✅

- 소프트 애스크 → `POST_NOTIFICATIONS` 시스템 권한 요청 (Android 13+)
- `send-push` (서비스계정 JWT → OAuth2 → FCM v1)
- `dispatch-scheduled-push` (15분 간격 cron): 단식 시작/종료 30분 전, 미기록 넛지, 주간 피드백 도착
- 카테고리별 독립 토글: 기능성 / 넛지 / 마케팅

---

## Phase 6 — 페이월 ⚠️ Play Console 등록 이후

- RevenueCat + `react-native-purchases` (Google Play Billing 단독)
- **무료 유지**: 최초 AI 스케줄 생성, 첫 주간 피드백 → 유료 전환 전에 핵심 가치 증명
- **유료(Pro)**: 무제한 스캔, 주간 피드백 재적용 무제한, 상세 매크로(나트륨·식이섬유)
- 퍼널 이벤트: view → trial → purchase → cancel (Firebase Analytics)
- 제휴 커머스 카드: V2 이연

> Expo Go에서는 동작하지 않습니다. development build + 내부 테스트 트랙 1회 배포가 선행되어야 인앱상품이 조회됩니다. 그 전까지 `EXPO_PUBLIC_BILLING_MODE=mock`로 UI만 확인하세요.

---

## Phase 7 — QA · 출시 준비 📄

- `docs/03_DATA_SAFETY.md` — Play Console Data Safety 신고 초안
- `docs/04_PRIVACY_POLICY.md` — GitHub Pages 게시용
- `docs/05_LAUNCH_CHECKLIST.md` — 단계적 출시 20% → 50% → 100%
- Crashlytics + Analytics 연동

---

## V2 이연 (MVP 제외 확정)

- 홈 화면 위젯 (네이티브 Kotlin — 시간 비용 최대)
- B2B 체육관 리포트
- 제휴 커머스 카드
- 완전 자유형 3교대 자연어 파싱 자동화 (1차는 프리셋 + 보정)
