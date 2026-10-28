import type { ReactNode } from "react";
import ReactMarkdown, { type Options } from "react-markdown";

import { LRUCache } from "../../lib/lruCache";

const MAX_CACHED_TREES = 200;
const MAX_CACHED_WEIGHT = 48 * 1024 * 1024;
// A parsed tree outweighs its source many times over: hast nodes, positions, elements.
const WEIGHT_PER_CHARACTER = 60;

const trees = new LRUCache<ReactNode>(MAX_CACHED_TREES, MAX_CACHED_WEIGHT);

interface MarkdownTreeFlags {
  readonly lineBreaks: boolean;
  readonly parseRawHtml: boolean;
  readonly math: boolean;
}

/** Identifies the tree `renderMarkdownTree` builds, given plugins that depend on nothing else. */
export function markdownTreeCacheKey(text: string, flags: MarkdownTreeFlags): string {
  const flagKey = `${flags.lineBreaks ? "b" : "-"}${flags.parseRawHtml ? "h" : "-"}${flags.math ? "m" : "-"}`;
  return `${flagKey}\u0000${text}`;
}

/**
 * Parses markdown into React elements. `ReactMarkdown` is a pure function of its options, and the
 * elements it returns read everything contextual through React context, so a finished message
 * keeps its tree across remounts (a recycled timeline row, a thread opened again). Pass a
 * `cacheKey` only when the plugins are fixed by it; pass `null` for streaming text.
 */
export function renderMarkdownTree(
  options: Readonly<Options> & { readonly children: string },
  cacheKey: string | null,
): ReactNode {
  if (cacheKey === null) return ReactMarkdown(options);
  const cached = trees.get(cacheKey);
  if (cached !== null) return cached;
  const tree = ReactMarkdown(options);
  trees.set(cacheKey, tree, options.children.length * WEIGHT_PER_CHARACTER);
  return tree;
}

export function clearMarkdownTreeCache(): void {
  trees.clear();
}
