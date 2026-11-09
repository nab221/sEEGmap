import { captureNode } from "./capture";
import { composeFigureWithLegend } from "./legend";
import type { Electrode } from "../../types";

const PNG_SCALE = 3;

/**
 * Export the canvas as a PNG. Pass `legendElectrodes` to draw the electrode legend
 * (name, entry, target) beside the figure in the same image.
 */
export async function exportWorkspacePng(
  node: HTMLElement,
  filename: string,
  legendElectrodes?: Electrode[]
) {
  const figure = await captureNode(node, PNG_SCALE);
  const dataUrl = legendElectrodes
    ? await composeFigureWithLegend(figure, legendElectrodes, PNG_SCALE)
    : figure;
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  link.click();
}
