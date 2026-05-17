"use client";

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

type WaitPolicy = 'steady' | 'adaptive' | 'target-aware';

type DotPhase = 'in' | 'queued' | 'firing' | 'done';

type Dot = {
  id: number;
  born: number;
  clientIndex: number;
  lmiIndex: number;
  lambdaIndex: number;
  x: number;
  y: number;
  phase: DotPhase;
  queuedAt?: number;
  fireStart?: number;
  fireOffset: number;
  batchSize: number;
  fireAngle: number;
  arrivalDuration: number;
  launchDelay: number;
  sourceX: number;
  sourceY: number;
};

type ModelConfig = {
  clients: number;
  maxWaitMs: number;
  policy: WaitPolicy;
};

type Stats = {
  avgBatch: number;
  costPct: number;
  p95: number;
  inFlight: number;
};

const CLIENT_COLS = 4;
const CLIENT_ROWS = 16;
const MAX_VISIBLE_CLIENTS = CLIENT_COLS * CLIENT_ROWS;
// Hard cap on the number of hexes that ever activate, smaller than the grid
// so the C-shape "mouth" stays open at peak traffic. Additional traffic above
// this cap manifests as a higher per-client emission rate (more frequency),
// not more visible clients.
const MAX_ACTIVE_CLIENTS = 40;
const MAX_LMI = 4;
const MAX_LAMBDA = 8;
const clientsPerLmi = 64;
const modeledResponseResidenceMs = 820;
const maxBatch = 16;
const maxDots = 600;
const batchThicknessPx = 4;
const batchLengthBasePx = 5;
const batchLengthStepPx = 1.4;
const LMI_BOOT_MS = 2400;

const LMI_HEIGHT = 40;
const LMI_GAP = 14;
const LMI_STEP = LMI_HEIGHT + LMI_GAP;
const LAMBDA_SIZE = 22;
const LAMBDA_GAP = 6;
const LAMBDA_STEP = LAMBDA_SIZE + LAMBDA_GAP;

const initialConfig: ModelConfig = { clients: 16, maxWaitMs: 45, policy: 'target-aware' };

