import {
  CHAT_MARKDOWN_REHYPE_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS,
} from "@t3tools/shared/markdownPipeline";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  clearMarkdownTreeCache,
  markdownTreeCacheKey,
  renderMarkdownTree,
} from "./markdownTreeCache";

const FLAGS = { lineBreaks: false, parseRawHtml: true, math: false } as const;

function setup() {
  clearMarkdownTreeCache();
  let parses = 0;
  const countParses = () => () => {
    parses += 1;
  };
  const render = (text: string, cacheKey: string | null) =>
    renderMarkdownTree(
      {
        children: text,
        remarkPlugins: [...CHAT_MARKDOWN_REMARK_PLUGINS, countParses],
        rehypePlugins: CHAT_MARKDOWN_REHYPE_PLUGINS,
      },
      cacheKey,
    );
  return { render, parses: () => parses };
}

describe("renderMarkdownTree", () => {
  afterEach(clearMarkdownTreeCache);

  it("parses a finished message once and hands every mount the same tree", () => {
    const { render, parses } = setup();
    const key = markdownTreeCacheKey("# Hello\n\nA *finished* message.", FLAGS);

    const first = render("# Hello\n\nA *finished* message.", key);
    const second = render("# Hello\n\nA *finished* message.", key);

    expect(second).toBe(first);
    expect(parses()).toBe(1);
  });

  it("never caches without a key, as for streaming text", () => {
    const { render, parses } = setup();

    const first = render("partial", null);
    const second = render("partial", null);

    expect(second).not.toBe(first);
    expect(parses()).toBe(2);
  });

  it("keeps trees apart by text and by flags", () => {
    const { render, parses } = setup();
    const text = "line one\nline two";

    render(text, markdownTreeCacheKey(text, FLAGS));
    render(text, markdownTreeCacheKey(text, { ...FLAGS, lineBreaks: true }));
    render(`${text}!`, markdownTreeCacheKey(`${text}!`, FLAGS));

    expect(parses()).toBe(3);
    expect(markdownTreeCacheKey(text, FLAGS)).not.toBe(
      markdownTreeCacheKey(text, { ...FLAGS, math: true }),
    );
    expect(markdownTreeCacheKey(text, FLAGS)).not.toBe(
      markdownTreeCacheKey(text, { ...FLAGS, parseRawHtml: false }),
    );
  });

  it("does not retain a message too large for the cache budget", () => {
    const { render, parses } = setup();
    const huge = "word ".repeat(200_000);
    const key = markdownTreeCacheKey(huge, FLAGS);

    render(huge, key);
    render(huge, key);

    expect(parses()).toBe(2);
  });
});
