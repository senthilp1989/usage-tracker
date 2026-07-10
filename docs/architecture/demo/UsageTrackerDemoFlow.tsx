import React, { useState, useEffect, useRef } from "react";
import "./UsageTrackerDemoFlow.css";

// ============================================================================
// ArchFlow DATA — regenerate this whole section per architecture.
// Everything below the "ArchFlow ENGINE" marker is proven, working code.
// Do not modify the engine; only touch it if a genuinely new interaction
// pattern is needed (and then port the fix back into the skill template).
// ============================================================================

// Canvas dimensions for the SVG stage. Compute from your node grid: take the
// bounding box of all NODES (max x + NW + margin, max y + NH + margin).
const STAGE_W = 1160;
const STAGE_H = 530;

// Node card size — keep these unless you have a strong reason to change them;
// the layout math below (bubble placement, arrow clipping) assumes this size.
const NW = 180;
const NH = 76;

// One entry per component in the architecture. `external: true` marks systems
// this application depends on but doesn't own (third-party APIs, legacy
// systems, SaaS) — they render as dashed cards, matching the "dark cloud"
// convention from the Mermaid/PlantUML diagrams.
//
// Optional `desc`: 1-2 sentences shown in the node inspector (the side panel
// that opens when a node card is clicked). Write it for every node — it's the
// "what is this component and why does it exist" line. The inspector also
// derives the node's connections and step appearances automatically from
// STEPS, so desc is the only extra authoring this feature needs.
//
// LAYOUT RULES (avoid overlap, leave room for chat bubbles):
//  - Arrange nodes in columns (pipeline stages) and rows (siblings at that
//    stage). Column gap >= 100px between card edges. Row gap >= 140px
//    between card edges — bubbles need ~95-100px of clearance above/below
//    a node and must not collide with the next row.
//  - Leave >= 100px of margin above the topmost row (bubbles above a
//    top-row node render at `node.y - 101`, which goes negative / off-canvas
//    if the node is any higher than y=110).
//  - STAGE_W / STAGE_H = bounding box of (x + NW) / (y + NH) across all
//    nodes, plus ~20-40px margin.
const NODES = {
    USER: { id: "USER", x: 40, y: 130, icon: "👤", title: "User / Browser", sub: "React SPA · dashboard admin", color: "#8b5cf6", desc: "The dashboard admin's browser running the React 18 SPA (Vite build). It keeps the 12h session token in localStorage and renders the KPI tiles, the hand-rolled SVG trend chart, and the per-user table." },
  NGINX: { id: "NGINX", x: 340, y: 130, icon: "🌐", title: "nginx", sub: "SPA host + /api proxy", color: "#10b981", desc: "Web server inside the frontend container: serves the built SPA with an index.html fallback and reverse-proxies /api/* to the API container, stripping the /api prefix on the way through." },
  API: { id: "API", x: 640, y: 130, icon: "⚡", title: "FastAPI api", sub: "Uvicorn · SQLAlchemy", color: "#3b82f6", desc: "FastAPI service (Uvicorn, SQLAlchemy 2, Pydantic v2) that owns both auth schemes — shared X-API-Key for ingestion, HMAC-signed 12h session tokens for dashboard reads — and aggregates all stats at query time." },
  DB: { id: "DB", x: 940, y: 130, icon: "🐘", title: "PostgreSQL", sub: "usage_reports · 1 row/user/day", color: "#f59e0b", desc: "PostgreSQL 15, reachable only on the internal Docker network. A single usage_reports table holds one upserted row per user per day; schema comes from create_all at startup — no migrations." },
  TESTEASE: { id: "TESTEASE", x: 640, y: 350, icon: "🧪", title: "Test Ease", sub: "usage reporter (external)", color: "#64748b", external: true, desc: "The external product being measured — the sole ingestion client. On a fixed interval it POSTs each user's running daily totals to /reports; it never sends one event per action." },
};

const center = (n) => ({ x: NODES[n].x + NW / 2, y: NODES[n].y + NH / 2 });

