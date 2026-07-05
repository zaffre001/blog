// 카트(브릿지)가 읽는 글 목록 — MDX 컬렉션에서 빌드 시 생성된다.
// 포맷은 기존 수제 content/index.json과 동일: { site, tagline, posts:[{id,slug,title,date}] }
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { fmtDate } from "../../lib/cart.js";
import site from "../../../content/site.json";

export const GET: APIRoute = async () => {
  const posts = (await getCollection("posts")).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
  return new Response(
    JSON.stringify({
      site: site.title,
      tagline: site.tagline,
      posts: posts.map((p, i) => ({
        id: i,
        slug: p.id,
        title: p.data.title,
        date: fmtDate(p.data.date),
      })),
    }),
    { headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};
