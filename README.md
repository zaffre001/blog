# pico-blog

PICO-8 카트가 뷰어인 블로그. 카트에는 콘텐츠가 한 글자도 들어있지 않다 —
글·사진·한글 글리프까지 전부 브라우저 JS가 CDN에서 받아 **GPIO 128바이트 창구**로 스트리밍한다.

```
[content/*.json + 이미지 CDN]
        │ fetch
[web/bridge.js]  ── 한글: Galmuri 웹폰트 → canvas → 1bpp 글리프
        │           사진: 리사이즈 → 16색 Floyd-Steinberg 디더링 → 4bpp
        ▼ gpio 0x5f80, 122바이트/프레임 (~7.4KB/s)
[cart/blog.p8]   ── 확장램 0x8000 = 512행 문서 버퍼, 스크롤 = memcpy
```

## 구조

| 경로 | 역할 |
|---|---|
| `cart/blog.p8` | PICO-8 카트 (뷰어: 레이아웃·스크롤·마우스·카트 스왑 연출) |
| `web/index.html` | 본편: CRT 모니터 프론트 (PICO-8 모드 iframe + 텍스트 모드 리더) |
| `web/debug.html` | 카트 없이 글리프·디더링 파이프라인 확인용 패널 |
| `web/bridge.js` | GPIO 프로토콜 / 글리프 래스터라이저 / 디더링 |
| `web/fonts/` | Galmuri7·11 (SIL OFL 1.1) |
| `content/index.json` | 글 목록 |
| `content/posts/*.json` | 글 본문 (`# 제목` `## 소제목` `> 인용` `![alt](url)` 지원) |
| `tools/export.sh` | PICO-8 CLI 익스포트 자동화 |

## 실행

```sh
python3 -m http.server 8123        # 레포 루트에서
open http://localhost:8123/web/                   # 블로그 본편: CRT 모니터 프론트
open http://localhost:8123/web/player/blog.html   # 플레이어 단독
open http://localhost:8123/web/debug.html         # 디버그 패널 (글리프·디더링 확인)
```

본편(`web/index.html`)은 **CRT 모니터 섀시** 디자인이고, 브라운관 자리에
플레이어 페이지를 iframe으로 끼운다. 같은 출처라 전원 LED가 카트 상태(gpio[126])를
실시간으로 읽는다 (빨강=▶ 대기, 초록=구동 중). 섀시 버튼:

- **PICO-8 / TEXT** — 모드 토글. TEXT 모드는 같은 콘텐츠 JSON을 일반 HTML로 렌더
  (접근성·검색용 폴백). 카트에서 읽던 글이 있으면 그 글을 이어서 연다 (반대 방향도 동일)
- **⏻** — 전원/재부팅
- 딥링크: `#슬러그`(PICO-8 모드), `#txt/슬러그`(텍스트 모드)

플레이어 쪽은 **익스포트된 공식 템플릿 페이지**를 그대로 쓴다 — PICO-8 웹 빌드는
키보드·마우스를 템플릿의 JS 글루(`pico8_buttons`/`pico8_mouse`)로 읽기 때문에,
우리 스크립트(`bridge.js`)를 그 페이지에 주입하는 구조다 (`tools/export.sh`가 자동).
첫 화면의 ▶ 클릭은 브라우저 오디오 정책 때문에 필요.

## 카트 익스포트 (PICO-8 필요)

```sh
PICO8=/Applications/PICO-8.app/Contents/MacOS/pico8 tools/export.sh
```

또는 PICO-8 안에서: `load <repo>/cart/blog.p8` → `export blog.html` → `blog.js`를 `web/player/`로 복사.
BBS/Splore에는 못 올린다(커스텀 JS 필요) — 자기 사이트 전용.

## 글 쓰기

`content/posts/<slug>.json` 추가 → `content/index.json`에 항목 추가. 끝.
이미지는 아무 CDN URL이나 가능(CORS 허용 필요) — 브라우저가 실시간으로 16색 디더링한다.

## 조작

- 마우스: 휠 스크롤, 클릭으로 글 열기, 우클릭/좌상단 `<` 버튼으로 뒤로
- 키보드: ↑↓ 이동/스크롤, Z 열기, X 뒤로
- URL 해시 딥링크: `…/web/#hello-pico8`

## GPIO 프로토콜 (요약)

`[0]`REQ `[1]`ARG `[2]`SEQ(JS→) `[3]`ACK(→JS) `[4]`FIN `[5]`LEN `[6..124]`페이로드
`[125]`카트 입력비트(디버그) `[126]`카트 상태(디버그, `window.__bridgeHistory`로 전이 기록 열람)
`[127]`휠 델타(JS→카트 — 웹 플레이어엔 stat(36)이 없어서 브릿지가 넣어줌)

카트가 REQ(1=목록, 2=글, 3=이미지)를 걸면 JS가 시퀀스+ACK 핸드셰이크로 청크 전송.
카트는 `_init`에서 채널을 0으로 리셋하고, 브릿지는 SEQ가 밟히면 전송을 폐기한다(리부트 대응).
상세 포맷은 `web/bridge.js` 상단 주석 참고. 모든 u16 값은 <0x8000 (PICO-8 16.16 고정소수점 보호).

## PICO-8 웹 익스포트 지뢰 목록 (겪은 것만)

- 숫자는 16.16 고정소수점: `memset(…, …, 0x8000)`의 길이 32768이 음수로 넘쳐 무시됨 → 반으로 쪼갤 것
- `-export`는 카트에 `__label__` 섹션이 없으면 거부함 ("please capture a label first")
- 미니멀 임베드 금지: 입력은 SDL이 아니라 템플릿 JS 글루로 들어온다 (`pico8_buttons`/`pico8_mouse`)
- 템플릿의 `pico8_gpio = new Array(128)`은 전부 `undefined` — 숫자로 정규화하지 않으면 오독함
- 데스크톱 마우스는 템플릿이 안 채워줌(터치만) — 캔버스 좌표로 직접 채우되, **캔버스 밖 클릭은 무시**할 것
