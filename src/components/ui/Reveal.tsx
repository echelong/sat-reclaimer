'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type RevealProps = {
  children: ReactNode;
  /** Stagger offset in milliseconds. */
  delay?: number;
  className?: string;
};

/**
 * Scroll-triggered reveal.
 *
 * Uses IntersectionObserver rather than a scroll listener so the browser does the
 * work off the main thread. The element is unobserved after its first
 * intersection, which means the observer set never grows and no work continues
 * once a section has been seen.
 *
 * `prefers-reduced-motion` is handled entirely in CSS (see `.reveal` in
 * globals.css): the block is rendered at full opacity and offset 0, so this
 * component is a no-op there.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      node.dataset.visible = 'true';
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          node.dataset.visible = 'true';
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className ? `reveal ${className}` : 'reveal'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      data-visible="false"
    >
      {children}
    </div>
  );
}
