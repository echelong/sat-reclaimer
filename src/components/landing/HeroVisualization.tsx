'use client';

import { useEffect, useRef } from 'react';

/**
 * HERO // UTXO CONSOLIDATION
 *
 * One <canvas> that tells the product's story on a loop:
 *
 *   SCATTER   dozens of inscription-bearing UTXOs drift in a deep field
 *   SCAN      a scan front sweeps across and lights them up
 *   CONVERGE  the lit nodes travel into one bright Bitcoin output
 *   SETTLE    only the consolidated output remains
 *   RESET     fade out, then repeat
 *
 * Why canvas instead of DOM/SVG: 68 nodes plus up to ~2,000 proximity links is
 * thousands of per-frame style mutations as DOM, and an SVG filter stack for the
 * glow would cost far more GPU than this does. Canvas 2D repaints one bitmap.
 *
 * Budget rules honoured here:
 *  - device pixel ratio is capped at 2, so a 4K display is not asked to fill 8M
 *    pixels at 60fps for a decorative layer;
 *  - rendering pauses when the hero scrolls out of view or the tab is hidden;
 *  - the loop stops entirely under `prefers-reduced-motion`, which draws the
 *    settled story frame once;
 *  - one rAF handle and one set of observers exist at a time, and every one of
 *    them is released on unmount, so navigating between `/` and `/app` cannot
 *    leak a frame loop.
 */

const CYCLE_MS = 16_000;
const SCAN_START = 3_200;
const SCAN_END = 6_400;
const CONVERGE_START = 6_000;
const CONVERGE_END = 11_200;
const SETTLE_END = 14_200;
const FADE_IN_MS = 800;

const NODE_COUNT = 68;
const LINK_DISTANCE = 0.13; // fraction of the canvas diagonal
const MAX_DPR = 2;

type Node = {
  /** Home position, normalised 0..1. */
  hx: number;
  hy: number;
  /** Depth 0..1 — drives size, brightness and drift amplitude. */
  z: number;
  radius: number;
  drift: number;
  speed: number;
  phase: number;
  /** 0..1 illumination from the scan front. */
  lit: number;
};

