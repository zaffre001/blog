// 새 댓글 알림 RSS — 전역 최신 50개 (KV의 r:* 인덱스 사용, 5분 캐시)
import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import site from "../../content/site.json";
import { cfEnv, mem, kvRecent } from "../lib/comments";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const kv = (await cfEnv())?.COMMENTS;
  const recent = kv ? await kvRecent(kv, 50) : mem.recent(50);
  const res = await rss({
    title: site.title + " — 새 댓글",
    description: "댓글 알림 피드",
    site: context.site ?? "https://blog.zaffre001.workers.dev",
    items: recent.map((c) => ({
      title: `[${c.slug}] ${c.nick}`,
      description: c.body,
      pubDate: new Date(c.ts),
      link: `/txt/${c.slug}/#c-${encodeURIComponent(c.id)}`,
    })),
    trailingSlash: false, // 앵커 뒤에 슬래시가 붙지 않게
    customData: "<language>ko</language>",
  });
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
