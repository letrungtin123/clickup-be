/**
 * Attachment-file generator for scripts/seed-workspace (LOCAL DEVELOPMENT ONLY).
 *
 * Produces small but valid files with invented, generic content for an imaginary photo-retouch company:
 *   png / jpg  – procedural "photos", screenshots and banners (own PNG + baseline JPEG encoders)
 *   pdf        – PDF 1.4, Helvetica (ASCII text, diacritics stripped)
 *   xlsx       – via exceljs
 *   docx       – minimal OPC package written with an own stored-ZIP writer
 *   csv / txt  – UTF-8 (CSV with BOM)
 *
 * Output is deterministic for the same (name, hint): every random choice comes from a RNG seeded by a hash of both.
 * Only node built-ins and exceljs are used.
 */
import { deflateSync } from "node:zlib";
import ExcelJS from "exceljs";

export type GeneratedFile = { bytes: Buffer; mimeType: string };

const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  txt: "text/plain"
} as const;

/** Picks the generator from the extension of `name` (case-insensitive): png, jpg/jpeg, pdf, xlsx, docx, csv, txt. Unknown → txt. Deterministic for the same (name, hint). */
export async function generateFile(name: string, hint?: string): Promise<GeneratedFile> {
  const ext = (/\.([^./\\]+)$/.exec(name)?.[1] ?? "").toLowerCase();
  const ctx = makeContext(name, hint ?? "");
  switch (ext) {
    case "png":
      return { bytes: encodePng(paint(ctx, "png")), mimeType: MIME.png };
    case "jpg":
    case "jpeg":
      return { bytes: encodeJpeg(paint(ctx, "jpg"), 85), mimeType: MIME.jpg };
    case "pdf":
      return { bytes: buildPdf(ctx), mimeType: MIME.pdf };
    case "xlsx":
      return { bytes: await buildXlsx(ctx), mimeType: MIME.xlsx };
    case "docx":
      return { bytes: buildDocx(ctx), mimeType: MIME.docx };
    case "csv":
      return { bytes: buildCsv(ctx), mimeType: MIME.csv };
    default:
      return { bytes: buildTxt(ctx), mimeType: MIME.txt };
  }
}

// =====================================================================================================
// Shared helpers: hashing, RNG, text
// =====================================================================================================

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rint = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const rrange = (r: Rng, lo: number, hi: number): number => lo + r() * (hi - lo);
const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)] as T;
function shuffle<T>(r: Rng, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

/** Removes Vietnamese (and other Latin) diacritics; maps đ→d, Đ→D. */
export function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFC");
}

/** " tokens of s " – lower-case ASCII words separated (and surrounded) by single spaces. */
function normWords(s: string): string {
  const t = stripDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return ` ${t} `;
}

/** Common slug phrases → Vietnamese with diacritics (only used when the file name itself has none). */
const VI_WORDS: Record<string, string> = {
  "bien ban": "biên bản", "hop dong": "hợp đồng", hop: "họp", tuan: "tuần", thang: "tháng",
  "nang suat": "năng suất", "bao cao": "báo cáo", "ke hoach": "kế hoạch", "noi dung": "nội dung",
  "du toan": "dự toán", "ngan sach": "ngân sách", "chi phi": "chi phí", "lich ca": "lịch ca", lich: "lịch",
  "quy dinh": "quy định", "quy trinh": "quy trình", "huong dan": "hướng dẫn", "danh sach": "danh sách",
  "nhan dien": "nhận diện", "thiet ke": "thiết kế", "phong khach": "phòng khách", "phong ngu": "phòng ngủ",
  "noi that": "nội thất", "dao tao": "đào tạo", "noi quy": "nội quy", "tong ket": "tổng kết",
  "de xuat": "đề xuất", "thong bao": "thông báo", "anh loi": "ảnh lỗi", loi: "lỗi", "nhan su": "nhân sự",
  "san xuat": "sản xuất", "chat luong": "chất lượng", "khach hang": "khách hàng", "don hang": "đơn hàng",
  "cap nhat": "cập nhật", tiec: "tiệc", "sinh nhat": "sinh nhật", "vung tau": "Vũng Tàu", truoc: "trước",
  cuoi: "cuối", "kiem tra": "kiểm tra", "chinh sach": "chính sách", "tai lieu": "tài liệu", "ghi chu": "ghi chú"
};
const VI_RE = new RegExp(
  `\\b(${Object.keys(VI_WORDS).sort((a, b) => b.length - a.length).join("|")})\\b`,
  "g"
);

function humanTitle(base: string): string {
  let t = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (t === stripDiacritics(t)) t = t.toLowerCase().replace(VI_RE, (m) => VI_WORDS[m] ?? m);
  t = t
    .split(" ")
    .map((w) => (/^(qc|hdr|nas|kpi|it|hr|sop|v\d+|heic|raw|cv)$/i.test(w) ? w.toUpperCase() : w))
    .join(" ");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Tài liệu";
}

type Ctx = {
  name: string;
  base: string;
  title: string;
  /** normalized words of name + hint */
  words: string;
  /** normalized words of the name only */
  nameWords: string;
  seed: number;
  rng: Rng;
  has: (...kws: string[]) => boolean;
};

function makeContext(name: string, hint: string): Ctx {
  const file = name.replace(/^.*[\\/]/, "");
  const base = file.includes(".") ? file.replace(/\.[^.]*$/, "") : file;
  const words = normWords(`${base} ${hint}`);
  const seed = hash32(`${name}\u0000${hint}`);
  return {
    name,
    base,
    title: humanTitle(base),
    words,
    nameWords: normWords(base),
    seed,
    rng: mulberry32(seed),
    has: (...kws) => kws.some((k) => words.includes(` ${k} `))
  };
}

function numAfter(ctx: Ctx, word: string): number | undefined {
  const m = new RegExp(` ${word} (\\d{1,2}) `).exec(ctx.words);
  return m ? Number(m[1]) : undefined;
}

/** A date implied by the name: "tuan-40" → Monday of ISO week 40/2026, "thang-10" → 1/10/2026, trailing "20-09" → 20/09/2026. */
function dateFromName(ctx: Ctx): Date {
  const wk = numAfter(ctx, "tuan");
  if (wk && wk >= 1 && wk <= 53) return new Date(Date.UTC(2025, 11, 29 + (wk - 1) * 7));
  const mo = numAfter(ctx, "thang");
  if (mo && mo >= 1 && mo <= 12) return new Date(Date.UTC(2026, mo - 1, 1));
  const m = /(\d{1,2}) (\d{1,2}) $/.exec(ctx.nameWords);
  if (m) {
    const d = Number(m[1]);
    const mm = Number(m[2]);
    if (d >= 1 && d <= 31 && mm >= 1 && mm <= 12) return new Date(Date.UTC(2026, mm - 1, d));
  }
  return new Date(Date.UTC(2026, 8, 1 + (ctx.seed % 38)));
}

