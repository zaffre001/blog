# za66re — PICO-8 카트가 뷰어인 블로그

카트에는 콘텐츠가 한 글자도 들어있지 않다 — 글·사진·한글 글리프까지 전부
브라우저 JS가 받아와 **GPIO 128바이트 창구**로 스트리밍한다. 글은 **Keystatic**(MDX)으로
쓰고, **Astro**가 빌드 시 카트용 JSON과 텍스트 모드 정적 페이지를 함께 굽는다.

```
[Keystatic /keystatic] ─ MDX 편집 → GitHub 커밋
        │
[content/posts/*.mdx + content/site.json]
        │ astro build
        ├─ /content/*.json      ← 카트용 (MDX → 미니 마크다운 강등)
        ├─ /txt/…               ← 텍스트 모드 정적 페이지 (SEO·접근성)
        ├─ /rss.xml
        └─ /                    ← CRT 모니터 프론트 (곡면 셰이더 브라운관)
                │ iframe
        [public/player/blog.html]  PICO-8 공식 플레이어 + bridge.js 주입
                │ gpio 0x5f80, ~7.4KB/s
        [cart/blog.p8]  글리프 블리터 + 512행 버퍼 + 카트리지 스왑 연출
```

## 구조

| 경로 | 역할 |
|---|---|
| `content/posts/*.mdx` | 글 (Keystatic이 관리, frontmatter: title·date) |
| `content/site.json` | 사이트 이름·태그라인 |
| `src/pages/index.astro` | CRT 모니터 프론트 (곡면 WebGL 셰이더 + PICO-8 브라운관) |
| `src/pages/txt/` | 텍스트 모드 정적 페이지 |
| `src/pages/content/` | 카트용 JSON 엔드포인트 (빌드 시 MDX에서 생성) |
| `src/lib/cart.js` | MDX → 카트 미니 마크다운 변환기 |
| `keystatic.config.ts` | CMS 스키마 (dev=로컬 파일, 배포=GitHub 모드) |
| `public/player/` | PICO-8 공식 익스포트 + bridge 주입 (블로그 본편의 브라운관) |
| `public/bridge.js` | GPIO 프로토콜 / 갈무리 글리프 래스터라이저 / 16색 디더링 |
| `cart/blog.p8` | PICO-8 카트 (뷰어) |
| `tools/export.sh` | 카트 익스포트 + `__label__` + bridge 주입 자동화 |

## 개발

```sh
npm install
npm run dev            # http://localhost:4321
```

- `/` CRT 프론트 · `/txt/` 텍스트 모드 · `/keystatic` 글쓰기(로컬 모드: 파일에 바로 저장)
- 콘텐츠 수정은 dev 서버가 즉시 반영. **카트 코드**(cart/blog.p8)를 고쳤을 때만
  `PICO8=<pico8 경로> npm run export-cart` 후 새로고침

## 배포 — Cloudflare Workers

어댑터 v13부터 **Cloudflare Pages는 미지원** (Workers + 정적 자산으로 통합됨).
배포 경험은 Pages와 동일하다: GitHub 연결 → 푸시하면 자동 빌드·배포.

1. GitHub에 repo 푸시 (`zaffre001/blog` — 다르면 `keystatic.config.ts`의 repo 수정)
2. Cloudflare 대시보드 → Workers & Pages → Create → **Workers** → Import a repository
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
3. 환경변수 4개 설정 (`.env.example` 참고 — Keystatic GitHub App 발급값)
   - GitHub App 만들기: 로컬에서 `keystatic.config.ts` storage를 잠시 github로 두고
     `npm run dev` → `localhost:4321/keystatic` 접속하면 생성 마법사가 뜬다
4. 배포 후 `astro.config.mjs`의 `site`를 실제 도메인으로 교체 (RSS 절대링크용)

로컬에서 수동 배포: `npm run build && npx wrangler deploy`
(`wrangler.jsonc`의 `nodejs_compat`은 Keystatic API 라우트에 필수)

## 글쓰기

- **배포된 사이트**: `https://<도메인>/keystatic` — 어디서든 접속, 저장 = GitHub 커밋 = 자동 재배포
- **로컬**: `npm run dev` → `/keystatic` — 저장 = 로컬 파일, 발행 = git push
- 본문은 MDX. 카트가 아는 문법: `# 제목` `## 소제목` `> 인용` `![alt](이미지URL)` 문단 —
  그 외 문법은 텍스트 모드에는 온전히, 카트에는 텍스트로 강등되어 나간다
- 이미지는 아무 CDN URL이나 가능(CORS 허용 필요) — 브라우저가 실시간 16색 디더링

## 조작 (PICO-8 모드)

- 유리 클릭 = 전원 ON · 휠 스크롤 · 클릭으로 글 열기 · 우클릭/X 뒤로 · ⏻ 재부팅
- 딥링크: `/#슬러그` (카트에서 바로 열림) · `/txt/슬러그/` (텍스트 모드)

## GPIO 프로토콜 (요약)

`[0]`REQ `[1]`ARG `[2]`SEQ(JS→) `[3]`ACK(→JS) `[4]`FIN `[5]`LEN `[6..124]`페이로드
`[125]`카트 입력비트(디버그) `[126]`카트 상태(디버그, `window.__bridgeHistory`) `[127]`휠 델타

카트가 REQ(1=목록, 2=글, 3=이미지)를 걸면 JS가 시퀀스+ACK 핸드셰이크로 청크 전송.
카트는 `_init`에서 채널을 0으로 리셋하고, 브릿지는 SEQ가 밟히면 전송을 폐기한다(리부트 대응).
상세 포맷은 `public/bridge.js` 상단 주석 참고. 모든 u16 값은 <0x8000 (PICO-8 16.16 고정소수점 보호).

## 지뢰 목록 (겪은 것만)

**PICO-8 웹 익스포트:**
- 숫자는 16.16 고정소수점: `memset(…, …, 0x8000)`의 길이 32768이 음수로 넘쳐 무시됨 → 반으로 쪼갤 것
- `-export`는 카트에 `__label__` 섹션이 없으면 거부함 ("please capture a label first")
- 미니멀 임베드 금지: 입력은 SDL이 아니라 템플릿 JS 글루로 들어온다 (`pico8_buttons`/`pico8_mouse`)
- 템플릿의 `pico8_gpio = new Array(128)`은 전부 `undefined` — 숫자로 정규화하지 않으면 오독함
- 데스크톱 마우스는 템플릿이 안 채워줌(터치만) — 캔버스 좌표로 직접 채우되, **캔버스 밖 클릭은 무시**할 것
- PICO-8(0.2.7)에 CRT/곡면 필터는 없다 — 프론트의 WebGL 셰이더가 담당

**Astro 6 + Keystatic + Cloudflare:**
- Keystatic은 Astro 7 미지원 (peer `2||3||4||5||6`) → `astro@^6` + `@astrojs/mdx@^6` + `@astrojs/cloudflare@^13`
- CF 어댑터는 **빌드에만** 적용 (`isBuild ? cloudflare() : undefined`) — dev가 workerd로 돌면
  Keystatic 로컬 모드(fs 필요)가 죽고 CJS 의존성이 "module is not defined"로 터진다
- `virtual:keystatic-config`는 esbuild 프리번들에서 제외 필요 (astro.config의 optimizeDeps 참고)
- 루트에 Pages식 `wrangler.toml`(`pages_build_output_dir`) 두면 어댑터 프리렌더와 충돌 —
  Workers식 `wrangler.jsonc`(main=어댑터 엔트리포인트)를 쓸 것
