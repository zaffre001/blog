import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Keystatic이 쓰는 content/posts/*.mdx 를 Astro 콘텐츠 컬렉션으로 읽는다.
const posts = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./content/posts" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
  }),
});

export const collections = { posts };
