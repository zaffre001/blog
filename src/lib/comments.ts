// 댓글 공용 로직 — API 라우트(/api/comments/*)와 댓글 RSS(/comments.xml)가 함께 쓴다.
// KV 키 설계:
//   c:<slug>:<suffix>  = 댓글 본체 {id, nick, body, ts, re?}  (글별 시간순 목록)
//   r:<suffix>         = {slug, ...같은 값}                    (전역 최신순 — 댓글 RSS용)
//   suffix = <ts 14자리 0패딩>:<rand4>  → 키가 사전순 = 시간순

export type Comment = {
  id: string;
  nick: string;
  body: string;
  ts: number;
  re?: string; // 부모 댓글 id (1단 답글)
  slug?: string;
};

export async function cfEnv(): Promise<Record<string, any> | undefined> {
  try {
    return (await import(/* @vite-ignore */ "cloudflare:workers")).env as Record<string, any>;
  } catch {
    return undefined;
  }
}

export async function readEnv(key: string): Promise<string | undefined> {
  const env = await cfEnv();
  return (
    env?.[key] ??
    (import.meta.env as Record<string, string | undefined>)[key] ??
    (globalThis as any).process?.env?.[key]
  );
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

export const okSlug = (s: string) => /^[a-z0-9-]{1,64}$/.test(s);

// 제어문자 제거 — 이스케이프 표기 대신 코드로 구성 (소스에 제어문자 금지)
const CTRL = new RegExp(
  "[" +
    String.fromCharCode(0) + "-" + String.fromCharCode(8) +
    String.fromCharCode(11) + "-" + String.fromCharCode(31) +
    String.fromCharCode(127) +
  "]",
  "g",
);
export const cleanNick = (v: unknown) =>
  String(v ?? "").replace(CTRL, "").replace(/\n/g, " ").trim().slice(0, 12) || "손님";
export const cleanBody = (v: unknown) =>
  String(v ?? "").replace(CTRL, "").trim().slice(0, 500);

export const newSuffix = (ts: number) =>
  String(ts).padStart(14, "0") + ":" + Math.random().toString(36).slice(2, 6);

// ── dev(Node) 폴백: 메모리 저장소 ──
const memBySlug = new Map<string, Comment[]>();

export const mem = {
  list(slug: string): Comment[] {
    return [...(memBySlug.get(slug) ?? [])];
  },
  add(slug: string, c: Comment) {
    const a = memBySlug.get(slug) ?? [];
    a.push(c);
    memBySlug.set(slug, a);
  },
  del(slug: string, id: string): boolean {
    const a = memBySlug.get(slug) ?? [];
    const i = a.findIndex((c) => c.id === id);
    if (i < 0) return false;
    a.splice(i, 1);
    return true;
  },
  recent(limit: number): Comment[] {
    const all: Comment[] = [];
    for (const [slug, arr] of memBySlug) for (const c of arr) all.push({ ...c, slug });
    return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
  },
};

// ── KV 헬퍼 ──
export async function kvList(kv: any, slug: string): Promise<Comment[]> {
  const list = await kv.list({ prefix: `c:${slug}:`, limit: 100 });
  const items = await Promise.all(
    list.keys.map(async (k: { name: string }) => {
      const v = (await kv.get(k.name, "json")) as Comment | null;
      if (v) v.id = k.name.slice(`c:${slug}:`.length);
      return v;
    }),
  );
  return items.filter(Boolean) as Comment[];
}

export async function kvRecent(kv: any, limit: number): Promise<Comment[]> {
  const list = await kv.list({ prefix: "r:", limit: 1000 });
  const tail = list.keys.slice(-limit); // 키가 시간순이므로 꼬리가 최신
  const items = await Promise.all(
    tail.map(async (k: { name: string }) => {
      const v = (await kv.get(k.name, "json")) as Comment | null;
      if (v) v.id = k.name.slice(2);
      return v;
    }),
  );
  return (items.filter(Boolean) as Comment[]).sort((a, b) => b.ts - a.ts);
}
