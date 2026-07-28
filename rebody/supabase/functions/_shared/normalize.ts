// 음식명 정규화 — 캐시 히트율이 곧 비용 절감률이므로 여기가 돈이 되는 지점이다.
//
// "닭가슴살 100g", "닭 가슴살", "닭가슴살(구운것)" 이 전부 같은 캐시 키로 떨어져야 한다.

const UNIT_PATTERN = /\s*\(?\d+(?:\.\d+)?\s*(?:g|kg|ml|l|인분|개|조각|공기|그릇|컵|스푼)\)?\s*/gi;

/** 조리법·상태 수식어. 영양값 차이가 크지 않거나, 있어도 캐시 통합 이득이 더 큰 것들. */
const MODIFIERS = [
  "구운것", "삶은것", "찐것", "생것", "익힌것", "데친것",
  "구운", "삶은", "찐", "생", "익힌", "데친",
  "국내산", "수입산", "냉동", "냉장", "즉석",
];

export function normalizeFoodName(raw: string): string {
  let s = raw.normalize("NFC").trim().toLowerCase();

  // 괄호 안 부연 제거: "김치찌개(돼지고기)" → "김치찌개"
  s = s.replace(/[（(][^)）]*[)）]/g, " ");
  // 수량/단위 제거
  s = s.replace(UNIT_PATTERN, " ");
  // 구두점 제거
  s = s.replace(/[,·・/\\\-_~"'`]/g, " ");

  for (const m of MODIFIERS) {
    s = s.replaceAll(m, " ");
  }

  // 공백 전면 제거. 한국어는 띄어쓰기 요동이 심해서
  // "닭 가슴살"/"닭가슴살"을 같은 키로 만들려면 이게 가장 확실하다.
  s = s.replace(/\s+/g, "");

  return s;
}

/**
 * 후보 이름들을 유사도 높은 순으로 정렬하기 위한 간이 점수.
 * MFDS 응답 중 어느 행을 고를지 결정하는 데 쓴다. (0~1)
 */
export function similarity(a: string, b: string): number {
  const x = normalizeFoodName(a);
  const y = normalizeFoodName(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  if (y.includes(x) || x.includes(y)) {
    return Math.min(x.length, y.length) / Math.max(x.length, y.length);
  }

  // bigram Dice 계수 — 한글 음절 단위로 잘 동작하고 구현이 짧다.
  const bigrams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  if (bx.size === 0 || by.size === 0) return 0;

  let overlap = 0;
  for (const g of bx) if (by.has(g)) overlap++;
  return (2 * overlap) / (bx.size + by.size);
}