const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtDate = (d: Date): string => `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

function wrapText(s: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of s.split(/\s+/)) {
    if (!w) continue;
    if (line && line.length + 1 + w.length > max) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

// =====================================================================================================
// CRC32 + byte sink
// =====================================================================================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = (CRC_TABLE[(c ^ (b[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class ByteSink {
  private buf = new Uint8Array(1 << 16);
  private n = 0;
  byte(b: number): void {
    if (this.n === this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.n++] = b;
  }
  u16(v: number): void {
    this.byte((v >> 8) & 0xff);
    this.byte(v & 0xff);
  }
  raw(a: ArrayLike<number>): void {
    for (let i = 0; i < a.length; i++) this.byte(a[i] as number);
  }
  toBuffer(): Buffer {
    return Buffer.from(this.buf.subarray(0, this.n));
  }
}

// =====================================================================================================
// Raster canvas (RGB, 8-bit) with a few drawing primitives and a 5x7 bitmap font
// =====================================================================================================

type RGB = readonly [number, number, number];
type Pt = readonly [number, number];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
];
function gradAt(stops: readonly RGB[], t: number): RGB {
  const n = stops.length - 1;
  if (n <= 0) return stops[0] ?? BLACK;
  const f = clamp(t, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(f));
  return mix(stops[i] as RGB, stops[i + 1] as RGB, f - i);
}

const GLYPHS: Record<string, string> = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110",
  C: "01110 10001 10000 10000 10000 10001 01110", D: "11110 10001 10001 10001 10001 10001 11110",
  E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001",
  I: "01110 00100 00100 00100 00100 00100 01110", J: "00111 00010 00010 00010 00010 10010 01100",
  K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 10001 11001 10101 10011 10001 10001",
  O: "01110 10001 10001 10001 10001 10001 01110", P: "11110 10001 10001 11110 10000 10000 10000",
  Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100",
  U: "10001 10001 10001 10001 10001 10001 01110", V: "10001 10001 10001 10001 10001 01010 00100",
  W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 10001 01010 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  "0": "01110 10001 10011 10101 11001 10001 01110", "1": "00100 01100 00100 00100 00100 00100 01110",
  "2": "01110 10001 00001 00010 00100 01000 11111", "3": "11111 00010 00100 00010 00001 10001 01110",
  "4": "00010 00110 01010 10010 11111 00010 00010", "5": "11111 10000 11110 00001 00001 10001 01110",
  "6": "00110 01000 10000 11110 10001 10001 01110", "7": "11111 00001 00010 00100 01000 01000 01000",
  "8": "01110 10001 10001 01110 10001 10001 01110", "9": "01110 10001 10001 01111 00001 00010 01100",
  "-": "00000 00000 00000 11111 00000 00000 00000", ".": "00000 00000 00000 00000 00000 01100 01100",
  ":": "00000 01100 01100 00000 01100 01100 00000", "!": "00100 00100 00100 00100 00100 00000 00100",
  "/": "00001 00001 00010 00100 01000 10000 10000", "%": "11000 11001 00010 00100 01000 10011 00011",
  ",": "00000 00000 00000 00000 00110 00100 01000"
};
const FONT = new Map<string, number[]>(
  Object.entries(GLYPHS).map(([k, v]) => [k, v.split(" ").map((row) => parseInt(row, 2))])
);
const textW = (s: string, scale: number): number => s.length * 6 * scale - scale;

class Canvas {
  readonly px: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
    bg: RGB = WHITE
  ) {
    this.px = new Uint8ClampedArray(w * h * 3);
    this.rect(0, 0, w, h, bg);
  }

  private put(i: number, c: RGB, a: number): void {
    const p = this.px;
    if (a >= 1) {
      p[i] = c[0];
      p[i + 1] = c[1];
      p[i + 2] = c[2];
    } else if (a > 0) {
      p[i] = (p[i] as number) + (c[0] - (p[i] as number)) * a;
      p[i + 1] = (p[i + 1] as number) + (c[1] - (p[i + 1] as number)) * a;
      p[i + 2] = (p[i + 2] as number) + (c[2] - (p[i + 2] as number)) * a;
    }
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.round(x)), x1 = Math.min(this.w, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y)), y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.put((yy * this.w + xx) * 3, c, a);
  }

  vgrad(x: number, y: number, w: number, h: number, stops: readonly RGB[], a = 1): void {
    const y0 = Math.round(y), y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) this.rect(x, yy, w, 1, gradAt(stops, (yy - y0) / Math.max(1, y1 - y0 - 1)), a);
  }

  /** Diagonal gradient over the whole canvas. */
  dgrad(c1: RGB, c2: RGB): void {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) this.put((y * this.w + x) * 3, mix(c1, c2, (x / this.w) * 0.65 + (y / this.h) * 0.35), 1);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
    const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + ry + 1));
    const m = Math.min(rx, ry);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const cov = clamp((1 - Math.sqrt(dx * dx + dy * dy)) * m + 0.5, 0, 1);
        if (cov > 0) this.put((y * this.w + x) * 3, c, a * cov);
      }
  }

  circle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    this.ellipse(cx, cy, r, r, c, a);
  }

  /** Additive radial light. */
  glow(cx: number, cy: number, rad: number, c: RGB, k: number): void {
    const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(this.w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(this.h - 1, Math.ceil(cy + rad));
    const p = this.px;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / rad;
        if (d >= 1) continue;
        const f = k * (1 - d) * (1 - d);
        const i = (y * this.w + x) * 3;
        p[i] = (p[i] as number) + c[0] * f;
        p[i + 1] = (p[i + 1] as number) + c[1] * f;
        p[i + 2] = (p[i + 2] as number) + c[2] * f;
      }
  }

  poly(pts: readonly Pt[], c: RGB, a = 1): void {
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i] as Pt;
        const [bx, by] = pts[(i + 1) % pts.length] as Pt;
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k] as number)), xb = Math.min(this.w, Math.round(xs[k + 1] as number));
        for (let x = xa; x < xb; x++) this.put((y * this.w + x) * 3, c, a);
      }
    }
  }

  roundRect(x: number, y: number, w: number, h: number, r: number, c: RGB, a = 1): void {
    r = Math.min(r, w / 2, h / 2);
    const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(this.w, Math.ceil(x + w));
    const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) {
        const px = xx + 0.5, py = yy + 0.5;
        const dx = Math.max(x + r - px, 0, px - (x + w - r));
        const dy = Math.max(y + r - py, 0, py - (y + h - r));
        const edge = Math.min(px - x, x + w - px, py - y, y + h - py) + 0.5;
        const cov = clamp(Math.min(r - Math.hypot(dx, dy) + 0.5, edge), 0, 1);
        if (cov > 0) this.put((yy * this.w + xx) * 3, c, a * cov);
      }
  }

  /** Soft drop shadow under a rounded rectangle. */
  shadow(x: number, y: number, w: number, h: number, r: number, spread: number, alpha: number): void {
    for (let i = spread; i >= 1; i--)
      this.roundRect(x - i, y - i + spread * 0.4, w + 2 * i, h + 2 * i, r + i, BLACK, alpha / spread);
  }

  text(s: string, x: number, y: number, scale: number, c: RGB, a = 1): number {
    let cx = x;
    for (const ch of stripDiacritics(s).toUpperCase()) {
      const g = FONT.get(ch);
      if (g)
        for (let row = 0; row < 7; row++)
          for (let col = 0; col < 5; col++)
            if (((g[row] as number) >> (4 - col)) & 1) this.rect(cx + col * scale, y + row * scale, scale, scale, c, a);
      cx += 6 * scale;
    }
    return cx - x - scale;
  }

  noise(r: Rng, amp: number): void {
    const p = this.px;
    for (let i = 0; i < p.length; i += 3) {
      const n = (r() - 0.5) * 2 * amp;
      p[i] = (p[i] as number) + n;
      p[i + 1] = (p[i + 1] as number) + n;
      p[i + 2] = (p[i + 2] as number) + n;
    }
  }

  grade(o: { mul?: number; add?: number; sat?: number; contrast?: number; tint?: RGB }): void {
    const p = this.px;
    const mul = o.mul ?? 1, add = o.add ?? 0, sat = o.sat ?? 1, con = o.contrast ?? 1, t = o.tint ?? BLACK;
    for (let i = 0; i < p.length; i += 3) {
      let r = p[i] as number, g = p[i + 1] as number, b = p[i + 2] as number;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = (l + (r - l) * sat - 128) * con + 128;
      g = (l + (g - l) * sat - 128) * con + 128;
      b = (l + (b - l) * sat - 128) * con + 128;
      p[i] = r * mul + add + t[0];
      p[i + 1] = g * mul + add + t[1];
      p[i + 2] = b * mul + add + t[2];
    }
  }

  vignette(k: number): void {
    const p = this.px, cx = this.w / 2, cy = this.h / 2;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const dx = (x - cx) / cx, dy = (y - cy) / cy;
        const f = 1 - k * Math.min(1, (dx * dx + dy * dy) / 2);
        const i = (y * this.w + x) * 3;
        p[i] = (p[i] as number) * f;
        p[i + 1] = (p[i + 1] as number) * f;
        p[i + 2] = (p[i + 2] as number) * f;
      }
  }

  flipX(): void {
    const p = this.px;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < Math.floor(this.w / 2); x++) {
        const i = (y * this.w + x) * 3, j = (y * this.w + (this.w - 1 - x)) * 3;
        for (let k = 0; k < 3; k++) {
          const t = p[i + k] as number;
          p[i + k] = p[j + k] as number;
          p[j + k] = t;
        }
      }
  }

  blit(src: Canvas, sx: number, sy: number, w: number, h: number, dx: number, dy: number): void {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const tx = dx + x, ty = dy + y, fx = sx + x, fy = sy + y;
        if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h || fx < 0 || fy < 0 || fx >= src.w || fy >= src.h) continue;
        const i = (ty * this.w + tx) * 3, j = (fy * src.w + fx) * 3;
        this.px[i] = src.px[j] as number;
        this.px[i + 1] = src.px[j + 1] as number;
        this.px[i + 2] = src.px[j + 2] as number;
      }
  }
}

// =====================================================================================================
// Procedural painter
// =====================================================================================================

type Scene = "estate" | "screenshot" | "banner" | "event";

function pickScene(ctx: Ctx, fmt: "png" | "jpg"): Scene {
  if (ctx.has("loi", "error", "screenshot", "anh chup", "anh loi", "bug", "crash", "chup man hinh")) return "screenshot";
  if (ctx.has("banner", "banners", "poster", "posters", "post", "thiet ke", "nhan dien", "logo")) return "banner";
  if (ctx.has("team", "building", "tiec", "sinh nhat", "trung thu", "vung tau", "party", "su kien", "du lich"))
    return "event";
  if (ctx.has("before", "after", "phong", "nha", "hdr", "sky", "troi", "noi that", "staging", "truoc", "twilight"))
    return "estate";
  return fmt === "png" ? "screenshot" : "estate";
}

function paint(ctx: Ctx, fmt: "png" | "jpg"): Canvas {
  const scene = pickScene(ctx, fmt);
  let c: Canvas;
  if (scene === "screenshot") c = paintScreenshot(ctx);
  else if (scene === "banner") c = paintBanner(ctx);
  else if (scene === "event") c = paintEvent(ctx);
  else c = paintEstate(ctx);
  // A little sensor grain makes the "photos" look less synthetic (skipped for PNG to keep it small).
  if (fmt === "jpg" && (scene === "estate" || scene === "event")) c.noise(ctx.rng, 3);
  return c;
}

// ---------- real-estate photo ----------

type EstateParams = {
  seed: number;
  horizon: number;
  houseX: number;
  houseW: number;
  houseH: number;
  roofH: number;
  twoStory: boolean;
  garageLeft: boolean;
  wall: RGB;
  roof: RGB;
  sunX: number;
  sunY: number;
  clouds: { x: number; y: number; s: number }[];
  bumps: number[];
  trees: { x: number; s: number }[];
  sofa: RGB;
  accent: RGB;
  artA: RGB;
  artB: RGB;
  windowLeft: boolean;
};

function estateParams(r: Rng): EstateParams {
  const trees = [
    { x: rrange(r, 0.05, 0.15), s: rrange(r, 0.9, 1.25) },
    { x: rrange(r, 0.85, 0.95), s: rrange(r, 0.8, 1.2) }
  ];
  if (r() < 0.5) trees.push({ x: rrange(r, 0.18, 0.22), s: rrange(r, 0.55, 0.75) });
  return {
    seed: Math.floor(r() * 2 ** 31),
    horizon: rrange(r, 0.56, 0.62),
    houseX: rrange(r, 0.46, 0.54),
    houseW: rrange(r, 0.46, 0.54),
    houseH: rrange(r, 0.19, 0.23),
    roofH: rrange(r, 0.1, 0.13),
    twoStory: r() < 0.5,
    garageLeft: r() < 0.5,
    wall: pick(r, [[236, 226, 206], [228, 224, 216], [214, 196, 170], [240, 236, 228], [204, 190, 172]] as const),
    roof: pick(r, [[86, 60, 52], [70, 74, 82], [110, 64, 48], [58, 60, 66]] as const),
    sunX: rrange(r, 0.65, 0.9),
    sunY: rrange(r, 0.08, 0.2),
    clouds: Array.from({ length: rint(r, 3, 5) }, () => ({ x: r(), y: rrange(r, 0.07, 0.3), s: rrange(r, 0.8, 1.6) })),
    bumps: Array.from({ length: 34 }, () => r()),
    trees,
    sofa: pick(r, [[92, 120, 138], [122, 126, 130], [150, 132, 110], [88, 112, 98]] as const),
    accent: pick(r, [[230, 170, 90], [214, 110, 90], [110, 160, 196], [204, 182, 110]] as const),
    artA: pick(r, [[40, 120, 140], [70, 90, 160], [150, 70, 80]] as const),
    artB: pick(r, [[236, 170, 90], [230, 200, 150], [120, 190, 170]] as const),
    windowLeft: r() < 0.5
  };
}

function cloud(c: Canvas, x: number, y: number, s: number, col: RGB, a: number): void {
  c.ellipse(x, y + s * 0.45, s * 2.2, s * 0.45, col, a);
  c.circle(x - s * 0.9, y + s * 0.2, s * 0.7, col, a);
  c.circle(x + s * 0.9, y + s * 0.15, s * 0.8, col, a);
  c.circle(x, y - s * 0.05, s, col, a);
  c.circle(x + s * 0.35, y - s * 0.45, s * 0.7, col, a);
  c.circle(x - s * 1.6, y + s * 0.4, s * 0.45, col, a);
}

function tree(c: Canvas, x: number, base: number, size: number, before: boolean): void {
  c.ellipse(x + size * 0.1, base, size * 0.38, size * 0.05, BLACK, 0.18);
  c.rect(x - size * 0.035, base - size * 0.5, size * 0.07, size * 0.5, [92, 66, 46]);
  const leaf: RGB = before ? [88, 102, 84] : [38, 102, 52];
  const hi: RGB = before ? [120, 130, 110] : [82, 150, 74];
  const blobs: [number, number, number][] = [
    [0, -0.62, 0.3], [-0.2, -0.5, 0.24], [0.21, -0.52, 0.25], [0, -0.85, 0.22], [-0.12, -0.75, 0.2], [0.14, -0.74, 0.2]
  ];
  for (const [dx, dy, rr] of blobs) c.circle(x + dx * size, base + dy * size, rr * size, leaf);
  for (const [dx, dy, rr] of blobs.slice(0, 4))
    c.circle(x + dx * size - rr * size * 0.25, base + dy * size - rr * size * 0.3, rr * size * 0.55, hi, before ? 0.3 : 0.45);
}

function renderExterior(c: Canvas, p: EstateParams, before: boolean): void {
  const W = c.w, H = c.h;
  const r = mulberry32(p.seed);
  const hz = Math.round(H * p.horizon);
  c.vgrad(0, 0, W, hz + 2, before ? [[160, 165, 172], [212, 213, 212]] : [[46, 106, 196], [112, 166, 228], [198, 224, 246]]);
  if (!before) c.glow(W * p.sunX, H * p.sunY, W * 0.36, [255, 222, 160], 0.6);
  for (const cl of p.clouds)
    cloud(c, W * cl.x, H * cl.y, W * 0.045 * cl.s, before ? [188, 190, 196] : WHITE, before ? 0.75 : 0.88);
  // distant tree line
  const tl: RGB = before ? [98, 108, 96] : [46, 98, 62];
  p.bumps.forEach((b, i) =>
    c.circle((i / (p.bumps.length - 1)) * W, hz - H * 0.02 - b * H * 0.035, H * 0.03 + b * H * 0.025, tl)
  );
  c.rect(0, hz - H * 0.025, W, H * 0.03, tl);
  // lawn with mowing stripes
  c.vgrad(0, hz, W, H - hz, before ? [[136, 146, 108], [110, 118, 88]] : [[98, 172, 76], [48, 118, 46]]);
  for (let y = hz + 6, k = 0; y < H; y += 10 + k * 1.6, k++) c.rect(0, y, W, 4 + k * 0.6, WHITE, 0.04);

  // house
  const hw = W * p.houseW, hh = H * p.houseH * (p.twoStory ? 1.35 : 1);
  const hx = W * p.houseX - hw / 2, base = hz + H * 0.08, top = base - hh, rh = H * p.roofH;
  const trim: RGB = [246, 244, 238];
  c.ellipse(hx + hw / 2, base + 2, hw * 0.62, H * 0.025, BLACK, 0.2);
  c.rect(hx + hw * 0.7, top - rh - H * 0.03, W * 0.026, rh * 0.7, mix(p.roof, [150, 90, 70], 0.5));
  const rl = hx - W * 0.02, rr = hx + hw + W * 0.02, tl2 = hx + hw * 0.2, tr2 = hx + hw * 0.8;
  c.poly([[rl, top + 2], [rr, top + 2], [tr2, top - rh], [tl2, top - rh]], p.roof);
  for (let y = top - rh + 5; y < top; y += 5) {
    const t = (y - (top - rh)) / rh;
    const xl = tl2 + (rl - tl2) * t, xr = tr2 + (rr - tr2) * t;
    c.rect(xl, y, xr - xl, 1, BLACK, 0.14);
  }
  c.rect(hx, top, hw, base - top, p.wall);
  for (let y = top + 6; y < base; y += 6) c.rect(hx, y, hw, 1, BLACK, 0.05);
  c.rect(hx, top, hw, 6, BLACK, 0.22);

  // garage
  const gw = hw * 0.32, gh = Math.min(hh * 0.62, H * 0.13);
  const gx = p.garageLeft ? hx + hw * 0.06 : hx + hw - gw - hw * 0.06;
  c.rect(gx - 3, base - gh - 3, gw + 6, gh + 3, trim);
  c.vgrad(gx, base - gh, gw, gh, [[214, 212, 206], [188, 186, 180]]);
  for (let k = 1; k < 4; k++) c.rect(gx, base - gh + (gh * k) / 4, gw, 1.5, BLACK, 0.16);
  // driveway & path
  const drive: RGB = before ? [168, 168, 162] : [182, 178, 170];
  c.poly([[gx, base], [gx + gw, base], [gx + gw + W * 0.1, H], [gx - W * 0.06, H]], drive);

  // ground floor: window – door – window inside the region not used by the garage
  const ra = p.garageLeft ? hx + hw * 0.42 : hx + hw * 0.04;
  const rw = hw * 0.54;
  const winH = H * 0.075, winY = base - H * 0.125;
  const lit: { x: number; y: number; w: number }[] = [];
  const win = (x: number, y: number, w: number, h: number): void => {
    c.rect(x - 3, y - 3, w + 6, h + 6, trim);
    c.vgrad(x, y, w, h, before ? [[124, 132, 142], [98, 106, 116]] : [[255, 224, 150], [244, 174, 92]]);
    c.rect(x + w / 2 - 1, y, 2, h, trim);
    c.rect(x, y + h / 2 - 1, w, 2, trim);
    c.rect(x - 5, y + h + 2, w + 10, 3, trim);
    lit.push({ x: x + w / 2, y: y + h / 2, w });
  };
  win(ra + rw * 0.06, winY, rw * 0.26, winH);
  win(ra + rw * 0.68, winY, rw * 0.26, winH);
  const dw = rw * 0.16, dh = H * 0.11, dx = ra + rw * 0.42;
  c.rect(dx - 3, base - dh - 3, dw + 6, dh + 3, trim);
  c.rect(dx, base - dh, dw, dh, [112, 70, 46]);
  c.rect(dx + dw * 0.15, base - dh + dh * 0.1, dw * 0.7, dh * 0.35, BLACK, 0.12);
  c.rect(dx + dw * 0.15, base - dh * 0.45, dw * 0.7, dh * 0.35, BLACK, 0.12);
  c.circle(dx + dw * 0.82, base - dh * 0.5, 2, [220, 190, 90]);
  c.poly([[dx, base], [dx + dw, base], [dx + dw + W * 0.03, H], [dx - W * 0.03, H]], [198, 188, 172]);
  if (p.twoStory) {
    const n = 4, y2 = top + hh * 0.14, h2 = H * 0.065, w2 = hw * 0.12;
    for (let k = 0; k < n; k++) win(hx + hw * (0.08 + (k * 0.84) / (n - 1)) - w2 / 2, y2, w2, h2);
  }
  // bushes along the facade
  const bush: RGB = before ? [92, 108, 86] : [40, 112, 52];
  for (let x = hx - 8; x < hx + hw + 8; x += 13) {
    if ((x > gx - 8 && x < gx + gw + 8) || (x > dx - 10 && x < dx + dw + 10)) continue;
    const br = 7 + r() * 6;
    c.circle(x + r() * 4, base - 3, br, bush);
    c.circle(x - br * 0.3, base - 3 - br * 0.4, br * 0.5, before ? [120, 130, 110] : [80, 150, 72], 0.5);
  }
  for (const t of p.trees) tree(c, W * t.x, base + H * 0.05 * t.s, H * 0.42 * t.s, before);
  if (!before) for (const l of lit) c.glow(l.x, l.y, l.w * 1.1, [255, 190, 110], 0.28);
  else c.grade({ sat: 0.55, contrast: 0.82, add: 14 });
}

function renderInterior(c: Canvas, p: EstateParams, before: boolean, center = false): void {
  const W = c.w, H = c.h;
  const r = mulberry32(p.seed ^ 0x5bd1e995);
  const fy = Math.round(H * 0.7);
  // wall + crown molding
  c.vgrad(0, 0, W, fy, [[244, 238, 226], [226, 214, 196]]);
  c.rect(0, 0, W, H * 0.03, [250, 248, 244]);
  c.rect(0, H * 0.03, W, 2, BLACK, 0.08);
  // window geometry (always laid out on the left; mirrored at the end when needed)
  // "center": window in the middle of the back wall (used for before/after splits so both halves show it)
  const wx = W * (center ? 0.33 : 0.07), wy = H * (center ? 0.08 : 0.12), ww = W * (center ? 0.34 : 0.3), wh = H * (center ? 0.36 : 0.46);
  // curtains
  const cur: RGB = [206, 176, 146];
  for (const cx of [wx - W * 0.05, wx + ww + W * 0.012]) {
    c.rect(cx, wy - H * 0.04, W * 0.04, wh + H * 0.12, cur);
    for (let k = 1; k < 4; k++) c.rect(cx + (W * 0.04 * k) / 4, wy - H * 0.04, 1.5, wh + H * 0.12, BLACK, 0.12);
  }
  c.rect(wx - W * 0.07, wy - H * 0.055, ww + W * 0.14, 4, [90, 80, 70]);
  // art above the sofa
  const sx = W * (center ? 0.5 : 0.64), sw = W * 0.42;
  const aw = W * (center ? 0.15 : 0.22), ah = H * 0.17, ax = center ? W * 0.08 : sx - aw / 2, ay = H * (center ? 0.2 : 0.15);
  c.shadow(ax - 5, ay - 5, aw + 10, ah + 10, 2, 5, 0.2);
  c.rect(ax - 5, ay - 5, aw + 10, ah + 10, [58, 50, 44]);
  c.vgrad(ax, ay, aw, ah, [p.artA, p.artB]);
  c.circle(ax + aw * 0.68, ay + ah * 0.38, ah * 0.17, [250, 240, 222], 0.9);
  c.poly([[ax, ay + ah], [ax + aw * 0.35, ay + ah * 0.45], [ax + aw * 0.6, ay + ah]], mix(p.artA, BLACK, 0.3));
  // floor: planks
  const wood: RGB = [178, 128, 84];
  for (let y = fy; y < H; ) {
    const ph = 8 + ((y - fy) / (H - fy)) * 11;
    const v = (r() - 0.5) * 20;
    c.rect(0, y, W, ph + 1, [wood[0] + v, wood[1] + v * 0.8, wood[2] + v * 0.6]);
    for (let x = -r() * 120; x < W; x += 90 + r() * 80) c.rect(x, y, 1.5, ph, BLACK, 0.2);
    c.rect(0, y, W, 1, BLACK, 0.12);
    y += ph;
  }
  for (let i = 0; i < 12; i++) c.rect(0, fy + i * 2, W, 2, BLACK, 0.14 * (1 - i / 12));
  c.rect(0, fy - H * 0.028, W, H * 0.028, [248, 246, 240]);
  c.rect(0, fy - 1, W, 1, BLACK, 0.15);
  // rug
  c.ellipse(sx - W * 0.02, H * 0.88, W * 0.32, H * 0.08, [128, 72, 60]);
  c.ellipse(sx - W * 0.02, H * 0.88, W * 0.3, H * 0.066, [224, 214, 198]);
  // sofa
  const so = p.sofa, dark = mix(so, BLACK, 0.18), light = mix(so, WHITE, 0.12);
  const sl = sx - sw / 2;
  c.ellipse(sx, fy + H * 0.065, sw * 0.56, H * 0.03, BLACK, 0.25);
  c.roundRect(sl + sw * 0.06, fy - H * 0.22, sw * 0.88, H * 0.17, 12, dark);
  const cushW = (sw * 0.86) / 3;
  for (let k = 0; k < 3; k++) c.roundRect(sl + sw * 0.07 + k * cushW + 2, fy - H * 0.205, cushW - 4, H * 0.13, 10, light);
  c.roundRect(sl + sw * 0.06, fy - H * 0.075, sw * 0.88, H * 0.1, 8, so);
  c.rect(sl + sw * 0.06, fy - H * 0.075, sw * 0.88, 3, WHITE, 0.15);
  c.roundRect(sl, fy - H * 0.15, sw * 0.09, H * 0.18, 10, dark);
  c.roundRect(sl + sw * 0.91, fy - H * 0.15, sw * 0.09, H * 0.18, 10, dark);
  for (const lx of [sl + sw * 0.05, sl + sw * 0.93]) c.rect(lx, fy + H * 0.03, 5, H * 0.025, [60, 44, 34]);
  c.roundRect(sl + sw * 0.13, fy - H * 0.17, sw * 0.13, H * 0.1, 8, p.accent);
  c.roundRect(sl + sw * 0.74, fy - H * 0.17, sw * 0.13, H * 0.1, 8, mix(p.accent, WHITE, 0.3));
  // coffee table
  const tx = sx - W * 0.02;
  c.ellipse(tx, H * 0.95, W * 0.12, H * 0.012, BLACK, 0.2);
  c.rect(tx - W * 0.11, H * 0.85, 5, H * 0.1, [70, 46, 32]);
  c.rect(tx + W * 0.11 - 5, H * 0.85, 5, H * 0.1, [70, 46, 32]);
  c.roundRect(tx - W * 0.12, H * 0.83, W * 0.24, H * 0.028, 4, [96, 64, 42]);
  c.rect(tx - W * 0.07, H * 0.815, W * 0.06, H * 0.016, [226, 222, 214]);
  c.circle(tx + W * 0.05, H * 0.805, H * 0.022, [238, 238, 234]);
  // plant next to the window
  const px = W * (center ? 0.1 : 0.43);
  for (let k = 0; k < 9; k++)
    c.ellipse(px + (r() - 0.5) * W * 0.06, fy - H * 0.1 - r() * H * 0.12, W * 0.018, H * 0.045, k % 2 ? [60, 128, 72] : [86, 152, 86]);
  c.poly([[px - W * 0.03, fy - H * 0.06], [px + W * 0.03, fy - H * 0.06], [px + W * 0.022, fy + H * 0.035], [px - W * 0.022, fy + H * 0.035]], [196, 190, 180]);
  // floor lamp
  const lx = W * (center ? 0.87 : 0.93);
  c.rect(lx - 2, fy - H * 0.34, 4, H * 0.38, [62, 60, 58]);
  c.ellipse(lx, fy + H * 0.04, W * 0.03, H * 0.01, [62, 60, 58]);
  c.poly([[lx - W * 0.042, fy - H * 0.33], [lx + W * 0.042, fy - H * 0.33], [lx + W * 0.028, fy - H * 0.43], [lx - W * 0.028, fy - H * 0.43]], [244, 234, 212]);

  if (before) c.grade({ mul: 0.66, sat: 0.72, tint: [-4, 0, 10] });
  // window glass: blown out "before", balanced view "after"
  if (before) {
    c.rect(wx, wy, ww, wh, [252, 252, 252]);
    c.glow(wx + ww / 2, wy + wh / 2, ww * 0.95, WHITE, 0.4);
  } else {
    c.vgrad(wx, wy, ww, wh, [[86, 148, 222], [190, 218, 244]]);
    cloud(c, wx + ww * 0.3, wy + wh * 0.22, ww * 0.07, WHITE, 0.9);
    for (let k = 0; k < 9; k++) c.circle(wx + (k / 8) * ww, wy + wh * 0.66 - r() * wh * 0.08, ww * 0.08, [52, 110, 62]);
    c.rect(wx, wy + wh * 0.72, ww, wh * 0.28, [96, 168, 80]);
    // sunlight patch on the floor
    if (!center) c.poly([[wx + ww * 0.1, fy + 4], [wx + ww * 0.9, fy + 4], [wx + ww * 1.25, H * 0.98], [wx + ww * 0.25, H * 0.98]], [255, 246, 220], 0.12);
  }
  const frame: RGB = before ? [214, 214, 212] : [250, 250, 248];
  c.rect(wx - 7, wy - 7, ww + 14, 7, frame);
  c.rect(wx - 7, wy + wh, ww + 14, 7, frame);
  c.rect(wx - 7, wy, 7, wh, frame);
  c.rect(wx + ww, wy, 7, wh, frame);
  c.rect(wx + ww / 2 - 3, wy, 6, wh, frame);
  c.rect(wx, wy + wh * 0.55 - 3, ww, 6, frame);
  c.rect(wx - 14, wy + wh + 7, ww + 28, 5, mix(frame, BLACK, 0.08));
  if (!before) {
    c.glow(lx, fy - H * 0.36, W * 0.17, [255, 196, 120], 0.5);
    c.vignette(0.18);
  }
  if (!p.windowLeft && !center) c.flipX();
}

function label(c: Canvas, s: string, x: number, y: number, scale: number): void {
  const w = textW(s, scale);
  c.roundRect(x, y, w + scale * 6, scale * 7 + scale * 5, scale * 2, [20, 22, 28], 0.6);
  c.text(s, x + scale * 3, y + scale * 2.5, scale, WHITE);
}

function paintEstate(ctx: Ctx): Canvas {
  const W = 640, H = 420;
  const p = estateParams(ctx.rng);
  const interior = ctx.has("phong", "noi that", "staging", "interior", "living", "bep", "kitchen", "bedroom");
  const split =
    (ctx.has("before") && ctx.has("after")) || (ctx.has("truoc") && ctx.has("sau")) || ctx.nameWords.includes(" before after ");
  const render = (before: boolean): Canvas => {
    const c = new Canvas(W, H);
    if (interior) renderInterior(c, p, before, split);
    else renderExterior(c, p, before);
    return c;
  };
  if (!split) return render(ctx.has("before", "truoc", "goc", "raw"));
  const out = render(false);
  out.blit(render(true), 0, 0, W / 2, H, 0, 0);
  out.rect(W / 2 - 2, 0, 4, H, WHITE);
  label(out, "BEFORE", 14, 14, 2);
  label(out, "AFTER", W - 14 - textW("AFTER", 2) - 12, 14, 2);
  return out;
}

// ---------- people / events ----------

const SKINS: readonly RGB[] = [[236, 196, 164], [226, 182, 146], [206, 158, 122], [190, 140, 104]];
const HAIRS: readonly RGB[] = [[30, 24, 22], [46, 34, 28], [24, 20, 20], [70, 46, 32]];

function person(c: Canvas, r: Rng, x: number, baseY: number, height: number, shirt: RGB, pants: RGB): void {
  const skin = pick(r, SKINS), hair = pick(r, HAIRS);
  const headR = height * 0.085, bodyW = height * 0.27, bodyH = height * 0.36, legH = height * 0.42;
  const neckY = baseY - legH - bodyH;
  const armW = bodyW * 0.26;
  c.ellipse(x, baseY, bodyW * 0.75, height * 0.025, BLACK, 0.22);
  c.roundRect(x - bodyW * 0.42, baseY - legH, bodyW * 0.38, legH, 3, pants);
  c.roundRect(x + bodyW * 0.04, baseY - legH, bodyW * 0.38, legH, 3, pants);
  if (r() < 0.35) {
    // arm raised
    c.roundRect(x - bodyW / 2 - armW * 0.6, neckY - height * 0.24, armW, height * 0.32, armW / 2, skin);
    c.roundRect(x + bodyW / 2 - armW * 0.2, neckY + 4, armW, bodyH * 0.9, armW / 2, skin);
  } else {
    c.roundRect(x - bodyW / 2 - armW * 0.7, neckY + 4, armW, bodyH * 0.9, armW / 2, skin);
    c.roundRect(x + bodyW / 2 - armW * 0.3, neckY + 4, armW, bodyH * 0.9, armW / 2, skin);
  }
  c.roundRect(x - bodyW / 2, neckY, bodyW, bodyH + height * 0.04, bodyW * 0.28, shirt);
  c.rect(x - bodyW * 0.18, neckY + bodyH * 0.25, bodyW * 0.36, bodyH * 0.18, WHITE, 0.55);
  c.circle(x, neckY - headR * 0.85, headR, skin);
  c.ellipse(x, neckY - headR * 1.45, headR * 1.05, headR * 0.62, hair);
}

function paintBeach(ctx: Ctx, c: Canvas): void {
  const r = ctx.rng, W = c.w, H = c.h;
  const hz = H * 0.46;
  c.vgrad(0, 0, W, hz, [[84, 136, 206], [178, 176, 196], [250, 186, 140], [255, 162, 110]]);
  const sunX = W * rrange(r, 0.6, 0.8);
  c.glow(sunX, hz - 16, W * 0.3, [255, 190, 120], 0.55);
  c.circle(sunX, hz - 16, 24, [255, 238, 196]);
  for (let k = 0; k < 3; k++) cloud(c, r() * W, H * rrange(r, 0.06, 0.2), W * 0.035, [255, 236, 226], 0.55);
  c.vgrad(0, hz, W, H * 0.22, [[70, 128, 172], [38, 96, 142]]);
  for (let k = 0; k < 70; k++) c.rect(r() * W, hz + 3 + r() * H * 0.2, 10 + r() * 30, 1.5, WHITE, 0.3);
  for (let y = hz + 3; y < hz + H * 0.2; y += 5) c.rect(sunX - 18 + (r() - 0.5) * 10, y, 36 * (1 - (y - hz) / (H * 0.3)), 2, [255, 220, 170], 0.55);
  const shore = hz + H * 0.22;
  c.vgrad(0, shore, W, H - shore, [[236, 212, 166], [214, 184, 136]]);
  c.rect(0, shore, W, 3, WHITE, 0.6);
  // banner on two poles
  const text = ctx.has("team", "building") ? "TEAM BUILDING 2026" : "SUMMER TRIP 2026";
  const shirt = pick(r, [[240, 120, 40], [28, 150, 170], [220, 60, 70], [246, 196, 40]] as const);
  const bw = textW(text, 3) + 40, bx = (W - bw) / 2, by = H * 0.3;
  c.rect(bx - 4, by - 6, 4, H * 0.42, [90, 70, 52]);
  c.rect(bx + bw, by - 6, 4, H * 0.42, [90, 70, 52]);
  c.rect(bx, by, bw, 40, WHITE);
  c.rect(bx, by, bw, 5, shirt);
  c.rect(bx, by + 35, bw, 5, shirt);
  c.text(text, bx + 20, by + 10, 3, mix(shirt, BLACK, 0.25));
  // the group
  const n = rint(r, 9, 11);
  const people = Array.from({ length: n }, (_, i) => ({
    x: W * 0.08 + ((W * 0.84) / n) * (i + 0.5) + (r() - 0.5) * 14,
    y: H * 0.93 + (r() - 0.5) * H * 0.06,
    h: H * rrange(r, 0.3, 0.37)
  })).sort((a, b) => a.y - b.y);
  for (const pp of people)
    person(c, r, pp.x, pp.y, pp.h, mix(shirt, WHITE, r() * 0.12), pick(r, [[38, 48, 78], [60, 64, 70], [230, 228, 220]] as const));
  c.vignette(0.22);
}

function paintParty(ctx: Ctx, c: Canvas): void {
  const r = ctx.rng, W = c.w, H = c.h;
  const kind = ctx.has("trung thu") ? "lantern" : ctx.has("sinh nhat", "birthday") ? "birthday" : "party";
  c.vgrad(0, 0, W, H, [[30, 18, 42], [70, 38, 52], [96, 56, 48]]);
  const warm: readonly RGB[] = [[255, 200, 120], [255, 150, 90], [255, 230, 170], [255, 120, 150], [190, 140, 255]];
  for (let k = 0; k < 46; k++) c.circle(r() * W, r() * H * 0.8, rrange(r, 6, 28), pick(r, warm), rrange(r, 0.1, 0.28));
  // string lights
  for (const [y0, sag] of [[H * 0.06, H * 0.12], [H * 0.16, H * 0.1]] as const) {
    for (let x = 0; x <= W; x += 3) {
      const t = (2 * x) / W - 1;
      c.rect(x, y0 + sag * (1 - t * t), 3, 1.2, [40, 30, 30]);
    }
    for (let x = 14; x < W; x += 30) {
      const t = (2 * x) / W - 1, y = y0 + sag * (1 - t * t) + 4;
      c.glow(x, y, 16, [255, 200, 120], 0.6);
      c.circle(x, y, 3.2, [255, 236, 180]);
    }
  }
  let caption = "PARTY 2026";
  if (kind === "lantern") {
    caption = "TRUNG THU 2026";
    for (let k = 0; k < 6; k++) {
      const x = W * (0.1 + k * 0.16) + (r() - 0.5) * 20, y = H * rrange(r, 0.3, 0.42), s = rrange(r, 22, 32);
      const col = pick(r, [[214, 48, 40], [240, 132, 30], [230, 60, 90]] as const);
      c.rect(x - 0.5, 0, 1.5, y - s, [60, 40, 30]);
      c.glow(x, y, s * 3, [255, 150, 80], 0.45);
      c.ellipse(x, y, s, s * 1.15, col);
      for (const f of [-0.55, 0, 0.55]) c.ellipse(x + f * s, y, s * 0.12, s * 1.05, mix(col, BLACK, 0.25), 0.6);
      c.rect(x - s * 0.4, y - s * 1.2, s * 0.8, s * 0.18, [226, 180, 70]);
      c.rect(x - s * 0.4, y + s * 1.05, s * 0.8, s * 0.18, [226, 180, 70]);
      c.rect(x - 1, y + s * 1.2, 2, s * 0.5, [226, 180, 70]);
    }
  } else if (kind === "birthday") {
    caption = "HAPPY BIRTHDAY";
    for (let k = 0; k < 7; k++) {
      const x = W * rrange(r, 0.05, 0.95), y = H * rrange(r, 0.28, 0.45), s = rrange(r, 18, 26);
      const col = pick(r, [[230, 60, 80], [60, 140, 230], [250, 200, 50], [120, 200, 120], [200, 100, 220]] as const);
      c.rect(x, y + s * 1.2, 1.2, H * 0.25, [200, 200, 200], 0.6);
      c.ellipse(x, y, s, s * 1.2, col);
      c.ellipse(x - s * 0.35, y - s * 0.4, s * 0.22, s * 0.32, WHITE, 0.45);
    }
    const tx = W / 2, ty = H * 0.75;
    c.rect(tx - W * 0.22, ty + 50, W * 0.44, H, [110, 70, 50]);
    c.rect(tx - W * 0.22, ty + 50, W * 0.44, 10, [240, 236, 230]);
    c.roundRect(tx - 70, ty + 10, 140, 42, 6, [250, 238, 240]);
    c.roundRect(tx - 50, ty - 22, 100, 34, 6, [246, 186, 204]);
    for (let k = 0; k < 5; k++) {
      const cx = tx - 36 + k * 18;
      c.rect(cx - 2, ty - 40, 4, 18, [120, 190, 240]);
      c.glow(cx, ty - 46, 22, [255, 190, 100], 0.6);
      c.ellipse(cx, ty - 46, 3, 6, [255, 230, 150]);
    }
  }
  // crowd silhouettes in front
  const n = rint(r, 6, 8);
  for (let k = 0; k < n; k++) {
    const x = (W / (n - 1)) * k + (r() - 0.5) * 30, hr = rrange(r, 24, 32), y = H - hr * 2.3 + r() * 20;
    c.roundRect(x - hr * 2, y + hr * 0.9, hr * 4, H, hr * 1.4, [26, 16, 26]);
    c.circle(x - 2, y - 2, hr + 2, [255, 170, 110], 0.25);
    c.circle(x, y, hr, [22, 14, 22]);
  }
  c.text(caption, (W - textW(caption, 3)) / 2, H * 0.53, 3, [255, 220, 150], 0.9);
  c.vignette(0.3);
}

function paintEvent(ctx: Ctx): Canvas {
  const c = new Canvas(640, 420);
  if (ctx.has("tiec", "sinh nhat", "trung thu", "party", "tat nien", "year end", "birthday")) paintParty(ctx, c);
  else paintBeach(ctx, c);
  return c;
}

// ---------- screenshot ----------

function paintScreenshot(ctx: Ctx): Canvas {
  const r = ctx.rng, W = 900, H = 560;
  const c = new Canvas(W, H);
  const err = ctx.has("loi", "error", "bug", "crash", "fail", "failed", "anh loi") || !ctx.has("screenshot", "anh chup");
  c.vgrad(0, 0, W, H, [[40, 72, 122], [22, 40, 72]]);
  for (let k = 0; k < 4; k++) {
    c.roundRect(14, 22 + k * 76, 36, 36, 8, WHITE, 0.2);
    c.roundRect(12, 62 + k * 76, 40, 5, 2, WHITE, 0.35);
  }
  // taskbar
  c.rect(0, H - 34, W, 34, [20, 22, 28]);
  const tb: readonly RGB[] = [[52, 120, 230], [240, 180, 40], [60, 180, 120], [220, 80, 80], [150, 150, 160]];
  tb.forEach((col, k) => c.roundRect(14 + k * 38, H - 28, 24, 22, 5, col));
  c.text("09:41", W - 76, H - 24, 2, [220, 222, 228]);
  // window
  const wx = 66, wy = 16, ww = 816, wh = 500;
  c.shadow(wx, wy, ww, wh, 8, 14, 0.4);
  c.roundRect(wx, wy, ww, wh, 8, [250, 250, 251]);
  c.roundRect(wx, wy, ww, 30, 8, [52, 54, 60]);
  c.rect(wx, wy + 20, ww, 10, [52, 54, 60]);
  ([[236, 95, 86], [245, 190, 80], [98, 195, 90]] as const).forEach((col, k) => c.circle(wx + 18 + k * 20, wy + 15, 6, col));
  const title = ctx.has("upload", "heic", "tai len") ? "UPLOAD MANAGER" : ctx.has("nas", "mang", "network") ? "FILE EXPLORER" : "WORKSPACE";
  c.text(title, wx + (ww - textW(title, 2)) / 2, wy + 8, 2, [214, 216, 222]);
  // sidebar
  const side = 180, bodyY = wy + 30, bodyH = wh - 30 - 24;
  c.rect(wx, bodyY, side, bodyH, [238, 240, 244]);
  c.rect(wx + side, bodyY, 1, bodyH, [222, 225, 230]);
  for (let k = 0; k < 10; k++) {
    const y = bodyY + 22 + k * 36, sel = k === 1;
    if (sel) c.roundRect(wx + 8, y - 9, side - 16, 30, 6, [220, 230, 250]);
    c.roundRect(wx + 20, y - 1, 14, 14, 3, sel ? [52, 110, 230] : [168, 176, 190]);
    c.roundRect(wx + 44, y + 3, 50 + r() * 70, 7, 3, sel ? [120, 150, 210] : [196, 201, 210]);
  }
  // toolbar
  const mx = wx + side + 1, mw = ww - side - 1;
  c.rect(mx, bodyY, mw, 44, WHITE);
  c.rect(mx, bodyY + 44, mw, 1, [226, 229, 234]);
  c.roundRect(mx + 16, bodyY + 9, 240, 26, 6, [241, 243, 246]);
  c.roundRect(mx + 40, bodyY + 19, 120, 6, 3, [200, 204, 212]);
  c.circle(mx + 28, bodyY + 22, 5, [170, 176, 188]);
  c.roundRect(mx + mw - 130, bodyY + 9, 114, 26, 6, [46, 108, 226]);
  c.text("UPLOAD", mx + mw - 130 + (114 - textW("UPLOAD", 2)) / 2, bodyY + 15, 2, WHITE);
  c.roundRect(mx + mw - 236, bodyY + 9, 94, 26, 6, [232, 235, 240]);
  c.roundRect(mx + mw - 220, bodyY + 19, 60, 6, 3, [170, 176, 188]);
  // thumbnails grid
  const cols = 4, gap = 16, cw = Math.floor((mw - gap * (cols + 1)) / cols), chh = 150;
  const failIdx = rint(r, 0, 7);
  for (let k = 0; k < 8; k++) {
    const x = mx + gap + (k % cols) * (cw + gap), y = bodyY + 60 + Math.floor(k / cols) * (chh + gap);
    const failed = err && k === failIdx;
    c.roundRect(x - 1, y - 1, cw + 2, chh + 2, 7, failed ? [214, 58, 58] : [222, 225, 230]);
    c.roundRect(x, y, cw, chh, 6, WHITE);
    const tw = cw - 12, th = 92;
    if (failed) {
      c.rect(x + 6, y + 6, tw, th, [236, 238, 241]);
      c.roundRect(x + 6 + tw / 2 - 18, y + 6 + th / 2 - 22, 36, 44, 4, [200, 204, 212]);
      c.poly([[x + 6 + tw / 2 + 6, y + th / 2 - 16], [x + 6 + tw / 2 + 18, y + th / 2 - 4], [x + 6 + tw / 2 + 6, y + th / 2 - 4]], [236, 238, 241]);
      c.circle(x + cw - 14, y + 14, 11, [214, 58, 58]);
      c.text("!", x + cw - 14 - 2.5, y + 7, 2, WHITE);
    } else {
      const thumb = new Canvas(tw, th);
      renderExterior(thumb, estateParams(r), r() < 0.3);
      c.blit(thumb, 0, 0, tw, th, x + 6, y + 6);
    }
    c.roundRect(x + 8, y + 108, cw * 0.7, 8, 4, [70, 74, 84]);
    c.roundRect(x + 8, y + 124, cw * 0.4, 7, 3, failed ? [236, 150, 150] : [200, 204, 212]);
  }
  // status bar with progress
  const sy = wy + wh - 24;
  c.roundRect(wx, sy, ww, 24, 8, [242, 243, 245]);
  c.rect(wx, sy, ww, 10, [242, 243, 245]);
  c.rect(wx, sy, ww, 1, [226, 229, 234]);
  c.roundRect(wx + 14, sy + 9, 120, 6, 3, [196, 201, 210]);
  c.roundRect(wx + ww - 260, sy + 8, 240, 8, 4, [222, 225, 230]);
  c.roundRect(wx + ww - 260, sy + 8, 240 * rrange(r, 0.45, 0.8), 8, 4, err ? [214, 58, 58] : [46, 108, 226]);

  if (err) {
    const msg = ctx.has("heic")
      ? "UNSUPPORTED FORMAT: HEIC"
      : ctx.has("upload", "tai len")
        ? "UPLOAD FAILED: TIMEOUT"
        : ctx.has("nas", "mang", "network", "vpn")
          ? "NETWORK PATH NOT FOUND"
          : ctx.has("license", "ban quyen", "key")
            ? "LICENSE EXPIRED"
            : ctx.has("font")
              ? "MISSING FONT"
              : ctx.has("disk", "o cung", "dung luong", "full")
                ? "DISK IS FULL"
                : pick(r, ["CANNOT OPEN FILE", "ACCESS DENIED", "FILE IS LOCKED", "UNEXPECTED ERROR"]);
    c.roundRect(wx, wy, ww, wh, 8, BLACK, 0.38);
    const dw = 410, dh = 200, dx = Math.round((W - dw) / 2), dy = Math.round((H - 34 - dh) / 2);
    c.shadow(dx, dy, dw, dh, 8, 16, 0.5);
    c.roundRect(dx, dy, dw, dh, 8, WHITE);
    c.roundRect(dx, dy, dw, 40, 8, [205, 45, 45]);
    c.rect(dx, dy + 30, dw, 10, [205, 45, 45]);
    c.text("ERROR", dx + 16, dy + 13, 2, WHITE);
    c.text("X", dx + dw - 26, dy + 13, 2, WHITE, 0.85);
    c.circle(dx + 44, dy + 90, 22, [222, 52, 52]);
    c.text("!", dx + 44 - 10, dy + 90 - 14, 4, WHITE);
    c.text(msg, dx + 82, dy + 62, 2, [40, 40, 46]);
    c.roundRect(dx + 82, dy + 88, 270, 8, 4, [208, 211, 217]);
    c.roundRect(dx + 82, dy + 104, 210, 8, 4, [208, 211, 217]);
    c.roundRect(dx + 82, dy + 120, 240, 8, 4, [208, 211, 217]);
    const by = dy + dh - 16 - 32;
    c.roundRect(dx + dw - 16 - 90, by, 90, 32, 6, [214, 58, 58]);
    c.text("OK", dx + dw - 16 - 90 + (90 - textW("OK", 2)) / 2, by + 9, 2, WHITE);
    c.roundRect(dx + dw - 16 - 90 - 12 - 112, by, 112, 32, 6, [236, 238, 242]);
    c.text("DETAILS", dx + dw - 16 - 90 - 12 - 112 + (112 - textW("DETAILS", 2)) / 2, by + 9, 2, [60, 62, 70]);
  } else {
    const tx = W - 320, ty = H - 34 - 84;
    c.shadow(tx, ty, 290, 58, 8, 8, 0.3);
    c.roundRect(tx, ty, 290, 58, 8, WHITE);
    c.circle(tx + 30, ty + 29, 14, [60, 170, 100]);
    c.text("OK", tx + 30 - 5.5, ty + 25, 1, WHITE);
    c.roundRect(tx + 56, ty + 18, 180, 8, 4, [70, 74, 84]);
    c.roundRect(tx + 56, ty + 34, 120, 7, 3, [200, 204, 212]);
  }
  return c;
}

// ---------- banner / poster / identity ----------

function headline(ctx: Ctx): string[] {
  const stop = new Set(["banner", "banners", "poster", "posters", "post", "thiet", "ke", "nhan", "dien", "logo", "anh", "file", "final", "ban", "mau", "v1", "v2", "v3", "png", "jpg"]);
  const words = ctx.nameWords.trim().split(" ").filter((w) => w && !stop.has(w)).map((w) => w.toUpperCase());
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const wt = w.slice(0, 11);
    if (cur && cur.length + 1 + wt.length > 11) {
      lines.push(cur);
      cur = wt;
    } else cur = cur ? `${cur} ${wt}` : wt;
    if (lines.length >= 2) break;
  }
  if (cur && lines.length < 2) lines.push(cur);
  return lines.length ? lines : ["PHOTO", "EDITING"];
}

function paintIdentity(c1: RGB, c2: RGB): Canvas {
  const W = 900, H = 500, c = new Canvas(W, H, [244, 244, 247]);
  c.shadow(24, 24, 470, 452, 12, 10, 0.18);
  c.roundRect(24, 24, 470, 452, 12, WHITE);
  const mx = 259, my = 200;
  c.circle(mx, my, 100, c1);
  c.circle(mx, my, 64, WHITE);
  c.poly([[mx, my - 52], [mx + 45, my + 26], [mx - 45, my + 26]], c2);
  c.circle(mx, my + 2, 15, c1);
  c.text("LOGO", mx - textW("LOGO", 6) / 2, 330, 6, [36, 38, 46]);
  c.roundRect(mx - 90, 392, 180, 8, 4, [200, 202, 210]);
  c.text("COLOR", 530, 40, 2, [90, 92, 102]);
  ([c1, c2, [40, 40, 48], [226, 228, 234]] as const).forEach((col, k) => {
    c.roundRect(530 + k * 88, 66, 76, 76, 8, col);
    c.roundRect(530 + k * 88, 152, 56, 6, 3, [190, 192, 200]);
  });
  c.text("TYPOGRAPHY", 530, 196, 2, [90, 92, 102]);
  c.text("ABCDEFGHIJKLM", 530, 224, 3, [36, 38, 46]);
  c.text("NOPQRSTUVWXYZ", 530, 254, 3, [36, 38, 46]);
  c.text("0123456789", 530, 284, 3, [36, 38, 46]);
  c.text("USAGE", 530, 336, 2, [90, 92, 102]);
  const mini = (x: number, y: number, bg: RGB, fg: RGB): void => {
    c.roundRect(x, y, 164, 96, 8, bg);
    c.circle(x + 82, y + 48, 30, fg);
    c.circle(x + 82, y + 48, 19, bg);
    c.poly([[x + 82, y + 33], [x + 95, y + 56], [x + 69, y + 56]], fg);
  };
  mini(530, 364, [40, 40, 48], WHITE);
  mini(706, 364, c1, WHITE);
  return c;
}

function paintBanner(ctx: Ctx): Canvas {
  const r = ctx.rng;
  const palettes: readonly (readonly [RGB, RGB])[] = [
    [[98, 54, 255], [255, 64, 129]], [[0, 150, 136], [33, 120, 243]], [[255, 111, 0], [229, 57, 53]],
    [[20, 32, 80], [0, 170, 200]], [[34, 139, 94], [170, 205, 60]]
  ];
  const [c1, c2] = pick(r, palettes);
  if (ctx.has("logo", "nhan dien")) return paintIdentity(c1, c2);
  const portrait = ctx.has("poster", "posters");
  const W = portrait ? 600 : 900, H = portrait ? 840 : 500;
  const c = new Canvas(W, H);
  c.dgrad(c1, c2);
  c.circle(W * 0.92, H * 0.08, H * 0.36, WHITE, 0.1);
  c.circle(W * 0.04, H * 1.02, H * 0.42, WHITE, 0.08);
  for (let k = 0; k < 4; k++) {
    const x = r() * W, y = r() * H, s = rrange(r, 30, 100);
    c.poly([[x, y - s], [x + s * 0.87, y + s * 0.5], [x - s * 0.87, y + s * 0.5]], WHITE, rrange(r, 0.07, 0.15));
  }
  c.poly([[W * 0.45, 0], [W * 0.6, 0], [W * 0.32, H], [W * 0.17, H]], WHITE, 0.06);
  const gx = portrait ? W * 0.72 : W * 0.44, gy = H * 0.07;
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) c.circle(gx + i * 16, gy + j * 16, 3, WHITE, 0.45);
  // logo placeholder
  c.circle(60, 52, 16, WHITE);
  c.circle(60, 52, 8, c1);
  c.roundRect(84, 44, 90, 8, 4, WHITE, 0.9);
  c.roundRect(84, 57, 60, 6, 3, WHITE, 0.6);
  // headline + copy + CTA
  const scale = portrait ? 7 : 6, tx = 48;
  let ty = portrait ? 120 : 126;
  for (const l of headline(ctx)) {
    c.text(l, tx + 3, ty + 3, scale, BLACK, 0.2);
    c.text(l, tx, ty, scale, WHITE);
    ty += scale * 9;
  }
  c.roundRect(tx, ty + 4, 300, 10, 5, WHITE, 0.75);
  c.roundRect(tx, ty + 24, 220, 10, 5, WHITE, 0.55);
  const cy = ty + 56;
  c.shadow(tx, cy, 170, 46, 23, 6, 0.25);
  c.roundRect(tx, cy, 170, 46, 23, WHITE);
  c.text("XEM NGAY", tx + (170 - textW("XEM NGAY", 2)) / 2, cy + 16, 2, c1);
  // framed photo
  const cw = Math.round(portrait ? W - 96 : W * 0.38), chh = Math.round(portrait ? H * 0.36 : H * 0.62);
  const cx = Math.round(portrait ? 48 : W * 0.57), cyy = Math.round(portrait ? H * 0.52 : H * 0.18);
  c.shadow(cx, cyy, cw, chh, 10, 12, 0.35);
  c.roundRect(cx, cyy, cw, chh, 10, WHITE);
  const photo = new Canvas(cw - 16, chh - 16);
  renderExterior(photo, estateParams(r), false);
  c.blit(photo, 0, 0, photo.w, photo.h, cx + 8, cyy + 8);
  c.text("WWW.EXAMPLE.COM", tx, H - 34, 2, WHITE, 0.8);
  return c;
}

// =====================================================================================================
// PNG encoder (RGB 8-bit, adaptive per-row filter, zlib via node:zlib)
// =====================================================================================================

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, "latin1");
  data.copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}

function encodePng(c: Canvas): Buffer {
  const { w, h, px } = c;
  const bpp = 3, stride = w * bpp;
  const raw = Buffer.alloc((stride + 1) * h);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  const zero = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : zero;
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f] as Uint8Array;
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const x = row[i] as number;
        const a = i >= bpp ? (row[i - bpp] as number) : 0;
        const b = up[i] as number;
        const cc = i >= bpp ? (up[i - bpp] as number) : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        const v = (x - pred) & 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    const o = y * (stride + 1);
    raw[o] = best;
    raw.set(cand[best] as Uint8Array, o + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  return Buffer.concat([
    PNG_SIG,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

// =====================================================================================================
// Baseline JPEG encoder (JFIF, YCbCr 4:4:4, standard Annex K tables)
// =====================================================================================================

/** zig-zag position → natural (row-major) index */
const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
];
const Q_LUM = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99
];
const Q_CHR = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99,
  ...new Array<number>(32).fill(99)
];
const DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUM_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
  0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
  0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];
const AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHR_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81,
  0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34,
  0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44,
  0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92,
  0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
  0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa
];

type HuffTable = { codes: Int32Array; lens: Uint8Array };

function huffTable(bits: readonly number[], vals: readonly number[]): HuffTable {
  const codes = new Int32Array(256), lens = new Uint8Array(256);
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < (bits[len - 1] as number); i++) {
      const v = vals[k++] as number;
      codes[v] = code++;
      lens[v] = len;
    }
    code <<= 1;
  }
  return { codes, lens };
}

function scaleQuant(base: readonly number[], quality: number): number[] {
  const q = clamp(Math.round(quality), 1, 100);
  const s = q < 50 ? 5000 / q : 200 - q * 2;
  return base.map((v) => clamp(Math.floor((v * s + 50) / 100), 1, 255));
}

/** DCT basis: M[u*8+x] = C(u)/2 · cos((2x+1)uπ/16) so that F = M·f·Mᵀ */
const DCT_M = (() => {
  const m = new Float64Array(64);
  for (let u = 0; u < 8; u++)
    for (let x = 0; x < 8; x++) m[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return m;
})();

function fdct8x8(inp: Float64Array, out: Float64Array, tmp: Float64Array): void {
  for (let v = 0; v < 8; v++)
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += (DCT_M[v * 8 + y] as number) * (inp[y * 8 + x] as number);
      tmp[v * 8 + x] = s;
    }
  for (let v = 0; v < 8; v++)
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += (tmp[v * 8 + x] as number) * (DCT_M[u * 8 + x] as number);
      out[v * 8 + u] = s;
    }
}

const bitLen = (v: number): number => {
  let a = Math.abs(v), n = 0;
  while (a) {
    n++;
    a >>= 1;
  }
  return n;
};

function encodeJpeg(c: Canvas, quality: number): Buffer {
  const { w, h, px } = c;
  const qt = [scaleQuant(Q_LUM, quality), scaleQuant(Q_CHR, quality)] as const;
  const dcT = [huffTable(DC_LUM_BITS, DC_VALS), huffTable(DC_CHR_BITS, DC_VALS)] as const;
  const acT = [huffTable(AC_LUM_BITS, AC_LUM_VALS), huffTable(AC_CHR_BITS, AC_CHR_VALS)] as const;
  const out = new ByteSink();
  out.u16(0xffd8); // SOI
  out.u16(0xffe0); // APP0 / JFIF 1.1, aspect ratio 1:1
  out.u16(16);
  out.raw([0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  out.u16(0xffdb); // DQT (two 8-bit tables, zig-zag order)
  out.u16(2 + 65 * 2);
  for (let t = 0; t < 2; t++) {
    out.byte(t);
    for (let k = 0; k < 64; k++) out.byte(qt[t]?.[ZIGZAG[k] as number] as number);
  }
  out.u16(0xffc0); // SOF0 baseline
  out.u16(17);
  out.byte(8);
  out.u16(h);
  out.u16(w);
  out.byte(3);
  out.raw([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const dht: [number, number[], number[]][] = [
    [0x00, DC_LUM_BITS, DC_VALS], [0x10, AC_LUM_BITS, AC_LUM_VALS],
    [0x01, DC_CHR_BITS, DC_VALS], [0x11, AC_CHR_BITS, AC_CHR_VALS]
  ];
  out.u16(0xffc4); // DHT
  out.u16(2 + dht.reduce((s, t) => s + 17 + t[2].length, 0));
  for (const [id, bits, vals] of dht) {
    out.byte(id);
    out.raw(bits);
    out.raw(vals);
  }
  out.u16(0xffda); // SOS
  out.u16(12);
  out.byte(3);
  out.raw([1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

  // colour conversion (level-shifted by -128)
  const n = w * h;
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)] as const;
  for (let i = 0; i < n; i++) {
    const r = px[i * 3] as number, g = px[i * 3 + 1] as number, b = px[i * 3 + 2] as number;
    planes[0][i] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
    planes[1][i] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    planes[2][i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }

  let acc = 0, nb = 0;
  const put = (code: number, len: number): void => {
    acc = (acc << len) | (code & ((1 << len) - 1));
    nb += len;
    while (nb >= 8) {
      nb -= 8;
      const byte = (acc >>> nb) & 0xff;
      out.byte(byte);
      if (byte === 0xff) out.byte(0); // byte stuffing
    }
    acc &= (1 << nb) - 1;
  };

  const blk = new Float64Array(64), coef = new Float64Array(64), tmp = new Float64Array(64), zz = new Int32Array(64);
  const prevDc = [0, 0, 0];
  const encodeBlock = (ci: 0 | 1 | 2, bx: number, by: number): void => {
    const plane = planes[ci];
    for (let y = 0; y < 8; y++) {
      const row = Math.min(by + y, h - 1) * w;
      for (let x = 0; x < 8; x++) blk[y * 8 + x] = plane[row + Math.min(bx + x, w - 1)] as number;
    }
    fdct8x8(blk, coef, tmp);
    const t = ci === 0 ? 0 : 1;
    const q = qt[t];
    for (let k = 0; k < 64; k++) {
      const nat = ZIGZAG[k] as number;
      zz[k] = Math.round((coef[nat] as number) / (q[nat] as number));
    }
    const dc = dcT[t], ac = acT[t];
    const diff = (zz[0] as number) - (prevDc[ci] as number);
    prevDc[ci] = zz[0] as number;
    let cat = bitLen(diff);
    put(dc.codes[cat] as number, dc.lens[cat] as number);
    if (cat) put(diff < 0 ? diff + (1 << cat) - 1 : diff, cat);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = zz[k] as number;
      if (v === 0) {
        run++;
        continue;
      }
      while (run > 15) {
        put(ac.codes[0xf0] as number, ac.lens[0xf0] as number); // ZRL
        run -= 16;
      }
      cat = bitLen(v);
      const sym = (run << 4) | cat;
      put(ac.codes[sym] as number, ac.lens[sym] as number);
      put(v < 0 ? v + (1 << cat) - 1 : v, cat);
      run = 0;
    }
    if (run > 0) put(ac.codes[0] as number, ac.lens[0] as number); // EOB
  };
  for (let by = 0; by < h; by += 8)
    for (let bx = 0; bx < w; bx += 8) {
      encodeBlock(0, bx, by);
      encodeBlock(1, bx, by);
      encodeBlock(2, bx, by);
    }
  if (nb > 0) put((1 << (8 - nb)) - 1, 8 - nb); // pad with 1-bits
  out.u16(0xffd9); // EOI
  return out.toBuffer();
}

// =====================================================================================================
// Document text (shared by PDF / DOCX / TXT)
// =====================================================================================================

type Para = { kind: "meta" | "h" | "p" | "li" | "check"; text: string };

const QC_ITEMS = [
  "Cân bằng trắng đồng đều giữa các ảnh trong cùng một đơn",
  "Đường thẳng đứng (tường, cửa, khung cửa sổ) đã được chỉnh thẳng",
  "Cửa sổ không bị cháy sáng, thấy rõ cảnh bên ngoài",
  "Đã xoá vật thể thừa theo yêu cầu (dây điện, thùng rác, vết bẩn)",
  "Bầu trời thay thế tự nhiên, khớp hướng ánh sáng",
  "Cỏ và cây xanh không bị quá bão hoà màu",
  "Vùng tối giữ được chi tiết, không bị bệt đen",
  "Viền mask mượt, không có quầng sáng (halo) quanh mép",
  "Kích thước và định dạng xuất đúng quy định của đơn",
  "Tên file đặt đúng quy ước của đơn hàng",
  "Màu nội thất trung thực, không bị ám màu",
  "Phản chiếu trên kính và gương đã được xử lý",
  "Ảnh twilight: đèn cửa sổ ấm, trời hoàng hôn hài hoà",
  "Không còn nhiễu hạt ở vùng trần nhà và góc tối",
  "Đã so sánh với ảnh gốc trước khi bàn giao"
];

function docBody(ctx: Ctx): Para[] {
  const r = ctx.rng;
  const d = dateFromName(ctx);
  const meta: Para = { kind: "meta", text: `Ngày ${fmtDate(d)} · Phiên bản 1.${rint(r, 0, 4)} · Tài liệu nội bộ` };
  const li = (text: string): Para => ({ kind: "li", text });
  const h = (text: string): Para => ({ kind: "h", text });
  const p = (text: string): Para => ({ kind: "p", text });

  if (ctx.has("checklist", "qc", "kiem tra")) {
    const items = shuffle(r, QC_ITEMS).slice(0, rint(r, 9, 12));
    return [
      meta,
      p("Áp dụng cho mọi đơn trước khi chuyển sang trạng thái bàn giao. Đánh dấu từng mục sau khi kiểm tra."),
      h("Hạng mục kiểm tra"),
      ...items.map((text): Para => ({ kind: "check", text })),
      p("Ghi chú: mục nào không đạt thì trả lại người xử lý kèm mô tả lỗi cụ thể.")
    ];
  }
  if (ctx.has("bien ban", "hop", "giao ban", "meeting")) {
    const wk = numAfter(ctx, "tuan");
    return [
      meta,
      p(`Thời gian: 08:30–09:30, thứ Hai ${fmtDate(d)}${wk ? ` (tuần ${wk})` : ""} – phòng họp tầng 2.`),
      p("Thành phần: Ban giám đốc, Trưởng phòng vận hành, các trưởng ca, nhóm QC, Account, IT."),
      h("1. Tình hình sản xuất tuần trước"),
      li(`Sản lượng đạt ${rint(r, 3200, 4800)} ảnh; tỷ lệ QC đạt lần đầu ${rint(r, 91, 97)}%.`),
      li(pick(r, ["Một số đơn twilight phải làm lại do bầu trời chưa tự nhiên.", "Lỗi thường gặp nhất: cửa sổ cháy sáng và đường dọc chưa thẳng."])),
      h("2. Vấn đề tồn đọng"),
      li(pick(r, ["NAS chậm vào giờ cao điểm, IT đang theo dõi và tối ưu.", "Một vài máy trạm cần nâng cấp RAM để chạy plugin mới."])),
      li("Hướng dẫn của một số đơn chưa rõ, Account sẽ xác nhận lại với khách trước khi giao việc."),
      h("3. Kế hoạch tuần này"),
      li("Ưu tiên các đơn gấp, hạn trước 17:00 hằng ngày."),
      li("Áp dụng checklist QC phiên bản mới cho toàn bộ các nhóm."),
      p("Kết luận: các trưởng ca phổ biến nội dung cuộc họp cho nhóm trước 10:00 cùng ngày.")
    ];
  }
  if (ctx.has("bao cao", "tong ket", "report", "nang suat")) {
    return [
      meta,
      h("Số liệu chính"),
      li(`Tổng số ảnh hoàn thành: ${rint(r, 3000, 5200)} ảnh (${pick(r, ["+", "-"])}${rint(r, 2, 9)}% so với kỳ trước).`),
      li(`Tỷ lệ QC đạt ngay lần đầu: ${rint(r, 90, 97)},${rint(r, 0, 9)}%.`),
      li(`Thời gian xử lý trung bình: ${rint(r, 6, 11)},${rint(r, 0, 9)} phút/ảnh.`),
      li(`Số đơn giao trễ hạn: ${rint(r, 0, 4)} đơn.`),
      h("Nhận xét"),
      li("Lỗi thường gặp: cửa sổ cháy sáng, đường dọc chưa thẳng, bầu trời thiếu tự nhiên."),
      li("Nguyên nhân chính: hướng dẫn của một số đơn chưa đầy đủ."),
      h("Đề xuất"),
      li("Bổ sung ảnh mẫu tham chiếu cho từng loại đơn."),
      li("Đào tạo nhanh về xử lý ảnh twilight cho nhân sự mới."),
      p("Mục tiêu kỳ tới: giữ tỷ lệ QC đạt trên 95%.")
    ];
  }
  if (ctx.has("quy dinh", "noi quy", "chinh sach", "quy che", "policy")) {
    return [
      meta,
      p("Điều 1. Phạm vi áp dụng: toàn bộ nhân sự khối sản xuất và các bộ phận hỗ trợ."),
      p("Điều 2. Làm việc theo ca đã phân công; đổi ca cần báo trưởng ca trước 24 giờ."),
      p("Điều 3. Không sao chép dữ liệu khách hàng ra thiết bị cá nhân hoặc dịch vụ lưu trữ ngoài."),
      p("Điều 4. File gốc và file hoàn thiện lưu đúng thư mục trên NAS theo quy ước đặt tên."),
      p("Điều 5. Sự cố phần mềm, máy tính báo ngay cho bộ phận IT qua kênh hỗ trợ."),
      p("Điều 6. Nghỉ phép đăng ký trên hệ thống tối thiểu 3 ngày làm việc."),
      p("Điều 7. Giữ gìn vệ sinh chung tại khu vực làm việc và phòng pantry."),
      p("Điều 8. Quy định có hiệu lực kể từ ngày ban hành.")
    ];
  }
  if (ctx.has("huong dan", "sop", "quy trinh", "guide")) {
    return [
      meta,
      p("Mục đích: thống nhất các bước xử lý một đơn ảnh từ lúc nhận đến lúc bàn giao."),
      li("Bước 1. Tải đơn hàng từ thư mục Input trên NAS về máy trạm."),
      li("Bước 2. Kiểm tra số lượng ảnh và yêu cầu riêng của đơn."),
      li("Bước 3. Ghép HDR / blend các ảnh bracket theo preset chuẩn."),
      li("Bước 4. Chỉnh đường thẳng, cân bằng trắng, độ sáng tổng thể."),
      li("Bước 5. Xử lý cửa sổ, bầu trời, cỏ theo checklist QC."),
      li("Bước 6. Xuất file đúng kích thước, đặt tên theo quy ước."),
      li("Bước 7. Chuyển sang thư mục QC và cập nhật trạng thái task."),
      li("Bước 8. Sửa lỗi theo phản hồi QC (nếu có) trong vòng 2 giờ.")
    ];
  }
  if (ctx.has("ke hoach", "plan", "de xuat", "du an")) {
    return [
      meta,
      p("Mục tiêu: nâng tỷ lệ QC đạt lần đầu lên trên 95% và giảm số đơn trễ hạn."),
      p("Phạm vi: các nhóm sản xuất A, B, C và nhóm QC."),
      p("Thời gian triển khai: 4 tuần, bắt đầu từ đầu tháng."),
      h("Hoạt động chính"),
      li("Chuẩn hoá preset và checklist cho từng loại đơn."),
      li("Tổ chức 2 buổi đào tạo nội bộ ngắn."),
      li("Theo dõi năng suất hằng tuần trên bảng tổng hợp."),
      p("Nguồn lực: trưởng ca, nhóm QC, bộ phận IT hỗ trợ."),
      p("Rủi ro: khối lượng đơn tăng đột biến cuối tháng."),
      p("Đánh giá: tổng kết kết quả vào tuần cuối của kế hoạch.")
    ];
  }
  return [
    meta,
    p("Tài liệu dùng nội bộ, phục vụ trao đổi giữa các bộ phận."),
    h("Nội dung chính"),
    li("Cập nhật cách làm việc mới cho các nhóm liên quan."),
    li("Phân công đầu mối phụ trách từng hạng mục."),
    li("Mốc thời gian dự kiến hoàn thành từng phần."),
    li("Các lưu ý khi phối hợp giữa sản xuất, QC và Account."),
    p(`Hạn phản hồi: ${fmtDate(addDays(d, 7))}.`),
    p("Mọi góp ý vui lòng phản hồi trực tiếp trong task liên quan.")
  ];
}

// =====================================================================================================
// PDF 1.4 (Helvetica / WinAnsi, ASCII only)
// =====================================================================================================

function toPdfAscii(s: string): string {
  return stripDiacritics(s)
    .replace(/[‒-―−]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/…/g, "...")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/×/g, "x")
    .replace(/[^\x20-\x7e]/g, "");
}

const pdfStr = (s: string): string => `(${s.replace(/[\\()]/g, (m) => `\\${m}`)})`;

function buildPdf(ctx: Ctx): Buffer {
  type Line = { bold: boolean; size: number; indent: number; mark: "box" | "dot" | null; text: string; gap: number; grey: boolean };
  const lines: Line[] = [];
  for (const para of docBody(ctx)) {
    const indent = para.kind === "li" || para.kind === "check" ? 18 : 0;
    const wrapped = wrapText(toPdfAscii(para.text), para.kind === "h" ? 70 : 92 - indent / 5);
    wrapped.forEach((text, i) =>
      lines.push({
        bold: para.kind === "h",
        size: para.kind === "h" ? 12 : para.kind === "meta" ? 9 : 10.5,
        indent,
        mark: i > 0 ? null : para.kind === "check" ? "box" : para.kind === "li" ? "dot" : null,
        text,
        gap: i > 0 ? 14 : para.kind === "h" ? 26 : para.kind === "check" ? 21 : 18,
        grey: para.kind === "meta"
      })
    );
  }
  const top = 768, bottom = 72;
  const pages: Line[][] = [[]];
  let y = top;
  for (const l of lines) {
    if (y - l.gap < bottom) {
      pages.push([]);
      y = top;
    }
    (pages[pages.length - 1] as Line[]).push(l);
    y -= l.gap;
  }
  const title = toPdfAscii(ctx.title).slice(0, 70);
  const streams = pages.map((pl, pi) => {
    const ops: string[] = [];
    ops.push("0.16 0.33 0.55 rg 50 798 4 24 re f");
    ops.push(`BT /F2 18 Tf 0.1 0.1 0.12 rg 62 803 Td ${pdfStr(title)} Tj ET`);
    ops.push("0.8 0.8 0.84 RG 0.6 w 50 788 m 545 788 l S");
    let yy = top;
    for (const l of pl) {
      yy -= l.gap;
      const x = 50 + l.indent;
      if (l.mark === "box") ops.push(`0.3 0.3 0.35 RG 0.8 w ${x - 15} ${yy - 1} 9 9 re S`);
      if (l.mark === "dot") ops.push(`0.16 0.33 0.55 rg ${x - 11} ${yy + 2.5} 3.5 3.5 re f`);
      const col = l.grey ? "0.45 0.45 0.5" : "0.12 0.12 0.14";
      ops.push(`BT /${l.bold ? "F2" : "F1"} ${l.size} Tf ${col} rg ${x} ${yy} Td ${pdfStr(l.text)} Tj ET`);
    }
    ops.push("0.85 0.85 0.88 RG 0.5 w 50 56 m 545 56 l S");
    ops.push(`BT /F1 8 Tf 0.5 0.5 0.55 rg 50 42 Td ${pdfStr("Tai lieu noi bo")} Tj ET`);
    ops.push(`BT /F1 8 Tf 0.5 0.5 0.55 rg 500 42 Td ${pdfStr(`Trang ${pi + 1}/${pages.length}`)} Tj ET`);
    return ops.join("\n");
  });

  const objs: string[] = [];
  const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ");
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[5] = `<< /Title ${pdfStr(title)} /Producer (seed-workspace) /CreationDate (D:20261001090000+07'00') >>`;
  streams.forEach((s, i) => {
    objs[6 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + i * 2} 0 R >>`;
    objs[7 + i * 2] = `<< /Length ${Buffer.byteLength(s, "latin1")} >>\nstream\n${s}\nendstream`;
  });
  let body = "%PDF-1.4\n%âãÏÓ\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(body, "latin1");
    body += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

