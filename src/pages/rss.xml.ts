import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import site from "../../content/site.json";

export const GET: APIRoute = async (context) => {
  const posts = (await getCollection("posts")).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime(),
  );
  return rss({
    title: site.title,
    description: site.tagline,
    site: context.site ?? "https://za66re.pages.dev",
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      link: `/txt/${p.id}/`,
    })),
    customData: "<language>ko</language>",
  });
};
