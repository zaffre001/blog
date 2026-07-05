// bridge.js — PICO-8 ↔ 웹 브릿지
// 역할: 콘텐츠 fetch, 한글 글리프 래스터라이즈, 이미지 16색 디더링,
//       GPIO(128바이트) 핸드셰이크로 카트에 스트리밍.
//
// GPIO 레이아웃 (cart/blog.p8 과 반드시 일치):
//   [0] REQ   카트→JS 명령 (0=유휴, 1=INDEX, 2=POST, 3=IMAGE)
//   [1] ARG   명령 인자 (글 id / 이미지 슬롯)
//   [2] SEQ   JS→카트 청크 시퀀스 (1..255 순환, 0 없음)
//   [3] ACK   카트→JS 소비 확인 (SEQ 에코)
//   [4] FLAGS bit0 = 마지막 청크
//   [5] LEN   페이로드 길이 (≤119)
//   [6..124]  페이로드
//   [125] 카트 입력 비트(디버그), [126] 카트 상태(디버그), [127] 휠 델타(JS→카트)
//
// 메시지 포맷 (u16 = 리틀엔디언, 값은 항상 <0x8000 — 카트의 16.16 고정소수점 보호):
//   공통 헤더: u16 글리프수, 반복{ u16 gid, u8 w, u8 h, ceil(w/8)*h 바이트(1bpp) }
//   INDEX: u8 autopost(0xff=없음), gids(사이트제목), u8 글수,
//          반복{ u8 id, u8 슬러그길이, ascii, gids(제목), gids(날짜) }
//   POST:  gids(제목), gids(날짜), u8 이미지수, 토큰 u16 스트림:
//          0x7fff=끝 0x7ffe=줄바꿈 0x7ffd=이미지(u8 k, u16 h) 0x7ffc=색(u8) 그외=gid
//   IMAGE: 행 단위 4bpp 원본 바이트 (h*64), 하위 니블 = 왼쪽 픽셀
//   gids = u8 길이 + u16×길이

(() => {
"use strict";

// 이 스크립트가 어디에 끼워지든(자체 쉘, 익스포트된 blog.html) 동작하도록
// 모든 경로를 bridge.js 자신의 위치 기준으로 푼다.
const SELF = (document.currentScript && document.currentScript.src) || location.href;
const ROOT = new URL(".", SELF);                      // …/web/
const CONTENT = new URL("../content", ROOT).href;
const fontUrl = n => new URL("fonts/" + n, ROOT).href;

// gpio[6..123]=페이로드, [124]=UI 채널(1=댓글창 열기 요청, 2=댓글 갱신됨),
// [125]=카트 입력비트(디버그), [126]=카트 상태, [127]=휠 델타
const PAYLOAD = 118;
const BG = 1; // pico-8 색 1 (진남색) — 카트와 동일해야 함

const FONTS = {
  body:  { css: "8px Galmuri7",        h: 8  },
  title: { css: "700 12px Galmuri11",  h: 12 },
};

// pico-8 기본 팔레트
const PAL = [
  [0,0,0],[29,43,83],[126,37,83],[0,135,81],
  [171,82,54],[95,87,79],[194,195,199],[255,241,232],
  [255,0,77],[255,163,0],[255,236,39],[0,228,54],
  [41,173,255],[131,118,156],[255,119,168],[255,204,170],
];

const gpio = (window.pico8_gpio = window.pico8_gpio || new Array(128).fill(0));
// 템플릿의 pico8_mouse는 첫 mousemove 전까지 빈 배열 — stat(32~34)가
// undefined를 읽고 유령 클릭이 생기지 않게 미리 채워둔다.
if (Array.isArray(window.pico8_mouse) && window.pico8_mouse.length === 0)
  window.pico8_mouse.push(0, 0, 0);
// 공식 익스포트 템플릿은 new Array(128) — 전부 undefined다.
// undefined를 명령/시퀀스로 오독하지 않도록 반드시 숫자로 정규화한다.
for (let i = 0; i < 128; i++) if (typeof gpio[i] !== "number" || !isFinite(gpio[i])) gpio[i] = 0;

const logEl = () => document.getElementById("bridge-log");
function log(msg) {
  console.log("[bridge]", msg);
  const el = logEl();
  if (el) { el.textContent += msg + "\n"; el.scrollTop = el.scrollHeight; }
}

// ---- 글리프 래스터라이저 ----------------------------------------------
const rcv = document.createElement("canvas");
rcv.width = 24; rcv.height = 24;
const rctx = rcv.getContext("2d", { willReadFrequently: true });

function rasterize(ch, font) {
  rctx.clearRect(0, 0, 24, 24);
  rctx.font = font.css;
  rctx.textBaseline = "top";
  rctx.fillStyle = "#fff";
  rctx.fillText(ch, 0, 0);
  let adv = Math.round(rctx.measureText(ch).width) || Math.ceil(font.h / 2);
  const w = Math.max(1, Math.min(adv, 16));
  const h = font.h;
  const data = rctx.getImageData(0, 0, 16, h).data;
  const bw = Math.ceil(w / 8);
  const bits = new Uint8Array(bw * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * 16 + x) * 4 + 3] > 127) bits[y * bw + (x >> 3)] |= 128 >> (x & 7);
  return { w, h, bits };
}

