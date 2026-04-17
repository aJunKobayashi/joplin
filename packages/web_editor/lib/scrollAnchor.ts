/**
 * Scroll anchor utilities for syncing visible content position
 * between viewer mode and editor (TinyMCE) mode.
 *
 * Strategy:
 * 1. Before switching modes, find the first visible block element at the viewport top.
 * 2. Create a fingerprint (tag + text snippet + index) for that element.
 * 3. After the new mode renders, find the matching element and scroll to it
 *    so it appears at the same visual offset from the viewport top.
 */

export interface ScrollAnchor {
  tag: string;
  textSnippet: string;
  blockIndex: number;
  /** Distance from the top of the element to the top of the viewport (px) */
  offsetFromTop: number;
}

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,pre,table,ul,ol,blockquote,hr,img';

function getBlockElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll(BLOCK_SELECTOR));
}

function fingerprint(el: HTMLElement): { tag: string; text: string } {
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').trim().slice(0, 80),
  };
}

/**
 * Find the first visible block element and return an anchor descriptor.
 * @param contentRoot  Root element that contains the note HTML
 * @param viewportTopY Y-coordinate of the visible viewport top in the same
 *                     coordinate system as getBoundingClientRect() of contentRoot's children.
 *                     For the viewer's overflow-auto div, pass its getBoundingClientRect().top.
 *                     For a TinyMCE iframe, pass 0.
 */
export function findVisibleAnchor(
  contentRoot: HTMLElement,
  viewportTopY: number
): ScrollAnchor | null {
  const blocks = getBlockElements(contentRoot);
  if (blocks.length === 0) return null;

  for (let i = 0; i < blocks.length; i++) {
    const rect = blocks[i].getBoundingClientRect();
    // Element whose bottom is below the viewport top → at least partially visible
    if (rect.bottom > viewportTopY + 2) {
      const fp = fingerprint(blocks[i]);
      return {
        tag: fp.tag,
        textSnippet: fp.text,
        blockIndex: i,
        offsetFromTop: rect.top - viewportTopY,
      };
    }
  }

  // Fallback: last block element
  const last = blocks[blocks.length - 1];
  const rect = last.getBoundingClientRect();
  const fp = fingerprint(last);
  return {
    tag: fp.tag,
    textSnippet: fp.text,
    blockIndex: blocks.length - 1,
    offsetFromTop: rect.top - viewportTopY,
  };
}

function findMatchingElement(contentRoot: HTMLElement, anchor: ScrollAnchor): HTMLElement | null {
  const blocks = getBlockElements(contentRoot);
  if (blocks.length === 0) return null;

  // Collect candidates that match by tag + text
  const candidates: { el: HTMLElement; index: number }[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const fp = fingerprint(blocks[i]);
    if (fp.tag === anchor.tag && fp.text === anchor.textSnippet) {
      candidates.push({ el: blocks[i], index: i });
    }
  }

  if (candidates.length === 1) {
    return candidates[0].el;
  }

  if (candidates.length > 1) {
    // Pick the candidate closest to the expected index
    let best = candidates[0];
    for (const c of candidates) {
      if (Math.abs(c.index - anchor.blockIndex) < Math.abs(best.index - anchor.blockIndex)) {
        best = c;
      }
    }
    return best.el;
  }

  // Fallback: index-based
  if (anchor.blockIndex < blocks.length) {
    return blocks[anchor.blockIndex];
  }

  return blocks[blocks.length - 1] || null;
}

/**
 * Scroll the viewer's overflow-auto container so the matching element
 * appears at the same offset from the viewport top.
 */
export function scrollToAnchorInViewer(
  scrollContainer: HTMLElement,
  contentRoot: HTMLElement,
  anchor: ScrollAnchor
): void {
  const target = findMatchingElement(contentRoot, anchor);
  if (!target) return;

  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const currentOffset = targetRect.top - containerRect.top;
  scrollContainer.scrollTop += currentOffset - anchor.offsetFromTop;
}

/**
 * Scroll the TinyMCE iframe so the matching element appears at the same
 * offset from the viewport top.
 */
export function scrollToAnchorInEditor(
  iframeWin: Window,
  body: HTMLElement,
  anchor: ScrollAnchor
): void {
  const target = findMatchingElement(body, anchor);
  if (!target) return;

  const targetRect = target.getBoundingClientRect();
  // In the iframe coordinate system, viewport top is 0
  iframeWin.scrollBy(0, targetRect.top - anchor.offsetFromTop);
}