// One entry per interaction in the demo scenario. Design ONE realistic,
// concrete end-to-end flow through the architecture (e.g. "a user submits
// a request and it propagates through every layer") rather than an abstract
// tour of every possible edge. Group steps into phases (ph: 0, 1, 2, ...)
// that match PHASES below.
//
// Fields:
//   f, t     — node IDs (from NODES). f === t means a "self-working" step
//              (the node pulses in place, no traveling dot) — use for
//              internal processing with no network hop.
//   ph       — phase index (see PHASES)
//   k        — 'call' (control/hand-off, indigo), 'data' (response, teal),
//              or 'work' (self-working, amber) — purely cosmetic, drives
//              log-item and pulse color.
//   route    — short label shown in the activity log, e.g. "Frontend → API"
//   m        — one-sentence description of what this step represents
//   roundTrip — set true when this is a request/response pair traveling the
//              SAME edge in one step (asker asks, responder answers, ball
//              travels both ways). When true: set f = the RESPONDER (who
//              has the data), t = the ASKER (who initiates) — this reads
//              backwards but matches the engine's `asker = t; responder = f`
//              convention. chat[0] should still be the asker speaking first.
//   chat     — array of [nodeId, "line of dialogue"] tuples, revealed in
//              order as the step plays out. Keep lines short (< ~70 chars).
//
// IMPORTANT: every pair used with roundTrip: true MUST also be added to the
// BIDIRECTIONAL set below (pairKey-sorted, e.g. ['A','B'].sort().join('|')),
// or the return-arrow won't render.
const STEPS = [
  // Phase 0 — Test Ease ingestion
  { f: "TESTEASE", t: "API", ph: 0, k: "call", route: "Test Ease → API", m: "POST /reports with X-API-Key — running daily totals for jane@…", chat: [["TESTEASE", "Interval tick — here are jane's running totals for today."], ["API", "X-API-Key matches. Payload validates (Pydantic)."]] },
  { f: "DB", t: "API", ph: 0, k: "call", roundTrip: true, route: "API ⇄ PostgreSQL", m: "SELECT the (user_email, report_date) row this report upserts into", chat: [["API", "Any row for (jane, today)?"], ["DB", "Yes — last written at 09:00 this morning."]] },
  { f: "API", t: "DB", ph: 0, k: "call", route: "API → PostgreSQL", m: "UPDATE — the new running totals replace the old row (upsert); reported_at bumped", chat: [["API", "Overwrite with the new totals; bump reported_at."]] },
  { f: "API", t: "TESTEASE", ph: 0, k: "data", route: "API → Test Ease", m: "200 OK — the stored row is echoed back", chat: [["API", "Stored. See you next interval."]] },
  // Phase 1 — open the dashboard
  { f: "USER", t: "NGINX", ph: 1, k: "call", route: "Browser → nginx", m: "GET / — the admin opens the dashboard at :3005", chat: [["USER", "Let's check this week's usage."]] },
  { f: "NGINX", t: "USER", ph: 1, k: "data", route: "nginx → Browser", m: "Serves the built React SPA (SPA fallback to index.html)", chat: [["NGINX", "index.html + the JS bundle, coming up."]] },
  { f: "USER", t: "USER", ph: 1, k: "work", route: "Browser", m: "SPA boots; no token in localStorage → login screen", chat: [["USER", "No session token — login first."]] },
  // Phase 2 — login
  { f: "USER", t: "NGINX", ph: 2, k: "call", route: "Browser → nginx", m: "POST /api/dashboard/login with username + password", chat: [["USER", "admin / ••••••••"]] },
  { f: "NGINX", t: "API", ph: 2, k: "call", route: "nginx → API", m: "Proxied to the API with the /api prefix stripped", chat: [["NGINX", "/api/dashboard/login → /dashboard/login"]] },
  { f: "API", t: "API", ph: 2, k: "work", route: "API", m: "Constant-time credential check; mints an HMAC session token (12h expiry)", chat: [["API", "Credentials match env config."], ["API", "Token = expiry signed with HMAC(api_key:password)."]] },
  { f: "API", t: "NGINX", ph: 2, k: "data", route: "API → nginx", m: "Returns { token, expires_at }" },
  { f: "NGINX", t: "USER", ph: 2, k: "data", route: "nginx → Browser", m: "Token reaches the SPA and is stored in localStorage", chat: [["USER", "Session open for 12 hours."]] },
  // Phase 3 — query aggregates
  { f: "USER", t: "NGINX", ph: 3, k: "call", route: "Browser → nginx", m: "GET /api/dashboard/summary?from&to with Authorization: Bearer", chat: [["USER", "Last 7 days, please."]] },
  { f: "NGINX", t: "API", ph: 3, k: "call", route: "nginx → API", m: "Forwarded as /dashboard/summary (prefix stripped)" },
  { f: "API", t: "API", ph: 3, k: "work", route: "API", m: "verify_dashboard_token: recompute the HMAC, check expiry", chat: [["API", "Signature valid, not expired. Proceed."]] },
  { f: "DB", t: "API", ph: 3, k: "call", roundTrip: true, route: "API ⇄ PostgreSQL", m: "SUM the three metrics + COUNT DISTINCT users over the date range", chat: [["API", "Aggregate usage_reports over the 7-day window."], ["DB", "3 users · 41 created · 87 executed · 12 docs."]] },
  { f: "DB", t: "API", ph: 3, k: "call", roundTrip: true, route: "API ⇄ PostgreSQL", m: "GROUP BY report_date for the daily trend, plus per-user totals", chat: [["API", "Now the per-day and per-user breakdowns."], ["DB", "7 day-rows and 3 user-rows coming up."]] },
  { f: "API", t: "NGINX", ph: 3, k: "data", route: "API → nginx", m: "Pydantic-shaped JSON: StatsSummary, DailyStats[], UserStats[]" },
  { f: "NGINX", t: "USER", ph: 3, k: "data", route: "nginx → Browser", m: "JSON lands in the SPA's fetch calls", chat: [["USER", "Data's in — render it."]] },
  // Phase 4 — render
  { f: "USER", t: "USER", ph: 4, k: "work", route: "Browser", m: "React renders the KPI StatTiles, the hand-rolled SVG DailyTrend chart, and the users table", chat: [["USER", "📊 Totals, trend line, per-user table — all live."]] },
];

// One label per phase index used in STEPS. Shown in the toolbar's phase tag.
const PHASES = [
  "Ingest — Test Ease reports totals",
  "Load — open the dashboard",
  "Login — mint a session token",
  "Query — aggregate the stats",
  "Render — KPI tiles & chart",
];

