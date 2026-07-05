// MDX 원문 → 카트가 이해하는 미니 마크다운으로 변환.
// 카트(web 브릿지 토크나이저)가 아는 것: `# ` `## ` `> ` `![alt](url)` 문단.
// 나머지 MDX 문법은 최대한 "텍스트만 남기는" 방향으로 강등한다.
// 한계: JSX 컴포넌트는 태그만 벗기고 children을 살린다. 표/각주 등은 원문 그대로 흐른다.
export function toCartBody(raw) {
  let s = String(raw).replace(/\r/g, "");
  // import/export 구문 제거
  s = s.replace(/^import\s.*$/gm, "");
  s = s.replace(/^export\s.*$/gm, "");
  // 코드펜스는 울타리만 제거하고 내용은 일반 텍스트로
  s = s.replace(/^```.*$/gm, "");
  // JSX/HTML 태그 제거 (children 텍스트는 유지)
  s = s.replace(/<\/?[A-Za-z][^>\n]*\/?>/g, "");
  // 링크는 텍스트만 (이미지 ![..](..)는 보존)
  s = s.replace(/(^|[^!])\[([^\]]*)\]\(([^)]*)\)/g, "$1$2");
  // 인라인 강조·코드 마커 제거
  s = s.replace(/(\*\*|__)([^*_]+?)\1/g, "$2");
  s = s.replace(/(\*|_)([^*_\n]+?)\1/g, "$2");
  s = s.replace(/`([^`]*)`/g, "$1");
  // 3단계 이상 헤딩은 카트의 2단계로 강등
  s = s.replace(/^#{3,}\s+/gm, "## ");
  // 빈 줄 정리
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export const fmtDate = (d) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
