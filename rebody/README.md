# ReBody (Re:Body · 리바디)

**내 생활 패턴에 맞춰주는 AI 간헐적 단식 스케줄링 앱** — Android only

> 워드마크는 `Re:Body`, 스토어 등록명과 패키지는 `ReBody` / `com.rebody.app`.
> 콜론은 Play Console·Android 패키지명·도메인에서 쓸 수 없어 로고 그래픽에만 사용합니다.

시중 단식 앱(Zero, Fastic 등)은 전부 **"매일 같은 시간에 일어나는 사람"** 을 전제합니다.
현실의 생활 패턴은 그렇게 균일하지 않습니다.

| 이런 사람도 | 지금 앱들은 |
|---|---|
| 주간 직장인 · 학생 | 대체로 맞음 (기존 앱의 유일한 타깃) |
| 알바·프리랜서처럼 요일마다 시간이 다른 사람 | 매일 같은 시각을 강요 |
| 은퇴·재택처럼 고정 출근이 없는 사람 | 기준점이 없어 설정 자체가 막막 |
| 2·3교대 근무자 | 사실상 사용 불가 |
| 해외 출장이 잦아 시차가 바뀌는 사람 | 타임존이 바뀌면 스케줄이 무너짐 |

ReBody는 **사용자의 하루가 어떻게 반복되는지(사이클)를 먼저 이해하고, 그 위에 식사 창을 배치**합니다.
매일 같은 패턴이면 1일 사이클, 주 단위면 7일 사이클, 3교대면 8일 사이클 — 같은 엔진으로 전부 표현됩니다.
교대근무는 이 모델이 다루는 **가장 어려운 케이스**일 뿐, 타깃의 전부가 아닙니다.

---

## 스택

| 레이어 | 선택 | 비용 |
|---|---|---|
| 앱 | Expo (React Native) + TypeScript, Android 전용 | $0 |
| 상태 | Zustand | $0 |
| 백엔드 | Supabase (Postgres + Auth + Edge Functions + Storage) | $0 (Free tier) |
| AI | Gemini `gemini-3.1-flash-lite` | ~$2/월 (DAU 100) |
| 영양 DB | 식약처 공공데이터 | $0 |
| 푸시 | FCM HTTP v1 | $0 |
| 결제 | ⛔ 미사용 (복무 중 수익화 보류) | — |

**필수 고정비는 Google Play 개발자 등록 $25 한 번뿐입니다.** → [`docs/01_COST.md`](docs/01_COST.md)

