import { marked, Renderer } from "marked";

export interface Slide {
  index: number;
  html: string;
}

/** Split only on a thematic-break line containing exactly three or more dashes. */
export function splitSlides(markdown: string): string[] {
  return markdown
    .replace(/\r\n?/g, "\n")
    .split(/^\s*---+\s*$/gm)
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '\"': "&quot;",
  })[character]!);
}

export function renderSlides(markdown: string): Slide[] {
  const renderer = new Renderer();
  renderer.image = ({ href, title, text }) => {
    const safeHref = escapeHtml(href);
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return `<figure class="markdown-image"><img src="${safeHref}" alt="${escapeHtml(text)}"${titleAttribute}><figcaption>![${escapeHtml(text)}](${safeHref})</figcaption></figure>`;
  };
  marked.setOptions({ gfm: true, breaks: true, renderer });
  return splitSlides(markdown).map((source, index) => ({
    index,
    html: marked.parse(source) as string,
  }));
}
