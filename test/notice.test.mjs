import test from "node:test"; import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const run = (env) => new Promise(res => {
  const p = spawn("node", ["dist/index.js"], { env: { ...process.env, ...env } }); let out = "", err = "";
  p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d);
  setTimeout(() => { p.kill(); res({ out, err }); }, 700);
});
test("startup notice goes to stderr only, stdout stays clean for MCP", async () => {
  const { out, err } = await run({ CYGNIX_QUIET: "" });
  assert.equal(out, ""); assert.match(err, /https:\/\/mcp\.cygnixlabs\.com/); assert.equal(err.trim().split("\n").length, 1);
});
test("CYGNIX_QUIET=1 hides the notice", async () => {
  const { out, err } = await run({ CYGNIX_QUIET: "1" });
  assert.equal(out, ""); assert.equal(err, "");
});