const gidMap = new Map();
let nextGid = 16;
let pending = [];

function gidOf(ch, font) {
  const key = font.css + "\x00" + ch;
  let g = gidMap.get(key);
  if (!g) {
    if (nextGid >= 0x7000) throw new Error("glyph id space exhausted");
    g = Object.assign({ id: nextGid++ }, rasterize(ch, font));
    gidMap.set(key, g);
    pending.push(g);
  }
  return g.id;
}

// ---- 바이트 라이터 -----------------------------------------------------
function W() { this.a = []; }
W.prototype.u8  = function (v) { this.a.push(v & 255); };
W.prototype.u16 = function (v) { this.a.push(v & 255, (v >> 8) & 255); };
W.prototype.raw = function (b) { for (let i = 0; i < b.length; i++) this.a.push(b[i]); };
W.prototype.gids = function (str, font) {
  const arr = Array.from(str).slice(0, 120).map(ch => gidOf(ch, font));
  this.u8(arr.length);
  for (const id of arr) this.u16(id);
};

function packMsg(buildBody) {
  const body = new W();
  buildBody(body); // 이 동안 새 글리프가 pending에 쌓임
  const head = new W();
  head.u16(pending.length);
  for (const g of pending) { head.u16(g.id); head.u8(g.w); head.u8(g.h); head.raw(g.bits); }
  pending = [];
  return Uint8Array.from(head.a.concat(body.a));
}

// ---- 본문 토크나이저 (아주 작은 마크다운 부분집합) ----------------------
function tokenize(body) {
  const tokens = [], images = [];
  for (const raw of body.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (m) { tokens.push({ img: images.length }); images.push({ alt: m[1], url: m[2] }); continue; }
    let col = 7, t = line;
    if (t.startsWith("# "))       { col = 10; t = t.slice(2); }
    else if (t.startsWith("## ")) { col = 12; t = t.slice(3); }
    else if (t.startsWith("> "))  { col = 6;  t = "| " + t.slice(2); }
    tokens.push({ line: t, col });
  }
  return { tokens, images };
}

// ---- 이미지: 로드 + 16색 Floyd–Steinberg 디더링 ------------------------
const dcv = document.createElement("canvas");
const dctx = dcv.getContext("2d", { willReadFrequently: true });

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("load fail: " + url));
    img.src = url;
  });
}

function dither(el, w, h) {
  dcv.width = 128; dcv.height = h;
  dctx.fillStyle = "rgb(29,43,83)"; // BG=1
  dctx.fillRect(0, 0, 128, h);
  dctx.imageSmoothingEnabled = true;
  dctx.drawImage(el, (128 - w) >> 1, 0, w, h);
  const d = dctx.getImageData(0, 0, 128, h).data;
  const px = new Float32Array(128 * h * 3);
  for (let i = 0; i < 128 * h; i++) {
    px[i * 3] = d[i * 4]; px[i * 3 + 1] = d[i * 4 + 1]; px[i * 3 + 2] = d[i * 4 + 2];
  }
  const clamp = v => v < 0 ? 0 : v > 255 ? 255 : v;
  const out = new Uint8Array(h * 64).fill(BG | (BG << 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 3;
      const r = clamp(px[i]), g = clamp(px[i + 1]), b = clamp(px[i + 2]);
      let bi = 0, bd = 1e12;
      for (let c = 0; c < 16; c++) {
        const p = PAL[c], dr = r - p[0], dg = g - p[1], db = b - p[2];
        const dist = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (dist < bd) { bd = dist; bi = c; }
      }
      const er = r - PAL[bi][0], eg = g - PAL[bi][1], eb = b - PAL[bi][2];
      if (x + 1 < 128) { px[i + 3] += er * 7 / 16; px[i + 4] += eg * 7 / 16; px[i + 5] += eb * 7 / 16; }
      if (y + 1 < h) {
        const j = ((y + 1) * 128 + x) * 3;
        if (x > 0)     { px[j - 3] += er * 3 / 16; px[j - 2] += eg * 3 / 16; px[j - 1] += eb * 3 / 16; }
        px[j] += er * 5 / 16; px[j + 1] += eg * 5 / 16; px[j + 2] += eb * 5 / 16;
        if (x + 1 < 128) { px[j + 3] += er / 16; px[j + 4] += eg / 16; px[j + 5] += eb / 16; }
      }
      const o = y * 64 + (x >> 1);
      if (x & 1) out[o] = (out[o] & 0x0f) | (bi << 4);
      else       out[o] = (out[o] & 0xf0) | bi;
    }
  }
  return out;
}