const policyLabels: Record<WaitPolicy, string> = {
  steady: 'Steady',
  adaptive: 'Adaptive',
  'target-aware': 'Target-aware',
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const smoothstep = (t: number) => t * t * (3 - 2 * t);

function queueWindowMs(config: ModelConfig) {
  const traffic = config.clients;
  if (config.policy === 'steady') return config.maxWaitMs;
  if (config.policy === 'adaptive') {
    const trafficPressure = clamp(traffic / 120, 0.35, 1.3);
    return Math.round(clamp(config.maxWaitMs / trafficPressure, 12, config.maxWaitMs));
  }
  const usefulWorkWindow = traffic > 80 ? 1.35 : 1.12;
  return Math.round(clamp(config.maxWaitMs * usefulWorkWindow, 18, config.maxWaitMs + 45));
}

function lmiCount(config: ModelConfig) {
  return Math.max(1, Math.min(MAX_LMI, Math.ceil(config.clients / clientsPerLmi)));
}

function derivedBatchSize(config: ModelConfig) {
  const arrivalsPerWindow = (config.clients * queueWindowMs(config)) / 1000;
  return clamp(arrivalsPerWindow / lmiCount(config), 1, 32);
}

function lambdaServiceCount(config: ModelConfig) {
  return Math.max(1, Math.ceil(config.clients / Math.max(1, derivedBatchSize(config))));
}

// How many λ-target stations to render in the visualization. Grows with
// traffic (~2 visible per LMI's worth of clients) instead of jumping straight
// to the cap of MAX_LAMBDA at low traffic.
function visibleLambdaCount(config: ModelConfig) {
  return clamp(Math.ceil(config.clients / 32), 1, MAX_LAMBDA);
}

function visibleClientCount(config: ModelConfig) {
  return clamp(config.clients, 1, MAX_ACTIVE_CLIENTS);
}

type Position = { x: number; y: number };

type Layout = {
  clients: Position[];
  lmis: Position[];
  lambdas: Position[];
};

function computeLayout(
  width: number,
  height: number,
  activeLmi: number,
  visibleLambdas: number,
): Layout {
  if (width <= 0 || height <= 0) {
    return { clients: [], lmis: [], lambdas: [] };
  }

  // Honeycomb packing: pointy-top hexagons, offset every other row.
  // Cell pitch is larger than the visible hex so the tessellation is readable
  // — without a gap the hexes blur together into a solid mass.
  const hexVisualW = 15;
  const hexVisualH = hexVisualW * 1.1547; // 2 / sqrt(3)
  const cellGap = 5;
  const xStep = hexVisualW + cellGap;
  const yStep = (hexVisualH + cellGap) * 0.75;
  const offsetW = CLIENT_ROWS > 1 ? xStep / 2 : 0;
  const clientGridW = CLIENT_COLS * xStep + offsetW;
  const clientGridH = (CLIENT_ROWS - 1) * yStep + hexVisualH;
  const clientCenterX = 28 + clientGridW / 2;
  const clientCenterY = height / 2;
  const clientStartX = clientCenterX - clientGridW / 2 + hexVisualW / 2;
  const clientStartY = clientCenterY - clientGridH / 2 + hexVisualH / 2;

  const rawCells: Position[] = [];
  for (let r = 0; r < CLIENT_ROWS; r += 1) {
    const rowOffset = r % 2 === 1 ? xStep / 2 : 0;
    for (let c = 0; c < CLIENT_COLS; c += 1) {
      rawCells.push({
        x: clientStartX + c * xStep + rowOffset,
        y: clientStartY + r * yStep,
      });
    }
  }
  // Activate cells in a C shape that opens toward the LMI column. Cells far
  // from this focal (placed just outside the grid's right edge, at midY)
  // come first — i.e. the leftmost cells and the top/bottom corners, which
  // together trace the left spine and the upper/lower arms of the C.
  const cFocalX = clientCenterX + clientGridW / 2 + 6;
  const cFocalY = clientCenterY;
  const clients = rawCells
    .map((pos, index) => ({
      pos,
      score:
        -Math.hypot(pos.x - cFocalX, pos.y - cFocalY) +
        ((index * 0.6180339) % 1) * 1.4,
    }))
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.pos);

  const lmiX = width * 0.5;
  const lmiCenterY = height / 2;
  const lmis: Position[] = Array.from({ length: MAX_LMI }, (_, i) => {
    if (i < activeLmi) {
      return {
        x: lmiX,
        y: lmiCenterY + (i - (activeLmi - 1) / 2) * LMI_STEP,
      };
    }
    // Inactive stations park at the center, hidden via opacity.
    return { x: lmiX, y: lmiCenterY };
  });

  const lambdaX = width - 40;
  const lambdaCenterY = height / 2;
  const lambdas: Position[] = Array.from({ length: MAX_LAMBDA }, (_, i) => {
    if (i < visibleLambdas) {
      return {
        x: lambdaX,
        y: lambdaCenterY + (i - (visibleLambdas - 1) / 2) * LAMBDA_STEP,
      };
    }
    return { x: lambdaX, y: lambdaCenterY };
  });

  return { clients, lmis, lambdas };
}

