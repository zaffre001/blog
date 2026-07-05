// 카트(브릿지)가 읽는 글 본문 — MDX를 카트용 미니 마크다운으로 강등해서 내보낸다.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { toCartBody, fmtDate } from "../../../lib/cart.js";

export async function getStaticPaths() {
  const posts = await getCollection("posts");
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export const GET: APIRoute = async ({ props }) => {
  const { post } = props as { post: any };
  return new Response(
    JSON.stringify({
      title: post.data.title,
      date: fmtDate(post.data.date),
      body: toCartBody(post.body ?? ""),
    }),
    { headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
};
