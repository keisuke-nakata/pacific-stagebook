import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");

const rules = [
  {
    name: "postal code",
    pattern: /\b\d{3}-\d{4}\b/
  },
  {
    name: "phone number",
    pattern: /\b0\d{1,4}-\d{1,4}-\d{3,4}\b/
  },
  {
    name: "reservation or booking identifier",
    pattern: /(予約番号|予約No|予約ID|booking\s*id|confirmation\s*(number|code))/i
  },
  {
    name: "personal-name field",
    pattern: /(実名|本名|氏名|real\s*name|full\s*name)/i
  },
  {
    name: "street-address-like detail",
    pattern: /[一二三四五六七八九十0-9]+丁目[0-9一二三四五六七八九十-]+/
  }
];

test("public data does not contain private addresses, phone numbers, or booking ids", () => {
  const data = readdirSync(dataDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readFileSync(path.join(dataDir, file), "utf8"))
    .join("\n");

  const findings = rules
    .filter((rule) => rule.pattern.test(data))
    .map((rule) => rule.name);

  assert.deepEqual(findings, []);
});
