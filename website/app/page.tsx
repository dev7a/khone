import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { BatchingSimulator } from '@/components/simulator';
import { SiteFooter, SiteHeader } from '@/components/site-frame';

export default function HomePage() {
  return (
    <>
      <SiteHeader active="home" />
      <main>
        <section className="hero">
          <div className="grid-bg" />
          <div className="wrap hero-inner">
            <div className="copy">
              <span className="eyebrow">
                <span className="dot" />
                χώνη · funnel
              </span>
              <h1 className="h-display">
                An HTTP <span className="hero-break">microbatching</span> gateway for{' '}
                <em>AWS Lambda.</em>
              </h1>
              <p className="lead">
                Khone buffers requests by route and batching dimensions for a few milliseconds,
                invokes Lambda with batched payloads, and routes each per-request response back to
                the original caller. It deliberately trades a few milliseconds per request for a
                smaller bill and fewer cold starts. That&apos;s the whole pitch.
              </p>
              <div className="cta-row">
                <Link className="btn primary" href="/docs/tutorials/first-lmi-deployment/">
                  Read the docs
                  <ArrowRight className="arrow" size={14} />
                </Link>
                <Link className="btn" href="https://github.com/dev7a/khone">
                  View on GitHub
                </Link>
              </div>
              <div className="meta-row">
                <div className="item">
                  <span className="k">Runtime</span>
                  <span className="v">Rust · LMI</span>
                </div>
                <div className="item">
                  <span className="k">Interface</span>
                  <span className="v">Function URL · RESPONSE_STREAM</span>
                </div>
                <div className="item">
                  <span className="k">Status</span>
                  <span className="v">Experimental</span>
                </div>
              </div>
            </div>
            <BatchingSimulator />
          </div>
        </section>

        <section className="block" id="how">
          <div className="wrap">
            <div className="block-head">
              <div>
                <div className="num">01 / Architecture</div>
                <h2 className="section-title">
                  One funnel,
                  <br />
                  fewer invocations.
                </h2>
              </div>
              <p className="lede">
                The gateway is a Rust Lambda Function URL router running on Lambda Managed
                Instances. It accepts HTTP, batches inside each execution environment, invokes the
                target with batched payloads, and demultiplexes per-request responses back to
                clients. Batches that exceed the invoke payload limit are split before invocation
                when possible.
              </p>
            </div>
            <div className="arch">
              {[
                ['01', 'HTTP requests', 'HTTP requests arrive at the gateway via Lambda Function URL with RESPONSE_STREAM invoke mode.'],
                ['02', 'Route match', 'A compiled route from Spec.paths identifies the target Lambda, method, and key dimensions.'],
                ['03', 'Microbatch', 'In-memory queue per target, route, mode, and key flushes when maxBatchSize, maxWaitMs, or an adaptive policy fires.'],
                ['04', 'Target Lambda', 'One or more invocations receive the batched payload and process every item in a single execution context.'],
                ['05', 'Streaming response', 'Buffered JSON returns one reply per batch; NDJSON streams per-item events as the handler produces them.'],
                ['06', 'Demultiplex', 'The gateway maps each response id back to the waiting client request and streams it home.'],
              ].map(([num, name, desc], index) => (
                <div className={index === 2 ? 'step batch' : 'step'} key={num}>
                  <span className="num">{num}</span>
                  <span className="name">{name}</span>
                  <span className="desc">{desc}</span>
                  {index < 5 ? (
                    <svg className="mark" width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M3 10h12m0 0L11 6m4 4L11 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="block" id="modes">
          <div className="wrap">
            <div className="block-head">
              <div>
                <div className="num">02 / Integration</div>
                <h2 className="section-title">
                  Three modes for
                  <br />
                  three handler shapes.
                </h2>
              </div>
              <p className="lede">
                Adopt Khone with the smallest change that fits your workload — from a layer drop-in
                for handlers that cannot change, to a native batch handler when one invocation should
                share data loading across all items.
              </p>
            </div>
            <div className="modes">
              <article className="mode-card">
                <div className="head">
                  <span className="tag">Mode A</span>
                  <span className="pill">No code change</span>
                </div>
                <h3>Layer Proxy</h3>
                <span className="mode-subtitle">Mode A</span>
                <p>A Lambda layer + Runtime API proxy presents one outer batch invocation as multiple virtual runtime invocations. Existing handlers run unmodified.</p>
                <ul className="features">
                  <li>Drop-in for legacy handlers</li>
                  <li>Runtime-specific (Node, Python)</li>
                  <li>Best when changing the handler is somebody else&apos;s problem</li>
                </ul>
              </article>
              <article className="mode-card">
                <div className="head">
                  <span className="tag">Mode B</span>
                  <span className="pill">Add an SDK</span>
                </div>
                <h3>Adapter</h3>
                <span className="mode-subtitle">Mode B</span>
                <p>A small wrapper preserves the familiar single-request handler shape. The adapter handles batch correlation, per-item errors, and response formatting.</p>
                <ul className="features">
                  <li>Familiar handler signature</li>
                  <li>Per-item error isolation</li>
                  <li>Node and Rust SDKs</li>
                </ul>
              </article>
              <article className="mode-card">
                <div className="head">
                  <span className="tag">Mode C</span>
                  <span className="pill">Full control</span>
                </div>
                <h3>Native Batch</h3>
                <span className="mode-subtitle">Mode C</span>
                <p>The handler receives the whole batch. Use it when one invocation should share data loading, fan-out, or response generation across all items.</p>
                <ul className="features">
                  <li>Custom batch processing</li>
                  <li>Shared work amortization</li>
                  <li>Streaming via NDJSON</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="block" id="config">
          <div className="wrap">
            <div className="block-head">
              <div>
                <div className="num">03 / Configuration</div>
                <h2 className="section-title">
                  Declare it
                  <br />
                  where it lives.
                </h2>
              </div>
              <p className="lede">
                The <code>KhoneGateway</code> macro publishes the gateway config and spec to S3. Your
                stack defines the gateway as an explicit <code>AWS::Serverless::Function</code> backed
                by an LMI capacity provider.
              </p>
            </div>

            <div className="code-grid">
              <div className="code">
                <div className="file-head">
                  <span className="name">template.yaml</span>
                  <span className="lang">yaml</span>
                </div>
                <pre>
                  <code>{`Transform:
  - AWS::Serverless-2016-10-31
  - KhoneGateway

Resources:
  GatewayConfig:
    Type: Khone::Gateway::Service
    Properties:
      ConfigPrefix: !Sub "khone/\${AWS::StackName}/gateway/"
      GatewayConfig:
        DefaultTimeoutMs: 2000
      Spec:
        openapi: 3.0.0
        paths:
          /items/{id}:
            get:
              x-target-lambda: !GetAtt ItemsFn.Arn
              x-khone:
                maxBatchSize: 16
                maxWaitMs: 35
                invokeMode: response_stream

  GatewayFunction:
    Type: AWS::Serverless::Function
    Metadata:
      BuildMethod: rust-cargolambda
    Properties:
      CodeUri: ../../gateway
      Handler: bootstrap
      Runtime: provided.al2023
      Architectures: [arm64]
      CapacityProviderConfig:
        Arn: !Ref GatewayCapacityProviderArn
      Environment:
        Variables:
          KHONE_CONFIG_URI: !GetAtt GatewayConfig.ConfigS3Uri
      FunctionUrlConfig:
        AuthType: NONE
        InvokeMode: RESPONSE_STREAM`}</code>
                </pre>
              </div>

              <div className="code">
                <div className="file-head">
                  <span className="name">handler.js (Mode B)</span>
                  <span className="lang">javascript</span>
                </div>
                <pre>
                  <code>{`const { batchAdapter } = require("khone-lambda-adapter");

// Single-request handler shape - preserved.
async function handleItem(event) {
  const item = await db.get(event.pathParameters.id);
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  };
}

// Adapter handles batch correlation, per-item errors,
// and the NDJSON response framing.
exports.handler = batchAdapter(handleItem);`}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        <section className="block" id="performance">
          <div className="wrap">
            <div className="block-head">
              <div>
                <div className="num">04 / Performance</div>
                <h2 className="section-title">
                  Pay less
                  <br />
                  per request.
                </h2>
              </div>
              <p className="lede">
                The public benchmark normalizes target invocation cost to the standard endpoint,
                an API Gateway HTTP API plus Lambda baseline, at 100%. In the high-traffic profile,
                <em>target-aware</em> batching delivered the lowest estimated target cost. The
                standard endpoint stays fastest because it avoids the gateway hop; asking a gateway
                to beat no gateway on latency was always going to be a losing fight. Khone trades
                some of that latency for a smaller bill — and, as a side effect, traffic spikes
                tend to land on warm sandboxes that are already chewing through a batch, rather
                than forcing fresh cold starts next door.
              </p>
            </div>

            <div className="perf">
              <div className="bigstat">
                <span className="eyebrow">
                  <span className="dot" />
                  target-aware · 256 MB · high traffic
                </span>
                <div className="num">
                  <span className="metric">17.7</span>
                  <span>%</span>
                </div>
                <p className="label">of standard target invocation cost in the curated round-2 high-traffic public report.</p>
              </div>

              <table className="bench-table" aria-label="Benchmark summary">
                <thead>
                  <tr>
                    <th>Profile</th>
                    <th>Endpoint</th>
                    <th className="num">P95</th>
                    <th className="num">Target cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Low · 1/10/50 rps', 'standard', '198 ms', '100.0%', 80],
                    ['Low · 1/10/50 rps', 'steady', '317 ms', '65.4%', 52],
                    ['Low · 1/10/50 rps', 'adaptive', '283 ms', '85.1%', 68],
                    ['Low · 1/10/50 rps', 'target-aware', '463 ms', '45.1%', 36],
                    ['High · 50/100/150 rps', 'standard', '197 ms', '100.0%', 80],
                    ['High · 50/100/150 rps', 'steady', '308 ms', '32.4%', 26],
                    ['High · 50/100/150 rps', 'adaptive', '304 ms', '36.2%', 29],
                    ['High · 50/100/150 rps', 'target-aware', '464 ms', '17.7%', 14],
                  ].map(([profile, endpoint, p95, cost, width], index) => (
                    <tr className={endpoint === 'target-aware' ? 'hl' : undefined} key={`${profile}-${endpoint}-${index}`}>
                      <td>{profile}</td>
                      <td>{endpoint}</td>
                      <td className="num">{p95}</td>
                      <td className="num">
                        <span className="bar" style={{ width: Number(width) }} />
                        {cost}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="callout-row">
              <span>Target memory: 256 MB</span>
              <span>Backend: 80 ms + 80 ms jitter</span>
              <span>Min 4 LMI envs</span>
              <span>Round 2: low traffic 0 errors</span>
            </div>
          </div>
        </section>

        <section className="block" id="docs">
          <div className="wrap">
            <div className="block-head">
              <div>
                <div className="num">05 / Documentation</div>
                <h2 className="section-title">Read your way in.</h2>
              </div>
              <p className="lede">
                Public docs follow Diátaxis. If a page feels misfiled, the framework is probably
                more right than the author. Start with project scope and architecture; deploy via
                the LMI tutorial; tune via the configuration reference.
              </p>
            </div>

            <div className="docmap">
              <div className="col">
                <h4>Tutorials</h4>
                <ul>
                  <li><Link href="/docs/tutorials/first-lmi-deployment/">First LMI deployment</Link></li>
                </ul>
              </div>
              <div className="col">
                <h4>How-To</h4>
                <ul>
                  <li><Link href="/docs/how-to/deploy-your-own-sam-gateway/">Deploy your own SAM gateway</Link></li>
                  <li><Link href="/docs/how-to/deploy-demo-stack/">Deploy the demo stack</Link></li>
                  <li><Link href="/docs/how-to/run-benchmarks/">Run benchmarks</Link></li>
                  <li><Link href="/docs/how-to/tune-batching/">Tune batching and timeouts</Link></li>
                  <li><Link href="/docs/how-to/integrate-handlers/">Integrate Lambda handlers</Link></li>
                  <li><Link href="/docs/how-to/use-mode-a-layer-proxy/">Use the Mode A layer proxy</Link></li>
                </ul>
              </div>
              <div className="col">
                <h4>Reference</h4>
                <ul>
                  <li><Link href="/docs/reference/config/">Configuration</Link></li>
                  <li><Link href="/docs/reference/batch-and-response-protocol/">Batch & response protocol</Link></li>
                  <li><Link href="/docs/reference/interleaved-streaming-protocol/">Interleaved streaming</Link></li>
                  <li><Link href="/docs/reference/observability/">Observability</Link></li>
                  <li><Link href="/docs/reference/sdk-adapters/">SDK adapters</Link></li>
                </ul>
              </div>
              <div className="col">
                <h4>Explanation</h4>
                <ul>
                  <li><Link href="/docs/explanation/architecture/">Architecture</Link></li>
                  <li><Link href="/docs/explanation/project-scope/">Project scope</Link></li>
                  <li><Link href="/docs/explanation/integration-modes/">Integration modes</Link></li>
                  <li><Link href="/docs/explanation/lmi-runtime-model/">LMI runtime model</Link></li>
                  <li><Link href="/docs/explanation/performance-and-cost/">Performance & cost</Link></li>
                  <li><Link href="/docs/explanation/benchmarking-methodology/">Benchmarking methodology</Link></li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
