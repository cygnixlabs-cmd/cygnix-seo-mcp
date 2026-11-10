// White-label PDF reports (Agency tier). pdf-lib is pure JS, so this runs on Workers and Node.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

export interface ReportBranding { agency_name: string; primary_color: string; accent_color: string; footer_text?: string | null; website?: string | null }
const hexRgb = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()) ?? ["", "1F3A5F"]; const n = parseInt(m[1], 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
export const validColor = (h: unknown): h is string => typeof h === "string" && /^#[0-9a-f]{6}$/i.test(h);
/** Standard PDF fonts are WinAnsi only: map common Unicode punctuation and drop the rest. */
export const winAnsi = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...")
  .replace(/[\u2022\u25CF]/g, "-").replace(/\u00A0/g, " ").replace(/\t/g, "  ").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");

export async function renderReportPdf(o: { branding: ReportBranding; title: string; clientName?: string; markdown: string; logo?: { bytes: Uint8Array; type: "png" | "jpg" } | null; date?: Date }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(o.title)); pdf.setAuthor(winAnsi(o.branding.agency_name)); pdf.setProducer(winAnsi(o.branding.agency_name)); pdf.setCreator(winAnsi(o.branding.agency_name));
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), mono = await pdf.embedFont(StandardFonts.Courier);
  let logo: PDFImage | null = null;
  if (o.logo) { try { logo = o.logo.type === "png" ? await pdf.embedPng(o.logo.bytes) : await pdf.embedJpg(o.logo.bytes); } catch { logo = null; } }
  const primary = hexRgb(o.branding.primary_color), accent = hexRgb(o.branding.accent_color), ink = rgb(0.13, 0.13, 0.15), muted = rgb(0.42, 0.42, 0.46);
  const W = 595.28, H = 841.89, M = 50, bodyW = W - 2 * M;
  let page!: PDFPage; let y = 0;
  const header = (first: boolean) => {
    page = pdf.addPage([W, H]);
    const bar = first ? 110 : 40;
    page.drawRectangle({ x: 0, y: H - bar, width: W, height: bar, color: primary });
    page.drawRectangle({ x: 0, y: H - bar - 4, width: W, height: 4, color: accent });
    let tx = M;
    if (logo) { const h = first ? 54 : 24; const s = h / logo.height; page.drawImage(logo, { x: M, y: H - bar / 2 - h / 2, width: logo.width * s, height: h }); tx = M + logo.width * s + 14; }
    if (first) {
      page.drawText(winAnsi(o.title).slice(0, 70), { x: tx, y: H - 52, size: 20, font: bold, color: rgb(1, 1, 1) });
      const sub = [o.clientName ? `Prepared for ${o.clientName}` : "", `by ${o.branding.agency_name}`, (o.date ?? new Date()).toISOString().slice(0, 10)].filter(Boolean).join("  |  ");
      page.drawText(winAnsi(sub).slice(0, 95), { x: tx, y: H - 78, size: 10.5, font, color: rgb(1, 1, 1) });
    } else page.drawText(winAnsi(`${o.branding.agency_name}  |  ${o.title}`).slice(0, 90), { x: tx, y: H - 25, size: 9, font, color: rgb(1, 1, 1) });
    y = H - bar - 34;
  };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = []; let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(t, size) <= width) line = t;
      else { if (line) out.push(line); let w = word; while (f.widthOfTextAtSize(w, size) > width) { let i = w.length; while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--; out.push(w.slice(0, i)); w = w.slice(i); } line = w; }
    }
    if (line) out.push(line); return out.length ? out : [""];
  };
  const ensure = (h: number) => { if (y - h < 60) header(false); };
  const para = (text: string, f = font, size = 10.5, color = ink, indent = 0, gap = 6) => {
    for (const l of wrap(winAnsi(text), f, size, bodyW - indent)) { ensure(size + 4); page.drawText(l, { x: M + indent, y, size, font: f, color }); y -= size + 4; }
    y -= gap;
  };
  header(true);
  const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  let inCode = false;
  for (const raw of o.markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) { ensure(12); page.drawText(winAnsi(line).slice(0, 95), { x: M + 8, y, size: 8.5, font: mono, color: ink }); y -= 11; continue; }
    if (!line.trim()) { y -= 4; continue; }
    if (/^---+$/.test(line.trim())) { ensure(12); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: muted }); y -= 12; continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { const size = h[1].length === 1 ? 16 : h[1].length === 2 ? 13.5 : 11.5; y -= 6; ensure(size + 10); para(clean(h[2]), bold, size, h[1].length === 1 ? primary : ink, 0, 2);
      if (h[1].length <= 2) { page.drawRectangle({ x: M, y: y + 2, width: 36, height: 2, color: accent }); y -= 8; } continue; }
    if (/^\|.*\|$/.test(line.trim())) {
      if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
      const cells = line.trim().slice(1, -1).split("|").map(c => clean(c.trim())); const cw = bodyW / cells.length;
      const wrapped = cells.map(c => wrap(winAnsi(c), font, 9, cw - 6)); const rows = Math.max(...wrapped.map(w => w.length)); ensure(rows * 12 + 4);
      wrapped.forEach((w, ci) => w.forEach((l, li) => page.drawText(l, { x: M + ci * cw + 3, y: y - li * 12, size: 9, font, color: ink })));
      y -= rows * 12; page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.3, color: muted }); y -= 4; continue;
    }
    const li = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (li) { ensure(14); page.drawText(li[1].endsWith(".") ? li[1] : "-", { x: M + 6, y, size: 10.5, font: bold, color: accent }); para(clean(li[2]), font, 10.5, ink, 22, 2); continue; }
    para(clean(line.replace(/^>\s?/, "")), line.startsWith(">") ? font : font, 10.5, line.startsWith(">") ? muted : ink);
  }
  const pages = pdf.getPages(); const foot = winAnsi([o.branding.footer_text || o.branding.agency_name, o.branding.website].filter(Boolean).join("  |  "));
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 42 }, end: { x: W - M, y: 42 }, thickness: 0.5, color: accent });
    p.drawText(foot.slice(0, 100), { x: M, y: 28, size: 8.5, font, color: muted });
    const n = `${i + 1} / ${pages.length}`; p.drawText(n, { x: W - M - font.widthOfTextAtSize(n, 8.5), y: 28, size: 8.5, font, color: muted });
  });
  return pdf.save();
}
export function sniffImage(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return null;
}