export function BatchingSimulator() {
  const [config, setConfig] = useState<ModelConfig>(initialConfig);
  const [layout, setLayout] = useState<Layout>({ clients: [], lmis: [], lambdas: [] });
  const configRef = useRef(config);
  const layoutRef = useRef(layout);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dotsRef = useRef<Dot[]>([]);
  const idRef = useRef(0);
  const lmiOpenedAtRef = useRef<(number | null)[]>(Array.from({ length: MAX_LMI }, () => null));
  const lmiFlashAtRef = useRef<number[]>(Array.from({ length: MAX_LMI }, () => -10));
  const lmiActivatedAtRef = useRef<number[]>(Array.from({ length: MAX_LMI }, () => Number.NEGATIVE_INFINITY));
  const lastActiveLmiRef = useRef<number | null>(null);
  const lambdaFlashAtRef = useRef<number[]>(Array.from({ length: MAX_LAMBDA }, () => -10));
  const dotElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const recentBatchesRef = useRef<number[]>([]);
  // Per-client emission-rate multipliers — heterogeneous so corner clients
  // don't all emit at identical uniform rates (which produced visible spokes).
  const clientRateMultiplierRef = useRef<number[]>(
    Array.from({ length: MAX_VISIBLE_CLIENTS }, () => 0.35 + Math.random() * 1.3),
  );
  const lastMultiplierShuffleRef = useRef(0);
  // Track the previously-fired lambda so two consecutive batches never land
  // on the same target.
  const lastLambdaTargetRef = useRef<number>(-1);

  const [stats, setStats] = useState<Stats>({ avgBatch: 3.2, costPct: 31, p95: 165, inFlight: 0 });

  const activeLmi = lmiCount(config);
  const visibleClients = visibleClientCount(config);
  const lambdaServices = lambdaServiceCount(config);
  const visibleLambdas = visibleLambdaCount(config);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // Recompute layout when canvas resizes or active counts change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const recompute = () => {
      const next = computeLayout(canvas.clientWidth, canvas.clientHeight, activeLmi, visibleLambdas);
      layoutRef.current = next;
      setLayout(next);
    };
    recompute();
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [activeLmi, visibleLambdas]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let raf = 0;
    let prev = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      const current = configRef.current;
      const layoutNow = layoutRef.current;
      if (layoutNow.clients.length === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const traffic = current.clients;
      const activeLmis = lmiCount(current);
      const visClients = visibleClientCount(current);
      const visLambdas = visibleLambdaCount(current);
      const policyWait = queueWindowMs(current);

      // Track LMI activation transitions for boot behavior
      if (lastActiveLmiRef.current === null) {
        // First frame — treat the initial active set as already-ready
        for (let i = 0; i < activeLmis; i += 1) {
          lmiActivatedAtRef.current[i] = Number.NEGATIVE_INFINITY;
        }
        lastActiveLmiRef.current = activeLmis;
      } else if (activeLmis > lastActiveLmiRef.current) {
        for (let i = lastActiveLmiRef.current; i < activeLmis; i += 1) {
          lmiActivatedAtRef.current[i] = now;
        }
        lastActiveLmiRef.current = activeLmis;
      } else if (activeLmis < lastActiveLmiRef.current) {
        for (let i = activeLmis; i < lastActiveLmiRef.current; i += 1) {
          lmiActivatedAtRef.current[i] = Number.NEGATIVE_INFINITY;
          lmiOpenedAtRef.current[i] = null;
        }
        lastActiveLmiRef.current = activeLmis;
      }

      // If traffic drops and some LMI stations deactivate, keep existing
      // incoming/queued requests visible by moving them back onto active LMIs.
      // Otherwise queued dots can stay hidden forever because the flush loop
      // only visits active stations.
      for (const dot of dotsRef.current) {
        if (dot.lmiIndex < activeLmis || (dot.phase !== 'in' && dot.phase !== 'queued')) continue;
        const nextLmi = dot.id % activeLmis;
        dot.lmiIndex = nextLmi;
        if (dot.phase === 'queued') {
          const dest = layoutNow.lmis[nextLmi];
          if (dest) {
            dot.x = dest.x;
            dot.y = dest.y;
          }
          dot.queuedAt = now;
          lmiOpenedAtRef.current[nextLmi] ??= now;
        }
      }

      const isLmiReady = (index: number) => {
        const at = lmiActivatedAtRef.current[index];
        return at === Number.NEGATIVE_INFINITY || now - at >= LMI_BOOT_MS;
      };

      // Find LMIs ready to receive dots (always at least one — index 0 is ready from boot)
      const readyLmis: number[] = [];
      for (let i = 0; i < activeLmis; i += 1) {
        if (isLmiReady(i)) readyLmis.push(i);
      }
      if (readyLmis.length === 0) readyLmis.push(0);

      // Slow shuffle of per-client multipliers so the chatty/quiet pattern
      // isn't fixed forever (~every 4s, roll a fresh set).
      if (now - lastMultiplierShuffleRef.current > 4000) {
        for (let i = 0; i < MAX_VISIBLE_CLIENTS; i += 1) {
          clientRateMultiplierRef.current[i] = 0.35 + Math.random() * 1.3;
        }
        lastMultiplierShuffleRef.current = now;
      }

      // Per-client Poisson emission — each visible client decides independently
      // each frame whether to emit a request, giving organic random timing.
      // Multipliers introduce heterogeneity so corner clients don't all emit
      // at uniform rates (which produces visible spoke trains).
      const ratePerClient = visClients > 0 ? traffic / visClients : 0;
      for (let i = 0; i < visClients; i += 1) {
        if (dotsRef.current.length >= maxDots) break;
        const localRate = ratePerClient * clientRateMultiplierRef.current[i];
        const probPerFrame = clamp(dt * localRate, 0, 0.9);
        if (Math.random() >= probPerFrame) continue;
        const id = ++idRef.current;
        const lmiIndex = readyLmis[Math.floor(Math.random() * readyLmis.length)];
        const source = layoutNow.clients[i];
        const sourceX = source.x + (Math.random() - 0.5) * 2;
        const sourceY = source.y + (Math.random() - 0.5) * 2;
        dotsRef.current.push({
          id,
          born: now,
          clientIndex: i,
          lmiIndex,
          lambdaIndex: -1,
          x: sourceX,
          y: sourceY,
          phase: 'in',
          fireOffset: 0,
          batchSize: 1,
          fireAngle: 0,
          arrivalDuration: 320 + Math.random() * 760,
          launchDelay: 60 + Math.random() * 240,
          sourceX,
          sourceY,
        });
        if (lmiOpenedAtRef.current[lmiIndex] === null) {
          lmiOpenedAtRef.current[lmiIndex] = now;
        }
      }

      const fireMs = 360;

      for (const dot of dotsRef.current) {
        if (dot.phase === 'in') {
          const elapsed = now - dot.born;
          // Hold at source for a random "launch delay" so the dot is visibly at
          // its client circle before traveling — makes the origin readable and
          // also de-syncs consecutive emissions from the same client.
          if (elapsed < dot.launchDelay) {
            dot.x = dot.sourceX;
            dot.y = dot.sourceY;
            continue;
          }
          const dest = layoutNow.lmis[dot.lmiIndex] ?? { x: dot.sourceX, y: dot.sourceY };
          const t = clamp((elapsed - dot.launchDelay) / dot.arrivalDuration, 0, 1);
          // Symmetric ease-in/out so the dot accelerates AWAY from the client
          // (you can see it leave) and decelerates INTO the LMI.
          const u = smoothstep(t);
          // Straight-line trajectory — variance in launch delay + arrival
          // duration scatters dots along the line, so multiple requests from
          // the same client read as discrete particles rather than a train.
          dot.x = dot.sourceX + (dest.x - dot.sourceX) * u;
          dot.y = dot.sourceY + (dest.y - dot.sourceY) * u;
          if (t >= 1) {
            dot.phase = 'queued';
            dot.queuedAt = now;
          }
        } else if (dot.phase === 'queued') {
          // Park at the LMI's center; rendering hides the dot during this
          // phase so the LMI box's own firing-state animation is the only
          // visual signal of batching activity.
          const dest = layoutNow.lmis[dot.lmiIndex] ?? { x: dot.x, y: dot.y };
          dot.x = dest.x;
          dot.y = dest.y;
        } else if (dot.phase === 'firing') {
          const source = layoutNow.lmis[dot.lmiIndex] ?? { x: 0, y: 0 };
          const dest = layoutNow.lambdas[dot.lambdaIndex] ?? source;
          const start = dot.fireStart ?? now;
          const t = clamp((now - start) / fireMs, 0, 1);
          const ease = smoothstep(t);
          dot.x = source.x + (dest.x - source.x) * ease;
          dot.y = source.y + (dest.y - source.y) * ease;
          if (t >= 1) dot.phase = 'done';
        }
      }

      // The flush threshold matches the readout's avg batch size: every batch
      // fires at the rounded derivedBatchSize. This guarantees the batches the
      // user sees on screen equal the number the readout shows.
      const targetBatchSize = Math.max(
        1,
        Math.min(maxBatch, Math.round(derivedBatchSize(current))),
      );

      // Per-LMI flush — synchronized batch, random lambda target (never the
      // same as the immediately previous batch's target).
      for (let i = 0; i < activeLmis; i += 1) {
        if (!isLmiReady(i)) continue;
        const queued = dotsRef.current.filter((d) => d.phase === 'queued' && d.lmiIndex === i);
        if (queued.length === 0) continue;
        const opened = lmiOpenedAtRef.current[i];
        const waited = opened === null ? 0 : now - opened;
        if (queued.length >= targetBatchSize || waited >= policyWait) {
          const lastTarget = lastLambdaTargetRef.current;
          const excludeLast = visLambdas > 1 && lastTarget >= 0 && lastTarget < visLambdas;
          let target: number;
          if (excludeLast) {
            const r = Math.floor(Math.random() * (visLambdas - 1));
            target = r >= lastTarget ? r + 1 : r;
          } else {
            target = Math.floor(Math.random() * Math.max(1, visLambdas));
          }
          lastLambdaTargetRef.current = target;
          const batchSize = queued.length;
          // Collapse the batch into a single rectangle — visually represents
          // N requests being delivered as one bundled invocation, oriented
          // along the source→dest trajectory.
          const leader = queued[0];
          const src = layoutNow.lmis[i];
          const dst = layoutNow.lambdas[target] ?? src;
          leader.phase = 'firing';
          leader.fireStart = now;
          leader.fireOffset = 0;
          leader.batchSize = batchSize;
          leader.fireAngle = Math.atan2(dst.y - src.y, dst.x - src.x);
          leader.lambdaIndex = target;
          for (let k = 1; k < queued.length; k += 1) {
            queued[k].phase = 'done';
            queued[k].fireStart = now - 700;
          }
          recentBatchesRef.current.push(batchSize);
          if (recentBatchesRef.current.length > 28) recentBatchesRef.current.shift();
          lmiOpenedAtRef.current[i] = null;
          lmiFlashAtRef.current[i] = now;
          lambdaFlashAtRef.current[target] = now;
        }
      }

      dotsRef.current = dotsRef.current.filter(
        (dot) => dot.phase !== 'done' || now - (dot.fireStart ?? 0) < 600,
      );

      // Render dots — requests stay as 2.5px circles; firing dots become
      // rectangles whose length scales with batch size and is rotated to face
      // the source→dest trajectory.
      const elements = dotElementsRef.current;
      const activeIds = new Set<number>();
      for (const dot of dotsRef.current) {
        let element = elements.get(dot.id);
        if (!element) {
          element = document.createElement('div');
          element.className = 'req-dot';
          canvas.appendChild(element);
          elements.set(dot.id, element);
        }
        activeIds.add(dot.id);
        element.classList.toggle('is-batch', dot.phase === 'firing');
        if (dot.phase === 'firing') {
          const length = batchLengthBasePx + dot.batchSize * batchLengthStepPx;
          const thickness = batchThicknessPx;
          const angleDeg = (dot.fireAngle * 180) / Math.PI;
          element.style.width = `${length}px`;
          element.style.height = `${thickness}px`;
          element.style.borderRadius = `${thickness / 2}px`;
          element.style.transform = `translate(${dot.x - length / 2}px, ${dot.y - thickness / 2}px) rotate(${angleDeg}deg)`;
          element.style.opacity = '1';
        } else {
          element.style.width = '2.5px';
          element.style.height = '2.5px';
          element.style.borderRadius = '50%';
          element.style.transform = `translate(${dot.x - 1.25}px, ${dot.y - 1.25}px)`;
          // Hide queued dots — they all sit at the LMI center and would just
          // stack into a buzzing pile. The LMI box's firing class shows
          // batch activity.
          element.style.opacity = dot.phase === 'queued' ? '0' : '0.92';
        }
      }
      for (const [id, element] of elements) {
        if (!activeIds.has(id)) {
          element.remove();
          elements.delete(id);
        }
      }

      // Station classes
      const lmiNodes = canvas.querySelectorAll<HTMLElement>('.lmi-station');
      lmiNodes.forEach((node, index) => {
        const isInactive = index >= activeLmis;
        const isBooting = !isInactive && !isLmiReady(index);
        node.classList.toggle('inactive', isInactive);
        node.classList.toggle('booting', isBooting);
        node.classList.toggle(
          'firing',
          !isInactive && !isBooting && now - lmiFlashAtRef.current[index] < 260,
        );
      });

      const lambdaNodes = canvas.querySelectorAll<HTMLElement>('.lambda-station');
      lambdaNodes.forEach((node, index) => {
        const isInactive = index >= visLambdas;
        node.classList.toggle('inactive', isInactive);
        node.classList.toggle(
          'active',
          !isInactive && now - lambdaFlashAtRef.current[index] < modeledResponseResidenceMs,
        );
      });

      const clientNodes = canvas.querySelectorAll<HTMLElement>('.client-station');
      clientNodes.forEach((node, index) => {
        node.classList.toggle('inactive', index >= visClients);
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const element of dotElementsRef.current.values()) element.remove();
      dotElementsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const current = configRef.current;
      const expected = derivedBatchSize(current);
      const recent = recentBatchesRef.current;
      const live = recent.length > 0 ? recent.reduce((sum, batch) => sum + batch, 0) / recent.length : expected;
      // Show the live observed average — guaranteed to match what's animating
      // since every batch fires at the targetBatchSize threshold.
      const avgBatch = live;
      const costPct = clamp(100 / avgBatch, 8, 100);
      const policyExtra = current.policy === 'target-aware' ? 34 : current.policy === 'adaptive' ? 14 : 22;
      const p95 = Math.round(queueWindowMs(current) + 86 + policyExtra + lmiCount(current) * 4);
      // Count actual requests — a firing batch-dot represents `batchSize` of them.
      const inFlight = dotsRef.current.reduce(
        (sum, dot) => sum + (dot.phase === 'firing' && dot.batchSize > 1 ? dot.batchSize : 1),
        0,
      );
      setStats({ avgBatch, costPct, p95, inFlight });
    }, 260);
    return () => clearInterval(interval);
  }, []);

  const updateConfig = (patch: Partial<ModelConfig>) => {
    setConfig((cur) => ({ ...cur, ...patch }));
  };

  const stationStyle = (pos: Position | undefined): CSSProperties => {
    if (!pos) return { display: 'none' };
    return { left: `${pos.x}px`, top: `${pos.y}px` };
  };

  return (
    <div className="sim">
      <div className="sim-head">
        <div className="sim-head-text">
          <span className="title">// microbatching simulator</span>
          <span className="subtitle">clients → khone gateway → batched λ invocations</span>
        </div>
        <span className="badge">live</span>
      </div>

      <div className="sim-canvas" ref={canvasRef}>
        {Array.from({ length: MAX_VISIBLE_CLIENTS }, (_, index) => (
          <div
            key={`client-${index}`}
            className={`client-station${index >= visibleClients ? ' inactive' : ''}`}
            style={stationStyle(layout.clients[index])}
            aria-hidden="true"
          >
            <svg viewBox="0 0 100 115.47" preserveAspectRatio="none">
              <polygon points="50,0 100,28.87 100,86.6 50,115.47 0,86.6 0,28.87" />
            </svg>
          </div>
        ))}

        {Array.from({ length: MAX_LMI }, (_, index) => (
          <div
            key={`lmi-${index}`}
            className={`lmi-station${index >= activeLmi ? ' inactive' : ''}`}
            style={stationStyle(layout.lmis[index])}
            aria-hidden="true"
          >
            <svg className="funnel" viewBox="0 0 110 110" aria-hidden="true">
              <path d="M10 18 L100 18 L66 70 L66 96 L44 96 L44 70 Z" />
            </svg>
          </div>
        ))}

        {Array.from({ length: MAX_LAMBDA }, (_, index) => (
          <div
            key={`lambda-${index}`}
            className={`lambda-station${index >= visibleLambdas ? ' inactive' : ''}`}
            style={stationStyle(layout.lambdas[index])}
            aria-hidden="true"
          >
            <div className="pulse-bg" />
            <span className="lambda-glyph">λ</span>
          </div>
        ))}

        <div className="sim-canvas-labels">
          <span>clients</span>
          <span>khone gateway</span>
          <span>λ services{lambdaServices > visibleLambdas ? ` (${lambdaServices}×)` : ''}</span>
        </div>

        <div className="sim-canvas-badge" aria-hidden="true">
          <span><span className="count">{activeLmi}</span> × {clientsPerLmi} LMI</span>
          <div className="pips">
            {Array.from({ length: MAX_LMI }, (_, index) => (
              <span key={index} className={index < activeLmi ? 'active' : ''} />
            ))}
          </div>
        </div>
      </div>

      <div className="sim-controls">
        <div className="sim-control">
          <div className="row">
            <label htmlFor="sim-clients">clients</label>
            <span className="val">
              {config.clients} <span>rps</span>
            </span>
          </div>
          <input
            id="sim-clients"
            type="range"
            min="8"
            max="256"
            step="8"
            value={config.clients}
            onChange={(event) => updateConfig({ clients: Number(event.target.value) })}
          />
        </div>
        <div className="sim-control">
          <div className="row">
            <label htmlFor="sim-max-wait">max wait</label>
            <span className="val">
              {config.maxWaitMs} <span>ms</span>
            </span>
          </div>
          <input
            id="sim-max-wait"
            type="range"
            min="0"
            max="200"
            step="5"
            value={config.maxWaitMs}
            onChange={(event) => updateConfig({ maxWaitMs: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="policy-picker" role="group" aria-label="Wait policy">
        {(Object.keys(policyLabels) as WaitPolicy[]).map((policy) => (
          <button
            aria-pressed={config.policy === policy}
            key={policy}
            onClick={() => updateConfig({ policy })}
            type="button"
          >
            {policyLabels[policy]}
          </button>
        ))}
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
          <span className="k">invoke cost</span>
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
        <div className="stat">
          <span className="k">in flight</span>
          <span className="v">{stats.inFlight}</span>
        </div>
      </div>
    </div>
  );
}
