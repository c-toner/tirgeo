import { describe, expect, it } from "vitest";
import { analyseTender, extractTenderText } from "../src/lib/tender-parser.js";
import ExcelJS from "exceljs";

describe("tender document processing", () => {
  it("extracts plain-text tender schedules", async () => {
    const parsed = await extractTenderText(Buffer.from("Requirement,Response\nPublic liability insurance,Attach certificate"), "text/csv", "return-schedule.csv");
    expect(parsed.sections[0]?.text).toContain("Public liability insurance");
  });

  it("identifies mandatory requirements with source references", () => {
    const requirements = analyseTender([{ page: 12, text: "The Tenderer must provide evidence of public liability insurance.\nA construction program shall be submitted with the tender." }]);
    expect(requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "LICENCE_AND_COMPLIANCE", mandatory: true, sourcePage: 12 }),
      expect.objectContaining({ category: "PROGRAM", mandatory: true, sourcePage: 12 }),
    ]));
  });

  it("does not present unrelated prose as a requirement", () => {
    expect(analyseTender([{ text: "Welcome to the project. We look forward to working with the successful tenderer." }])).toEqual([]);
  });
  it("rejects files whose content does not match their claimed type", async () => {
    await expect(extractTenderText(Buffer.from("not a pdf"), "application/pdf", "fake.pdf")).rejects.toThrow("not a valid PDF");
  });
  it("extracts XLSX schedules with the audited dependency override", async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("Return Schedule"); sheet.addRow(["Requirement", "Response"]); sheet.addRow(["Safety management plan", "Attach"]);
    const parsed = await extractTenderText(Buffer.from(await workbook.xlsx.writeBuffer()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "schedule.xlsx");
    expect(parsed.sections[0]).toMatchObject({ sheet: "Return Schedule" }); expect(parsed.sections[0]?.text).toContain("Safety management plan");
  });
});