/** Deterministic PRNG so the field is identical on every mount and resize. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNodes(): Node[] {
  const random = mulberry32(0x5a7c0de);
  const nodes: Node[] = [];
  for (let i = 0; i < NODE_COUNT; i += 1) {
    const z = Math.pow(random(), 0.7);
    nodes.push({
      // Bias the field left of the core so the right side stays open for the
      // consolidation target.
      hx: 0.02 + random() * 0.92,
      hy: 0.06 + random() * 0.88,
      z,
      radius: 1.1 + z * 2.6,
      drift: 0.012 + random() * 0.03,
      speed: 0.00016 + random() * 0.00034,
      phase: random() * Math.PI * 2,
      lit: 0,
    });
  }
  return nodes;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function HeroVisualization() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const nodes = makeNodes();
    let width = 0;
    let height = 0;
    let unit = 1;
    let diag = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      unit = Math.max(0.72, Math.min(width / 1180, 1.7));
      diag = Math.hypot(width, height);
    };

    /** Core output: bottom-right of the field, pulled slightly inward. */
    const core = () => ({ x: width * 0.76, y: height * 0.52 });

    const drawCore = (cx: number, cy: number, progress: number, time: number, alpha: number) => {
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.0022);
      const radius = (7 + progress * 15) * unit;
      const outer = radius * (3.6 + pulse * 0.5) * progress;

      if (outer > 1) {
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
        glow.addColorStop(0, `rgba(247, 147, 26, ${0.5 * alpha * progress})`);
        glow.addColorStop(0.35, `rgba(255, 46, 136, ${0.16 * alpha * progress})`);
        glow.addColorStop(1, 'rgba(247, 147, 26, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.fill();
      }

      // Orbit arcs: two counter-rotating rings that read as "locked output".
      if (progress > 0.15) {
        ctx.save();
        ctx.translate(cx, cy);
        for (let ring = 0; ring < 2; ring += 1) {
          const r = (radius * (2.1 + ring * 0.85)) | 0;
          const spin = time * (ring === 0 ? 0.0007 : -0.00052);
          ctx.rotate(spin);
          ctx.strokeStyle = ring === 0 ? `rgba(0, 245, 255, ${0.5 * alpha * progress})` : `rgba(168, 85, 247, ${0.42 * alpha * progress})`;
          ctx.lineWidth = 1 * unit;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0.2, Math.PI * 0.85);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, r, Math.PI * 1.2, Math.PI * 1.65);
          ctx.stroke();
        }
        ctx.restore();
      }

      // The output itself: a solid orange disc with the two tick marks that make
      // an unmistakable Bitcoin mark without depending on a font glyph.
      const disc = radius * (0.55 + progress * 0.45);
      ctx.fillStyle = `rgba(247, 147, 26, ${0.96 * alpha})`;
      ctx.beginPath();
      ctx.arc(cx, cy, disc, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(255, 238, 214, ${0.92 * alpha})`;
      ctx.lineWidth = Math.max(1, 1.7 * unit);
      ctx.lineCap = 'round';
      const tick = disc * 0.72;
      ctx.beginPath();
      ctx.moveTo(cx, cy - tick - disc * 0.34);
      ctx.lineTo(cx, cy + tick + disc * 0.34);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - disc * 0.42, cy - disc * 0.4);
      ctx.lineTo(cx + disc * 0.42, cy - disc * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - disc * 0.42, cy + disc * 0.4);
      ctx.lineTo(cx + disc * 0.42, cy + disc * 0.4);
      ctx.stroke();
    };

    const drawFrame = (elapsed: number, delta: number, instant: boolean) => {
      const t = elapsed % CYCLE_MS;
      const time = elapsed;

      ctx.clearRect(0, 0, width, height);

      const scanProgress = clamp01((t - SCAN_START) / (SCAN_END - SCAN_START));
      const converge = easeInOut(clamp01((t - CONVERGE_START) / (CONVERGE_END - CONVERGE_START)));

      let alpha = clamp01(t / FADE_IN_MS);
      if (t > SETTLE_END) {
        alpha *= clamp01(1 - (t - SETTLE_END) / (CYCLE_MS - SETTLE_END));
      }

      const { x: coreX, y: coreY } = core();
      const linkLimit = diag * LINK_DISTANCE;

      type Point = { x: number; y: number; lit: number; z: number; radius: number };
      const points: Point[] = [];

      for (const node of nodes) {
        // Ambient drift keeps the field alive without any user input.
        const ax = node.hx + Math.sin(time * node.speed + node.phase) * node.drift;
        const ay = node.hy + Math.cos(time * node.speed * 0.82 + node.phase * 1.31) * node.drift * 0.85;

        // Target: a small ring around the core so the nodes visibly arrive as a
        // cluster rather than collapsing into a single pixel.
        const angle = node.phase * 2.4;
        const orbit = (12 + node.z * 30) * unit;
        const tx = coreX + Math.cos(angle) * orbit;
        const ty = coreY + Math.sin(angle) * orbit;

        const x = (ax + (tx / width - ax) * converge) * width;
        const y = (ay + (ty / height - ay) * converge) * height;

        const target = scanProgress > 0 && node.hx < scanProgress * 1.14 ? 1 : 0;
        if (instant) {
          node.lit = target;
        } else {
          node.lit += (target - node.lit) * Math.min(1, delta * 0.006);
        }

        points.push({ x, y, lit: node.lit, z: node.z, radius: node.radius });
      }

      // Proximity links: the "network" mesh, which retracts as consolidation
      // begins so the story reads in one direction.
      const linkAlphaBase = alpha * (1 - converge * 0.92);
      if (linkAlphaBase > 0.01) {
        for (let i = 0; i < points.length; i += 1) {
          const a = points[i];
          for (let j = i + 1; j < points.length; j += 1) {
            const b = points[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const distance = Math.hypot(dx, dy);
            if (distance > linkLimit) continue;
            const strength = 1 - distance / linkLimit;
            const warm = Math.max(a.lit, b.lit);
            const alphaLink = strength * linkAlphaBase * (0.06 + warm * 0.16) * (0.4 + a.z * 0.6);
            if (alphaLink < 0.006) continue;
            ctx.strokeStyle = warm > 0.5 ? `rgba(0, 245, 255, ${alphaLink})` : `rgba(120, 145, 190, ${alphaLink})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // Streams: during consolidation, a faint trace runs from each node into the
      // output, with a travelling highlight.
      if (converge > 0.03 && converge < 1) {
        const travel = (time * 0.0011) % 1;
        ctx.lineWidth = 1;
        for (const point of points) {
          const streamAlpha = alpha * converge * 0.24 * point.lit;
          if (streamAlpha < 0.01) continue;
          ctx.strokeStyle = `rgba(0, 245, 255, ${streamAlpha})`;
          ctx.beginPath();
          ctx.moveTo(point.x, point.y);
          ctx.lineTo(coreX, coreY);
          ctx.stroke();

          const px = point.x + (coreX - point.x) * travel;
          const py = point.y + (coreY - point.y) * travel;
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha * converge * 0.5 * point.lit})`;
          ctx.beginPath();
          ctx.arc(px, py, 1.5 * unit, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Nodes.
      for (const point of points) {
        const lit = point.lit;
        const radius = point.radius * unit * (0.7 + point.z * 0.6);
        const base = alpha * (0.26 + point.z * 0.4) * (1 - converge * 0.55);
        const glowAlpha = alpha * lit * 0.34 * (1 - converge * 0.7);

        if (glowAlpha > 0.01) {
          const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 6);
          glow.addColorStop(0, `rgba(0, 245, 255, ${glowAlpha})`);
          glow.addColorStop(1, 'rgba(0, 245, 255, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(point.x, point.y, radius * 6, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle =
          lit > 0.05
            ? `rgba(${(150 + 105 * lit) | 0}, ${(230 + 25 * lit) | 0}, 255, ${clamp01(base + lit * 0.6)})`
            : `rgba(139, 160, 196, ${base})`;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // The scan front itself: a soft vertical band with a bright leading edge.
      if (t >= SCAN_START && t <= SCAN_END) {
        const frontX = (scanProgress * 1.14 - 0.07) * width;
        const bandWidth = Math.max(70, 150 * unit);
        const band = ctx.createLinearGradient(frontX - bandWidth, 0, frontX, 0);
        band.addColorStop(0, 'rgba(0, 245, 255, 0)');
        band.addColorStop(0.72, `rgba(0, 245, 255, ${0.07 * alpha})`);
        band.addColorStop(1, `rgba(0, 245, 255, ${0.2 * alpha})`);
        ctx.fillStyle = band;
        ctx.fillRect(frontX - bandWidth, 0, bandWidth, height);

        ctx.strokeStyle = `rgba(190, 255, 255, ${0.55 * alpha})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(frontX, 0);
        ctx.lineTo(frontX, height);
        ctx.stroke();
      }

      drawCore(coreX, coreY, converge, time, alpha * (0.35 + converge * 0.65));
    };

    // --- reduced motion: one settled frame, no loop, no observers beyond a
    // single resize handler. ------------------------------------------------
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    resize();

    if (reduced) {
      drawFrame(12_500, 16, true);
      const observer = new ResizeObserver(() => {
        resize();
        drawFrame(12_500, 16, true);
      });
      observer.observe(canvas);
      return () => observer.disconnect();
    }

    let frame = 0;
    let last = 0;
    let origin = 0;
    let running = false;
    let visible = true;

    const tick = (now: number) => {
      if (!running) return;
      const delta = Math.min(48, now - last);
      last = now;
      drawFrame(now - origin, delta, false);
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (running || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      origin = last;
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    const resizeObserver = new ResizeObserver(() => {
      const wasRunning = running;
      stop();
      resize();
      if (wasRunning) start();
      else drawFrame(0, 0, true);
    });
    resizeObserver.observe(canvas);

    const intersection = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) start();
        else stop();
      },
      { threshold: 0 },
    );
    intersection.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="hero-canvas"
      aria-hidden="true"
      // Decorative: the story is carried as text by the hero caption.
      role="presentation"
    />
  );
}
