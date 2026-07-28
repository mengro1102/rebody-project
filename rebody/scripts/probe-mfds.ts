/**
 * 식약처 공공데이터 API 응답 스키마 확인용.
 *
 * 왜 필요한가: 공공데이터포털의 식품영양성분 계열 API는 데이터셋·개정 시기별로
 * 응답 필드명이 다르다. `_shared/mfds.ts`의 FIELD_MAPS가 실제와 어긋나면
 * 예외 없이 조용히 0kcal이 들어간다. 키 발급 직후 반드시 한 번 눈으로 확인할 것.
 *
 * 실행:
 *   MFDS_SERVICE_KEY=<디코딩된 키> npx tsx scripts/probe-mfds.ts 김치찌개
 */

const KEY = process.env.MFDS_SERVICE_KEY;
const BASE = process.env.MFDS_API_BASE ??
  "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02";
const NAME_PARAM = process.env.MFDS_NAME_PARAM ?? "FOOD_NM_KR";

const query = process.argv[2] ?? "김치찌개";

async function main() {
  if (!KEY) {
    console.error("MFDS_SERVICE_KEY가 필요합니다.");
    console.error("공공데이터포털에서 발급받은 두 종류의 키 중 '디코딩' 키를 사용하세요.");
    process.exit(1);
  }

  const url = new URL(BASE);
  url.searchParams.set("serviceKey", KEY);
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("numOfRows", "3");
  url.searchParams.set("type", "json");
  url.searchParams.set(NAME_PARAM, query);

  console.log(`요청: ${BASE}?...&${NAME_PARAM}=${query}\n`);

  const res = await fetch(url);
  const text = await res.text();

  if (text.trimStart().startsWith("<")) {
    console.error("XML 응답을 받았습니다. 대개 다음 중 하나입니다:");
    console.error("  - serviceKey가 인코딩된 키 (디코딩 키를 쓰세요)");
    console.error("  - 아직 승인 대기 중 (신청 후 1~2일)");
    console.error("  - 엔드포인트 URL이 다름 (data.go.kr 상세 페이지의 '요청주소' 확인)");
    console.error(`\n응답:\n${text.slice(0, 600)}`);
    process.exit(1);
  }

  const payload = JSON.parse(text);

  // 응답 구조가 데이터셋마다 다르므로 행 배열을 찾아 나선다.
  const candidates = [
    payload?.body?.items,
    payload?.response?.body?.items,
    payload?.response?.body?.items?.item,
    payload?.I2790?.row,
    payload?.items,
  ];
  const rows = candidates.find((c) => Array.isArray(c) && c.length > 0);

  if (!rows) {
    console.log("행 배열을 찾지 못했습니다. 전체 응답:");
    console.log(JSON.stringify(payload, null, 2).slice(0, 2000));
    return;
  }

  const first = rows[0];
  console.log(`─── 첫 번째 행의 필드 (${Object.keys(first).length}개) ───\n`);
  for (const [k, v] of Object.entries(first)) {
    console.log(`  ${k.padEnd(28)} ${String(v).slice(0, 40)}`);
  }

  // 확정 스펙(15127578) 대비 자동 검증. 눈으로 대조하는 것보다 확실하다.
  const EXPECTED: Record<string, string> = {
    FOOD_NM_KR: "식품명",
    FOOD_CD: "식품코드",
    DB_GRP_NM: "데이터구분명",
    SERVING_SIZE: "영양성분함량기준량 (AMT_NUM*의 분모)",
    AMT_NUM1: "에너지(kcal)",
    AMT_NUM3: "단백질(g)",
    AMT_NUM4: "지방(g)",
    AMT_NUM6: "탄수화물(g)",
    AMT_NUM7: "당류(g)",
    AMT_NUM8: "식이섬유(g)",
    AMT_NUM13: "나트륨(mg)",
    AMT_NUM24: "포화지방산(g)",
  };

  console.log("\n─── FIELD_MAPS 검증 ───\n");
  let missing = 0;
  for (const [key, desc] of Object.entries(EXPECTED)) {
    const present = key in first;
    if (!present) missing++;
    console.log(`  ${present ? "OK  " : "MISS"}  ${key.padEnd(14)} ${desc.padEnd(30)} ${present ? String(first[key]).slice(0, 20) : ""}`);
  }

  if (missing === 0) {
    console.log("\n전부 일치합니다. _shared/mfds.ts를 수정할 필요 없습니다.");
  } else {
    console.log(`\n⚠️  ${missing}개 필드가 응답에 없습니다.`);
    console.log("   supabase/functions/_shared/mfds.ts 의 FIELD_MAPS를 갱신하세요.");
    console.log("   그대로 두면 스캐너가 예외 없이 0kcal을 저장합니다.");
  }

  console.log(`\n참고: SERVING_SIZE = ${JSON.stringify(first.SERVING_SIZE)}`);
  console.log("      이 값이 AMT_NUM* 전체의 분모다. '100g' 형태여야 정상.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
