import { describe, it, expect } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("quotes and doubles embedded quotes", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(3)).toBe('"3"');
  });

  it("neutralises formula triggers = + - @ TAB CR", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\",\"x\")")).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell("+1+1")).toBe("\"'+1+1\"");
    expect(csvCell("-2+3")).toBe("\"'-2+3\"");
    expect(csvCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    expect(csvCell("\t=1")).toBe("\"'\t=1\"");
    expect(csvCell("\r=1")).toBe("\"'\r=1\"");
  });

  it("leaves ordinary values alone", () => {
    expect(csvCell("10.0.0.1")).toBe('"10.0.0.1"');
    expect(csvCell("evil.example")).toBe('"evil.example"');
  });
});

describe("toCsv", () => {
  it("joins cells and rows", () => {
    expect(toCsv([["a", "b"], ["=1", "x"]])).toBe('"a","b"\r\n"\'=1","x"');
  });
});
