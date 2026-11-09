import { useCallback, useRef, useState } from "react";
import { useStore } from "../store/useStore";
import type { Electrode, FreehandSketch, GridElectrode, Point, TextAnnotation } from "../types";
import { REF_W } from "../lib/constants";
import { figureImageUrl } from "../lib/figures";
import { useCanvasHeight } from "../lib/useFigure";
import { darkenHex } from "../lib/color";
import { centroid, clampTranslation } from "../lib/geometry";
import {
  contactRadiusPx,
  cornersToPolygon,
  gridContacts,
  gridCorners,
  gridSizePx,
  localToPixels,
  resizeFromCorner,
  rotationFromPointer,
  rotationHandlePx,
  toPixels,
  type PixelPoint,
} from "../lib/grid";

type DragTarget =
  | {
      kind: "point";
      electrodeId: string;
      field: "entry" | "target" | "lateralStart" | "lateralEnd" | "medialTarget";
    }
  /** Body drag: `grab` is the pointer's offset from the array center, in REF pixels. */
  | { kind: "grid-move"; electrodeId: string; grab: PixelPoint }
  | { kind: "grid-resize"; electrodeId: string; corner: number }
  | { kind: "grid-rotate"; electrodeId: string }
  | { kind: "text-move"; textId: string; grab: PixelPoint };

type SketchDrag = { sketchId: string; startX: number; startY: number; originalPoints: Point[] };

const MIN_POINT_SPACING = 5; // svg units, thins freehand path points

