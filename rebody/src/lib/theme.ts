// 다크 우선 팔레트.
// 야간 근무자가 주 타겟이라 새벽 3시에 침대에서 보는 화면이 기본값이어야 한다.

export const colors = {
  bg: "#0F1115",
  surface: "#181B22",
  surfaceAlt: "#20242D",
  border: "#2A2F3A",

  text: "#F2F4F8",
  textMuted: "#9AA3B2",
  textFaint: "#6B7480",

  // 단식(진행) / 식사(허용) 두 상태를 색으로 즉시 구분한다.
  fasting: "#7C9CF5",
  eating: "#4ADE80",

  warning: "#FBBF24",
  danger: "#F87171",

  // 영양 데이터 출처 배지
  official: "#4ADE80",
  estimate: "#FBBF24",
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

export const typography = {
  display: { fontSize: 44, fontWeight: "700" as const, letterSpacing: -1 },
  title: { fontSize: 22, fontWeight: "700" as const },
  subtitle: { fontSize: 16, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  caption: { fontSize: 13, fontWeight: "400" as const },
  // fontVariant는 RN 타입이 가변 배열(FontVariant[])을 요구하므로 이 객체에는
  // as const를 걸지 않는다. 리터럴이 필요한 fontWeight만 개별로 고정한다.
  mono: { fontSize: 40, fontWeight: "700" as const, fontVariant: ["tabular-nums" as const] },
};
