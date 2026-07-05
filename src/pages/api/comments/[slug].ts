// 댓글 API — Cloudflare KV(binding: COMMENTS) 저장, 익명 "손님" 문화.
// GET  /api/comments/<slug>  → { comments: [{nick, body, ts}, ...] } (오래된 순)
// POST /api/comments/<slug>  → { ok: true } | { error }
// dev(Node)에는 KV가 없으므로 메모리 폴백 (서버 재시작 시 소멸 — UI 개발용).
import type { APIRoute } from "astro";

export const prerender = false;

const memStore = new Map<string, unknown[]>();

async function cfEnv(): Promise<Record<string, any> | undefined> {
  try {
    return (await import(/* @vite-ignore */ "cloudflare:workers")).env as Record<string, any>;
  } catch {
    return undefined;
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const okSlug = (s: string) => /^[a-z0-9-]{1,64}$/.test(s);

export const GET: APIRoute = async ({ params }) => {
  const slug = String(params.slug ?? "").replace(/\.json$/, "");
  if (!okSlug(slug)) return json({ comments: [] }, 400);
  const env = await cfEnv();
  const kv = env?.COMMENTS;
  if (!kv) return json({ comments: memStore.get(slug) ?? [], dev: true });
  const list = await kv.list({ prefix: `c:${slug}:`, limit: 100 });
  const comments = (
    await Promise.all(list.keys.map((k: { name: string }) => kv.get(k.name, "json")))
  ).filter(Boolean);
  return json({ comments });
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
  if (payload.website) return json({ ok: true }); // 허니팟 — 봇에게는 성공한 척

  const nick =
    String(payload.nick ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 12) || "손님";
  const body = String(payload.body ?? "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 500);
  if (!body) return json({ error: "내용이 비었습니다" }, 400);

  const c = { nick, body, ts: Date.now() };
  const env = await cfEnv();
  const kv = env?.COMMENTS;

  if (!kv) {
    const a = (memStore.get(slug) ?? []) as unknown[];
    a.push(c);
    memStore.set(slug, a);
    return json({ ok: true, dev: true });
  }

  // 실존하는 글인지 확인 (정적 자산에 물어봄)
  const assets = env?.ASSETS;
  if (assets) {
    const chk = await assets.fetch(new URL(`/content/posts/${slug}.json`, request.url));
    if (chk.status !== 200) return json({ error: "없는 글" }, 404);
  }

  // 도배 방지: IP당 60초
  let ip = "anon";
  try {
    ip = request.headers.get("cf-connecting-ip") ?? "anon";
  } catch {}
  if (await kv.get(`rl:${ip}`)) return json({ error: "도배 방지 — 잠시 후 다시 (60초)" }, 429);
  await kv.put(`rl:${ip}`, "1", { expirationTtl: 60 });

  // 키가 시간순으로 정렬되도록 타임스탬프 패딩
  const key = `c:${slug}:${String(c.ts).padStart(14, "0")}:${Math.random().toString(36).slice(2, 6)}`;
  await kv.put(key, JSON.stringify(c));
  return json({ ok: true });
};
