'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '@/src/components/ui/useReducedMotion';

/**
 * SECTION — DEMO // SIMULATED WALLET
 *
 * A fully scripted illustration of the sweep. It is hard-wired to constants: it
 * has no wallet handle, no signer, no network client and no broadcast path, and
 * nothing in this file imports from `src/lib` — the demo literally cannot reach
 * the Bitcoin engine. The wording throughout says so.
 *
 * Numbers come from the original test wallet (1,083 inscriptions in 1,079 unique
 * UTXOs holding 601,214 sats) and a measured-size P2TR sweep. They are labelled
 * as illustrative everywhere they appear.
 *
 * The whole sequence is derived from one clock, so pausing, replaying or
 * unmounting is a single value change and there are no orphaned timers.
 */

const INSCRIPTIONS = 1083;
const UTXOS = 1079;
const INPUT_SATS = 601_214;
/** The demo is priced at 1 sat/vB so the arithmetic is checkable by eye. */
const FEE_RATE_SAT_VB = 1;
/** Vsize of a one-output P2TR sweep of this wallet, from the planner's measurement. */
const VSIZE = 62_084;
const FEE_SATS = VSIZE * FEE_RATE_SAT_VB;
const OUTPUT_SATS = INPUT_SATS - FEE_SATS;

const GRID_COLS = 41;
const GRID_ROWS = 27;

const T = {
  scanEnd: 4_200,
  convergeEnd: 7_000,
  freeze: 7_600,
};

type Phase = 'idle' | 'scan' | 'converge' | 'done';

type Clock = { startedAt: number; running: boolean; frozen: number };

type LogLine = { at: number; text: string; kind: 'cmd' | 'info' | 'ok' };

const LOG: LogLine[] = [
  { at: 0, text: 'wallet_connect :: DEMO WALLET ................. OK', kind: 'cmd' },
  { at: 320, text: 'ord_getInscriptions :: total = 1,083', kind: 'info' },
  { at: 1_500, text: 'paging 1,083 rows across 19 pages .............. OK', kind: 'info' },
  { at: 2_300, text: 'deduplicate by txid:vout -> 1,079 unique outputs', kind: 'info' },
  { at: 3_000, text: 'postage sum -> 601,214 sats', kind: 'info' },
  { at: 4_250, text: 'planSweep :: 1,079 inputs -> 1 transaction', kind: 'cmd' },
  { at: 4_900, text: 'measured vsize 62,084 vB @ 1 sat/vB -> fee 62,084 sats', kind: 'info' },
  { at: 5_600, text: 'destination output -> 539,130 sats', kind: 'info' },
  { at: 6_400, text: 'verify signed PSBT :: 1,079/1,079 signatures .... OK', kind: 'ok' },
  { at: 7_050, text: 'SIMULATION COMPLETE. Nothing was signed or broadcast.', kind: 'ok' },
];

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const between = (value: number, start: number, end: number) => clamp01((value - start) / (end - start));

function phaseAt(elapsed: number): Phase {
  if (elapsed >= T.convergeEnd) return 'done';
  if (elapsed >= T.scanEnd) return 'converge';
  if (elapsed > 0) return 'scan';
  return 'idle';
}