// =====================================================================================================
// ZIP (stored) + DOCX
// =====================================================================================================

const DOS_TIME = (9 << 11) | (0 << 5) | 0; // 09:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 1; // 2026-10-01

function zipStore(files: readonly { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const nm = Buffer.from(f.name, "utf8"), crc = crc32(f.data), len = f.data.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(len, 18);
    lh.writeUInt32LE(len, 22);
    lh.writeUInt16LE(nm.length, 26);
    lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); // made by (MS-DOS, 2.0)
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(len, 20);
    ch.writeUInt32LE(len, 24);
    ch.writeUInt16LE(nm.length, 28);
    ch.writeUInt32LE(off, 42); // extra/comment/disk/attrs stay 0
    parts.push(lh, nm, f.data);
    central.push(ch, nm);
    off += 30 + nm.length + len;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

/** Rewrites every entry's DOS timestamp to a fixed value so zips produced by libraries are byte-stable. */
function normalizeZipTimes(buf: Buffer): Buffer {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return buf;
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; i++) {
    buf.writeUInt16LE(DOS_TIME, p + 12);
    buf.writeUInt16LE(DOS_DATE, p + 14);
    const lo = buf.readUInt32LE(p + 42);
    if (lo + 30 <= buf.length && buf.readUInt32LE(lo) === 0x04034b50) {
      buf.writeUInt16LE(DOS_TIME, lo + 10);
      buf.writeUInt16LE(DOS_DATE, lo + 12);
    }
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return buf;
}

const xmlEsc = (s: string): string =>
  s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[m] as string);

