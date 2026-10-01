// 외부 라이브러리 없이 앱/트레이 아이콘 PNG를 생성한다.
// 사용법: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');
const SS = 4; // 안티앨리어싱용 슈퍼샘플링 배수

// 0..1 정규화 좌표에서 픽셀 색을 돌려준다 (RGBA, 투명이면 null).
function shade(x, y) {
  const cx = 0.5, cy = 0.5;
  const dx = x - cx, dy = y - cy;

  // 기울어진 고리(타원) — 행성 뒤쪽 절반은 행성에 가려진다.
  const a = 0.47, b = 0.13, t = -0.42;
  const rx = dx * Math.cos(t) - dy * Math.sin(t);
  const ry = dx * Math.sin(t) + dy * Math.cos(t);
  const ringD = (rx * rx) / (a * a) + (ry * ry) / (b * b);
  const onRing = ringD > 0.72 && ringD < 1.0;

  const r = Math.hypot(dx, dy);
  const planetR = 0.29;
  if (r < planetR) {
    // 고리의 앞쪽(아래쪽) 절반은 행성 위에 그린다.
    if (onRing && ry > 0) return [255, 214, 120, 255];
    // 좌상단에서 빛이 오는 구 셰이딩
    const lx = -0.5, ly = -0.6;
    const nz = Math.sqrt(Math.max(0, planetR * planetR - r * r)) / planetR;
    const light = Math.max(0, (dx / planetR) * lx + (dy / planetR) * ly + nz * 0.62);
    const k = 0.45 + 0.55 * Math.min(1, light);
    return [Math.round(92 * k + 20), Math.round(110 * k + 30), Math.round(240 * k + 15), 255];
  }
  if (onRing) return [255, 214, 120, 255];
  return null;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round((a / (SS * SS)) * 255);
      }
    }
  }
  return encodePng(size, size, px);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = { 'tray.png': 16, 'tray@2x.png': 32, 'icon.png': 512 };
for (const [name, size] of Object.entries(targets)) {
  fs.writeFileSync(path.join(OUT, name), render(size));
  console.log(`assets/${name} (${size}x${size})`);
}
