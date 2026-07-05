// 댓글 API — Cloudflare KV 저장, 익명 "손님" 문화.
// GET    /api/comments/<slug>          → { comments: [{id, nick, body, ts, re?}] }
// POST   /api/comments/<slug>          → { ok, comments } (방금 쓴 것 포함 병합 목록 —
//                                         KV list()의 최종 일관성 지연을 우회하는 read-your-own-writes)
// DELETE /api/comments/<slug> {id}     → { ok }  (Authorization: Bearer <ADMIN_TOKEN>)
// dev(Node)에는 KV가 없으므로 메모리 폴백.
import type { APIRoute } from "astro";
import {
  cfEnv, readEnv, json, okSlug, cleanNick, cleanBody, newSuffix, mem, kvList,
} from "../../../lib/comments";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? "").replace(/\.json$/, "");
  if (!okSlug(slug)) return json({ comments: [] }, 400);
  const kv = (await cfEnv())?.COMMENTS;
  if (!kv) return json({ comments: mem.list(slug), dev: true });
  return json({ comments: await kvList(kv, slug) });
};

export const POST: APIRoute = async ({ params, request }) => {
  const slug = String(params.slug ?? "");
  if (!okSlug(slug)) return json({ error: "잘못된 주소" }, 400);

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "잘못된 요청" }, 400);
  }
  if (payload.website) return json({ ok: true, comments: [] }); // 허니팟 — 봇에게는 성공한 척

  const nick = cleanNick(payload.nick);
  const body = cleanBody(payload.body);
  if (!body) return json({ error: "내용이 비었습니다" }, 400);
  let re = typeof payload.re === "string" && payload.re ? payload.re.slice(0, 32) : undefined;

  const ts = Date.now();
  const id = newSuffix(ts);
  const env = await cfEnv();
  const kv = env?.COMMENTS;

  if (!kv) {
    // dev 폴백
    if (re) {
      const parent = mem.list(slug).find((c) => c.id === re);
      if (!parent) re = undefined;
      else if (parent.re) re = parent.re; // 답글의 답글은 같은 스레드로 평탄화
    }
    const c = { id, nick, body, ts, ...(re ? { re } : {}) };
    mem.add(slug, c);
    return json({ ok: true, dev: true, comments: mem.list(slug) });
  }

  // 실존하는 글인지 확인 (정적 자산에 물어봄)
  const assets = env?.ASSETS;
  if (assets) {
    const chk = await assets.fetch(new URL(`/content/posts/${slug}.json`, request.url));
    if (chk.status !== 200) return json({ error: "없는 글" }, 404);
  }

  // 답글 대상 확인 (없으면 일반 댓글로, 답글의 답글은 평탄화)
  if (re) {
    const parent = (await kv.get(`c:${slug}:${re}`, "json")) as any;
    if (!parent) re = undefined;
    else if (parent.re) re = parent.re;
  }

  // 도배 방지: IP당 60초
  let ip = "anon";
  try {
    ip = request.headers.get("cf-connecting-ip") ?? "anon";
  } catch {}
  if (await kv.get(`rl:${ip}`)) return json({ error: "도배 방지 — 잠시 후 다시 (60초)" }, 429);
  await kv.put(`rl:${ip}`, "1", { expirationTtl: 60 });

  const value = { nick, body, ts, ...(re ? { re } : {}) };
  await kv.put(`c:${slug}:${id}`, JSON.stringify(value));
  await kv.put(`r:${id}`, JSON.stringify({ ...value, slug })); // 댓글 RSS용 전역 인덱스

  // read-your-own-writes: list()가 아직 못 봐도 방금 쓴 건 응답에 병합
  const listed = await kvList(kv, slug);
  if (!listed.some((c) => c.id === id)) listed.push({ id, ...value });
  return json({ ok: true, comments: listed });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const slug = String(params.slug ?? "");
  if (!okSlug(slug)) return json({ error: "잘못된 주소" }, 400);

  const token = await readEnv("ADMIN_TOKEN");
  const auth = request.headers.get("authorization") ?? "";
  if (!token || auth !== `Bearer ${token}`) return json({ error: "시삽 암호 불일치" }, 401);

  let id = "";
  try {
    id = String((await request.json()).id ?? "");
  } catch {}
  if (!id) return json({ error: "id 필요" }, 400);

  const kv = (await cfEnv())?.COMMENTS;
  if (!kv) return json({ ok: mem.del(slug, id), dev: true });

  await kv.delete(`c:${slug}:${id}`);
  await kv.delete(`r:${id}`);
  return json({ ok: true });
};
