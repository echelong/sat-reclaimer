'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './useReducedMotion';

type CounterProps = {
  value: number;
  /** Animation length in milliseconds. Kept short so it never blocks reading. */
  durationMs?: number;
  className?: string;
  /** Rendered before the animated digits. */
  prefix?: string;
  suffix?: string;
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function format(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Animated integer counter.
 *
 * Starts when scrolled into view and stops there — no interval is left running,
 * and the final frame always lands exactly on `value`. Every `setState` happens
 * inside a requestAnimationFrame or IntersectionObserver callback, never in an
 * effect body, so there is no cascading render on mount.
 *
 * The animated digits are hidden from assistive technology and the real value is
 * exposed once as text, so a screen reader never reads a transient number.
 */
export function Counter({ value, durationMs = 1400, className, prefix = '', suffix = '' }: CounterProps) {
  const reduced = useReducedMotion();
  const [animated, setAnimated] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced || typeof IntersectionObserver === 'undefined') return;

    let frame = 0;
    let start = 0;

    const step = (now: number) => {
      if (!start) start = now;
      const progress = Math.min(1, (now - start) / durationMs);
      setAnimated(Math.round(value * easeOutCubic(progress)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          frame = requestAnimationFrame(step);
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, durationMs, reduced]);

  const shown = reduced ? value : animated;

  return (
    <span ref={ref} className={className}>
      {prefix}
      <span className="num" aria-hidden="true">
        {format(shown)}
      </span>
      <span className="sr-only">{format(value)}</span>
      {suffix}
    </span>
  );
}
