import { useCallback, useMemo, useRef } from "react";
import { useStore } from "../store/useStore";
import type { AxialPlacement, AxialViewId, Electrode, Point } from "../types";
import { AXIAL_VIEWS, axialImageUrl, type AxialViewConfig } from "../lib/axialViews";
import {
  CONTACT_SPACING_MM,
  contactPositions,
  cycleContact,
  handlePosition,
  normalizeAxial,
  translateAxial,
} from "../lib/axial";
import { TISSUE_STYLE } from "../lib/axialStyle";

/** Pointer travel (CSS px) below which a press on a contact counts as a click, not a drag. */
const DRAG_THRESHOLD = 4;

/**
 * Blank margin drawn around the outline (as fractions of the image size), so contacts
 * and labels running past the brain -- the point of the page -- stay on the figure.
 */
const MARGIN_X = 0.2;
const MARGIN_Y = 0.06;

function frameOf(view: AxialViewConfig) {
  const mx = Math.round(view.width * MARGIN_X);
  const my = Math.round(view.height * MARGIN_Y);
  return { mx, my, w: view.width + 2 * mx, h: view.height + 2 * my };
}

interface DragState {
  kind: "move" | "rotate";
  electrodeId: string;
  start: Point; // client px
  startPlacement: AxialPlacement;
  contactIndex: number | null;
  moved: boolean;
}

/**
 * One axial outline (bottom-up or top-down) with every electrode placed on it. Click a
 * contact to cycle its tissue; drag a contact or the shaft to move it; drag the diamond
 * handle to rotate the shaft about its tip.
 */
