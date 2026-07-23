export type SourceSection = { text: string; page?: number; sheet?: string };
export type ParsedTender = { sections: SourceSection[]; pageCount?: number };

async function ensurePdfDomPolyfills() {
  const globals = globalThis as typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: unknown } };
  if (typeof globalThis.DOMMatrix === "undefined" || typeof globalThis.ImageData === "undefined" || typeof globalThis.Path2D === "undefined") {
    const canvas = await import("@napi-rs/canvas");
    globalThis.DOMMatrix ??= canvas.DOMMatrix as typeof globalThis.DOMMatrix;
    globalThis.ImageData ??= canvas.ImageData as typeof globalThis.ImageData;
    globalThis.Path2D ??= canvas.Path2D as typeof globalThis.Path2D;
  }
  if (!globals.pdfjsWorker?.WorkerMessageHandler) {
    const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    globals.pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
  }
}

export async function extractTenderText(buffer: Buffer, mimeType: string, filename: string): Promise<ParsedTender> {
  const ext = filename.toLowerCase().split(".").pop();
  const isPdf = buffer.subarray(0, 5).toString("ascii") === "%PDF-"; const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  if ((mimeType === "application/pdf" || ext === "pdf") && !isPdf) throw Object.assign(new Error("File content is not a valid PDF"), { statusCode: 415 });
  if (["docx", "xlsx"].includes(ext ?? "") && !isZip) throw Object.assign(new Error("File content is not a valid Office document"), { statusCode: 415 });
  if (["txt", "csv"].includes(ext ?? "") && buffer.includes(0)) throw Object.assign(new Error("Text files cannot contain binary data"), { statusCode: 415 });
  if (mimeType === "application/pdf" || ext === "pdf") {
    await ensurePdfDomPolyfills();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      if (result.total > 2000) throw Object.assign(new Error("PDF exceeds the 2000 page processing limit"), { statusCode: 413 });
      return limitExtractedText({ pageCount: result.total, sections: result.pages.map(p => ({ page: p.num, text: p.text })) });
    } finally { await parser.destroy(); }
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx") {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return limitExtractedText({ sections: [{ text: result.value }] });
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any);
    const sections: SourceSection[] = [];
    workbook.eachSheet(sheet => {
      const rows: string[] = [];
      sheet.eachRow(row => rows.push(row.values instanceof Array ? row.values.slice(1).map(v => typeof v === "object" && v && "text" in v ? (v as any).text : String(v ?? "")).join(" | ") : String(row.values)));
      if (sheet.rowCount > 100_000) throw Object.assign(new Error("Worksheet exceeds the row processing limit"), { statusCode: 413 });
      sections.push({ sheet: sheet.name, text: rows.join("\n") });
    });
    return limitExtractedText({ sections });
  }
  if (["text/plain", "text/csv", "application/csv"].includes(mimeType) || ["txt", "csv"].includes(ext ?? "")) return limitExtractedText({ sections: [{ text: buffer.toString("utf8") }] });
  throw Object.assign(new Error("Supported tender files are PDF, DOCX, XLSX, TXT and CSV"), { statusCode: 415 });
}

function limitExtractedText(parsed: ParsedTender) {
  if (parsed.sections.reduce((sum, section) => sum + section.text.length, 0) > 5_000_000) throw Object.assign(new Error("Extracted document text exceeds the processing limit"), { statusCode: 413 });
  return parsed;
}

const patterns = [
  { category: "SUBMISSION", regex: /\b(submit|submission|lodg(e|ement)|closing|tender return|schedule)\b/i },
  { category: "LICENCE_AND_COMPLIANCE", regex: /\b(licen[cs]e|accredit|prequalif|registration|insurance|workers compensation|public liability|professional indemnity)\b/i },
  { category: "SAFETY", regex: /\b(WHS|safety|SWMS|JSA|incident|environmental management|traffic management)\b/i },
  { category: "TECHNICAL", regex: /\b(specification|drawing|standard|methodology|scope of works|deliverable|hold point|inspection)\b/i },
  { category: "COMMERCIAL", regex: /\b(price|pricing|bill of quantities|schedule of rates|retention|security|liquidated damages|payment terms)\b/i },
  { category: "PROGRAM", regex: /\b(program|programme|milestone|completion date|commencement|duration|work schedule)\b/i },
  { category: "RESOURCING", regex: /\b(key personnel|experience|resources|plant|equipment|subcontractor|organisation chart)\b/i },
];

export type SuggestedRequirement = { category: string; title: string; detail: string; mandatory: boolean; confidence: number; sourcePage?: number; sourceSheet?: string; sourceExcerpt: string };

export function analyseTender(sections: SourceSection[]): SuggestedRequirement[] {
  const found: SuggestedRequirement[] = [];
  for (const section of sections) {
    const sentences = section.text.replace(/\r/g, "").split(/\n+|(?<=[.!?;])\s+/).map(s => s.trim()).filter(s => s.length >= 18 && s.length <= 600);
    for (const sentence of sentences) {
      const match = patterns.find(p => p.regex.test(sentence)); if (!match) continue;
      const mandatory = /\b(must|shall|required|mandatory|is to provide|failure to|condition of tender)\b/i.test(sentence);
      const excerpt = sentence.slice(0, 500);
      const normalized = excerpt.toLowerCase().replace(/\W+/g, " ").trim();
      if (found.some(r => r.sourcePage === section.page && r.sourceSheet === section.sheet && r.sourceExcerpt.toLowerCase().replace(/\W+/g, " ").trim() === normalized)) continue;
      found.push({ category: match.category, title: excerpt.length > 110 ? `${excerpt.slice(0, 107)}...` : excerpt, detail: excerpt, mandatory, confidence: mandatory ? 0.88 : 0.68, sourcePage: section.page, sourceSheet: section.sheet, sourceExcerpt: excerpt });
      if (found.length >= 250) return found;
    }
  }
  return found;
}
