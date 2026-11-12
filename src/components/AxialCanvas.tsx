import { useCallback, useMemo, useRef } from "react";
import { useStore } from "../store/useStore";
import type { AxialPlacement, AxialViewId, Electrode, Point } from "../types";
import { AXIAL_VIEWS, axialImageUrl, type AxialViewConfig } from "../lib/axialViews";
import {
  contactPositions,
  cycleContact,
  distanceAlongShaft,
  edgePosition,
  effectiveTissue,
  handlePosition,
  nominalSpacingPx,
  normalizeAxial,
  shaftFit,
  translateAxial,
} from "../lib/axial";
import { TISSUE_STYLE } from "../lib/axialStyle";
import type { BrainMask } from "../lib/brainMask";
import { useBrainMask } from "../lib/useBrainMask";

/** Pointer travel (CSS px) below which a press on a contact counts as a click, not a drag. */
const DRAG_THRESHOLD = 4;

/** Class on anything drawn only for editing, left out of exported pictures (see electrodeViewPng). */
export const EDIT_ONLY = "edit-only";

/**
 * Blank margin drawn around the outline (the view's margin, as fractions of the image
 * size), so contacts and labels running past the brain stay on the figure.
 */
function frameOf(view: AxialViewConfig) {
  const mx = Math.round(view.width * view.margin.x);
  const my = Math.round(view.height * view.margin.y);
  return { mx, my, w: view.width + 2 * mx, h: view.height + 2 * my };
}

/** Millimetres on the outline, in that view's native pixels: keeps marks the same size on every view. */
const mmOn = (view: AxialViewConfig) => (v: number) => v / view.mmPerPx;

interface DragState {
  kind: "move" | "rotate" | "edge";
  electrodeId: string;
  start: Point; // client px
  startPlacement: AxialPlacement;
  contactIndex: number | null;
  moved: boolean;
}

/**
 * One outline with every electrode placed on it. Click a contact to cycle its state; drag
 * a contact or the shaft to move it; drag the diamond handle to rotate the shaft about its
 * tip; drag the edge bar to set where the brain edge is.
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
  const mask = useBrainMask(viewId);

  // Drawable placements only: anything normalizeAxial can't repair is treated as not placed.
  const placed = useMemo(
    () =>
      [...electrodes]
        .sort((a, b) => a.order - b.order)
        .flatMap((e) => {
          const placement = e.type !== "grid" ? normalizeAxial(e.axial) : null;
          return placement?.view === viewId ? [{ electrode: e, placement }] : [];
        }),
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
    // Primary button only: a right-click must not change a contact's mark.
    if (e.button !== 0) return;
    const startPlacement = normalizeAxial(electrode.axial);
    if (!startPlacement) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    beginHistoryBatch();
    dragRef.current = {
      kind,
      electrodeId: electrode.id,
      start: { x: e.clientX, y: e.clientY },
      startPlacement,
      contactIndex,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // Button released without a pointerup reaching us (e.g. the window lost focus).
    if (e.buttons === 0) {
      cancelDrag();
      return;
    }
    if (d.kind === "rotate") {
      d.moved = true;
      updateElectrode(d.electrodeId, {
        axial: { ...d.startPlacement, toward: clientToNormalized(e.clientX, e.clientY) },
      });
      return;
    }
    if (d.kind === "edge") {
      d.moved = true;
      const along = distanceAlongShaft(d.startPlacement, view, clientToNormalized(e.clientX, e.clientY));
      updateElectrode(d.electrodeId, {
        axial: { ...d.startPlacement, edgeDist: Math.max(0.25 * nominalSpacingPx(view), along) },
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

  /** End a drag without treating it as a click: lost capture, cancel, or a stray release. */
  const cancelDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
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
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        style={{ display: "block", background: "#fff", touchAction: "none" }}
      >
        <image href={axialImageUrl(viewId)} x={0} y={0} width={view.width} height={view.height} />
        <SideMarkers view={view} />
        {placed.map(({ electrode: e, placement }) => (
          <Shaft
            key={e.id}
            electrode={e}
            placement={placement}
            view={view}
            mask={mask}
            showAllNumbers={showAllNumbers}
            onStart={startDrag}
          />
        ))}
      </svg>
    </div>
  );
}

function SideMarkers({ view }: { view: AxialViewConfig }) {
  const { mx, my } = frameOf(view);
  const mm = mmOn(view);
  const size = mm(7.3);
  const style = { fontSize: size, fontWeight: 700, fill: "#182430", fontFamily: "Helvetica, Arial, sans-serif" };
  const top = -my + mm(2) + size * 0.8;
  if (view.kind === "sagittal") {
    // One letter: whose hemisphere this is.
    return (
      <g style={{ pointerEvents: "none", userSelect: "none" }}>
        <text x={-mx + mm(2)} y={top} {...style}>
          {view.hemisphere}
        </text>
      </g>
    );
  }
  const left = view.patientLeftOnViewerLeft ? "L" : "R";
  const right = view.patientLeftOnViewerLeft ? "R" : "L";
  return (
    <g style={{ pointerEvents: "none", userSelect: "none" }}>
      <text x={-mx + mm(2)} y={mm(6.6)} {...style}>
        {left}
      </text>
      <text x={view.width + mx - mm(2)} y={mm(6.6)} textAnchor="end" {...style}>
        {right}
      </text>
    </g>
  );
}