function buildDocx(ctx: Ctx): Buffer {
  const run = (text: string, o: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}): string =>
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${o.bold ? "<w:b/>" : ""}${o.italic ? "<w:i/>" : ""}` +
    `${o.color ? `<w:color w:val="${o.color}"/>` : ""}<w:sz w:val="${o.size ?? 22}"/><w:szCs w:val="${o.size ?? 22}"/></w:rPr>` +
    text
      .split("\t")
      .map((part) => `<w:t xml:space="preserve">${xmlEsc(part)}</w:t>`)
      .join("<w:tab/>") +
    `</w:r>`;
  const para = (inner: string, after = 120, indent = false): string =>
    `<w:p><w:pPr><w:spacing w:after="${after}"/>${indent ? '<w:ind w:left="567" w:hanging="283"/>' : ""}</w:pPr>${inner}</w:p>`;
  const body: string[] = [para(run(ctx.title, { bold: true, size: 32, color: "1F3864" }), 80)];
  for (const p of docBody(ctx)) {
    if (p.kind === "meta") body.push(para(run(p.text, { italic: true, size: 18, color: "6B6B76" }), 240));
    else if (p.kind === "h") body.push(para(run(p.text, { bold: true, size: 24, color: "2F5597" }), 80));
    else if (p.kind === "li") body.push(para(run(`•\t${p.text}`), 60, true));
    else if (p.kind === "check") body.push(para(run(`☐\t${p.text}`), 60, true));
    else body.push(para(run(p.text)));
  }
  const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const doc =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${W_NS}"><w:body>${body.join("")}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`;
  const types =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;
  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(types, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(doc, "utf8") }
  ]);
}

