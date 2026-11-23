import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

export async function capturePng(node: HTMLElement): Promise<string> {
  // Render twice: the first pass warms the image/font cache so the second is complete.
  await toPng(node, { pixelRatio: 1, backgroundColor: "#ffffff" });
  return toPng(node, { pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true });
}

export function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function copyImage(dataUrl: string): Promise<boolean> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function downloadPdf(node: HTMLElement, filename: string) {
  const url = await capturePng(node);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const w = img.width / 2, h = img.height / 2;
  const pdf = new jsPDF({ orientation: w > h ? "landscape" : "portrait", unit: "px", format: [w, h], hotfixes: ["px_scaling"] });
  pdf.addImage(url, "PNG", 0, 0, w, h);
  pdf.save(filename);
}