function format(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

/* ------------------------------------------------------------------------ *
 * The UTXO field.
 *
 * Exactly 1,079 dots, one per unique output, positioned row-major so the scan
 * reads as a real progressive sweep rather than decoration. It owns its own rAF
 * loop so the parent React tree only re-renders ~20x/second while the numbers
 * change, and it pauses when scrolled out of view.
 * ------------------------------------------------------------------------ */

function DemoField({ clock, reduced }: { clock: React.RefObject<Clock>; reduced: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (elapsed: number) => {
      ctx.clearRect(0, 0, width, height);

      const fieldWidth = width * 0.74;
      const step = Math.min(fieldWidth / GRID_COLS, height / GRID_ROWS);
      const originX = (fieldWidth - step * GRID_COLS) / 2 + step / 2;
      const originY = (height - step * GRID_ROWS) / 2 + step / 2;
      const dot = Math.max(1.05, step * 0.3);
      const outX = width * 0.9;
      const outY = height * 0.5;

      // Destination output ring.
      const arrive = between(elapsed, T.scanEnd, T.convergeEnd);
      const outRadius = Math.max(3.2, step * 0.9) * (0.5 + arrive * 0.5);
      const halo = ctx.createRadialGradient(outX, outY, 0, outX, outY, outRadius * 6);
      halo.addColorStop(0, `rgba(247, 147, 26, ${0.42 * arrive})`);
      halo.addColorStop(1, 'rgba(247, 147, 26, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(outX, outY, outRadius * 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(247, 147, 26, ${0.35 + arrive * 0.6})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(outX, outY, outRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(247, 147, 26, ${0.2 + arrive * 0.8})`;
      ctx.beginPath();
      ctx.arc(outX, outY, outRadius * 0.55, 0, Math.PI * 2);
      ctx.fill();

      for (let index = 0; index < UTXOS; index += 1) {
        const col = index % GRID_COLS;
        const row = (index / GRID_COLS) | 0;
        let x = originX + col * step;
        let y = originY + row * step;

        const litAt = 220 + (index / UTXOS) * 3_500;
        const lit = clamp01((elapsed - litAt) / 240);

        const localStart = T.scanEnd + (index / UTXOS) * 1_300;
        const travel = easeOut(between(elapsed, localStart, localStart + 1_400));

        let alpha = 0.1 + lit * 0.82;
        let radius = dot;

        if (travel > 0) {
          x += (outX - x) * travel;
          y += (outY - y) * travel;
          radius = dot * (1 - travel * 0.55);
          alpha *= 1 - travel * 0.85;
        }

        if (alpha < 0.02) continue;

        ctx.fillStyle =
          lit > 0.35
            ? `rgba(110, ${(225 + 30 * lit) | 0}, 255, ${alpha})`
            : `rgba(110, 132, 168, ${alpha * 0.75})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // The sweep front.
      if (elapsed > 0 && elapsed < T.scanEnd + 400) {
        const front = between(elapsed, 0, T.scanEnd) * (GRID_ROWS * step);
        const frontY = originY - step / 2 + front;
        ctx.strokeStyle = 'rgba(0, 245, 255, 0.55)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(originX - step, frontY);
        ctx.lineTo(originX + GRID_COLS * step, frontY);
        ctx.stroke();

        const band = ctx.createLinearGradient(0, frontY - step * 4, 0, frontY);
        band.addColorStop(0, 'rgba(0, 245, 255, 0)');
        band.addColorStop(1, 'rgba(0, 245, 255, 0.13)');
        ctx.fillStyle = band;
        ctx.fillRect(originX - step, frontY - step * 4, GRID_COLS * step + step * 2, step * 4);
      }
    };

    resize();

    let frame = 0;
    let visible = true;

    const tick = () => {
      const state = clock.current;
      const elapsed = reduced
        ? T.freeze
        : state.running
          ? Math.min(T.freeze, performance.now() - state.startedAt)
          : state.frozen;
      draw(elapsed);
      frame = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        cancelAnimationFrame(frame);
        if (visible) frame = requestAnimationFrame(tick);
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [clock, reduced]);

  return (
    <canvas
      ref={canvasRef}
      className="demo-field"
      role="img"
      aria-label={`Illustration of ${UTXOS} inscription-bearing UTXOs being scanned and consolidated into a single Bitcoin output.`}
    />
  );
}

/* ------------------------------------------------------------------------ *
 * The section.
 * ------------------------------------------------------------------------ */

export function Demo() {
  const prefersReduced = useReducedMotion();
  const clock = useRef<Clock>({ startedAt: 0, running: false, frozen: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');

  // Reduced motion is derived during render rather than written into state from
  // an effect: the scripted sequence is simply replaced by its finished frame,
  // so nothing animates and no cascading render is triggered.
  const reduced = prefersReduced;
  const shownElapsed = reduced ? T.freeze : elapsed;
  const shownPhase = reduced ? 'done' : phase;

  useEffect(() => {
    if (reduced) return;
    if (phase !== 'scan' && phase !== 'converge') return;
    const id = setInterval(() => {
      const ms = performance.now() - clock.current.startedAt;
      setElapsed(ms);
      const next = phaseAt(ms);
      if (next !== phase) setPhase(next);
    }, 50);
    return () => clearInterval(id);
  }, [phase, reduced]);

  const start = useCallback(() => {
    clock.current = { startedAt: performance.now(), running: true, frozen: 0 };
    setElapsed(0);
    setPhase('scan');
  }, []);

  const finish = useCallback(() => {
    clock.current.running = false;
    clock.current.frozen = T.freeze;
  }, []);

  useEffect(() => {
    if (phase === 'done') finish();
  }, [phase, finish]);

  const scanning = shownPhase === 'scan' || shownPhase === 'converge' || shownPhase === 'done';

  const counters = useMemo(() => {
    const inscriptions = scanning ? Math.round(INSCRIPTIONS * easeOut(between(shownElapsed, 200, 3_600))) : INSCRIPTIONS;
    const utxos = scanning ? Math.round(UTXOS * easeOut(between(shownElapsed, 2_200, 4_000))) : UTXOS;
    const sats = scanning ? Math.round(INPUT_SATS * easeOut(between(shownElapsed, 2_900, 4_200))) : INPUT_SATS;
    return { inscriptions, utxos, sats };
  }, [shownElapsed, scanning]);

  const lines = LOG.filter((line) => (scanning ? shownElapsed >= line.at : false));
  const showOutcome = shownElapsed >= 4_900;
  const showNet = shownElapsed >= 5_600;

  return (
    <section className="section demo" id="demo">
      <div className="wrap">
        <div className="section-head">
          <span className="kicker">Demo // Simulated wallet</span>
          <h2 className="section-title">
            Watch a wallet collapse <span className="hl">into one output</span>.
          </h2>
          <p className="section-lede">
            This is the sweep, running on hard-coded numbers. It has no wallet handle and no network
            access, so nothing you do here can sign, spend or broadcast anything.
          </p>
        </div>

        <div className="demo-frame card bracket">
          <div className="demo-bar">
            <span className="tag tag-warn">
              <span className="pulse-dot" />
              Simulated · not connected to a wallet
            </span>
            <span className="demo-bar-note mono">illustrative values · 1 sat/vB</span>
          </div>

          <div className="demo-grid">
            <div className="demo-left">
              <dl className="demo-stats">
                <div data-active={scanning ? 'true' : 'false'}>
                  <dt>Inscriptions detected</dt>
                  <dd className="num">{format(counters.inscriptions)}</dd>
                </div>
                <div data-active={scanning ? 'true' : 'false'}>
                  <dt>Unique UTXOs</dt>
                  <dd className="num">{format(counters.utxos)}</dd>
                </div>
                <div data-active={scanning ? 'true' : 'false'}>
                  <dt>BTC in UTXOs</dt>
                  <dd className="num">
                    {format(counters.sats)} <small>sats</small>
                  </dd>
                </div>
              </dl>

              <div className="demo-stage">
                <DemoField clock={clock} reduced={reduced} />
                <span className="demo-stage-corner demo-stage-corner-tl" aria-hidden="true" />
                <span className="demo-stage-corner demo-stage-corner-br" aria-hidden="true" />
                <span
                  className="demo-stage-out mono"
                  data-on={shownPhase === 'done' || shownPhase === 'converge' ? 'true' : 'false'}
                >
                  1 output
                </span>
              </div>

              <div className="demo-controls">
                {reduced ? (
                  <span className="demo-hint mono">
                    Reduced motion preferred — showing the completed state.
                  </span>
                ) : phase === 'idle' ? (
                  <button type="button" className="btn btn-magenta" onClick={start}>
                    [ INITIATE SCAN ]
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={start}
                    disabled={phase === 'scan' || phase === 'converge'}
                  >
                    {phase === 'scan' || phase === 'converge' ? '[ SCANNING… ]' : '[ REPLAY DEMO ]'}
                  </button>
                )}
                <span className="demo-hint mono">no wallet · no signature · no broadcast</span>
              </div>
            </div>

            <div className="demo-right">
              <div className="demo-terminal" aria-live="polite" aria-atomic="false">
                <div className="demo-terminal-bar">
                  <span className="demo-dot" />
                  <span className="demo-dot" />
                  <span className="demo-dot" />
                  <span className="mono">satreclaimer — demo</span>
                </div>
                <pre className="demo-terminal-body mono">
                  {lines.length === 0
                    ? '$ awaiting command — press INITIATE SCAN'
                    : lines.map((line) => (
                        <span key={line.at} className={`demo-line demo-line-${line.kind}`}>
                          {line.kind === 'cmd' ? '$ ' : '  '}
                          {line.text}
                          {'\n'}
                        </span>
                      ))}
                  {shownPhase === 'scan' && <span className="demo-cursor" aria-hidden="true" />}
                </pre>
              </div>

              <dl className="demo-outcome" data-shown={showOutcome ? 'true' : 'false'}>
                <div>
                  <dt>Input value</dt>
                  <dd className="num">{format(INPUT_SATS)} sats</dd>
                </div>
                <div>
                  <dt>Measured size</dt>
                  <dd className="num">{format(VSIZE)} vB</dd>
                </div>
                <div className="demo-outcome-fee">
                  <dt>
                    Mining fee <span className="mono">@ {FEE_RATE_SAT_VB} sat/vB</span>
                  </dt>
                  <dd className="num">− {format(FEE_SATS)} sats</dd>
                </div>
                <div className="demo-outcome-net" data-shown={showNet ? 'true' : 'false'}>
                  <dt>Net Bitcoin output</dt>
                  <dd className="num">{format(OUTPUT_SATS)} sats</dd>
                </div>
              </dl>

              <p className="demo-note mono">
                Illustrative only. A real sweep&apos;s fee depends on live fee rates and the exact
                input count; on a small wallet the fee can outweigh the sats recovered.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