// =====================================================================================================
// Tables (XLSX / CSV)
// =====================================================================================================

type Cell = string | number | Date;
type Col = { header: string; width: number; fmt?: "date" | "pct" | "dec1" };
type Table = { sheet: string; columns: Col[]; rows: Cell[][]; total?: Cell[] };

const GROUPS = ["Nhóm A", "Nhóm B", "Nhóm C"];

function tableFor(ctx: Ctx): Table {
  const r = ctx.rng;
  const d0 = dateFromName(ctx);
  if (ctx.has("lich ca", "ca", "lich truc", "phan ca")) {
    const shifts = rint(r, 2, 3) === 3 ? ["Sáng 06:00–14:00", "Chiều 14:00–22:00", "Đêm 22:00–06:00"] : ["Ca 1 08:00–17:00", "Ca 2 13:00–22:00"];
    const notes = ["", "", "", "Ưu tiên đơn gấp", "Bảo trì NAS sau 22:00", "Thiếu 1 người – điều phối bổ sung", "Đào tạo nhân sự mới", "Họp giao ban 08:30"];
    const rows: Cell[][] = [];
    for (let day = 0; day < 7; day++)
      shifts.forEach((s, k) => {
        const g = GROUPS[(day + k) % 3] as string;
        rows.push([addDays(d0, day), s, g, `Trưởng ca ${g.slice(-1)}`, pick(r, notes)]);
      });
    return {
      sheet: "Lịch ca",
      columns: [{ header: "Ngày", width: 13, fmt: "date" }, { header: "Ca", width: 20 }, { header: "Nhóm", width: 10 }, { header: "Trưởng ca", width: 14 }, { header: "Ghi chú", width: 34 }],
      rows
    };
  }
  if (ctx.has("nang suat", "bao cao", "kpi", "san luong")) {
    const wk = numAfter(ctx, "tuan") ?? 40;
    const rows: Cell[][] = [];
    for (let w = wk - 3; w <= wk; w++)
      for (const g of GROUPS) rows.push([`Tuần ${w}`, g, rint(r, 900, 1650), Math.round(rrange(r, 0.9, 0.985) * 1000) / 1000, Math.round(rrange(r, 6.5, 12) * 10) / 10]);
    return {
      sheet: "Năng suất",
      columns: [
        { header: "Tuần", width: 10 }, { header: "Nhóm", width: 10 }, { header: "Số ảnh", width: 10 },
        { header: "Tỷ lệ QC đạt %", width: 16, fmt: "pct" }, { header: "Thời gian TB/ảnh (phút)", width: 24, fmt: "dec1" }
      ],
      rows
    };
  }
  if (ctx.has("ke hoach", "noi dung", "content", "fanpage")) {
    const topics = shuffle(r, [
      "Before/After ảnh HDR nội thất", "Mẹo chụp ảnh bất động sản bằng điện thoại", "Giới thiệu dịch vụ thay bầu trời",
      "Hậu trường đội QC", "Ưu đãi cho khách hàng mới", "Video timelapse chỉnh một bức ảnh", "Câu hỏi thường gặp",
      "Virtual staging phòng khách", "Ảnh twilight ngoại thất", "Quy trình nhận và giao đơn", "Chia sẻ của nhân viên mới",
      "So sánh ảnh gốc và ảnh đã xử lý", "Mẹo chọn góc chụp phòng nhỏ", "Tổng kết tháng", "Sự kiện nội bộ"
    ]);
    const n = rint(r, 12, 15);
    return {
      sheet: "Kế hoạch nội dung",
      columns: [{ header: "Ngày đăng", width: 13, fmt: "date" }, { header: "Kênh", width: 16 }, { header: "Chủ đề", width: 42 }, { header: "Định dạng", width: 14 }, { header: "Trạng thái", width: 14 }],
      rows: topics.slice(0, n).map((t, i): Cell[] => [
        addDays(d0, i * 2 + (i % 3 === 2 ? 1 : 0)),
        pick(r, ["Fanpage", "Website", "Nhóm cộng đồng", "Email"]),
        t,
        pick(r, ["Ảnh đơn", "Album", "Video ngắn", "Bài viết"]),
        i < n * 0.3 ? "Đã đăng" : pick(r, ["Ý tưởng", "Đang làm", "Chờ duyệt"])
      ])
    };
  }
  if (ctx.has("du toan", "ngan sach", "chi phi", "budget")) {
    const items = shuffle(r, [
      "Thuê địa điểm", "Ăn uống", "Di chuyển", "Quà tặng", "Trang trí", "In ấn", "Âm thanh, ánh sáng", "Bảo hiểm",
      "Hoạt động tập thể", "Thiết bị, vật tư", "Chụp ảnh, quay phim", "Dự phòng phát sinh"
    ]).slice(0, rint(r, 9, 12));
    const weights = items.map(() => rrange(r, 1, 6));
    const sum = weights.reduce((a, b) => a + b, 0);
    const pcts = weights.map((w) => Math.round((w / sum) * 1000) / 1000);
    pcts[pcts.length - 1] = Math.round((1 - pcts.slice(0, -1).reduce((a, b) => a + b, 0)) * 1000) / 1000;
    const notes = ["Ước tính theo kỳ trước", "Đã có báo giá sơ bộ", "Chờ duyệt", "Có thể điều chỉnh", ""];
    return {
      sheet: "Dự toán",
      columns: [{ header: "STT", width: 6 }, { header: "Hạng mục", width: 26 }, { header: "Tỷ trọng (%)", width: 14, fmt: "pct" }, { header: "Ghi chú", width: 28 }],
      rows: items.map((it, i): Cell[] => [i + 1, it, pcts[i] as number, pick(r, notes)]),
      total: ["", "Tổng cộng", 1, ""]
    };
  }
  const tasks = shuffle(r, [
    "Rà soát quy trình nhận đơn", "Cập nhật preset màu chung", "Kiểm tra dung lượng NAS", "Sao lưu dữ liệu tháng trước",
    "Cập nhật checklist QC", "Đào tạo nhân sự mới", "Kiểm tra bản quyền phần mềm", "Dọn thư mục Output cũ",
    "Tổng hợp phản hồi khách hàng", "Chuẩn bị ảnh mẫu tham chiếu", "Rà soát lịch ca tháng sau", "Bảo trì máy trạm",
    "Cập nhật tài liệu hướng dẫn", "Kiểm tra thiết bị văn phòng", "Lên danh sách đề xuất cải tiến", "Đối soát số lượng đơn"
  ]).slice(0, rint(r, 10, 16));
  return {
    sheet: "Danh sách",
    columns: [{ header: "STT", width: 6 }, { header: "Hạng mục", width: 34 }, { header: "Phụ trách", width: 14 }, { header: "Hạn", width: 13, fmt: "date" }, { header: "Trạng thái", width: 16 }],
    rows: tasks.map((t, i): Cell[] => [
      i + 1, t, pick(r, ["Vận hành", "QC", "IT", "Account", "Thiết kế", "Nhóm A", "Nhóm B"]), addDays(d0, rint(r, 1, 21)),
      pick(r, ["Chưa bắt đầu", "Đang làm", "Hoàn thành", "Hoàn thành"])
    ])
  };
}

