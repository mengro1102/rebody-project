/**
 * Phase 3a — 푸드 스캐너 정확도 스파이크 (Go/No-Go 게이트)
 *
 * 앱도, 로그인도, 스케줄 엔진도 필요 없다. 배포된 analyze-food-image Edge Function에
 * 골든셋 사진을 던져 정확도를 숫자로 낸다.
 *
 * 왜 이걸 Phase 2보다 먼저 돌리는가:
 *   스케줄 온보딩(Phase 2)은 UI 작업량이 크다. 그걸 다 만들고 나서
 *   "AI가 한식을 못 알아본다"를 알게 되면 손실이 훨씬 크다. (docs/00_ANALYSIS.md §3)
 *
 * 준비:
 *   1. eval/golden/ 에 한식 사진 30~50장 (jpg)
 *   2. eval/golden.json 에 정답 라벨:
 *      [{ "file": "01.jpg", "food_name": "김치찌개", "calories": 320 }, ...]
 *   3. .env 에 SUPABASE_URL / SUPABASE_ANON_KEY / EVAL_USER_JWT
 *      (EVAL_USER_JWT: 테스트 계정으로 로그인해 얻은 access_token.
 *       쿼터를 우회하려면 해당 계정을 pro로 만들어 둘 것)
 *
 * 실행:  npm run eval:scanner
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const JWT = process.env.EVAL_USER_JWT;

const GOLDEN_DIR = "eval/golden";
const GOLDEN_JSON = "eval/golden.json";
const RESULTS_DIR = "eval/results";

// 합격선 (docs/02_ROADMAP.md Phase 3a)
const THRESHOLDS = {
  nameAccuracy: 0.70,
  mfdsMatchRate: 0.60,
  calorieWithin25: 0.70,
  p95LatencyMs: 6000,
};

interface GoldenItem {
  file: string;
  food_name: string;
  calories?: number;
}

interface ScanItem {
  food_name: string;
  display_name: string;
  portion_g: number;
  calories: number | null;
  source: "mfds_db" | "ai_estimate";
  confidence: number;
  cache_hit: boolean;
}

interface Outcome {
  file: string;
  expected: string;
  got: string | null;
  nameMatch: boolean;
  source: string | null;
  expectedCalories?: number;
  gotCalories: number | null;
  calorieErrorPct: number | null;
  latencyMs: number;
  error?: string;
}

/** mfds.ts의 normalizeFoodName과 같은 규칙 — 채점 기준을 런타임과 일치시킨다. */
function normalize(raw: string): string {
  return raw
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[（(][^)）]*[)）]/g, " ")
    .replace(/\s*\(?\d+(?:\.\d+)?\s*(?:g|kg|ml|l|인분|개|조각|공기|그릇|컵|스푼)\)?\s*/gi, " ")
    .replace(/[,·・/\\\-_~"'`]/g, " ")
    .replace(/\s+/g, "");
}

async function scanOne(base64: string): Promise<{ items: ScanItem[]; latencyMs: number }> {
  const t0 = Date.now();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-food-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY!,
      Authorization: `Bearer ${JWT}`,
    },
    body: JSON.stringify({
      image_base64: base64,
      mime_type: "image/jpeg",
      local_date: new Date().toISOString().slice(0, 10),
    }),
  });

  const latencyMs = Date.now() - t0;
  const body = await res.json();

  if (!res.ok || body.error) {
    throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
  }
  return { items: body.items ?? [], latencyMs };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

