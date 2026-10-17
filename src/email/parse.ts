import { parse } from "node-html-parser";
import type { MessageLink } from "../core/types.js";

/** HTML → plain text plus anchors, keeping the visible label separate from the href. */
export function parseHtml(html: string): { text: string; links: MessageLink[] } {
  const root = parse(html);
  for (const node of root.querySelectorAll("script, style")) node.remove();

  const links: MessageLink[] = [];
  for (const anchor of root.querySelectorAll("a")) {
    const href = anchor.getAttribute("href")?.trim();
    if (!href) continue;
    links.push({
      visibleText: anchor.text.replace(/\s+/g, " ").trim(),
      href,
    });
  }

  return {
    text: root.text.replace(/\s+/g, " ").trim(),
    links,
  };
}
