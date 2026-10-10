import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../../src/common/http/csv.js";

test("CSV: BOM for Arabic in Excel, quoting, CRLF, and no formula injection", () => {
  const csv = toCsv(
    ["الخط", "العدد"],
    [
      ['الخط "الغربي"', 3],
      ['=HYPERLINK("http://evil")', "+1"],
      [null, "-2"],
    ],
  );
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines[0], '"الخط","العدد"');
  assert.equal(lines[1], '"الخط ""الغربي""","3"');
  assert.equal(lines[2], `"'=HYPERLINK(""http://evil"")","'+1"`);
  assert.equal(lines[3], `"","'-2"`);
});
