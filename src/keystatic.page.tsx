// Keystatic 관리화면 React 앱 (client:only 아일랜드로만 로드 — SSR 안 탐)
// @keystatic/astro의 makePage와 동일한 구성을 직접 정의한다.
import { Keystatic as KeystaticUI } from "@keystatic/core/ui";
import config from "../keystatic.config";

const appSlug = {
  envName: "PUBLIC_KEYSTATIC_GITHUB_APP_SLUG",
  value: import.meta.env.PUBLIC_KEYSTATIC_GITHUB_APP_SLUG,
};

export function Keystatic() {
  return <KeystaticUI config={config} appSlug={appSlug} />;
}
