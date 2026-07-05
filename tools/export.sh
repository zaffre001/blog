#!/usr/bin/env bash
# PICO-8 웹 플레이어 익스포트 자동화.
# 사용법: PICO8=/Applications/PICO-8.app/Contents/MacOS/pico8 tools/export.sh
# (PICO8 미지정 시 기본 설치 경로를 시도)
set -euo pipefail

PICO8="${PICO8:-/Applications/PICO-8.app/Contents/MacOS/pico8}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/player"

if [[ ! -x "$PICO8" ]]; then
  echo "PICO-8 실행 파일을 찾을 수 없습니다: $PICO8"
  echo "PICO8=<pico8 경로> tools/export.sh 로 지정하거나, PICO-8 앱에서 직접:"
  echo "  load ${ROOT}/cart/blog.p8  →  export blog.html  →  blog.js를 web/player/로 복사"
  exit 1
fi

mkdir -p "$OUT"
cd "$OUT"
"$PICO8" "$ROOT/cart/blog.p8" -export blog.html

# 익스포트된 공식 플레이어 페이지에 브릿지 주입.
# (공식 템플릿의 pico8_buttons/pico8_mouse 입력 글루를 그대로 쓰기 위해
#  우리 쉘에 플레이어를 끼우지 않고, 플레이어에 우리 스크립트를 끼운다)
if ! grep -q "bridge.js" blog.html; then
  perl -0pi -e 's{</head>}{<style>canvas\{cursor:none\}.p8_menu_button\{display:none!important\}</style>\n</head>}' blog.html
  perl -0pi -e 's{</body>}{<script src="../bridge.js"></script>\n</body>}' blog.html
  echo "bridge.js 주입 완료"
fi
echo "완료: 블로그 페이지 = web/player/blog.html (디버그 패널 = web/index.html)"
