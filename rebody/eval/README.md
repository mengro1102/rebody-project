# eval — 스캐너 정확도 평가 (D5 · Go/No-Go 게이트)

앱 없이 Edge Function만으로 수행합니다. 필요한 것은 **한식 사진 30~50장**과 키뿐입니다.

## 준비

```bash
mkdir -p eval/golden           # 사진을 여기 넣습니다 (.gitignore 처리됨 — 커밋되지 않습니다)
cp eval/golden.example.json eval/golden.json
```

`eval/golden.json`에 사진별 정답을 적습니다. 칼로리는 대략적인 1인분 기준으로 적으면 됩니다 —
±25% 오차 판정에만 쓰이므로 정밀할 필요는 없습니다.

## 실행

```bash
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_ANON_KEY=<anon key>
export EVAL_USER_JWT=<테스트 계정의 access_token>

npm run eval:scanner
```

JWT를 얻는 방법: 앱에서 로그인한 뒤 Supabase 대시보드 → Authentication에서 확인하거나,
`supabase.auth.getSession()`의 `access_token`을 로그로 출력해 복사합니다.

**쿼터 우회**: 평가는 수십 건을 연속 호출하므로 무료 3회 제한에 걸립니다.
테스트 계정만 임시로 pro로 바꿉니다.

```sql
update user_subscriptions set plan_type = 'pro' where user_id = '<uuid>';
-- 평가가 끝나면 되돌리세요
update user_subscriptions set plan_type = 'free' where user_id = '<uuid>';
```

> ⚠️ 전역 AI 예산(하루 2,000건)도 함께 소모됩니다. 50장 평가는 50건이라 문제없지만,
> 반복 측정 시 `select * from ai_usage_recent;`로 잔량을 확인하세요.

## 합격선

| 지표 | 기준 |
|---|---|
| 음식명 top-1 정확도 | ≥ 70% |
| MFDS 매칭률 | ≥ 60% |
| 칼로리 오차 ±25% 이내 | ≥ 70% |
| p95 응답시간 | ≤ 6초 |
| 1건당 비용 | ≤ $0.002 |

## 결과 해석

`eval/results/*.json`이 생성됩니다. 이 파일을 그대로 넘겨주시면 판정과 다음 조치를 정리해 드립니다.

NO-GO일 때 시도 순서:
1. `GEMINI_MODEL=gemini-3.5-flash-lite`로 승급 후 재측정 (비용 재확인 — 출력 단가가 3배 이상입니다)
2. 프롬프트에 한식 카테고리 힌트 주입
3. **MFDS 매칭률만 낮다면** → 표준데이터 CSV를 Supabase에 적재해 자체 검색으로 전환
4. 그래도 미달 → 피벗: 사진 스캔을 "텍스트 검색 우선 + 사진 보조"로 격하

> NO-GO는 프로젝트 중단 사유가 아닙니다. 이 앱의 차별점은 스캐너가 아니라 사이클 스케줄링입니다.
> 특히 수익이 없는 지금은 **정확도가 낮은 스캐너가 비용만 쓰는 기능**이 되므로,
> 격하 판단을 미루지 않는 편이 낫습니다.

## 사진 수집 팁

- 실제로 먹는 상황에서 찍은 사진이 좋습니다. 스톡 사진은 조명이 지나치게 좋아 정확도가 과대평가됩니다
- 한 상에 여러 반찬이 있는 사진을 30% 정도 섞으세요 — 실사용에서 가장 흔하고 가장 많이 틀립니다
- 국·찌개류를 반드시 포함하세요. 국물 음식의 중량 추정이 제일 어렵습니다
- 라벨은 식약처 DB에서 검색될 만한 **일반명**으로 (`백종원 김치찌개` ✗ → `김치찌개` ✓)
