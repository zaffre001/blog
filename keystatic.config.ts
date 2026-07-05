import { config, fields, collection, singleton } from "@keystatic/core";

// 개발 중엔 로컬 파일에 바로 쓰고(localhost/keystatic),
// 배포된 사이트의 /keystatic은 GitHub App을 통해 repo에 커밋한다.
const isDev = process.env.NODE_ENV === "development";

export default config({
  storage: isDev
    ? { kind: "local" }
    : {
        kind: "github",
        // TODO: GitHub repo 만들면 owner/name 확인 (기본: zaffre001/blog)
        repo: "zaffre001/blog",
      },
  ui: {
    brand: { name: "za66re" },
  },
  singletons: {
    site: singleton({
      label: "사이트 설정",
      path: "content/site",
      format: { data: "json" },
      schema: {
        title: fields.text({ label: "블로그 이름" }),
        tagline: fields.text({ label: "태그라인" }),
      },
    }),
  },
  collections: {
    posts: collection({
      label: "글",
      slugField: "title",
      path: "content/posts/*",
      entryLayout: "content",
      format: { contentField: "body" },
      schema: {
        title: fields.slug({
          name: { label: "제목" },
          slug: { label: "슬러그 (URL·카트 부팅 화면에 표시)" },
        }),
        date: fields.date({ label: "날짜", defaultValue: { kind: "today" } }),
        body: fields.mdx({ label: "본문" }),
      },
    }),
  },
});