function buildPath(f, t) {
  const a = center(f);
  const b = center(t);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return `M ${a.x} ${a.y} C ${a.x + dx * 0.5} ${a.y}, ${b.x - dx * 0.5} ${
      b.y
    }, ${b.x} ${b.y}`;
  }
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy * 0.5}, ${b.x} ${
    b.y - dy * 0.5
  }, ${b.x} ${b.y}`;
}
// NOTE: if two nodes are far apart with unrelated nodes sitting between them
// on the direct path, this S-curve will visually cross those nodes. Either
// reposition nodes so no edge needs to cross unrelated cards, or special-case
// that one pair with a manual arc (see the git history of docs/architecture
// examples for the "top arc" pattern used when a straight S-curve would
// cut through the middle of the diagram).

const pairKey = (a, b) => [a, b].sort().join("|");

// Derived per-node info for the click-to-open node inspector: every unique
// route label the node participates in, and every step index it appears at
// (rendered as clickable chips that jump the demo to that step).
function nodeInfo(id) {
  const routes = [];
  const stepIdxs = [];
  STEPS.forEach((s, i) => {
    if (s.f === id || s.t === id) {
      stepIdxs.push(i);
      if (routes.indexOf(s.route) === -1) routes.push(s.route);
    }
  });
  return { routes, stepIdxs };
}

// Pairs that need arrowheads on BOTH ends because the flow is a
// request/response round-trip along one edge, not two distinct steps.
// Must exactly match every pairKey(f, t) used with roundTrip: true above.
const BIDIRECTIONAL = new Set(["API|DB"]);

// OPTIONAL: dramatize one "persistence save" step (file-transfer console +
// flying particles) — nice for a moment like "the run is written to the
// database." Set DB_INGEST_TO to null to disable this entirely; that's the
// right default unless your scenario has one obvious "everything lands
// here" step. When enabled, DB_INGEST_FROM/TO must match the f/t of exactly
// one non-roundTrip STEPS entry.
const DB_INGEST_FROM = "API"; // node id, e.g. 'API', or null
const DB_INGEST_TO = "DB"; // node id, e.g. 'DB', or null
const DB_INGEST_ICON = "⚡ ➔ 🐘"; // e.g. '🖥️ ➔ 🗄️'
const DB_INGEST_TITLE = "Upserting usage_reports…"; // e.g. 'Saving run to PostgreSQL...'
const DB_INGEST_FILES = [
  { name: "test_cases_created = 14", size: "int" },
  { name: "test_cases_executed = 29", size: "int" },
  { name: "documents_generated = 4", size: "int" },
  { name: "stack_id = stack-eu-1", size: "text" },
  { name: "reported_at = now()", size: "tstz" },
  { name: "uq (user_email, report_date)", size: "ok" },
]; // [{name,size}, ...] cosmetic file list
// Place the console in genuinely empty canvas space near DB_INGEST_TO — check
// your NODES layout for a gap, don't just guess.
const DB_INGEST_CONSOLE_X = 880;
const DB_INGEST_CONSOLE_Y = 260;
// Particle path: start near the bottom/edge of DB_INGEST_FROM's card, end
// near the top/edge of DB_INGEST_TO's card.
const DB_INGEST_PARTICLE_PATH = {
  startX: 830,
  startY: 168,
  endX: 935,
  endY: 168,
};

const TITLE = "iVolve Usage Tracker — Live Request Flow";
const SUBTITLE = "Test Ease reports running daily totals; an admin logs in and reads the aggregates";

// ============================================================================
// ArchFlow ENGINE — do not modify below this line.
// ============================================================================

export function UsageTrackerDemoFlow() {
  const [theme, setTheme] = useState("dark");
  const [speed, setSpeed] = useState(0.5);
  const [isPlaying, setIsPlaying] = useState(false);
  const [phaseText, setPhaseText] = useState("Ready");
  const [isDoneDisabled, setIsDoneDisabled] = useState(false);
  // progress mirrors idxRef into React state so the scrubber / step counter /
  // button labels re-render as the run advances.
  const [progress, setProgress] = useState(-1);
  // Node inspector: id of the clicked node, or null when closed.
  const [inspected, setInspected] = useState(null);

  const stageRef = useRef(null);
  const logRef = useRef(null);
  const scrubTrackRef = useRef(null);

  const playingRef = useRef(false);
  const idxRef = useRef(-1);
  const speedRef = useRef(0.5);
  const animRef = useRef(null);
  // True while a ⏭ Step single-step animation runs — jumpTo must not fire
  // then (DOM log-item listeners bypass the disabled-button guards).
  const ffRef = useRef(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch((err) => console.error(err));
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () =>
      setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    Object.keys(nodeElsRef.current).forEach((id) =>
      nodeElsRef.current[id].classList.toggle("inspected", id === inspected),
    );
  }, [inspected]);

  const edgesRef = useRef({});
  const nodeElsRef = useRef({});
  const pulseRef = useRef(null);
  const allArrowsRef = useRef([]);
  const bubbleLayerRef = useRef(null);
  const bubbleElsRef = useRef([]);
  const dbParticlesGroupRef = useRef(null);
  const pgConsoleFORef = useRef(null);

  const BASE = 2400; // base step duration in ms

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    playingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(
    () => () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!stageRef.current) return;
    stageRef.current.innerHTML = "";

    const SVGNS = "http://www.w3.org/2000/svg";
    const el = (tag, attrs, text) => {
      const e = document.createElementNS(SVGNS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text !== undefined && text !== null) e.textContent = text;
      return e;
    };

    const edges = {};
    const directed = new Set();

    STEPS.forEach((s) => {
      if (s.f !== s.t) {
        directed.add(s.f + ">" + s.t);
        const key = pairKey(s.f, s.t);
        if (!edges[key])
          edges[key] = { from: s.f, to: s.t, d: buildPath(s.f, s.t) };
      }
    });

    const edgeLayer = el("g", {});
    stageRef.current.appendChild(edgeLayer);

    const edgesCached = {};
    Object.keys(edges).forEach((key) => {
      const e = edges[key];
      const p = el("path", { d: e.d, class: "edge dashed" });
      edgeLayer.appendChild(p);
      edgesCached[key] = {
        el: p,
        from: e.from,
        to: e.to,
        len: p.getTotalLength(),
        arrows: {},
      };
    });
    edgesRef.current = edgesCached;

    const arrowLayer = el("g", {});
    stageRef.current.appendChild(arrowLayer);
    const allArrows = [];

    const norm = (x, y) => {
      const d = Math.hypot(x, y) || 1;
      return { x: x / d, y: y / d };
    };
    const insideCard = (p, n, pad) =>
      p.x >= n.x - pad &&
      p.x <= n.x + NW + pad &&
      p.y >= n.y - pad &&
      p.y <= n.y + NH + pad;

    const makeArrow = (path, len, n, side) => {
      const STEP = 1;
      const OVERLAP = 2.5;
      let edgeL = 0;
      let tip = { x: 0, y: 0 };
      let dir = { x: 0, y: 0 };

      if (side === "to") {
        edgeL = 0;
        for (let q = len; q >= 0; q -= STEP) {
          if (!insideCard(path.getPointAtLength(q), n, 0)) {
            edgeL = q;
            break;
          }
        }
        const onEdge = path.getPointAtLength(edgeL);
        const ahead = path.getPointAtLength(Math.min(len, edgeL + 8));
        dir = norm(ahead.x - onEdge.x, ahead.y - onEdge.y);
        tip = { x: onEdge.x + dir.x * OVERLAP, y: onEdge.y + dir.y * OVERLAP };
      } else {
        edgeL = len;
        for (let q = 0; q <= len; q += STEP) {
          if (!insideCard(path.getPointAtLength(q), n, 0)) {
            edgeL = q;
            break;
          }
        }
        const onEdge = path.getPointAtLength(edgeL);
        const back = path.getPointAtLength(Math.max(0, edgeL - 8));
        dir = norm(back.x - onEdge.x, back.y - onEdge.y);
        tip = { x: onEdge.x + dir.x * OVERLAP, y: onEdge.y + dir.y * OVERLAP };
      }

      const size = 7;
      const half = 4;
      const nx = -dir.y;
      const ny = dir.x;
      const bx = tip.x - dir.x * size;
      const by = tip.y - dir.y * size;
      const pts = `${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${(
        bx +
        nx * half
      ).toFixed(1)},${(by + ny * half).toFixed(1)} ${(bx - nx * half).toFixed(
        1,
      )},${(by - ny * half).toFixed(1)}`;
      const poly = el("polygon", { points: pts, class: "arrow" });
      arrowLayer.appendChild(poly);
      allArrows.push(poly);
      return poly;
    };

    Object.keys(edgesRef.current).forEach((key) => {
      const e = edgesRef.current[key];
      const nodesTo = NODES[e.to];
      const nodesFrom = NODES[e.from];
      e.arrows[e.to] = makeArrow(e.el, e.len, nodesTo, "to");
      if (
        directed.has(e.to + ">" + e.from) ||
        BIDIRECTIONAL.has(pairKey(e.from, e.to))
      ) {
        e.arrows[e.from] = makeArrow(e.el, e.len, nodesFrom, "from");
      }
    });
    allArrowsRef.current = allArrows;

    const pulse = el("circle", {
      r: 5.5,
      class: "pulse",
      cx: -100,
      cy: -100,
      opacity: 0,
    });
    pulseRef.current = pulse;

    const nodeEls = {};
    Object.keys(NODES).forEach((id) => {
      const n = NODES[id];
      const g = el("g", {
        class: "node" + (n.external ? " external" : ""),
        "data-id": id,
      });
      g.appendChild(
        el("rect", {
          class: "node-card",
          x: n.x,
          y: n.y,
          width: NW,
          height: NH,
          rx: 12,
        }),
      );
      g.appendChild(
        el("circle", { cx: n.x + 30, cy: n.y + NH / 2, r: 19, fill: n.color }),
      );
      g.appendChild(
        el(
          "text",
          { class: "node-icon", x: n.x + 30, y: n.y + NH / 2 + 1 },
          n.icon,
        ),
      );
      g.appendChild(
        el("text", { class: "node-title", x: n.x + 58, y: n.y + 31 }, n.title),
      );
      g.appendChild(
        el("text", { class: "node-sub", x: n.x + 58, y: n.y + 50 }, n.sub),
      );
      g.addEventListener("click", () =>
        setInspected((prev) => (prev === id ? null : id)),
      );
      stageRef.current.appendChild(g);
      nodeEls[id] = g;
    });
    nodeElsRef.current = nodeEls;

    stageRef.current.appendChild(pulse);

    const bubbleLayer = el("g", {});
    stageRef.current.appendChild(bubbleLayer);
    bubbleLayerRef.current = bubbleLayer;

    const dbParticlesGroup = el("g", { id: "dbParticlesGroup" });
    stageRef.current.appendChild(dbParticlesGroup);
    dbParticlesGroupRef.current = dbParticlesGroup;

    // OPTIONAL persistence-save flourish (file-transfer console + flying
    // particles). Wire DB_INGEST_FROM/DB_INGEST_TO/DB_INGEST_FILES below to
    // enable it for a "save to storage" step, or leave DB_INGEST_TO empty
    // (see DATA section note) to skip this block entirely — the generic
    // step animation still works fine without it.
    if (DB_INGEST_TO) {
      const pgConsoleFO = el("foreignObject", {
        id: "pgConsoleFO",
        x: DB_INGEST_CONSOLE_X,
        y: DB_INGEST_CONSOLE_Y,
        width: 255,
        height: 155,
        style: "display: none;",
      });
      const consoleDiv = document.createElement("div");
      consoleDiv.className = "transfer-modal";
      consoleDiv.innerHTML = `
        <div class="transfer-header">
          <span class="transfer-icon">${DB_INGEST_ICON}</span>
          <span class="transfer-title">${DB_INGEST_TITLE}</span>
          <span class="transfer-pct" id="transferPct">0%</span>
        </div>
        <div class="transfer-progress-container">
          <div class="transfer-progress-bar" id="transferProgressBar"></div>
        </div>
        <div class="transfer-stats">
          <div class="transfer-stat">Records: <span id="transferFiles">0 / ${DB_INGEST_FILES.length}</span></div>
          <div class="transfer-stat">Rate: <span id="transferRate">45.8 KB/s</span></div>
          <div class="transfer-stat">Time Left: <span id="transferTimeLeft">15s</span></div>
        </div>
        <div class="transfer-log" id="transferLog"></div>
      `;
      pgConsoleFO.appendChild(consoleDiv);
      stageRef.current.appendChild(pgConsoleFO);
      pgConsoleFORef.current = pgConsoleFO;
    }

    resetAnimation(false);
  }, []);

  function clearActive() {
    Object.values(edgesRef.current).forEach((e) =>
      e.el.classList.remove("active", "flow", "call", "data", "flow-reverse"),
    );
    Object.values(nodeElsRef.current).forEach((g) =>
      g.classList.remove("active", "working", "db-ingesting"),
    );
    if (pulseRef.current) pulseRef.current.setAttribute("opacity", "0");
    allArrowsRef.current.forEach((a) => a.classList.remove("blink"));
    clearBubbles();
    if (pgConsoleFORef.current) {
      pgConsoleFORef.current.style.display = "none";
      const innerConsole =
        pgConsoleFORef.current.querySelector(".transfer-modal");
      if (innerConsole) innerConsole.classList.remove("show");
    }
    if (dbParticlesGroupRef.current) dbParticlesGroupRef.current.innerHTML = "";
  }

  function clearBubbles() {
    while (bubbleElsRef.current.length > 0) {
      const fo = bubbleElsRef.current.pop();
      if (fo && bubbleLayerRef.current) bubbleLayerRef.current.removeChild(fo);
    }
  }

  function addBubble(nodeId, text) {
    const n = NODES[nodeId];
    if (!n || !bubbleLayerRef.current) return;

    const top = n.y < STAGE_H / 2;
    const W = 200;
    const foH = top ? 95 : 85;
    let bx = n.x + NW / 2 - W / 2;
    bx = Math.max(8, Math.min(bx, STAGE_W - W - 8));
    const by = top ? n.y - 101 : n.y + NH + 4;

    const fo = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "foreignObject",
    );
    fo.setAttribute("x", String(bx));
    fo.setAttribute("y", String(by));
    fo.setAttribute("width", String(W));
    fo.setAttribute("height", String(foH));

    const wrap = document.createElement("div");
    wrap.className = "bubble-wrap " + (top ? "above" : "below");
    const b = document.createElement("div");
    b.className = "bubble " + (top ? "tail-down" : "tail-up");
    const who = document.createElement("span");
    who.className = "bubble-who";
    who.textContent = NODES[nodeId].title;
    b.appendChild(who);
    b.appendChild(document.createTextNode(text));
    wrap.appendChild(b);
    fo.appendChild(wrap);

    bubbleLayerRef.current.appendChild(fo);
    bubbleElsRef.current.push(fo);
  }

  function blinkArrow(edge, destId) {
    const a = edge.arrows[destId];
    if (!a) return;
    a.classList.remove("blink");
    void a.getBBox();
    a.classList.add("blink");
  }

  function travelBall(edge, srcId, dstId, kind, travelMs) {
    return new Promise((res) => {
      const forward = edge.from === srcId;
      edge.el.classList.remove("call", "data", "flow-reverse");
      edge.el.classList.add(kind);
      if (!forward) edge.el.classList.add("flow-reverse");
      if (pulseRef.current) {
        pulseRef.current.setAttribute(
          "class",
          "pulse " + (kind === "data" ? "data" : "call"),
        );
        pulseRef.current.setAttribute("opacity", "1");
      }
      const t0 = performance.now();
      const tick = (now) => {
        let p = (now - t0) / travelMs;
        if (p > 1) p = 1;
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const t = forward ? eased : 1 - eased;
        const pt = edge.el.getPointAtLength(edge.len * t);
        if (pulseRef.current) {
          pulseRef.current.setAttribute("cx", String(pt.x));
          pulseRef.current.setAttribute("cy", String(pt.y));
        }
        if (p >= 1) res();
        else animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
    });
  }

  function waitMs(ms) {
    return new Promise((res) => {
      const t0 = performance.now();
      const tick = (now) => {
        if (now - t0 >= ms) res();
        else animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
    });
  }

  function addLog(i) {
    if (!logRef.current) return;
    const s = STEPS[i];
    logRef.current
      .querySelectorAll(".log-item.cur")
      .forEach((n) => n.classList.remove("cur"));
    const item = document.createElement("div");
    item.className = "log-item cur " + s.k;
    item.innerHTML = `
      <div class="log-num">${i + 1}</div>
      <div class="log-body">
        <span class="log-route">${s.route}</span>
        ${s.m}
      </div>
    `;
    item.title = "Jump to this step";
    item.addEventListener("click", () => jumpTo(i));
    logRef.current.appendChild(item);
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }

  function markDone(id) {
    const node = nodeElsRef.current[id];
    if (node) node.classList.add("done");
  }

  function triggerDbIngestAnimation(currentSpeed) {
    return new Promise((resolveAnimation) => {
      const dbNode = nodeElsRef.current[DB_INGEST_TO];
      if (dbNode) dbNode.classList.add("db-ingesting");

      if (pgConsoleFORef.current) {
        pgConsoleFORef.current.style.display = "block";
        pgConsoleFORef.current.getBoundingClientRect();
        const innerConsole =
          pgConsoleFORef.current.querySelector(".transfer-modal");
        if (innerConsole) innerConsole.classList.add("show");
      }

      const pctEl = document.getElementById("transferPct");
      const barEl = document.getElementById("transferProgressBar");
      const filesEl = document.getElementById("transferFiles");
      const rateEl = document.getElementById("transferRate");
      const timeLeftEl = document.getElementById("transferTimeLeft");
      const localLogEl = document.getElementById("transferLog");
      if (localLogEl) localLogEl.innerHTML = "";

      const files = DB_INGEST_FILES;
      const totalDuration = 15000 / currentSpeed;
      const startTime = performance.now();
      let lastFileIdx = -1;
      let lastRateUpdate = 0;
      const transferActive = true;

      function addConsoleLog(text, type = "normal") {
        if (!localLogEl) return;
        const line = document.createElement("div");
        line.className = "log-line " + type;
        line.textContent = text;
        localLogEl.appendChild(line);
        localLogEl.scrollTop = localLogEl.scrollHeight;
      }

      addConsoleLog("Opening transaction...", "active");

      const progressTick = (now) => {
        if (!transferActive) return;
        const elapsed = now - startTime;
        const pct = Math.min(100, (elapsed / totalDuration) * 100);

        if (pctEl) pctEl.textContent = Math.round(pct) + "%";
        if (barEl) barEl.style.width = pct + "%";

        const secondsLeft = Math.max(
          0,
          Math.ceil((totalDuration - elapsed) / 1000),
        );
        if (timeLeftEl) timeLeftEl.textContent = secondsLeft + "s";

        if (now - lastRateUpdate > 1200) {
          lastRateUpdate = now;
          const rate = (30 + Math.random() * 25).toFixed(1);
          if (rateEl) rateEl.textContent = rate + " KB/s";
        }

        const step = 100 / files.length;
        const fileIdx = Math.floor(pct / step);
        if (fileIdx > lastFileIdx && fileIdx < files.length) {
          lastFileIdx = fileIdx;
          const f = files[fileIdx];
          if (filesEl) filesEl.textContent = `${fileIdx + 1} / ${files.length}`;
          addConsoleLog(
            `[${Math.round(pct)}%] Writing ${f.name} (${f.size})...`,
            "active",
          );
          if (localLogEl) {
            const lines = localLogEl.querySelectorAll(".log-line");
            if (lines.length > 1) {
              const prevLine = lines[lines.length - 2];
              prevLine.className = "log-line success";
              prevLine.textContent = "✓ " + prevLine.textContent.substring(4);
            }
          }
        }

        if (pct < 100) {
          animRef.current = requestAnimationFrame(progressTick);
        } else {
          if (filesEl)
            filesEl.textContent = `${files.length} / ${files.length}`;
          if (timeLeftEl) timeLeftEl.textContent = "0s";
          if (localLogEl) {
            const lines = localLogEl.querySelectorAll(".log-line");
            if (lines.length > 0) {
              const last = lines[lines.length - 1];
              last.className = "log-line success";
              if (last.textContent.startsWith("["))
                last.textContent = "✓ " + last.textContent.substring(6);
            }
          }
          addConsoleLog("✓ COMMIT — transaction closed.", "success");
          addConsoleLog("Saved. Next run will be smarter.", "finish");
          setTimeout(() => {
            if (dbNode) dbNode.classList.remove("db-ingesting");
            resolveAnimation();
          }, 1000);
        }
      };
      animRef.current = requestAnimationFrame(progressTick);

      if (dbParticlesGroupRef.current) {
        dbParticlesGroupRef.current.innerHTML = "";
        const { startX, startY, endX, endY } = DB_INGEST_PARTICLE_PATH;
        const spawnInterval = 500 / currentSpeed;
        let spawnedCount = 0;
        const maxSpawns = Math.floor(totalDuration / spawnInterval) - 2;
        const fileEmojis = ["📄", "📝", "📊", "📁", "⚡", "🗃️"];

        const spawnFileIcon = () => {
          if (
            spawnedCount >= maxSpawns ||
            !transferActive ||
            !dbParticlesGroupRef.current
          )
            return;
          spawnedCount++;
          const emoji =
            fileEmojis[Math.floor(Math.random() * fileEmojis.length)];
          const p = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
          );
          p.setAttribute("x", String(startX));
          p.setAttribute("y", String(startY));
          p.setAttribute("font-size", "13px");
          p.setAttribute("text-anchor", "middle");
          p.setAttribute("dominant-baseline", "middle");
          p.setAttribute("opacity", "0.9");
          p.setAttribute(
            "style",
            `cursor: default; user-select: none; font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji';`,
          );
          p.textContent = emoji;
          dbParticlesGroupRef.current.appendChild(p);

          const iconStartTime = performance.now();
          const duration = (900 + Math.random() * 400) / currentSpeed;
          const offsetX = (Math.random() - 0.5) * 30;
          const offsetY = -25 - Math.random() * 45;

          const animateIcon = (now) => {
            const elapsed = now - iconStartTime;
            const pct = Math.min(1, elapsed / duration);
            const eased =
              pct < 0.5
                ? 4 * pct * pct * pct
                : 1 - Math.pow(-2 * pct + 2, 3) / 2;
            const cx =
              startX +
              (endX - startX) * eased +
              offsetX * Math.sin(pct * Math.PI);
            const cy =
              startY +
              (endY - startY) * eased +
              offsetY * Math.sin(pct * Math.PI);
            const rotation = eased * 360;
            p.setAttribute("x", String(cx));
            p.setAttribute("y", String(cy));
            p.setAttribute("transform", `rotate(${rotation}, ${cx}, ${cy})`);
            p.setAttribute("opacity", String(1 - eased));
            if (pct < 1) requestAnimationFrame(animateIcon);
            else p.remove();
          };
          requestAnimationFrame(animateIcon);
          setTimeout(spawnFileIcon, spawnInterval);
        };
        spawnFileIcon();
      }
    });
  }

  function runStep(i) {
    return new Promise((resolve) => {
      const s = STEPS[i];
      clearActive();
      setPhaseText(PHASES[s.ph]);
      setProgress(i);
      addLog(i);

      const currentSpeed = speedRef.current;
      let dur = BASE / currentSpeed;
      const V = 0.125 * currentSpeed;

      const chat = s.chat || [];
      const shownChat = new Array(chat.length).fill(false);
      const revealChat = (elapsed) => {
        for (let c = 0; c < chat.length; c++) {
          if (shownChat[c]) continue;
          const at = dur * Math.min(0.5, c * 0.42);
          if (elapsed >= at) {
            shownChat[c] = true;
            addBubble(chat[c][0], chat[c][1]);
          }
        }
      };

      if (s.f === s.t) {
        dur = 1600 / currentSpeed;
        const activeNode = nodeElsRef.current[s.f];
        if (activeNode) activeNode.classList.add("active", "working");
        const t0 = performance.now();
        const tick = (now) => {
          revealChat(now - t0);
          if (now - t0 >= dur) {
            if (activeNode) activeNode.classList.remove("working");
            markDone(s.f);
            resolve();
          } else {
            animRef.current = requestAnimationFrame(tick);
          }
        };
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      if (s.roundTrip) {
        const rtEdge = edgesRef.current[pairKey(s.f, s.t)];
        const asker = s.t;
        const responder = s.f;
        rtEdge.el.classList.remove("call", "data");
        rtEdge.el.classList.add("active", "flow", "call");
        const askerNode = nodeElsRef.current[asker];
        const responderNode = nodeElsRef.current[responder];
        if (askerNode) askerNode.classList.add("active");
        if (responderNode) responderNode.classList.add("active");

        const leg = rtEdge.len / V;
        (async () => {
          if (chat[0]) addBubble(chat[0][0], chat[0][1]);
          await travelBall(rtEdge, asker, responder, "call", leg);
          blinkArrow(rtEdge, responder);
          await waitMs(200 / currentSpeed);
          if (chat[1]) addBubble(chat[1][0], chat[1][1]);
          await travelBall(rtEdge, responder, asker, "data", leg);
          blinkArrow(rtEdge, asker);
          await waitMs(300 / currentSpeed);
          markDone(asker);
          markDone(responder);
          resolve();
        })();
        return;
      }

      const edge = edgesRef.current[pairKey(s.f, s.t)];
      const forward = edge.from === s.f;
      edge.el.classList.remove("call", "data", "flow-reverse");
      edge.el.classList.add("active", "flow", s.k);
      if (!forward) edge.el.classList.add("flow-reverse");
      const fromNode = nodeElsRef.current[s.f];
      const toNode = nodeElsRef.current[s.t];
      if (fromNode) fromNode.classList.add("active");
      if (toNode) toNode.classList.add("active");

      if (pulseRef.current) {
        pulseRef.current.setAttribute(
          "class",
          "pulse " + (s.k === "data" ? "data" : "call"),
        );
        pulseRef.current.setAttribute("opacity", "1");
      }

      const travel = edge.len / V;
      dur = travel + 600 / currentSpeed;
      const t0 = performance.now();
      let arrived = false;

      const tick = async (now) => {
        revealChat(now - t0);
        let p = (now - t0) / travel;
        if (p > 1) p = 1;
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        const t = forward ? eased : 1 - eased;
        const pt = edge.el.getPointAtLength(edge.len * t);
        if (pulseRef.current) {
          pulseRef.current.setAttribute("cx", String(pt.x));
          pulseRef.current.setAttribute("cy", String(pt.y));
        }

        if (p >= 1 && !arrived) {
          arrived = true;
          blinkArrow(edge, s.t);
          if (DB_INGEST_TO && s.f === DB_INGEST_FROM && s.t === DB_INGEST_TO)
            triggerDbIngestAnimation(currentSpeed);
        }

        const extraWait =
          DB_INGEST_TO && s.f === DB_INGEST_FROM && s.t === DB_INGEST_TO
            ? 15000 / currentSpeed
            : 0;
        if (p >= 1 && now - t0 >= dur + extraWait) {
          markDone(s.f);
          markDone(s.t);
          resolve();
        } else {
          animRef.current = requestAnimationFrame(tick);
        }
      };
      animRef.current = requestAnimationFrame(tick);
    });
  }

  async function advance() {
    if (idxRef.current >= STEPS.length - 1) {
      stopPlay();
      return false;
    }
    idxRef.current++;
    await runStep(idxRef.current);
    if (idxRef.current >= STEPS.length - 1) {
      stopPlay();
      resetAnimation(true, true);
      setPhaseText("Run completed");
      markRunCompleteInLog();
    }
    return true;
  }

  function markRunCompleteInLog() {
    if (!logRef.current) return;
    logRef.current
      .querySelectorAll(".log-item.cur")
      .forEach((n) => n.classList.remove("cur"));
    const item = document.createElement("div");
    item.className = "log-item cur";
    item.innerHTML = `
      <div class="log-num" style="background: #22c55e;">✓</div>
      <div class="log-body">
        <span class="log-route">System</span>
        Run completed
      </div>
    `;
    logRef.current.appendChild(item);
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }

  async function loop() {
    while (playingRef.current) {
      const more = await advance();
      if (!more) break;
    }
  }

  function startPlay() {
    if (idxRef.current >= STEPS.length - 1) resetAnimation(false);
    else if (idxRef.current === -1 && logRef.current)
      logRef.current.innerHTML = "";
    setIsPlaying(true);
    playingRef.current = true;
    loop();
  }

  function stopPlay() {
    setIsPlaying(false);
    playingRef.current = false;
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }

  function resetAnimation(repaint = true, keepLogs = false) {
    stopPlay();
    idxRef.current = -1;
    setProgress(-1);
    clearActive();
    Object.values(nodeElsRef.current).forEach((g) =>
      g.classList.remove("done"),
    );
    if (!keepLogs && logRef.current) logRef.current.innerHTML = "";
    if (repaint) setPhaseText("Ready");
  }

  // Jump the demo to the state where step `target` has just completed:
  // done-marks and the activity log are rebuilt for steps 0..target, and the
  // target step's nodes, edge and chat are shown statically so the jumped-to
  // moment reads at a glance. target = -1 lands on the pristine "Ready" state.
  // This backs the scrubber, the ⏮ Back button, the clickable activity log,
  // and the inspector's step chips.
  function jumpTo(target) {
    if (ffRef.current) return;
    stopPlay();
    target = Math.max(-1, Math.min(STEPS.length - 1, target));
    idxRef.current = target;
    setProgress(target);
    clearActive();
    Object.values(nodeElsRef.current).forEach((g) =>
      g.classList.remove("done"),
    );
    if (logRef.current) logRef.current.innerHTML = "";
    for (let i = 0; i <= target; i++) {
      markDone(STEPS[i].f);
      markDone(STEPS[i].t);
      addLog(i);
    }
    if (target < 0) {
      setPhaseText("Ready");
      return;
    }
    const s = STEPS[target];
    setPhaseText(PHASES[s.ph]);
    const fromNode = nodeElsRef.current[s.f];
    const toNode = nodeElsRef.current[s.t];
    if (fromNode) fromNode.classList.add("active");
    if (toNode) toNode.classList.add("active");
    if (s.f !== s.t) {
      const edge = edgesRef.current[pairKey(s.f, s.t)];
      if (edge)
        edge.el.classList.add("active", s.k === "data" ? "data" : "call");
    }
    (s.chat || []).forEach((c) => addBubble(c[0], c[1]));
  }

  function scrubToEvent(e) {
    const track = scrubTrackRef.current;
    if (!track) return;
    const r = track.getBoundingClientRect();
    let frac = (e.clientX - r.left) / r.width;
    frac = Math.max(0, Math.min(0.999, frac));
    const i = Math.floor(frac * STEPS.length);
    if (i !== idxRef.current) jumpTo(i);
  }

  // Advance exactly ONE step, animated at the current speed. The step's final
  // state (active edge, chat bubbles) stays on screen afterwards so the user
  // can read what just happened before stepping again.
  async function handleStep() {
    if (playingRef.current || ffRef.current) return;
    if (idxRef.current >= STEPS.length - 1) return;
    setIsDoneDisabled(true);
    ffRef.current = true;
    await advance();
    ffRef.current = false;
    setIsDoneDisabled(false);
  }

  function adjustSpeed(amount) {
    let nextSpeed = speed + amount;
    nextSpeed = parseFloat(nextSpeed.toFixed(1));
    if (nextSpeed >= 0.1 && nextSpeed <= 3.0) setSpeed(nextSpeed);
  }

  return (
    <div
      ref={containerRef}
      className={`archflow-container ${theme === "light" ? "light" : ""}`}
    >
      <header>
        <div>
          <h1>{TITLE}</h1>
          <p>{SUBTITLE}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
          >
            {theme === "dark" ? "☀ Light" : "🌙 Dark"}
          </button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? "🗗 Exit" : "⛶ Fullscreen"}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <button
          onClick={() => (isPlaying ? stopPlay() : startPlay())}
          className={!isPlaying ? "primary" : ""}
          disabled={isDoneDisabled}
        >
          {isPlaying
            ? "⏸ Pause"
            : progress >= STEPS.length - 1
              ? "▶ Replay"
              : "▶ Play"}
        </button>
        <button
          onClick={() => jumpTo(idxRef.current - 1)}
          disabled={isPlaying || isDoneDisabled || progress < 0}
          title="Back one step"
        >
          ⏮ Back
        </button>
        <button onClick={handleStep} disabled={isPlaying || isDoneDisabled}>
          ⏭ Step
        </button>
        <button onClick={() => resetAnimation(true)} disabled={isDoneDisabled}>
          ↻ Restart
        </button>
        <span className="speed">
          Speed
          <button
            onClick={() => adjustSpeed(-0.1)}
            className="speed-btn"
            disabled={isDoneDisabled}
          >
            −
          </button>
          <span id="speedVal">{speed.toFixed(1)}×</span>
          <button
            onClick={() => adjustSpeed(0.1)}
            className="speed-btn"
            disabled={isDoneDisabled}
          >
            +
          </button>
        </span>
        <span className="spacer"></span>
        <span className="phase-tag">{phaseText}</span>
      </div>

      <div className="scrubber">
        <span className="scrub-count">
          {progress + 1} / {STEPS.length}
        </span>
        <div
          ref={scrubTrackRef}
          className="scrub-track"
          title="Drag or click to jump to any step"
          onPointerDown={(e) => {
            if (isDoneDisabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            scrubToEvent(e);
          }}
          onPointerMove={(e) => {
            if (isDoneDisabled || e.buttons !== 1) return;
            scrubToEvent(e);
          }}
        >
          {STEPS.map((s, i) => (
            <div
              key={i}
              className={
                "scrub-seg" +
                (i <= progress ? " filled" : "") +
                (i > 0 && STEPS[i - 1].ph !== s.ph ? " phase-start" : "")
              }
            />
          ))}
        </div>
      </div>

      <div className="wrap">
        <div className="stage-area">
          <svg
            ref={stageRef}
            className="stage"
            viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label={TITLE}
          ></svg>
        </div>
        <aside className="side">
          {inspected && NODES[inspected] && (
            <div className="inspector">
              <div className="inspector-head">
                <span
                  className="inspector-icon"
                  style={{ background: NODES[inspected].color }}
                >
                  {NODES[inspected].icon}
                </span>
                <div className="inspector-name">
                  <div className="inspector-title">
                    {NODES[inspected].title}
                  </div>
                  <div className="inspector-sub">{NODES[inspected].sub}</div>
                </div>
                <button
                  className="inspector-close"
                  onClick={() => setInspected(null)}
                  title="Close inspector"
                >
                  ✕
                </button>
              </div>
              {NODES[inspected].external && (
                <span className="inspector-badge">
                  External system — depended on, not owned
                </span>
              )}
              {NODES[inspected].desc && (
                <p className="inspector-desc">{NODES[inspected].desc}</p>
              )}
              <div className="inspector-section">Connections</div>
              <ul className="inspector-routes">
                {nodeInfo(inspected).routes.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <div className="inspector-section">Appears in steps</div>
              <div className="inspector-steps">
                {nodeInfo(inspected).stepIdxs.map((i) => (
                  <button
                    key={i}
                    className="inspector-step-chip"
                    onClick={() => jumpTo(i)}
                    title={STEPS[i].m}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
          <h2>Activity log</h2>
          <div ref={logRef} className="log"></div>
        </aside>
      </div>

      <footer>
        <div className="legend">
          <span>
            <i className="dot" style={{ background: "var(--accent)" }}></i>{" "}
            control / hand-off
          </span>
          <span>
            <i className="dot" style={{ background: "#0ea5a4" }}></i> data
            returned
          </span>
          <span>
            <i className="dot" style={{ background: "#f59e0b" }}></i> working
          </span>
          <span>
            <i
              className="dot"
              style={{ background: "#374151", border: "1px dashed #94a3b8" }}
            ></i>{" "}
            external system
          </span>
        </div>
        <p style={{ margin: 0 }}>Everything hangs off one table: <b>Test Ease</b> POSTs each user's <b>running daily totals</b> (not per-action events) to <b>POST /reports</b> with a shared <b>X-API-Key</b>, and each report <b>upserts</b> one row per user per day in <b>usage_reports</b>. The dashboard never touches Postgres directly — it logs in for an <b>HMAC-signed 12h token</b> and reads the aggregates through the same FastAPI service, with nginx proxying <b>/api/*</b> in between.</p>
      </footer>
    </div>
  );
}

export default UsageTrackerDemoFlow;
