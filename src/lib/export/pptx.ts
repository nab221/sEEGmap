import PptxGenJS from "pptxgenjs";
import { cropHalf, fetchImageAsDataUrl, getImageSize, rasterizeSketches } from "./capture";
import { REF_W } from "../constants";
import { FIGURES, canvasHeight } from "../figures";
import { stripHash } from "../color";
import { electrodeLetter } from "../nomenclature";
import { centroid } from "../geometry";
import { contactRadiusPx, gridContacts, gridCorners, gridSizePx, localToPixels } from "../grid";
import type { Electrode, FigureId, FreehandSketch, GridElectrode, Point, TextAnnotation } from "../../types";

interface PptxOptions {
  /** Which brain figure the plan is drawn on -- picks the background image and canvas aspect. */
  figure: FigureId;
  electrodes: Electrode[];
  sketches: FreehandSketch[];
  texts: TextAnnotation[];
  patientLabel: string;
  planNotes: string;
  institution?: string;
  showNames: boolean;
  filename: string;
}

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const DIAGRAM_TOP = 1.3;
const DIAGRAM_MAX_W = 12.3;
const DIAGRAM_MAX_H = 6.0;
const DOT_R = 0.055; // inches
const X_R = 0.075; // Change this value to adjust the PowerPoint X-marker size (in inches).

type SlideRect = { x: number; y: number; w: number; h: number };

function fitRect(aspect: number): SlideRect {
  let w = DIAGRAM_MAX_W;
  let h = w / aspect;
  if (h > DIAGRAM_MAX_H) {
    h = DIAGRAM_MAX_H;
    w = h * aspect;
  }
  return { x: (SLIDE_W - w) / 2, y: DIAGRAM_TOP, w, h };
}

