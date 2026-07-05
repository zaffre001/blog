import { config, fields, collection, singleton } from "@keystatic/core";

// 개발 중엔 로컬 파일에 바로 쓰고(localhost/keystatic),
// 배포된 사이트의 /keystatic은 GitHub App을 통해 repo에 커밋한다.
// PUBLIC_KEYSTATIC_STORAGE=github 로 dev를 띄우면 로컬에서도 GitHub 모드
// (최초 1회 GitHub App 생성 마법사를 띄울 때 사용).
// 주의: 이 파일은 관리화면(브라우저)에서도 실행되므로 process.env 금지 — import.meta.env만.
const useGithub =
  !import.meta.env.DEV || import.meta.env.PUBLIC_KEYSTATIC_STORAGE === "github";

export default config({
  storage: useGithub
    ? { kind: "github", repo: "zaffre001/blog" }
    : { kind: "local" },
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
