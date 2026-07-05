// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import cloudflare from "@astrojs/cloudflare";

// 사이트는 전부 정적으로 프리렌더되고, Keystatic 관리화면(/keystatic, /api/keystatic)만
// SSR로 Cloudflare Workers 런타임에서 돈다 (wrangler.jsonc의 nodejs_compat 필요).
//
// CF 어댑터는 "빌드에만" 적용한다: dev는 Node 런타임이어야 Keystatic 로컬 모드가
// 파일(fs)에 글을 쓸 수 있다 (workerd엔 fs가 없음). 프로덕션 /keystatic은
// GitHub 모드라 fs가 필요 없어서 workerd에서 문제없다.
const isBuild = process.argv.includes("build");

export default defineConfig({
  // TODO: Workers 도메인 확정 후 실제 주소로 교체 (RSS/절대링크에 쓰임)
  site: "https://za66re-blog.workers.dev",
  // Keystatic 라우트는 직접 정의(src/pages/keystatic, src/pages/api/keystatic) —
  // @keystatic/astro 통합의 주입 라우트가 Astro 6 + CF에서 깨져서 쓰지 않는다.
  integrations: [react(), mdx()],
  adapter: isBuild ? cloudflare() : undefined,
  vite: {
    // cloudflare:workers는 workerd 전용 가상 모듈 — 번들에서 외부 처리
    ssr: { external: ["cloudflare:workers"] },
  },
});