export default function BrainCanvas() {
  const electrodes = useStore((s) => s.electrodes);
  const sketches = useStore((s) => s.sketches);
  const texts = useStore((s) => s.texts);
  const selectedId = useStore((s) => s.selectedId);
  const hoveredId = useStore((s) => s.hoveredId);
  const setSelected = useStore((s) => s.setSelected);
  const setHovered = useStore((s) => s.setHovered);
  const updateElectrode = useStore((s) => s.updateElectrode);
  const beginHistoryBatch = useStore((s) => s.beginHistoryBatch);
  const endHistoryBatch = useStore((s) => s.endHistoryBatch);
  const showNames = useStore((s) => s.showNames);
  const drawMode = useStore((s) => s.drawMode);
  const addSketch = useStore((s) => s.addSketch);
  const selectedSketchId = useStore((s) => s.selectedSketchId);
  const setSelectedSketchId = useStore((s) => s.setSelectedSketchId);
  const updateSketch = useStore((s) => s.updateSketch);
  const sketchDraftColor = useStore((s) => s.sketchDraftColor);
  const textMode = useStore((s) => s.textMode);
  const setTextMode = useStore((s) => s.setTextMode);
  const addText = useStore((s) => s.addText);
  const updateText = useStore((s) => s.updateText);
  const selectedTextId = useStore((s) => s.selectedTextId);
  const setSelectedTextId = useStore((s) => s.setSelectedTextId);
  const figure = useStore((s) => s.figure);
  // Canvas is REF_W wide for every figure; its height follows the active figure's aspect ratio.
  const REF_H = useCanvasHeight();

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragTarget | null>(null);
  const [currentPath, setCurrentPath] = useState<Point[] | null>(null);
  const drawingRef = useRef(false);
  const movedRef = useRef(false);
  const prevSelectedRef = useRef<string | null>(null);
  const sketchDragRef = useRef<SketchDrag | null>(null);
  const sketchMovedRef = useRef(false);
  const prevSelectedSketchRef = useRef<string | null>(null);
  const textMovedRef = useRef(false);
  const prevSelectedTextRef = useRef<string | null>(null);

  // Either placement mode swallows canvas clicks, so existing items aren't grabbed by mistake.
  const placementMode = drawMode || textMode;

  const clientToNormalized = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  /** Pointer position in REF pixel space -- the SVG viewBox coordinate system. */
  const clientToPixels = useCallback(
    (clientX: number, clientY: number): PixelPoint => {
      const n = clientToNormalized(clientX, clientY);
      return { x: n.x * REF_W, y: n.y * REF_H };
    },
    [clientToNormalized, REF_H]
  );

  const onMarkerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const target = dragRef.current;
      if (!target) return;
      movedRef.current = true;

      if (target.kind === "point") {
        const point = clientToNormalized(e.clientX, e.clientY);
        updateElectrode(target.electrodeId, { [target.field]: point } as unknown as Partial<Electrode>);
        return;
      }

      if (target.kind === "text-move") {
        const p = clientToPixels(e.clientX, e.clientY);
        textMovedRef.current = true;
        updateText(target.textId, {
          position: {
            x: Math.min(1, Math.max(0, (p.x - target.grab.x) / REF_W)),
            y: Math.min(1, Math.max(0, (p.y - target.grab.y) / REF_H)),
          },
        });
        return;
      }

      // Grid drags read the live electrode, so resize/rotate always work from current geometry.
      const grid = useStore
        .getState()
        .electrodes.find((el) => el.id === target.electrodeId && el.type === "grid") as GridElectrode | undefined;
      if (!grid) return;
      const p = clientToPixels(e.clientX, e.clientY);

      if (target.kind === "grid-move") {
        updateElectrode(grid.id, {
          center: {
            x: Math.min(1, Math.max(0, (p.x - target.grab.x) / REF_W)),
            y: Math.min(1, Math.max(0, (p.y - target.grab.y) / REF_H)),
          },
        } as Partial<Electrode>);
        return;
      }

      if (target.kind === "grid-resize") {
        // Shift keeps the array's current aspect ratio while resizing.
        updateElectrode(grid.id, resizeFromCorner(grid, target.corner, p, REF_H, e.shiftKey) as Partial<Electrode>);
        return;
      }

      // grid-rotate: Shift snaps to 15-degree increments.
      updateElectrode(grid.id, { rotation: rotationFromPointer(grid, p, REF_H, e.shiftKey) } as Partial<Electrode>);
    },
    [clientToNormalized, clientToPixels, updateElectrode, updateText, REF_H]
  );

  const startDrag = (e: React.PointerEvent, target: DragTarget) => {
    if (placementMode) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    movedRef.current = false;
    dragRef.current = target;
    beginHistoryBatch();
    if (target.kind === "text-move") {
      textMovedRef.current = false;
      prevSelectedTextRef.current = selectedTextId;
      setSelectedTextId(target.textId);
    } else {
      prevSelectedRef.current = selectedId;
      setSelected(target.electrodeId);
    }
  };

  /** Dragging anywhere on the array body (or on a contact) moves the whole array. */
  const startGridBodyDrag = (e: React.PointerEvent, grid: GridElectrode) => {
    const p = clientToPixels(e.clientX, e.clientY);
    const c = toPixels(grid.center, REF_H);
    startDrag(e, { kind: "grid-move", electrodeId: grid.id, grab: { x: p.x - c.x, y: p.y - c.y } });
  };

  const startTextDrag = (e: React.PointerEvent, text: TextAnnotation) => {
    const p = clientToPixels(e.clientX, e.clientY);
    const anchor = toPixels(text.position, REF_H);
    startDrag(e, { kind: "text-move", textId: text.id, grab: { x: p.x - anchor.x, y: p.y - anchor.y } });
  };

  const handleTextClick = (textId: string) => {
    if (placementMode) return;
    if (!textMovedRef.current && prevSelectedTextRef.current === textId) {
      setSelectedTextId(null);
    }
    textMovedRef.current = false;
  };

  const handleTextEdit = (text: TextAnnotation) => {
    if (placementMode) return;
    const next = window.prompt("Edit text", text.content);
    if (next !== null && next.trim()) updateText(text.id, { content: next.trim() });
  };

  const handleElectrodeClick = (electrodeId: string) => {
    // A plain click (no drag movement) on an already-selected electrode toggles it off.
    if (!movedRef.current && prevSelectedRef.current === electrodeId) {
      setSelected(null);
    }
    movedRef.current = false;
  };

  const startSketchDrag = (e: React.PointerEvent, sketch: FreehandSketch) => {
    if (placementMode) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const point = clientToNormalized(e.clientX, e.clientY);
    sketchMovedRef.current = false;
    prevSelectedSketchRef.current = selectedSketchId;
    sketchDragRef.current = {
      sketchId: sketch.id,
      startX: point.x,
      startY: point.y,
      originalPoints: sketch.points,
    };
    beginHistoryBatch();
    setSelectedSketchId(sketch.id);
  };

  const onSketchPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = sketchDragRef.current;
      if (!drag) return;
      const point = clientToNormalized(e.clientX, e.clientY);
      const rawDx = point.x - drag.startX;
      const rawDy = point.y - drag.startY;
      if (Math.abs(rawDx) > 0.001 || Math.abs(rawDy) > 0.001) sketchMovedRef.current = true;
      const { x: dx, y: dy } = clampTranslation(drag.originalPoints, rawDx, rawDy);
      const newPoints = drag.originalPoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      updateSketch(drag.sketchId, { points: newPoints });
    },
    [clientToNormalized, updateSketch]
  );

  const handleSketchClick = (sketchId: string) => {
    if (placementMode) return;
    if (!sketchMovedRef.current && prevSelectedSketchRef.current === sketchId) {
      setSelectedSketchId(null);
    }
    sketchMovedRef.current = false;
  };

  const endDrag = () => {
    if (dragRef.current || sketchDragRef.current) endHistoryBatch();
    dragRef.current = null;
  };

  const onSvgPointerDown = (e: React.PointerEvent) => {
    if (textMode) {
      // One click places one label; re-arm from the toolbar to place another.
      addText(clientToNormalized(e.clientX, e.clientY));
      setTextMode(false);
      return;
    }
    if (!drawMode) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const point = clientToNormalized(e.clientX, e.clientY);
    drawingRef.current = true;
    setCurrentPath([point]);
    setSelectedSketchId(null);
  };

  const onSvgPointerMove = (e: React.PointerEvent) => {
    if (dragRef.current) return onMarkerPointerMove(e);
    if (sketchDragRef.current) return onSketchPointerMove(e);
    if (!drawMode || !drawingRef.current) return;
    const point = clientToNormalized(e.clientX, e.clientY);
    setCurrentPath((prev) => {
      if (!prev) return [point];
      const last = prev[prev.length - 1];
      const dx = (last.x - point.x) * REF_W;
      const dy = (last.y - point.y) * REF_H;
      if (Math.sqrt(dx * dx + dy * dy) < MIN_POINT_SPACING) return prev;
      return [...prev, point];
    });
  };

  const onSvgPointerUp = () => {
    endDrag();
    sketchDragRef.current = null;
    if (drawMode && drawingRef.current) {
      drawingRef.current = false;
      setCurrentPath((prev) => {
        if (prev && prev.length >= 3) addSketch(prev);
        return null;
      });
    }
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 980,
        margin: "0 auto",
        aspectRatio: `${REF_W} / ${REF_H}`,
        position: "relative",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${REF_W} ${REF_H}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        onPointerDown={onSvgPointerDown}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onPointerLeave={onSvgPointerUp}
        style={{
          display: "block",
          background: "#fff",
          borderRadius: 14,
          border: "1px solid var(--line)",
          cursor: placementMode ? "crosshair" : "default",
        }}
      >
        <image href={figureImageUrl(figure)} x={0} y={0} width={REF_W} height={REF_H} />

        {/* quadrant labels */}
        <QuadLabel x={REF_W * 0.02} y={REF_H * 0.045} text="Left Lateral" />
        <QuadLabel x={REF_W * 0.98} y={REF_H * 0.045} text="Right Lateral" anchorEnd />
        <QuadLabel x={REF_W * 0.02} y={REF_H * 0.535} text="Left Medial" />
        <QuadLabel x={REF_W * 0.98} y={REF_H * 0.535} text="Right Medial" anchorEnd />

        {/* freehand sketches (semi-transparent regions), drawn above the template, below markers */}
        <g style={{ pointerEvents: placementMode ? "none" : "auto" }}>
          {sketches.map((sk) => (
            <SketchShape
              key={sk.id}
              sketch={sk}
              isSelected={sk.id === selectedSketchId}
              onPointerDown={(e) => startSketchDrag(e, sk)}
              onClick={() => handleSketchClick(sk.id)}
            />
          ))}
        </g>
        {currentPath && currentPath.length > 1 && (
          <polyline
            points={currentPath.map((p) => `${p.x * REF_W},${p.y * REF_H}`).join(" ")}
            fill="none"
            stroke={sketchDraftColor}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        <g style={{ pointerEvents: placementMode ? "none" : "auto" }}>
          {electrodes.map((e) => (
            <ElectrodeMarks
              key={e.id}
              electrode={e}
              isSelected={e.id === selectedId}
              isHighlighted={e.id === hoveredId || e.id === selectedId}
              showNames={showNames}
              onSelect={() => handleElectrodeClick(e.id)}
              onHover={(v) => setHovered(v ? e.id : null)}
              onStartDrag={startDrag}
              onStartGridBodyDrag={startGridBodyDrag}
            />
          ))}
        </g>

        {/* text annotations sit on top so they stay readable and easy to grab */}
        <g style={{ pointerEvents: placementMode ? "none" : "auto" }}>
          {texts.map((t) => (
            <TextMark
              key={t.id}
              text={t}
              isSelected={t.id === selectedTextId}
              onPointerDown={(e) => startTextDrag(e, t)}
              onClick={() => handleTextClick(t.id)}
              onDoubleClick={() => handleTextEdit(t)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function QuadLabel({ x, y, text, anchorEnd }: { x: number; y: number; text: string; anchorEnd?: boolean }) {
  return (
    <text
      x={x}
      y={y}
      fontSize={16}
      fontFamily="Inter, sans-serif"
      fontWeight={600}
      fill="var(--muted, #647480)"
      textAnchor={anchorEnd ? "end" : "start"}
      style={{ userSelect: "none" }}
    >
      {text}
    </text>
  );
}

function SketchShape({
  sketch,
  isSelected,
  onPointerDown,
  onClick,
}: {
  sketch: FreehandSketch;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  const REF_H = useCanvasHeight();
  const pts = sketch.points.map((p) => `${p.x * REF_W},${p.y * REF_H}`).join(" ");
  const c = centroid(sketch.points);
  return (
    <g onPointerDown={onPointerDown} onClick={onClick} style={{ cursor: "grab" }}>
      <polygon
        points={pts}
        fill={sketch.color}
        fillOpacity={sketch.opacity}
        stroke={isSelected ? darkenHex(sketch.color, 0.25) : sketch.color}
        strokeWidth={isSelected ? 3 : 1.5}
        strokeOpacity={0.9}
      />
      <text
        x={c.x * REF_W}
        y={c.y * REF_H}
        fontSize={15}
        fontFamily="IBM Plex Mono, ui-monospace, monospace"
        fontWeight={600}
        fill={darkenHex(sketch.color, 0.35)}
        stroke="#ffffff"
        strokeWidth={3.5}
        paintOrder="stroke"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ userSelect: "none", pointerEvents: "none" }}
      >
        {sketch.label}
      </text>
    </g>
  );
}

function ElectrodeMarks({
  electrode,
  isSelected,
  isHighlighted,
  showNames,
  onSelect,
  onHover,
  onStartDrag,
  onStartGridBodyDrag,
}: {
  electrode: Electrode;
  isSelected: boolean;
  isHighlighted: boolean;
  showNames: boolean;
  onSelect: () => void;
  onHover: (v: boolean) => void;
  onStartDrag: (e: React.PointerEvent, target: DragTarget) => void;
  onStartGridBodyDrag: (e: React.PointerEvent, grid: GridElectrode) => void;
}) {
  const opacity = isHighlighted ? 1 : 0.85;
  const strokeW = isSelected ? 3 : isHighlighted ? 2.2 : 1.5;
  const color = isHighlighted ? darkenHex(electrode.color, 0.22) : electrode.color;
  const dotR = isHighlighted ? 13 : 9;
  const xR = isHighlighted ? 12 : 8; // Adjust these values to change the planner X-marker size.

  if (electrode.type === "grid") {
    return (
      <g opacity={opacity} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onSelect}>
        <GridArray
          grid={electrode}
          color={color}
          isSelected={isSelected}
          strokeW={strokeW}
          showNames={showNames}
          onStartBodyDrag={(e) => onStartGridBodyDrag(e, electrode)}
          onStartResize={(e, corner) => onStartDrag(e, { kind: "grid-resize", electrodeId: electrode.id, corner })}
          onStartRotate={(e) => onStartDrag(e, { kind: "grid-rotate", electrodeId: electrode.id })}
        />
      </g>
    );
  }

  if (electrode.type === "lateral-medial") {
    return (
      <g opacity={opacity} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onSelect}>
        <EntryDot
          point={electrode.entry}
          color={color}
          strokeW={strokeW}
          r={dotR}
          onPointerDown={(e) => onStartDrag(e, { kind: "point", electrodeId: electrode.id, field: "entry" })}
        />
        {electrode.showTarget !== false && (
          <TargetX
            point={electrode.target}
            color={color}
            strokeW={strokeW}
            r={xR}
            onPointerDown={(e) => onStartDrag(e, { kind: "point", electrodeId: electrode.id, field: "target" })}
          />
        )}
        {showNames && (
          <>
            <NameLabel point={electrode.entry} text={electrode.name} color={color} dy={dotR + 16} />
            {electrode.showTarget !== false && (
              <NameLabel point={electrode.target} text={electrode.name} color={color} dy={xR + 16} />
            )}
          </>
        )}
      </g>
    );
  }

  return (
    <g opacity={opacity} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onSelect}>
      <TrajectoryLine a={electrode.lateralStart} b={electrode.lateralEnd} color={color} strokeW={strokeW} />
      <EntryDot
        point={electrode.lateralStart}
        color={color}
        strokeW={strokeW}
        r={dotR}
        onPointerDown={(e) => onStartDrag(e, { kind: "point", electrodeId: electrode.id, field: "lateralStart" })}
      />
      {electrode.showTarget !== false && (
        <TargetX
          point={electrode.lateralEnd}
          color={color}
          strokeW={strokeW}
          r={xR}
          onPointerDown={(e) => onStartDrag(e, { kind: "point", electrodeId: electrode.id, field: "lateralEnd" })}
        />
      )}
      {electrode.medialTarget && electrode.showTarget !== false && (
        <TargetX
          point={electrode.medialTarget}
          color={color}
          strokeW={strokeW}
          r={xR}
          onPointerDown={(e) => onStartDrag(e, { kind: "point", electrodeId: electrode.id, field: "medialTarget" })}
        />
      )}
      {showNames && (
        <>
          <NameLabel point={electrode.lateralStart} text={electrode.name} color={color} dy={-(dotR + 10)} />
          {electrode.medialTarget && electrode.showTarget !== false && (
            <NameLabel point={electrode.medialTarget} text={electrode.name} color={color} dy={xR + 16} />
          )}
        </>
      )}
    </g>
  );
}

/**
 * Grid / strip array: a rotatable rectangle of contacts.
 *
 * Dragging the body (or any contact) moves the array. When selected it also shows four
 * corner handles -- drag to resize, Shift keeps the aspect ratio -- plus a rotation
 * handle above the top edge, where Shift snaps to 15-degree steps.
 */
function GridArray({
  grid,
  color,
  isSelected,
  strokeW,
  showNames,
  onStartBodyDrag,
  onStartResize,
  onStartRotate,
}: {
  grid: GridElectrode;
  color: string;
  isSelected: boolean;
  strokeW: number;
  showNames: boolean;
  onStartBodyDrag: (e: React.PointerEvent) => void;
  onStartResize: (e: React.PointerEvent, corner: number) => void;
  onStartRotate: (e: React.PointerEvent) => void;
}) {
  const REF_H = useCanvasHeight();
  const corners = gridCorners(grid, REF_H);
  const contacts = gridContacts(grid, REF_H);
  const r = contactRadiusPx(grid);
  const { h } = gridSizePx(grid);
  const handle = rotationHandlePx(grid, REF_H);
  const topMid = localToPixels(grid, 0, -h / 2, REF_H);
  const labelPos = localToPixels(grid, 0, -h / 2 - 18, REF_H);
  const handleR = 11;
  const cornerR = 9;

  return (
    <g>
      {/* faint fill so the anatomy underneath stays visible */}
      <polygon
        points={cornersToPolygon(corners)}
        fill={color}
        fillOpacity={isSelected ? 0.16 : 0.1}
        stroke={color}
        strokeWidth={strokeW + 0.8}
        strokeLinejoin="round"
        onPointerDown={onStartBodyDrag}
        style={{ cursor: "grab" }}
      />

      {contacts.map((c) => (
        <g key={c.number} onPointerDown={onStartBodyDrag} style={{ cursor: "grab" }}>
          <circle cx={c.x} cy={c.y} r={r} fill="#ffffff" stroke={color} strokeWidth={Math.max(1.2, r * 0.22)} />
          {grid.contactNumbers && r >= 7 && (
            <text
              x={c.x}
              y={c.y}
              fontSize={r * 1.05}
              fontFamily="IBM Plex Mono, ui-monospace, monospace"
              fontWeight={600}
              fill={darkenHex(color, 0.3)}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ userSelect: "none", pointerEvents: "none" }}
            >
              {c.number}
            </text>
          )}
        </g>
      ))}

      {showNames && (
        <text
          x={labelPos.x}
          y={labelPos.y}
          fontSize={17}
          fontFamily="IBM Plex Mono, ui-monospace, monospace"
          fontWeight={700}
          fill={color}
          stroke="#ffffff"
          strokeWidth={3.5}
          paintOrder="stroke"
          textAnchor="middle"
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {grid.name}
        </text>
      )}

      {isSelected && (
        <>
          <line
            x1={topMid.x}
            y1={topMid.y}
            x2={handle.x}
            y2={handle.y}
            stroke={color}
            strokeWidth={2}
            strokeDasharray="4 3"
            style={{ pointerEvents: "none" }}
          />
          <circle
            cx={handle.x}
            cy={handle.y}
            r={handleR}
            fill="#ffffff"
            stroke={color}
            strokeWidth={3}
            onPointerDown={onStartRotate}
            style={{ cursor: "grab" }}
          >
            <title>Drag to rotate (hold Shift to snap to 15 degrees)</title>
          </circle>
          {corners.map((p, i) => (
            <rect
              key={i}
              x={p.x - cornerR}
              y={p.y - cornerR}
              width={cornerR * 2}
              height={cornerR * 2}
              fill="#ffffff"
              stroke={color}
              strokeWidth={3}
              rx={2}
              onPointerDown={(e) => onStartResize(e, i)}
              style={{ cursor: i % 2 === 0 ? "nwse-resize" : "nesw-resize" }}
            >
              <title>Drag to resize (hold Shift to keep the aspect ratio)</title>
            </rect>
          ))}
        </>
      )}
    </g>
  );
}

/** Free-standing text label: drag to move, double-click to edit. */
function TextMark({
  text,
  isSelected,
  onPointerDown,
  onClick,
  onDoubleClick,
}: {
  text: TextAnnotation;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const REF_H = useCanvasHeight();
  const x = text.position.x * REF_W;
  const y = text.position.y * REF_H;
  const lines = text.content.split("\n");
  const lineHeight = text.fontSize * 1.2;
  // Center the whole block on the anchor point.
  const firstY = y - ((lines.length - 1) * lineHeight) / 2;
  const longest = lines.reduce((n: number, l: string) => Math.max(n, l.length), 1);
  const halfW = (longest * text.fontSize * 0.34) / 2 + 10;
  const halfH = (lines.length * lineHeight) / 2 + 6;

  return (
    <g onPointerDown={onPointerDown} onClick={onClick} onDoubleClick={onDoubleClick} style={{ cursor: "grab" }}>
      {/* invisible hit area, so thin glyphs are still easy to grab */}
      <rect x={x - halfW} y={y - halfH} width={halfW * 2} height={halfH * 2} fill="transparent" />
      {isSelected && (
        <rect
          x={x - halfW}
          y={y - halfH}
          width={halfW * 2}
          height={halfH * 2}
          fill="none"
          stroke={text.color}
          strokeOpacity={0.6}
          strokeWidth={1.5}
          strokeDasharray="6 4"
          rx={6}
          style={{ pointerEvents: "none" }}
        />
      )}
      {lines.map((line: string, i: number) => (
        <text
          key={i}
          x={x}
          y={firstY + i * lineHeight}
          fontSize={text.fontSize}
          fontFamily="Inter, sans-serif"
          fontWeight={text.bold ? 700 : 500}
          fill={text.color}
          stroke="#ffffff"
          strokeWidth={text.fontSize * 0.18}
          paintOrder="stroke"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ userSelect: "none", pointerEvents: "none" }}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function NameLabel({ point, text, color, dy }: { point: Point; text: string; color: string; dy: number }) {
  const REF_H = useCanvasHeight();
  return (
    <text
      x={point.x * REF_W}
      y={point.y * REF_H + dy}
      fontSize={15}
      fontFamily="IBM Plex Mono, ui-monospace, monospace"
      fontWeight={600}
      fill={color}
      stroke="#ffffff"
      strokeWidth={3.5}
      paintOrder="stroke"
      textAnchor="middle"
      style={{ userSelect: "none", pointerEvents: "none" }}
    >
      {text}
    </text>
  );
}

function EntryDot({
  point,
  color,
  strokeW,
  r,
  onPointerDown,
}: {
  point: Point;
  color: string;
  strokeW: number;
  r: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const REF_H = useCanvasHeight();
  return (
    <circle
      cx={point.x * REF_W}
      cy={point.y * REF_H}
      r={r}
      fill={color}
      stroke="#fff"
      strokeWidth={strokeW}
      onPointerDown={onPointerDown}
      style={{ cursor: "grab" }}
    />
  );
}

function TargetX({
  point,
  color,
  strokeW,
  r,
  onPointerDown,
}: {
  point: Point;
  color: string;
  strokeW: number;
  r: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const REF_H = useCanvasHeight();
  const cx = point.x * REF_W;
  const cy = point.y * REF_H;
  const armWidth = strokeW + 4.5; // bold, short arms
  return (
    <g onPointerDown={onPointerDown} style={{ cursor: "grab" }}>
      <circle cx={cx} cy={cy} r={r + 6} fill="transparent" />
      <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke={color} strokeWidth={armWidth} strokeLinecap="round" />
      <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke={color} strokeWidth={armWidth} strokeLinecap="round" />
      <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
      <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

function TrajectoryLine({ a, b, color, strokeW }: { a: Point; b: Point; color: string; strokeW: number }) {
  const REF_H = useCanvasHeight();
  return (
    <line
      x1={a.x * REF_W}
      y1={a.y * REF_H}
      x2={b.x * REF_W}
      y2={b.y * REF_H}
      stroke={color}
      strokeWidth={strokeW}
      strokeDasharray="6 4"
    />
  );
}
