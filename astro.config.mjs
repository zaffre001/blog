// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import keystatic from "@keystatic/astro";
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
  integrations: [react(), mdx(), keystatic()],
  adapter: isBuild ? cloudflare() : undefined,
  vite: {
    // virtual:keystatic-config는 vite 플러그인이 런타임에 해석하는 가상 모듈이라
    // esbuild 프리번들에서는 "외부"로 남겨둬야 한다. 패키지 전체를 제외하면
    // CJS 의존성(lodash 등)의 ESM 변환이 빠져 다른 오류가 나므로 이 id만 제외.
    optimizeDeps: { exclude: ["virtual:keystatic-config"] },
    ssr: { optimizeDeps: { exclude: ["virtual:keystatic-config"] } },
  },
});
