import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("benchmark lambda handlers stay identical", async () => {
  const directItemPath = path.join(__dirname, "..", "sam", "lambda", "direct-item", "app.ts");
  const modeANodePath = path.join(__dirname, "..", "sam", "lambda", "mode-a-node", "app.ts");

  const [directItem, modeANode] = await Promise.all([
    fs.readFile(directItemPath, "utf8"),
    fs.readFile(modeANodePath, "utf8"),
  ]);

  assert.equal(
    modeANode,
    directItem,
    "Expected benchmark/sam/lambda/*/app.ts sources to stay identical for fair benchmarking",
  );
});