function Shaft({
  electrode,
  placement,
  view,
  mask,
  showAllNumbers,
  onStart,
}: {
  electrode: Electrode;
  placement: AxialPlacement;
  view: AxialViewConfig;
  mask: BrainMask | null;
  showAllNumbers: boolean;
  onStart: (e: React.PointerEvent, el: Electrode, kind: DragState["kind"], contactIndex: number | null) => void;
}) {
  const mm = mmOn(view);
  const toPx = (p: Point) => ({ x: p.x * view.width, y: p.y * view.height });
  const fit = shaftFit(placement, view, mask);
  const tissue = effectiveTissue(placement);
  const contacts = contactPositions(placement, view, fit).map(toPx);
  const handle = toPx(handlePosition(placement, view, fit));
  const nominal = nominalSpacingPx(view);
  const r = Math.min(0.36 * nominal, 0.45 * fit.innerPx);
  const hitR = 0.5 * Math.min(fit.innerPx, fit.outerPx);
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
  const showEdge = placement.lastInBrain !== undefined && placement.lastInBrain < placement.contacts;
  const edgeN = showEdge ? edgePosition(placement, view, fit) : null;
  const edge = edgeN ? toPx(edgeN) : null;
  const handleR = mm(1.2);

  return (
    <g>
      <line
        x1={tip.x}
        y1={tip.y}
        x2={handle.x}
        y2={handle.y}
        stroke={electrode.color}
        strokeWidth={mm(0.6)}
        strokeLinecap="round"
        style={{ cursor: "grab" }}
        onPointerDown={(e) => onStart(e, electrode, "move", null)}
      />
      {contacts.map((c, i) => {
        const st = TISSUE_STYLE[tissue[i]];
        const k = r * 0.55;
        return (
          <g
            key={i}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => onStart(e, electrode, "move", i)}
          >
            {/* Invisible hit area filling the gap to the neighbouring contacts. */}
            <circle cx={c.x} cy={c.y} r={hitR} fill="transparent" />
            <circle
              cx={c.x}
              cy={c.y}
              r={r}
              fill={st.fill ?? "#ffffff"}
              fillOpacity={st.fill ? 1 : 0.01}
              stroke={st.stroke ?? "none"}
              strokeWidth={st.stroke ? mm(0.3) : 0}
              opacity={st.opacity}
            />
            {st.cross && (
              <path
                d={`M${c.x - k},${c.y - k}L${c.x + k},${c.y + k}M${c.x + k},${c.y - k}L${c.x - k},${c.y + k}`}
                stroke={st.stroke ?? "#8a8a8a"}
                strokeWidth={mm(0.27)}
                opacity={st.opacity}
                style={{ pointerEvents: "none" }}
              />
            )}
            {st.slash && (
              // ⊘: runs a little past the circle so it reads even at small print sizes.
              <path
                d={`M${c.x - r * 0.95},${c.y + r * 0.95}L${c.x + r * 0.95},${c.y - r * 0.95}`}
                stroke={st.stroke ?? "#222222"}
                strokeWidth={mm(0.35)}
                strokeLinecap="round"
                style={{ pointerEvents: "none" }}
              />
            )}
            {(showAllNumbers || i === 0 || i === lastIndex) && (
              <text
                x={c.x + nx * (r + mm(1.5))}
                y={c.y + ny * (r + mm(1.5))}
                fontSize={mm(2.15)}
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
      {edge && (
        <g className={EDIT_ONLY} style={{ cursor: "move" }} onPointerDown={(e) => onStart(e, electrode, "edge", null)}>
          <title>Drag to set where the brain edge is</title>
          {/* Wide invisible grab area, then the visible bar across the shaft. */}
          <line
            x1={edge.x + nx * mm(3)}
            y1={edge.y + ny * mm(3)}
            x2={edge.x - nx * mm(3)}
            y2={edge.y - ny * mm(3)}
            stroke="transparent"
            strokeWidth={mm(2)}
          />
          <line
            x1={edge.x + nx * mm(2.4)}
            y1={edge.y + ny * mm(2.4)}
            x2={edge.x - nx * mm(2.4)}
            y2={edge.y - ny * mm(2.4)}
            stroke={electrode.color}
            strokeWidth={mm(0.5)}
            strokeDasharray={`${mm(0.6)} ${mm(0.4)}`}
          />
        </g>
      )}
      <path
        className={EDIT_ONLY}
        d={`M${handle.x},${handle.y - handleR}L${handle.x + handleR},${handle.y}L${handle.x},${handle.y + handleR}L${handle.x - handleR},${handle.y}Z`}
        fill={electrode.color}
        style={{ cursor: "crosshair" }}
        onPointerDown={(e) => onStart(e, electrode, "rotate", null)}
      >
        <title>Drag to rotate the shaft about its tip</title>
      </path>
      <text
        x={handle.x + ux * mm(2.3)}
        y={handle.y + uy * mm(2.3)}
        fontSize={mm(3.6)}
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