---

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/00_ANALYSIS.md`](docs/00_ANALYSIS.md) | **착수 문서 분석 리포트** — 정정 사항과 착수 전 리스크 12건 |
| [`docs/01_COST.md`](docs/01_COST.md) | 비용 구조와 절감 장치 |
| [`docs/02_ROADMAP.md`](docs/02_ROADMAP.md) | Phase 0~7 실행 순서 · 포지셔닝 확정 |
| [`docs/03_DATA_SAFETY.md`](docs/03_DATA_SAFETY.md) | Play Console Data Safety 신고 초안 |
| [`docs/04_PRIVACY_POLICY.md`](docs/04_PRIVACY_POLICY.md) | 개인정보처리방침 (GitHub Pages 게시용) |
| [`docs/05_LAUNCH_CHECKLIST.md`](docs/05_LAUNCH_CHECKLIST.md) | 출시 체크리스트 |
| [`docs/06_MY_TASKS.md`](docs/06_MY_TASKS.md) | **내가 해야 할 일 — 개발 트랙 D1~D6 / 배포 트랙 R0~R5** |
| [`docs/07_MONETIZATION_DEFERRED.md`](docs/07_MONETIZATION_DEFERRED.md) | **수익화 보류 결정과 복원 런북** |

---

## 구조

```
rebody/
├── app/                        ← expo-router 라우트. 온보딩 게이트가 여기 있다.
│   ├── _layout.tsx             세션 → 동의 → 안전성 → 스케줄 순서로 분기
│   ├── sign-in.tsx
│   ├── onboarding/             consent(동의 3분할) · profile(안전성) · schedule(프리셋)
│   └── settings/
├── src/
│   ├── domain/                 ← 순수 로직. 테스트가 여기 집중된다.
│   │   ├── cycle.ts            사이클 해석 (타임존 없음, civil-date 정수 연산)
│   │   ├── FastingScheduler.ts 벽시계 → 절대시각 변환 (여기서만 TZ를 안다)
│   │   ├── presets.ts          생활 패턴 프리셋 9종 (일반·불규칙·교대·출장)
│   │   ├── nutrition.ts        매크로 비례 재계산
│   │   └── safety.ts           연령·BMI·임신 게이트
│   ├── store/                  Zustand
│   ├── screens/                대시보드 · 온보딩 · 스캐너 · 알림설정 · 페이월
│   ├── components/             FeedbackCard
│   ├── features/               notifications(FCM) · billing(RevenueCat)
│   └── lib/                    supabase · env · analytics · theme
├── supabase/
│   ├── migrations/             스키마 · RLS · 함수 · cron
│   └── functions/              Edge Functions 7개
├── scripts/
│   ├── eval-food-scanner.ts    Phase 3a Go/No-Go 게이트
│   └── probe-mfds.ts           MFDS 응답 필드 자동 검증
└── __tests__/                  79 tests
```

### 설계상 중요한 경계 두 개

**1. 사이클은 달력의 문제, 알림은 시계의 문제 — 섞지 않는다**

`cycle.ts`는 타임존을 일절 쓰지 않습니다. `'YYYY-MM-DD'` 정수 연산만 합니다.
벽시계 → 절대시각 변환은 `FastingScheduler.ts`에서만 일어납니다.
교대근무 앱에서 "하루가 밀리는" 버그는 거의 전부 이 둘을 섞으면서 생깁니다.

DB도 같은 원칙입니다 — 스케줄 시각은 `time`(벽시계), 날짜는 `date`(civil date)로 저장하고,
실제 발생한 사건(단식 시작/종료)만 `timestamptz`로 저장합니다.

**2. 클라이언트를 믿지 않는다**

- 스캔 쿼터 → `consume_scan_quota()` DB 함수가 원자적으로 차감. 재설치·시계조작 우회 불가
- 데이터 접근 → 전 테이블 RLS. anon key는 공개돼도 무방
- 구독 상태 → RevenueCat 웹훅이 서버를 갱신. 클라이언트는 표시만
- AI 제안 적용 → `apply_feedback_adjustment()`가 제안된 값만 반영

---

## 시작하기

```bash
npm install
cp .env.example .env          # Supabase URL / anon key 채우기

# 백엔드
supabase link --project-ref <ref>
supabase db push                                   # 마이그레이션 7개
supabase secrets set --env-file supabase/.env.local # GEMINI / MFDS / FCM
supabase functions deploy                           # Edge Function 7개

# 앱
npm test                      # 도메인 로직 79 tests
npm run typecheck
npm start
```

Vault 시크릿(cron이 Edge Function을 호출하는 데 필요):

```sql
select vault.create_secret('<project-ref>.supabase.co', 'project_host');
select vault.create_secret('<service-role-key>',        'service_role_key');
```

---

## 배포

```bash
# JS/UI 변경 — 빌드 쿼터를 쓰지 않는다
eas update --branch production

# 네이티브 변경(권한 추가 등)이 있을 때만
eas build --profile production --platform android
```

---

## MVP 스코프

**포함** — Cycle 기반 AI 스케줄링(생활패턴 프리셋 9종 + 자연어 보정) · 단식 타이머 · ICS 내보내기 ·
단식/식사 기록 · 하이브리드 푸드 스캐너(Gemini + 식약처 DB) · 주간 AI 코칭 · FCM 푸시

**⛔ 수익화 없음** — 운영자의 복무 사정으로 MVP는 **무료로만** 배포합니다. 인앱 결제·구독·광고를
운영하지 않습니다. 사진 분석만 비용 방어를 위해 하루 3회로 제한합니다.
→ [`docs/07_MONETIZATION_DEFERRED.md`](docs/07_MONETIZATION_DEFERRED.md)

**V2 이연** — 홈 화면 위젯 · B2B 체육관 리포트 · 제휴 커머스 카드 · 완전 자유형 3교대 자연어 파싱 · 결제

---

## 면책

ReBody가 제공하는 정보는 일반적인 건강 정보이며 의학적 진단·치료·처방을 대체하지 않습니다.
만 18세 미만, BMI 18.5 미만, 임신·수유 중인 경우 단식 스케줄 기능이 제공되지 않습니다.
