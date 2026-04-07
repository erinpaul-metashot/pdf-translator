import type { ExtractedTextNodes, TextNodePath } from './types';

const EXCLUDED_PARENT_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

function isTranslatableText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // Skip text that does not contain letters (punctuation/symbols/numbers-only).
  return /\p{L}/u.test(trimmed);
}

function buildPathFromBody(node: Node): number[] {
  const path: number[] = [];
  let current: Node | null = node;

  while (current && current.parentNode && current.parentNode !== current.ownerDocument?.body) {
    const parent = current.parentNode as Node;
    const index = Array.prototype.indexOf.call(parent.childNodes, current) as number;
    path.unshift(index);
    current = parent;
  }

  if (current && current.parentNode === current.ownerDocument?.body) {
    const index = Array.prototype.indexOf.call(current.ownerDocument.body.childNodes, current) as number;
    path.unshift(index);
  }

  return path;
}

export function extractTextNodes(pageHtml: string): ExtractedTextNodes {
  const parser = new DOMParser();
  const document = parser.parseFromString(pageHtml, 'text/html');
  const nodes: TextNodePath[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let currentNode: Node | null = walker.nextNode();
  let sequence = 0;

  while (currentNode) {
    const parentElement = currentNode.parentElement;
    const parentTag = parentElement?.tagName;

    if (parentTag && !EXCLUDED_PARENT_TAGS.has(parentTag) && isTranslatableText(currentNode.nodeValue ?? '')) {
      nodes.push({
        id: `node-${sequence}`,
        path: buildPathFromBody(currentNode),
        originalText: currentNode.nodeValue ?? '',
      });
      sequence += 1;
    }

    currentNode = walker.nextNode();
  }

  return { nodes, document };
}

export function getNodeByPath(document: Document, path: number[]): Node | null {
  let current: Node = document.body;

  for (const index of path) {
    if (!current.childNodes[index]) {
      return null;
    }
    current = current.childNodes[index];
  }

  return current;
}