// ---- 콘텐츠 핸들러 -----------------------------------------------------
let indexData = null;
let currentPost = null;
let firstIndex = true;

const ready = (async () => {
  // 페이지에 @font-face가 없어도 되도록 FontFace API로 직접 등록
  const faces = [
    new FontFace("Galmuri7",  'url("' + fontUrl("Galmuri7.woff2") + '")'),
    new FontFace("Galmuri11", 'url("' + fontUrl("Galmuri11.woff2") + '")', { weight: "400" }),
    new FontFace("Galmuri11", 'url("' + fontUrl("Galmuri11-Bold.woff2") + '")', { weight: "700" }),
  ];
  await Promise.all(faces.map(f => f.load()));
  faces.forEach(f => document.fonts.add(f));
  await Promise.all([
    document.fonts.load(FONTS.body.css, "가나다Aa1"),
    document.fonts.load(FONTS.title.css, "가나다Aa1"),
  ]);
  if (!document.fonts.check(FONTS.body.css, "가")) log("경고: Galmuri7 로드 실패 — web/fonts/ 확인");
  else log("폰트 준비 완료 (Galmuri7 / Galmuri11)");
})();

async function handleIndex() {
  indexData = await (await fetch(CONTENT + "/index.json")).json();
  if (!firstIndex) history.replaceState(null, "", "#");
  const auto = firstIndex ? indexData.posts.findIndex(p => "#" + p.slug === location.hash) : -1;
  firstIndex = false;
  log("INDEX 전송: 글 " + indexData.posts.length + "개");
  return packMsg(w => {
    w.u8(auto < 0 ? 255 : auto);
    w.gids(indexData.site, FONTS.title);
    w.u8(indexData.posts.length);
    indexData.posts.forEach((p, i) => {
      w.u8(i);
      const slug = p.slug.slice(0, 24);
      w.u8(slug.length);
      for (const ch of slug) w.u8(ch.charCodeAt(0) & 127);
      w.gids(p.title, FONTS.body);
      w.gids(p.date, FONTS.body);
    });
  });
}

