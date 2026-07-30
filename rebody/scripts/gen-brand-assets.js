#!/usr/bin/env node
// 브랜드 에셋 생성기 — 외부 의존성 없이 PNG를 직접 인코딩한다.
//
// 왜 스크립트인가: 아이콘·피처 그래픽을 손으로 그린 파일로 커밋하면 크기가 바뀔 때마다
// 다시 그려야 하고, 무엇을 어떻게 만들었는지 기록이 남지 않는다. 여기서 만들면
// 색·비율·여백 규칙이 코드로 남고 재현 가능하다.
//
// 디자인 컨셉 — "진행 중인 링":
//   단식은 "지금 어디쯤인가"가 전부인 경험이다. 그래서 마크는 시계도 접시도 아니라
//   **한 바퀴 도는 링**이다. 링의 빈 구간(우상단 60°)이 "아직 남은 시간"을 뜻한다.
//   안쪽 점은 지금 이 순간. 색은 앱의 eating 그린(#4ADE80) 하나만 쓴다 —
//   단색 실루엣이어야 알림 아이콘·모노크롬 테마에서도 그대로 통한다.
//
// 사용법:
//   node scripts/gen-brand-assets.js            # assets/ 갱신
//   node scripts/gen-brand-assets.js --store    # assets/store/ 까지 생성

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ── 팔레트 (src/lib/theme.ts와 일치시킬 것) ──────────────────
const BG = [0x0f, 0x11, 0x15, 255];
const SURFACE = [0x18, 0x1b, 0x22, 255];
const GREEN = [0x4a, 0xde, 0x80, 255];
const BLUE = [0x7c, 0x9c, 0xf5, 255];
const WHITE = [0xff, 0xff, 0xff, 255];
const CLEAR = [0, 0, 0, 0];

// ── PNG 인코더 ───────────────────────────────────────────────
function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** paint(x, y) -> [r,g,b,a] · 2x 슈퍼샘플링으로 경계를 부드럽게 만든다. */
function png(width, height, paint, { supersample = 2 } = {}) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  const s = supersample;
  const inv = 1 / (s * s);

  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < s; sy++) {
        for (let sx = 0; sx < s; sx++) {
          const px = paint(x + (sx + 0.5) / s, y + (sy + 0.5) / s);
          // 알파 가중 평균. 투명 배경 위 안티에일리어싱에서 색이 검게 뜨는 것을 막는다.
          const al = px[3] / 255;
          r += px[0] * al; g += px[1] * al; b += px[2] * al; a += px[3];
        }
      }
      const aAvg = a * inv;
      const norm = aAvg > 0 ? 255 / aAvg : 0;
      raw[p++] = Math.round(Math.min(255, r * inv * norm));
      raw[p++] = Math.round(Math.min(255, g * inv * norm));
      raw[p++] = Math.round(Math.min(255, b * inv * norm));
      raw[p++] = Math.round(aAvg);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── 마크 ─────────────────────────────────────────────────────
/**
 * 진행 링 + 중심점.
 * @param cx,cy   중심
 * @param r       링 반지름
 * @param t       링 두께
 * @param gapDeg  비어 있는 구간(도). 12시 방향에서 시계방향으로 잘린다.
 */
function ringMark({ cx, cy, r, t, gapDeg = 60, fg, bg, dot = true }) {
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);

    if (dot && d <= r * 0.4) return fg;

    if (Math.abs(d - r) <= t / 2) {
      // 12시를 0도로, 시계방향 증가
      const deg = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      if (deg > 360 - gapDeg) return bg;
      return fg;
    }
    return bg;
  };
}

/** 두 페인터를 합성한다 (위 레이어의 알파가 0이면 아래를 보여준다). */
function over(top, bottom) {
  return (x, y) => {
    const t = top(x, y);
    return t[3] > 0 ? t : bottom(x, y);
  };
}

function solid(color) {
  return () => color;
}

/** 상하 그라디언트. 피처 그래픽 배경용. */
function gradient(from, to, height) {
  return (_x, y) => {
    const k = Math.min(1, Math.max(0, y / height));
    return [
      Math.round(from[0] + (to[0] - from[0]) * k),
      Math.round(from[1] + (to[1] - from[1]) * k),
      Math.round(from[2] + (to[2] - from[2]) * k),
      255,
    ];
  };
}

// ── 출력 ─────────────────────────────────────────────────────
const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "assets");
const storeDir = path.join(assetsDir, "store");
const withStore = process.argv.includes("--store");

fs.mkdirSync(assetsDir, { recursive: true });
if (withStore) fs.mkdirSync(storeDir, { recursive: true });

const written = [];
function write(dir, name, buf) {
  fs.writeFileSync(path.join(dir, name), buf);
  written.push(`${path.relative(root, path.join(dir, name))} (${(buf.length / 1024).toFixed(1)}KB)`);
}

// 1) 앱 아이콘 1024 — 어두운 배경 + 그린 링
write(assetsDir, "icon.png", png(1024, 1024,
  over(ringMark({ cx: 512, cy: 512, r: 330, t: 84, fg: GREEN, bg: CLEAR }), solid(BG))));

// 2) 적응형 아이콘 전경 — 투명 배경, 안전 영역(중앙 66%) 안에 마크를 둔다.
//    바깥은 런처가 마스크로 잘라내므로 여백이 필수다.
write(assetsDir, "adaptive-icon.png", png(1024, 1024,
  ringMark({ cx: 512, cy: 512, r: 250, t: 64, fg: GREEN, bg: CLEAR })));

// 3) 스플래시 — 작게. resizeMode:contain이라 화면 비율과 무관하다.
write(assetsDir, "splash.png", png(1024, 1024,
  over(ringMark({ cx: 512, cy: 512, r: 170, t: 44, fg: GREEN, bg: CLEAR }), solid(BG))));

// 4) 알림 아이콘 — 흰색 단색 실루엣 + 투명 배경.
//    Android는 이 이미지의 알파만 쓰고 색은 app.config.ts의 color로 덮는다.
//    컬러 이미지를 넣으면 흰 사각형으로 렌더링된다.
write(assetsDir, "notification-icon.png", png(96, 96,
  ringMark({ cx: 48, cy: 48, r: 30, t: 9, fg: WHITE, bg: CLEAR })));

if (withStore) {
  // 5) 스토어 아이콘 512 — Play Console 필수. 투명 배경 불가라 배경을 채운다.
  write(storeDir, "icon-512.png", png(512, 512,
    over(ringMark({ cx: 256, cy: 256, r: 165, t: 42, fg: GREEN, bg: CLEAR }), solid(BG))));

  // 6) 피처 그래픽 1024×500 — 좌측 마크, 우측은 문구를 얹을 여백으로 비워 둔다.
  //    (텍스트는 폰트 렌더링이 필요해 여기서 넣지 않는다. Figma에서 얹을 것)
  write(storeDir, "feature-graphic-1024x500.png", png(1024, 500,
    over(
      over(
        ringMark({ cx: 250, cy: 250, r: 140, t: 36, fg: GREEN, bg: CLEAR }),
        // 우측에 은은한 링 하나 더 — 사이클이 반복된다는 은유
        ringMark({ cx: 880, cy: 250, r: 210, t: 6, gapDeg: 120, fg: BLUE, bg: CLEAR, dot: false }),
      ),
      gradient(BG, SURFACE, 500),
    )));
}

console.log("생성됨:\n  " + written.join("\n  "));
if (!withStore) console.log("\n스토어 에셋까지 만들려면: node scripts/gen-brand-assets.js --store");