async function buildXlsx(ctx: Ctx): Promise<Buffer> {
  const t = tableFor(ctx);
  const fixed = new Date(Date.UTC(2026, 9, 1, 2, 0, 0));
  const wb = new ExcelJS.Workbook();
  wb.creator = "seed-workspace";
  wb.created = fixed;
  wb.modified = fixed;
  const ws = wb.addWorksheet(t.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = t.columns.map((c) => ({ header: c.header, width: c.width }));
  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  const border = { style: "thin" as const, color: { argb: "FFD0D4DC" } };
  const all = t.total ? [...t.rows, t.total] : t.rows;
  all.forEach((values, ri) => {
    const row = ws.addRow(values);
    row.eachCell({ includeEmpty: true }, (cell, ci) => {
      const fmt = t.columns[ci - 1]?.fmt;
      if (fmt === "date") cell.numFmt = "dd/mm/yyyy";
      else if (fmt === "pct") cell.numFmt = "0.0%";
      else if (fmt === "dec1") cell.numFmt = "0.0";
      cell.border = { top: border, left: border, bottom: border, right: border };
      if (t.total && ri === all.length - 1) cell.font = { bold: true };
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  return normalizeZipTimes(Buffer.from(await wb.xlsx.writeBuffer()));
}

function buildCsv(ctx: Ctx): Buffer {
  const t = tableFor(ctx);
  const fmt = (v: Cell, c: Col | undefined): string => {
    if (v instanceof Date) return fmtDate(v);
    if (typeof v === "number" && c?.fmt === "pct") return `${(v * 100).toFixed(1)}%`;
    if (typeof v === "number" && c?.fmt === "dec1") return v.toFixed(1);
    return String(v);
  };
  const esc = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [t.columns.map((c) => c.header), ...(t.total ? [...t.rows, t.total] : t.rows).map((r) => r.map((v, i) => fmt(v, t.columns[i])))];
  const text = rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);
}

// =====================================================================================================
// TXT (logs / notes)
// =====================================================================================================

function buildTxt(ctx: Ctx): Buffer {
  const r = ctx.rng;
  if (ctx.has("log", "logs", "syslog")) {
    const d = dateFromName(ctx);
    const hm = /(nas|srv|server|pc|ws) (\d{1,3}) /.exec(ctx.nameWords);
    const host = hm ? `${hm[1] === "server" ? "SRV" : (hm[1] as string).toUpperCase()}-${(hm[2] as string).padStart(2, "0")}` : "SRV-01";
    const ip = (): string => `10.0.${rint(r, 1, 3)}.${rint(r, 10, 99)}`;
    let t = rint(r, 0, 900);
    const info = [
      (): string => `smbd: client ${ip()} connected to share "Production"`,
      (): string => `smbd: client ${ip()} disconnected`,
      (): string => `snapshot: created Production@auto-${pad2(Math.floor(t / 3600))}${pad2(Math.floor(t / 60) % 60)}`,
      (): string => `rsync: job "nightly-backup" started`,
      (): string => `rsync: job "nightly-backup" finished, ${rint(r, 800, 9000)} files, ${rint(r, 4, 60)} GB transferred`,
      (): string => `volume1: usage ${rint(r, 62, 82)}% (threshold 85%)`,
      (): string => `disk${rint(r, 1, 4)}: SMART self-test passed`,
      (): string => `system: load average ${rrange(r, 0.3, 3).toFixed(2)} ${rrange(r, 0.3, 3).toFixed(2)} ${rrange(r, 0.3, 3).toFixed(2)}`,
      (): string => "eth0: link up 1000Mb/s full-duplex",
      (): string => "antivirus: scheduled scan completed, 0 threats found"
    ];
    const warn = [
      (): string => `smbd: slow response ${rrange(r, 1.5, 6).toFixed(1)}s on share "Production"`,
      (): string => `volume1: usage ${rint(r, 85, 92)}% exceeds warning threshold`,
      (): string => `disk${rint(r, 1, 4)}: temperature ${rint(r, 50, 58)}C above normal`,
      (): string => "eth0: link speed changed to 100Mb/s",
      (): string => `rsync: ${rint(r, 2, 40)} files skipped (in use)`
    ];
    const error = [
      (): string => `rsync: job "nightly-backup" exited with code 23 (partial transfer)`,
      (): string => `smbd: authentication failed for user "scanner01" from ${ip()}`,
      (): string => `nfs: mount "archive" timed out after 30s`
    ];
    const lines: string[] = [];
    const n = rint(r, 28, 40);
    for (let i = 0; i < n && t < 86_400; i++) {
      const x = r();
      const [lvl, gen] = x < 0.72 ? ["INFO", pick(r, info)] : x < 0.92 ? ["WARN", pick(r, warn)] : ["ERROR", pick(r, error)];
      const ts = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(Math.floor(t / 3600))}:${pad2(Math.floor(t / 60) % 60)}:${pad2(t % 60)}`;
      lines.push(`${ts} ${host} ${lvl.padEnd(5)} ${gen()}`);
      t += rint(r, 20, 2200);
    }
    return Buffer.from(lines.join("\n") + "\n", "utf8");
  }
  const out: string[] = [ctx.title, "=".repeat(Math.min(60, ctx.title.length)), ""];
  for (const p of docBody(ctx)) {
    if (p.kind === "h") out.push("", p.text);
    else if (p.kind === "li") out.push(`- ${p.text}`);
    else if (p.kind === "check") out.push(`[ ] ${p.text}`);
    else out.push(p.text);
  }
  return Buffer.from(out.join("\n") + "\n", "utf8");
}