async function handlePost(arg) {
  const p = indexData.posts[arg];
  if (!p) throw new Error("post " + arg + " 없음");
  const post = await (await fetch(CONTENT + "/posts/" + p.slug + ".json")).json();
  history.replaceState(null, "", "#" + p.slug);
  const { tokens, images } = tokenize(post.body);
  await Promise.all(images.map(async im => {
    try {
      im.el = await loadImage(im.url);
      // CORS 오염 검사 — getImageData가 막히면 텍스트로 대체
      dcv.width = 1; dcv.height = 1;
      dctx.drawImage(im.el, 0, 0, 1, 1);
      dctx.getImageData(0, 0, 1, 1);
      im.w = 128;
      im.h = Math.max(8, Math.round(im.el.naturalHeight * 128 / im.el.naturalWidth));
      if (im.h > 224) { im.h = 224; im.w = Math.round(im.el.naturalWidth * 224 / im.el.naturalHeight); }
    } catch (e) {
      log("이미지 실패: " + im.url + " (" + e.message + ")");
      im.failed = true;
    }
  }));
  currentPost = { post, tokens, images };

  // 댓글 (PC통신 감성 — 글 뒤에 같은 파이프라인으로 이어붙인다)
  let cms = [];
  try {
    cms = (await (await fetch(new URL("api/comments/" + p.slug, ROOT))).json()).comments ?? [];
  } catch (e) { log("댓글 로드 실패: " + e.message); }
  // read-your-own-writes: 방금 모달로 등록한 댓글이 KV list() 지연으로 빠졌으면 병합
  try {
    const ov = window.__cmtsOverride;
    if (ov && ov.slug === p.slug && Date.now() - ov.at < 120000) {
      const seen = new Set(cms.map(c => c.id));
      for (const c of ov.comments ?? []) if (c.id && !seen.has(c.id)) cms.push(c);
    }
  } catch (e) {}

  log("POST 전송: " + post.title + " (이미지 " + images.length + ", 댓글 " + cms.length + ")");
  return packMsg(w => {
    w.gids(post.title, FONTS.title);
    w.gids(post.date, FONTS.body);
    w.u8(images.length);
    let cur = 7;
    const emitRun = (txt, col) => {
      if (col !== cur) { w.u16(0x7ffc); w.u8(col); cur = col; }
      for (const ch of Array.from(txt)) w.u16(gidOf(ch, FONTS.body));
    };
    const emitText = (txt, col) => { emitRun(txt, col); w.u16(0x7ffe); };
    for (const t of tokens) {
      if (t.img !== undefined) {
        const im = images[t.img];
        if (im.failed) emitText("[이미지 실패: " + (im.alt || im.url) + "]", 8);
        else { w.u16(0x7ffd); w.u8(t.img); w.u16(im.h); }
      } else emitText(t.line, t.col);
    }
    // ── 댓글 섹션 (1단 답글 스레드) ──
    const p2 = n => String(n).padStart(2, "0");
    const when = ts => {
      const d = new Date(ts);
      return p2(d.getMonth() + 1) + "/" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
    };
    const tops = cms.filter(c => !c.re).sort((a, b) => a.ts - b.ts);
    const reps = cms.filter(c => c.re).sort((a, b) => a.ts - b.ts);
    for (const r of reps) if (!tops.some(t => t.id === r.re)) { delete r.re; tops.push(r); } // 부모 삭제된 답글은 승격
    tops.sort((a, b) => a.ts - b.ts);
    w.u16(0x7ffe);
    emitText("─".repeat(15), 13);
    emitText("▶ 댓글 " + cms.length + "건", 12);
    if (!cms.length) emitText("아직 댓글이 없습니다", 5);
    for (const c of tops.slice(-50)) {
      emitRun(String(c.nick), 11);
      emitRun(" " + when(c.ts), 5);
      w.u16(0x7ffe);
      for (const ln of String(c.body).split("\n")) emitText("> " + ln, 7);
      for (const r of reps) {
        if (r.re !== c.id) continue;
        emitRun("└ ", 13);
        emitRun(String(r.nick), 11);
        emitRun(" " + when(r.ts), 5);
        w.u16(0x7ffe);
        for (const ln of String(r.body).split("\n")) emitText("  > " + ln, 6);
      }
      w.u16(0x7ffe);
    }
    emitText("[+]로 댓글 남기기", 5);
    w.u16(0x7fff);
  });
}

async function handleImage(k) {
  const im = currentPost && currentPost.images[k];
  if (!im || im.failed) return new Uint8Array(0);
  if (!im.bytes) im.bytes = dither(im.el, im.w, im.h);
  log("IMAGE " + k + " 전송: " + im.bytes.length + "바이트");
  return im.bytes;
}

async function handle(cmd, arg) {
  await ready;
  if (cmd === 1) return handleIndex();
  if (cmd === 2) return handlePost(arg);
  if (cmd === 3) return handleImage(arg);
  return new Uint8Array(0);
}

// ---- GPIO 펌프 ---------------------------------------------------------
let tx = null, busy = false, armed = true, seqCounter = 0;

function mkTx(bytes) {
  const chunks = [];
  for (let o = 0; o < bytes.length; o += PAYLOAD) chunks.push(bytes.subarray(o, Math.min(o + PAYLOAD, bytes.length)));
  if (chunks.length === 0) chunks.push(new Uint8Array(0));
  return { chunks, i: 0, cur: 0 };
}

function sendChunk() {
  const c = tx.chunks[tx.i];
  gpio[5] = c.length;
  for (let i = 0; i < c.length; i++) gpio[6 + i] = c[i];
  gpio[4] = (tx.i === tx.chunks.length - 1) ? 1 : 0;
  seqCounter = seqCounter % 255 + 1;
  tx.cur = seqCounter;
  gpio[2] = seqCounter;
}

