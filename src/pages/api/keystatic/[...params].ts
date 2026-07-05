// Keystatic API — GitHub OAuth/커밋 프록시.
// @keystatic/astro의 주입 라우트가 Astro 6 + Cloudflare에서 죽어서 직접 정의한다.
// 환경변수는 3단 폴백: cloudflare:workers(배포 workerd) → import.meta.env(dev) → process.env.
import type { APIRoute } from "astro";
import { makeGenericAPIRouteHandler } from "@keystatic/core/api/generic";
import config from "../../../../keystatic.config";

export const prerender = false;

async function readEnv(key: string): Promise<string | undefined> {
  try {
    // 배포(workerd): Astro 6 권장 방식
    const { env } = await import(/* @vite-ignore */ "cloudflare:workers");
    if ((env as Record<string, string>)?.[key]) return (env as Record<string, string>)[key];
  } catch {
    /* dev(Node)에서는 모듈이 없음 — 폴백 */
  }
  return (
    (import.meta.env as Record<string, string | undefined>)[key] ??
    (globalThis as any).process?.env?.[key]
  );
}

export const ALL: APIRoute = async ({ request }) => {
  const handler = makeGenericAPIRouteHandler({
    config,
    clientId: await readEnv("KEYSTATIC_GITHUB_CLIENT_ID"),
    clientSecret: await readEnv("KEYSTATIC_GITHUB_CLIENT_SECRET"),
    secret: await readEnv("KEYSTATIC_SECRET"),
  });
  const { body, headers, status } = await handler(request);
  return new Response(body, { headers, status });
};
