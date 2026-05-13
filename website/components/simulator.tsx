"use client";

import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

type Dot = {
  id: number;
  born: number;
  lane: number;
  x: number;
  y: number;
  phase: 'in' | 'queued' | 'firing' | 'done';
  queuedAt?: number;
  fireStart?: number;
};

const seedDots = [
  [18, 58], [25, 72], [34, 45], [40, 66], [47, 52], [55, 76], [62, 48], [69, 62],
  [78, 53], [88, 72], [96, 42], [104, 58], [116, 64], [130, 49], [142, 55], [156, 56],
  [171, 55], [186, 56], [202, 55], [218, 56], [234, 56], [250, 56],
];

export function BatchingSimulator() {
  const [rps, setRps] = useState(80);
  const [maxWaitMs, setMaxWaitMs] = useState(35);
  const maxBatch = 16;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<Dot[]>([]);
  const idRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const batchStartRef = useRef<number | null>(null);
  const fireFlashRef = useRef(0);
  const targetRef = useRef<HTMLDivElement | null>(null);
  const dotElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const recentBatchesRef = useRef<number[]>([]);

  const [stats, setStats] = useState({ avgBatch: 3.4, costPct: 29, p95: 155 });

  useEffect(() => {
    let raf = 0;
    let prev = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(80, now - prev);
      prev = now;

      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const spawnInterval = 1000 / Math.max(1, rps);
      lastSpawnRef.current += dt;

      while (lastSpawnRef.current >= spawnInterval) {
        lastSpawnRef.current -= spawnInterval;
        const id = ++idRef.current;
        dotsRef.current.push({
          id,
          born: now,
          lane: Math.floor(Math.random() * 5),
          x: 0,
          y: 0,
          phase: 'in',
        });

        if (batchStartRef.current === null) batchStartRef.current = now;
      }

      const sourceX = 36;
      const funnelX = w / 2;
      const targetX = w - 50;
      const cy = h / 2;
      const laneSpread = 28;
      const arrivalTime = 380;

      const inFlight = dotsRef.current;
      for (const dot of inFlight) {
        if (dot.phase === 'in') {
          const t = Math.min(1, (now - dot.born) / arrivalTime);
          const ease = 1 - Math.pow(1 - t, 2);
          dot.x = sourceX + (funnelX - sourceX) * ease;
          const targetY = cy + (dot.lane - 2) * 6;
          const startY = cy + (dot.lane - 2) * laneSpread;
          dot.y = startY + (targetY - startY) * ease;
          if (t >= 1) {
            dot.phase = 'queued';
            dot.queuedAt = now;
          }
        } else if (dot.phase === 'queued') {
          dot.x = funnelX + (Math.random() - 0.5) * 2;
          dot.y = cy + (Math.random() - 0.5) * 14;
        } else if (dot.phase === 'firing') {
          const t = Math.max(0, Math.min(1, (now - (dot.fireStart ?? now)) / 280));
          dot.x = funnelX + (targetX - funnelX) * t;
          dot.y = cy;
          if (t >= 1) dot.phase = 'done';
        }
      }

      const queued = inFlight.filter((dot) => dot.phase === 'queued');
      if (queued.length > 0 && batchStartRef.current !== null) {
        const waited = now - batchStartRef.current;
        if (queued.length >= maxBatch || waited >= maxWaitMs) {
          queued.forEach((dot) => {
            dot.phase = 'firing';
            dot.fireStart = now + Math.random() * 30;
          });
          recentBatchesRef.current.push(queued.length);
          if (recentBatchesRef.current.length > 20) recentBatchesRef.current.shift();
          batchStartRef.current = null;
          fireFlashRef.current = now;
        }
      }

      dotsRef.current = inFlight.filter(
        (dot) => dot.phase !== 'done' || now - (dot.fireStart ?? 0) < 600,
      );

      targetRef.current?.classList.toggle('firing', now - fireFlashRef.current < 240);

      const elements = dotElementsRef.current;
      const activeIds = new Set<number>();

      for (const dot of dotsRef.current) {
        let element = elements.get(dot.id);
        if (!element) {
          element = document.createElement('div');
          element.className = 'req-dot';
          element.dataset.id = String(dot.id);
          canvas.appendChild(element);
          elements.set(dot.id, element);
        }

        activeIds.add(dot.id);
        element.style.transform = `translate(${dot.x - 4}px, ${dot.y - 4}px)`;
        element.style.opacity = dot.phase === 'firing' ? '1' : dot.phase === 'queued' ? '0.7' : '0.9';
      }

      for (const [id, element] of elements) {
        if (!activeIds.has(id)) {
          element.remove();
          elements.delete(id);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const element of dotElementsRef.current.values()) element.remove();
      dotElementsRef.current.clear();
    };
  }, [rps, maxWaitMs]);

  useEffect(() => {
    const interval = setInterval(() => {
      const expected = Math.min(maxBatch, Math.max(1, (rps * maxWaitMs) / 1000));
      const recent = recentBatchesRef.current;
      const live = recent.length > 0 ? recent.reduce((sum, batch) => sum + batch, 0) / recent.length : 4;
      const avgBatch = live * 0.5 + expected * 0.5;
      const costPct = 100 / avgBatch;
      const p95 = Math.round(maxWaitMs + 110 + Math.min(40, rps / 8));

      setStats({ avgBatch, costPct, p95 });
    }, 240);

    return () => clearInterval(interval);
  }, [rps, maxWaitMs]);

  return (
    <div className="sim">
      <div className="sim-head">
        <span className="title">// batching simulator</span>
        <span className="badge">live</span>
      </div>

      <div className="sim-canvas" ref={canvasRef}>
        <div className="lane" style={{ top: '30%' }} />
        <div className="lane" style={{ top: '50%' }} />
        <div className="lane" style={{ top: '70%' }} />

        {seedDots.map(([left, top], index) => (
          <span
            aria-hidden="true"
            className="seed-dot"
            key={`${left}-${top}`}
            style={
              {
                '--x': `${left}px`,
                '--y': `${top + 40}px`,
                animationDelay: `${index * 90}ms`,
              } as CSSProperties
            }
          />
        ))}

        <div className="source">
          <div className="icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          <span className="label">clients</span>
        </div>

        <svg className="funnel" viewBox="0 0 110 110" fill="none">
          <defs>
            <linearGradient id="funGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0.5" />
            </linearGradient>
          </defs>
          <path d="M10 18 L100 18 L66 70 L66 96 L44 96 L44 70 Z" stroke="var(--accent)" strokeWidth="1.2" fill="url(#funGrad)" />
          <path d="M10 28 L100 28" stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="2 4" />
          <path d="M22 38 L88 38" stroke="var(--accent)" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="2 4" />
          <path d="M34 48 L76 48" stroke="var(--accent)" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 4" />
        </svg>

        <div className="target" ref={targetRef}>
          <div className="box">
            <div className="pulse-bg" />
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M5 17 L11 5 L17 17 H13 L11 12 L9 17 Z" fill="currentColor" opacity="0.85" />
            </svg>
          </div>
          <span className="label">λ target</span>
        </div>
      </div>

      <div className="sim-controls">
        <div className="sim-control">
          <div className="row">
            <label>traffic</label>
            <span className="val">
              {rps} <span>rps</span>
            </span>
          </div>
          <input type="range" min="5" max="200" step="5" value={rps} onChange={(event) => setRps(Number(event.target.value))} />
        </div>
        <div className="sim-control">
          <div className="row">
            <label>max wait</label>
            <span className="val">
              {maxWaitMs} <span>ms</span>
            </span>
          </div>
          <input type="range" min="0" max="200" step="5" value={maxWaitMs} onChange={(event) => setMaxWaitMs(Number(event.target.value))} />
        </div>
      </div>

      <div className="sim-readout">
        <div className="stat">
          <span className="k">avg batch</span>
          <span className="v">
            {stats.avgBatch.toFixed(1)}
            <span>×</span>
          </span>
        </div>
        <div className="stat">
          <span className="k">target cost</span>
          <span className="v accent">
            {Math.round(stats.costPct)}
            <span>%</span>
          </span>
        </div>
        <div className="stat">
          <span className="k">added p95</span>
          <span className="v">
            +{stats.p95}
            <span>ms</span>
          </span>
        </div>
      </div>
    </div>
  );
}