// 카트 상태/입력 관찰 (디버깅용 — window.__bridgeHistory로 열람)
const hist = (window.__bridgeHistory = []);
let lastState = -1, lastInput = 0;
function watch() {
  const st = gpio[126], ib = gpio[125];
  if (st !== lastState) { hist.push(performance.now().toFixed(0) + "ms state " + lastState + "→" + st); lastState = st; }
  if (ib !== lastInput && ib !== 0) hist.push(performance.now().toFixed(0) + "ms input bits=" + ib);
  if (ib !== lastInput) lastInput = ib;
  if (hist.length > 400) hist.splice(0, 100);
}

function pump() {
  watch();
  // 휠 델타를 gpio[127]로 전달 (부호 있는 바이트, 카트가 읽고 0으로 지움)
  // 정수부만 보내고 소수점은 이월 — 작은 제스처도 누적되면 반영된다
  if (wheelAcc !== 0 && gpio[127] === 0) {
    const v = Math.max(-120, Math.min(120, Math.trunc(wheelAcc)));
    if (v !== 0) { gpio[127] = v & 0xff; wheelAcc -= v; }
    else if (Math.abs(wheelAcc) < 0.01) wheelAcc = 0;
  }
  if (tx) {
    if (gpio[2] !== tx.cur) {
      // 카트가 (재)부팅하며 채널을 리셋함 → 진행 중 전송 폐기
      log("채널 리셋 감지 — 전송 폐기");
      tx = null; busy = false;
      return;
    }
    if (gpio[3] === tx.cur) {
      tx.i++;
      if (tx.i >= tx.chunks.length) { tx = null; busy = false; }
      else sendChunk();
    }
    return;
  }
  const cmd = gpio[0];
  if (cmd === 0) { armed = true; return; }
  if (!armed || busy) return;
  if (cmd !== 1 && cmd !== 2 && cmd !== 3) return; // 프리부트 쓰레기 무시
  armed = false; busy = true;
  const arg = gpio[1];
  handle(cmd, arg).then(bytes => { tx = mkTx(bytes); sendChunk(); })
    .catch(e => {
      log("오류(cmd=" + cmd + "): " + e.message);
      tx = mkTx(new Uint8Array(0)); // 빈 최종 청크 = 카트 쪽 오류 화면
      sendChunk();
    });
}

setInterval(pump, 8);

// 데스크톱 마우스 글루 — 공식 템플릿은 터치에서만 pico8_mouse를 채우므로
// 마우스 이벤트로도 [x(0..127), y(0..127), 버튼비트]를 유지해 준다.
(function mouseGlue() {
  let btns = 0;
  const upd = e => {
    const c = document.getElementById("canvas") || document.querySelector("canvas");
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    // 캔버스 안에 있을 때만 반영 — 밖의 클릭을 클램프하면 유령 클릭이 된다
    if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) {
      window.pico8_mouse = [
        Math.floor((e.clientX - r.left) * 128 / r.width),
        Math.floor((e.clientY - r.top) * 128 / r.height),
        btns,
      ];
    } else if (Array.isArray(window.pico8_mouse) && window.pico8_mouse.length >= 3) {
      window.pico8_mouse[2] = 0;
    }
  };
  addEventListener("mousemove", upd, true);
  addEventListener("mousedown", e => { if (e.button === 0) btns |= 1; if (e.button === 2) btns |= 2; upd(e); }, true);
  addEventListener("mouseup",   e => { if (e.button === 0) btns &= ~1; if (e.button === 2) btns &= ~2; upd(e); }, true);
})();

// 캔버스 위 휠: 페이지 스크롤 막고 카트로 전달 (위로 굴리면 +)
// 이벤트 "개수"가 아니라 deltaY 크기 기반 — 트랙패드는 제스처당 수십 개의
// 작은 이벤트를 쏘므로 개수 기반이면 감도가 폭주한다. 휠 한 노치(±120) ≈ 2유닛.
let wheelAcc = 0;
addEventListener("wheel", e => {
  if (e.target && e.target.tagName === "CANVAS") {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 128 : e.deltaY;
    wheelAcc -= dy / 200; // 노치(±120) ≈ 0.6유닛 ≈ 카트 7px (index.astro 터치 환산 상수와 연동)
  }
}, { passive: false });

// 디버그/자체 테스트용 노출
window.__bridge = { FONTS, PAL, BG, rasterize, gidOf, dither, loadImage, tokenize, ready, log };
})();