export default function AxialCanvas({
  viewId,
  showAllNumbers,
}: {
  viewId: AxialViewId;
  showAllNumbers: boolean;
}) {
  const view = AXIAL_VIEWS[viewId];
  const electrodes = useStore((s) => s.electrodes);
  const updateElectrode = useStore((s) => s.updateElectrode);
  const beginHistoryBatch = useStore((s) => s.beginHistoryBatch);
  const endHistoryBatch = useStore((s) => s.endHistoryBatch);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const placed = useMemo(
    () =>
      [...electrodes]
        .filter((e) => e.type !== "grid" && e.axial?.view === viewId)
        .sort((a, b) => a.order - b.order),
    [electrodes, viewId]
  );

  const frame = frameOf(view);

  /** Pointer position, normalized to the outline image (may fall outside 0..1 in the margin). */
  const clientToNormalized = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current!.getBoundingClientRect();
      return {
        x: (((clientX - rect.left) / rect.width) * frame.w - frame.mx) / view.width,
        y: (((clientY - rect.top) / rect.height) * frame.h - frame.my) / view.height,
      };
    },
    [frame.w, frame.h, frame.mx, frame.my, view.width, view.height]
  );

  const startDrag = (
    e: React.PointerEvent,
    electrode: Electrode,
    kind: DragState["kind"],
    contactIndex: number | null
  ) => {
    if (!electrode.axial) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    beginHistoryBatch();
    dragRef.current = {
      kind,
      electrodeId: electrode.id,
      start: { x: e.clientX, y: e.clientY },
      startPlacement: normalizeAxial(electrode.axial),
      contactIndex,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "rotate") {
      d.moved = true;
      updateElectrode(d.electrodeId, {
        axial: { ...d.startPlacement, toward: clientToNormalized(e.clientX, e.clientY) },
      });
      return;
    }
    const dist = Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y);
    if (!d.moved && dist < DRAG_THRESHOLD) return;
    d.moved = true;
    const a = clientToNormalized(d.start.x, d.start.y);
    const b = clientToNormalized(e.clientX, e.clientY);
    updateElectrode(d.electrodeId, {
      axial: translateAxial(d.startPlacement, b.x - a.x, b.y - a.y),
    });
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (!d.moved && d.kind === "move" && d.contactIndex !== null) {
      updateElectrode(d.electrodeId, { axial: cycleContact(d.startPlacement, d.contactIndex) });
    }
    endHistoryBatch();
  };

  return (
    <div style={{ width: "100%", aspectRatio: `${frame.w} / ${frame.h}`, position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`${-frame.mx} ${-frame.my} ${frame.w} ${frame.h}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // The frame keeps each view's L/R markers visibly its own when the two views sit side by side.
        style={{ display: "block", background: "#fff", touchAction: "none", border: "1px solid #cbd3da", borderRadius: 8, boxSizing: "border-box" }}
      >
        <image href={axialImageUrl(viewId)} x={0} y={0} width={view.width} height={view.height} />
        <SideMarkers view={view} />
        {placed.map((e) => (
          <Shaft
            key={e.id}
            electrode={e}
            placement={normalizeAxial(e.axial!)}
            view={view}
            showAllNumbers={showAllNumbers}
            onStart={startDrag}
          />
        ))}
      </svg>
    </div>
  );
}

function SideMarkers({ view }: { view: AxialViewConfig }) {
  const { mx } = frameOf(view);
  const left = view.patientLeftOnViewerLeft ? "L" : "R";
  const right = view.patientLeftOnViewerLeft ? "R" : "L";
  const style = { fontSize: 22, fontWeight: 700, fill: "#182430", fontFamily: "Helvetica, Arial, sans-serif" };
  return (
    <g style={{ pointerEvents: "none", userSelect: "none" }}>
      <text x={-mx + 6} y={20} {...style}>
        {left}
      </text>
      <text x={view.width + mx - 6} y={20} textAnchor="end" {...style}>
        {right}
      </text>
    </g>
  );
}

function Shaft({
  electrode,
  placement,
  view,
  showAllNumbers,
  onStart,
}: {
  electrode: Electrode;
  placement: AxialPlacement;
  view: AxialViewConfig;
  showAllNumbers: boolean;
  onStart: (e: React.PointerEvent, el: Electrode, kind: "move" | "rotate", contactIndex: number | null) => void;
}) {
  const toPx = (p: Point) => ({ x: p.x * view.width, y: p.y * view.height });
  const contacts = contactPositions(placement, view).map(toPx);
  const handle = toPx(handlePosition(placement, view));
  const spacing = CONTACT_SPACING_MM / view.mmPerPx;
  const r = spacing * 0.36;
  const tip = contacts[0];
  const last = contacts[contacts.length - 1];
  // Unit direction along the shaft and its perpendicular, for label offsets.
  const len = Math.hypot(handle.x - last.x, handle.y - last.y) || 1;
  const ux = (handle.x - last.x) / len;
  const uy = (handle.y - last.y) / len;
  const nx = -uy;
  const ny = ux;
  const font = "Helvetica, Arial, sans-serif";
  const lastIndex = contacts.length - 1;

  return (
    <g>
      <line
        x1={tip.x}
        y1={tip.y}
        x2={handle.x}
        y2={handle.y}
        stroke={electrode.color}
        strokeWidth={1.8}
        strokeLinecap="round"
        style={{ cursor: "grab" }}
        onPointerDown={(e) => onStart(e, electrode, "move", null)}
      />
      {contacts.map((c, i) => {
        const st = TISSUE_STYLE[placement.tissue[i]];
        return (
          <g
            key={i}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => onStart(e, electrode, "move", i)}
          >
            {/* Invisible hit area filling the gap to the neighbouring contacts. */}
            <circle cx={c.x} cy={c.y} r={spacing * 0.5} fill="transparent" />
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill={st.fill ?? "#ffffff"}
              fillOpacity={st.fill ? 1 : 0.01}
              stroke={st.stroke ?? "none"}
              strokeWidth={st.stroke ? 0.9 : 0}
              opacity={st.opacity}
            />
            {st.cross && (
              <path
                d={`M${c.x - r * 0.55},${c.y - r * 0.55}L${c.x + r * 0.55},${c.y + r * 0.55}M${c.x + r * 0.55},${c.y - r * 0.55}L${c.x - r * 0.55},${c.y + r * 0.55}`}
                stroke={st.stroke ?? "#8a8a8a"}
                strokeWidth={0.8}
                opacity={st.opacity}
                style={{ pointerEvents: "none" }}
              />
            )}
            {(showAllNumbers || i === 0 || i === lastIndex) && (
              <text
                x={c.x + nx * (r + 4.5)}
                y={c.y + ny * (r + 4.5)}
                fontSize={6.5}
                fontFamily={font}
                fill="#182430"
                textAnchor="middle"
                dominantBaseline="central"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
      <path
        d={`M${handle.x},${handle.y - 3.6}L${handle.x + 3.6},${handle.y}L${handle.x},${handle.y + 3.6}L${handle.x - 3.6},${handle.y}Z`}
        fill={electrode.color}
        style={{ cursor: "crosshair" }}
        onPointerDown={(e) => onStart(e, electrode, "rotate", null)}
      >
        <title>Drag to rotate the shaft about its tip</title>
      </path>
      <text
        x={handle.x + ux * 7}
        y={handle.y + uy * 7}
        fontSize={11}
        fontWeight={700}
        fontFamily={font}
        fill={electrode.color}
        textAnchor={ux < -0.3 ? "end" : ux > 0.3 ? "start" : "middle"}
        dominantBaseline="central"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {electrode.name}
      </text>
    </g>
  );
}