async function main() {
  if (!SUPABASE_URL || !ANON_KEY || !JWT) {
    console.error("SUPABASE_URL / SUPABASE_ANON_KEY / EVAL_USER_JWT 환경변수가 필요합니다.");
    process.exit(1);
  }
  if (!existsSync(GOLDEN_JSON)) {
    console.error(`${GOLDEN_JSON} 이 없습니다. 골든셋 라벨을 먼저 만들어 주세요.`);
    process.exit(1);
  }

  const golden: GoldenItem[] = JSON.parse(readFileSync(GOLDEN_JSON, "utf8"));
  const available = new Set(readdirSync(GOLDEN_DIR));
  const outcomes: Outcome[] = [];

  console.log(`골든셋 ${golden.length}건 평가 시작\n`);

  for (const item of golden) {
    if (!available.has(item.file)) {
      console.warn(`  [skip] ${item.file} — 파일 없음`);
      continue;
    }

    const base64 = readFileSync(join(GOLDEN_DIR, item.file)).toString("base64");

    try {
      const { items, latencyMs } = await scanOne(base64);
      const top = items[0] ?? null;

      const gotName = top ? (top.display_name || top.food_name) : null;
      const nameMatch = gotName !== null && normalize(gotName) === normalize(item.food_name);

      let calorieErrorPct: number | null = null;
      if (item.calories && top?.calories) {
        calorieErrorPct = Math.abs(top.calories - item.calories) / item.calories;
      }

      outcomes.push({
        file: item.file,
        expected: item.food_name,
        got: gotName,
        nameMatch,
        source: top?.source ?? null,
        expectedCalories: item.calories,
        gotCalories: top?.calories ?? null,
        calorieErrorPct,
        latencyMs,
      });

      const mark = nameMatch ? "✓" : "✗";
      console.log(
        `  ${mark} ${item.file.padEnd(12)} 기대:${item.food_name.padEnd(10)} ` +
        `실제:${(gotName ?? "-").padEnd(10)} [${top?.source ?? "-"}] ${latencyMs}ms`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outcomes.push({
        file: item.file, expected: item.food_name, got: null, nameMatch: false,
        source: null, gotCalories: null, calorieErrorPct: null, latencyMs: 0, error: msg,
      });
      console.log(`  ! ${item.file} — ${msg}`);
    }

    // 무료 티어 레이트리밋 회피
    await new Promise((r) => setTimeout(r, 1200));
  }

  // ── 집계 ────────────────────────────────────────────────
  const valid = outcomes.filter((o) => !o.error);
  const n = valid.length || 1;

  const nameAccuracy = valid.filter((o) => o.nameMatch).length / n;
  const mfdsMatchRate = valid.filter((o) => o.source === "mfds_db").length / n;

  const withCalories = valid.filter((o) => o.calorieErrorPct !== null);
  const calorieWithin25 = withCalories.length
    ? withCalories.filter((o) => o.calorieErrorPct! <= 0.25).length / withCalories.length
    : 0;

  const p95 = percentile(valid.map((o) => o.latencyMs), 0.95);

  const results = {
    ran_at: new Date().toISOString(),
    model: process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite (기본값)",
    total: outcomes.length,
    errors: outcomes.length - valid.length,
    metrics: {
      name_accuracy: nameAccuracy,
      mfds_match_rate: mfdsMatchRate,
      calorie_within_25pct: calorieWithin25,
      p95_latency_ms: p95,
    },
    thresholds: THRESHOLDS,
    outcomes,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  const line = (label: string, value: number, threshold: number, fmt = (v: number) => `${(v * 100).toFixed(1)}%`) => {
    const pass = value >= threshold;
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(24)} ${fmt(value).padStart(8)}  (기준 ${fmt(threshold)})`);
    return pass;
  };

  console.log("\n─────────────────────────────────────────");
  console.log(`평가 결과 (${valid.length}/${outcomes.length}건 성공)\n`);
  const p1 = line("음식명 top-1 정확도", nameAccuracy, THRESHOLDS.nameAccuracy);
  const p2 = line("MFDS 매칭률", mfdsMatchRate, THRESHOLDS.mfdsMatchRate);
  const p3 = line("칼로리 오차 ±25% 이내", calorieWithin25, THRESHOLDS.calorieWithin25);
  const p4 = p95 <= THRESHOLDS.p95LatencyMs;
  console.log(`  ${p4 ? "PASS" : "FAIL"}  ${"p95 응답시간".padEnd(24)} ${`${p95}ms`.padStart(8)}  (기준 ${THRESHOLDS.p95LatencyMs}ms)`);

  const allPass = p1 && p2 && p3 && p4;
  console.log("─────────────────────────────────────────");
  console.log(allPass
    ? "\nGO — Phase 2로 진행. 스캐너를 1급 기능으로 유지합니다."
    : "\nNO-GO — 순서대로 시도하세요:\n" +
      "  1. GEMINI_MODEL=gemini-3.5-flash-lite 로 승급 후 재측정 (비용 재확인)\n" +
      "  2. 프롬프트에 한식 카테고리 힌트 주입\n" +
      "  3. 그래도 미달이면 피벗: '사진 스캔' → '텍스트 검색 우선 + 사진 보조'\n" +
      "     (이 앱의 차별점은 스캐너가 아니라 교대근무 스케줄링입니다 — 프로젝트 중단 사유가 아님)");
  console.log(`\n상세 결과: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