// Fits an image into `box`, preserving aspect ratio and maximizing height first
// (rather than width first, as fitRect() does) -- used for the overview slide so
// the figure uses the full available slide height whenever the aspect ratio allows,
// only shrinking to the box width if the image is too wide to fit at full height.
function fitRectToHeight(aspect: number, box: SlideRect): SlideRect {
  let h = box.h;
  let w = h * aspect;
  if (w > box.w) {
    w = box.w;
    h = w / aspect;
  }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function sideOfElectrode(e: Electrode): "L" | "R" {
  const n = e.name.trim().toUpperCase();
  if (n.startsWith("L")) return "L";
  if (n.startsWith("R")) return "R";
  const nx =
    e.type === "lateral-medial"
      ? (e.entry.x + e.target.x) / 2
      : e.type === "grid"
        ? e.center.x
        : (e.lateralStart.x + e.lateralEnd.x) / 2;
  return nx < 0.5 ? "L" : "R";
}

export async function exportWorkspacePptx({
  figure,
  electrodes,
  sketches,
  texts,
  patientLabel,
  planNotes,
  institution,
  showNames,
  filename,
}: PptxOptions) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "SEEGMAP_16x9", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "SEEGMAP_16x9";

  const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL;
  // Canvas space (REF_W x REF_H) is what marker/label sizes and grid geometry are measured in.
  const REF_H = canvasHeight(figure);
  const bgFull = await fetchImageAsDataUrl(`${base}${FIGURES[figure].imageFile}`);
  const bgLeft = await cropHalf(bgFull, "left");
  const bgRight = await cropHalf(bgFull, "right");
  const fullSize = await getImageSize(bgFull);

  // Rasterized at the image's own pixel size so the sketch fills stay as sharp as the background.
  const sketchOverlayFull = rasterizeSketches(sketches, fullSize.width, fullSize.height);
  const sketchOverlayLeft = sketchOverlayFull ? await cropHalf(sketchOverlayFull, "left") : null;
  const sketchOverlayRight = sketchOverlayFull ? await cropHalf(sketchOverlayFull, "right") : null;

  const titleColor = "2F6F6B";
  const mutedColor = "647480";

  function addTitleSlide(title: string) {
    const slide = pptx.addSlide();
    slide.addText(title, { x: 0.5, y: 0.3, fontSize: 22, bold: true, color: titleColor, fontFace: "Arial" });
    if (patientLabel || institution) {
      slide.addText([patientLabel, institution].filter(Boolean).join("   ·   "), {
        x: 0.5,
        y: 0.85,
        fontSize: 11,
        color: mutedColor,
        fontFace: "Arial",
      });
    }
    return slide;
  }

  function addDot(slide: PptxGenJS.Slide, pt: { x: number; y: number }, colorHex: string) {
    slide.addShape("ellipse", {
      x: pt.x - DOT_R,
      y: pt.y - DOT_R,
      w: DOT_R * 2,
      h: DOT_R * 2,
      fill: { color: stripHash(colorHex) },
      line: { color: "FFFFFF", width: 1 },
    });
  }

  function addTargetX(slide: PptxGenJS.Slide, pt: { x: number; y: number }, colorHex: string) {
    slide.addShape("mathMultiply", {
      x: pt.x - X_R,
      y: pt.y - X_R,
      w: X_R * 2,
      h: X_R * 2,
      fill: { color: stripHash(colorHex) },
      line: { type: "none" },
    });
  }

  /** Straight segment between two slide points; used for grid outlines and trajectories. */
  function addSegment(
    slide: PptxGenJS.Slide,
    a: { x: number; y: number },
    b: { x: number; y: number },
    colorHex: string,
    widthPt: number,
    dashed = false
  ) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.max(Math.abs(b.x - a.x), 0.005);
    const h = Math.max(Math.abs(b.y - a.y), 0.005);
    const topLeftToBottomRight = (a.x <= b.x) === (a.y <= b.y);
    slide.addShape("line", {
      x,
      y,
      w,
      h,
      line: dashed
        ? { color: stripHash(colorHex), width: widthPt, dashType: "dash" }
        : { color: stripHash(colorHex), width: widthPt },
      flipV: !topLeftToBottomRight,
    });
  }

  /**
   * Grid / strip array: outline plus one small circle per contact. `pxScale` converts
   * REF pixels to slide inches, so contacts keep their on-canvas size.
   */
  function addGridArray(
    slide: PptxGenJS.Slide,
    grid: GridElectrode,
    toSlide: (p: Point) => { x: number; y: number },
    pxScale: number
  ) {
    const px = (p: { x: number; y: number }) => toSlide({ x: p.x / REF_W, y: p.y / REF_H });
    const corners = gridCorners(grid, REF_H).map(px);
    for (let i = 0; i < corners.length; i++) {
      addSegment(slide, corners[i], corners[(i + 1) % corners.length], grid.color, 1.5);
    }
    const rIn = contactRadiusPx(grid) * pxScale;
    gridContacts(grid, REF_H).forEach((c) => {
      const p = px({ x: c.x, y: c.y });
      slide.addShape("ellipse", {
        x: p.x - rIn,
        y: p.y - rIn,
        w: rIn * 2,
        h: rIn * 2,
        fill: { color: "FFFFFF" },
        line: { color: stripHash(grid.color), width: 1 },
      });
    });
    if (showNames) {
      const { h } = gridSizePx(grid);
      const label = px(localToPixels(grid, 0, -h / 2 - 18, REF_H));
      addNameLabel(slide, label, grid.name, grid.color, false);
    }
  }

  /** Free-standing text labels, sized from their on-canvas font size. */
  function drawTexts(
    slide: PptxGenJS.Slide,
    list: TextAnnotation[],
    toSlide: (p: Point) => { x: number; y: number },
    pxScale: number
  ) {
    list.forEach((t) => {
      const p = toSlide(t.position);
      const fontSize = Math.max(6, t.fontSize * pxScale * 72);
      const lines = t.content.split("\n").length;
      const h = (fontSize / 72) * 1.35 * lines;
      slide.addText(t.content, {
        x: p.x - 2,
        y: p.y - h / 2,
        w: 4,
        h,
        align: "center",
        valign: "middle",
        fontSize,
        bold: t.bold,
        color: stripHash(t.color),
        fontFace: "Arial",
        margin: 0,
      });
    });
  }

  function addTrajectoryLine(slide: PptxGenJS.Slide, a: { x: number; y: number }, b: { x: number; y: number }, colorHex: string) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.max(Math.abs(b.x - a.x), 0.005);
    const h = Math.max(Math.abs(b.y - a.y), 0.005);
    const topLeftToBottomRight = (a.x <= b.x) === (a.y <= b.y);
    slide.addShape("line", {
      x,
      y,
      w,
      h,
      line: { color: stripHash(colorHex), width: 1.5, dashType: "dash" },
      flipV: !topLeftToBottomRight,
    });
  }

  function addNameLabel(slide: PptxGenJS.Slide, pt: { x: number; y: number }, text: string, colorHex: string, below: boolean) {
    const h = 0.22;
    slide.addText(text, {
      x: pt.x - 0.5,
      y: below ? pt.y + 0.1 : pt.y - 0.1 - h,
      w: 1.0,
      h,
      align: "center",
      fontSize: 8,
      bold: true,
      color: stripHash(colorHex),
      fontFace: "Courier New",
      margin: 0,
    });
  }

  function addSketchLabel(slide: PptxGenJS.Slide, pt: { x: number; y: number }, text: string, colorHex: string) {
    const h = 0.24;
    slide.addText(text, {
      x: pt.x - 0.6,
      y: pt.y - h / 2,
      w: 1.2,
      h,
      align: "center",
      fontSize: 9,
      bold: true,
      color: stripHash(colorHex),
      fontFace: "Arial",
      margin: 0,
    });
  }

  function drawElectrodes(
    slide: PptxGenJS.Slide,
    list: Electrode[],
    toSlide: (p: Point) => { x: number; y: number },
    pxScale: number
  ) {
    list.forEach((e) => {
      // Mirror the canvas: the per-electrode "showTarget" toggle hides the X marker
      // (and its name label). Undefined/legacy values are treated as visible.
      const targetVisible = e.showTarget !== false;
      if (e.type === "grid") {
        addGridArray(slide, e, toSlide, pxScale);
      } else if (e.type === "lateral-medial") {
        const entry = toSlide(e.entry);
        const target = toSlide(e.target);
        addDot(slide, entry, e.color);
        if (targetVisible) addTargetX(slide, target, e.color);
        if (showNames) {
          addNameLabel(slide, entry, e.name, e.color, true);
          if (targetVisible) addNameLabel(slide, target, e.name, e.color, true);
        }
      } else {
        const ls = toSlide(e.lateralStart);
        const le = toSlide(e.lateralEnd);
        addTrajectoryLine(slide, ls, le, e.color);
        addDot(slide, ls, e.color);
        if (targetVisible) addTargetX(slide, le, e.color);
        const mt = e.medialTarget && targetVisible ? toSlide(e.medialTarget) : null;
        if (mt) addTargetX(slide, mt, e.color);
        if (showNames) {
          addNameLabel(slide, ls, e.name, e.color, false);
          if (mt) addNameLabel(slide, mt, e.name, e.color, true);
        }
      }
    });
  }

  function drawSketchLabels(slide: PptxGenJS.Slide, list: FreehandSketch[], toSlide: (p: Point) => { x: number; y: number }) {
    list.forEach((sk) => {
      const c = centroid(sk.points);
      addSketchLabel(slide, toSlide(c), sk.label, sk.color);
    });
  }

  function addDiagramSlide(
    title: string,
    bgDataUrl: string,
    sketchOverlay: string | null,
    aspect: number,
    list: Electrode[],
    sketchList: FreehandSketch[],
    textList: TextAnnotation[],
    localMap: (p: Point) => Point
  ) {
    const slide = addTitleSlide(title);
    const rect = fitRect(aspect);
    slide.addImage({ data: bgDataUrl, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    if (sketchOverlay) {
      slide.addImage({ data: sketchOverlay, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }
    const toSlide = (p: Point) => {
      const local = localMap(p);
      return { x: rect.x + local.x * rect.w, y: rect.y + local.y * rect.h };
    };
    // Vertical scale is isotropic for both the full image and the cropped halves.
    const pxScale = rect.h / REF_H;
    drawSketchLabels(slide, sketchList, toSlide);
    drawElectrodes(slide, list, toSlide, pxScale);
    drawTexts(slide, textList, toSlide, pxScale);
    return slide;
  }

  function sketchInHalf(sk: FreehandSketch, half: "L" | "R"): boolean {
    const c = centroid(sk.points);
    return half === "L" ? c.x < 0.5 : c.x >= 0.5;
  }

  // Slide 1: both hemispheres + compact electrode summary on the left.
  const overviewSlide = addTitleSlide("Both Hemispheres");
  const overviewBox: SlideRect = { x: 4.65, y: DIAGRAM_TOP, w: SLIDE_W - 4.65 - 0.5, h: SLIDE_H - DIAGRAM_TOP - 0.35 };
  const overviewRect = fitRectToHeight(fullSize.width / fullSize.height, overviewBox);
  overviewSlide.addImage({
    data: bgFull,
    x: overviewRect.x,
    y: overviewRect.y,
    w: overviewRect.w,
    h: overviewRect.h,
  });
  if (sketchOverlayFull) {
    overviewSlide.addImage({
      data: sketchOverlayFull,
      x: overviewRect.x,
      y: overviewRect.y,
      w: overviewRect.w,
      h: overviewRect.h,
    });
  }
  const overviewToSlide = (p: Point) => ({
    x: overviewRect.x + p.x * overviewRect.w,
    y: overviewRect.y + p.y * overviewRect.h,
  });
  const overviewPxScale = overviewRect.h / REF_H;
  drawSketchLabels(overviewSlide, sketches, overviewToSlide);
  drawElectrodes(overviewSlide, electrodes, overviewToSlide, overviewPxScale);
  drawTexts(overviewSlide, texts, overviewToSlide, overviewPxScale);

  const sorted = [...electrodes].sort((a, b) => a.order - b.order);
  const summaryRows: PptxGenJS.TableRow[] = [
    [
      { text: "ID", options: { bold: true, fill: { color: "DDE7EA" } } },
      { text: "Name", options: { bold: true, fill: { color: "DDE7EA" } } },
      { text: "Entry", options: { bold: true, fill: { color: "DDE7EA" } } },
      { text: "Target", options: { bold: true, fill: { color: "DDE7EA" } } },
    ],
    ...sorted.map((e, i) => {
      const fill = i % 2 === 0 ? "F7F9FA" : "EAF0F2";
      return [
        { text: electrodeLetter(i), options: { fill: { color: fill } } },
        { text: e.name, options: { fill: { color: fill } } },
        { text: e.entryName || "--", options: { fill: { color: fill } } },
        { text: e.targetName || "--", options: { fill: { color: fill } } },
      ];
    }),
  ];
  overviewSlide.addTable(summaryRows, {
    x: 0.45,
    y: 1.3,
    w: 3.85,
    fontSize: 7.5,
    fontFace: "Arial",
    border: { type: "solid", color: "D5DDE1", pt: 0.6 },
    margin: 0.035,
    colW: [0.34, 0.68, 1.35, 1.48],
    autoPage: false,
  });

  // Slide 2: left hemisphere only
  addDiagramSlide(
    "Left Hemisphere",
    bgLeft,
    sketchOverlayLeft,
    fullSize.width / 2 / fullSize.height,
    electrodes.filter((e) => sideOfElectrode(e) === "L"),
    sketches.filter((sk) => sketchInHalf(sk, "L")),
    texts.filter((t) => t.position.x < 0.5),
    (p) => ({ x: Math.min(1, Math.max(0, p.x * 2)), y: p.y })
  );

  // Slide 3: right hemisphere only
  addDiagramSlide(
    "Right Hemisphere",
    bgRight,
    sketchOverlayRight,
    fullSize.width / 2 / fullSize.height,
    electrodes.filter((e) => sideOfElectrode(e) === "R"),
    sketches.filter((sk) => sketchInHalf(sk, "R")),
    texts.filter((t) => t.position.x >= 0.5),
    (p) => ({ x: Math.min(1, Math.max(0, (p.x - 0.5) * 2)), y: p.y })
  );

  // Slide 5: notes
  const notesSlide = addTitleSlide("Notes");
  const withNotes = sorted.filter((e) => e.notes.trim());
  const sketchLines = sketches.length
    ? ["", "Sketched areas:", ...sketches.map((sk) => `${sk.label}`)]
    : [];
  const bodyLines = [
    "Plan notes:",
    planNotes || "(none)",
    "",
    ...(withNotes.length ? ["Per-electrode notes:"] : []),
    ...withNotes.map((e) => `${e.name}: ${e.notes}`),
    ...sketchLines,
  ];
  notesSlide.addText(bodyLines.join("\n"), {
    x: 0.5,
    y: 1.3,
    w: 12.3,
    h: 5.6,
    fontSize: 12,
    fontFace: "Arial",
    valign: "top",
    color: "182430",
  });

  await pptx.writeFile({ fileName: filename.endsWith(".pptx") ? filename : `${filename}.pptx` });
}
