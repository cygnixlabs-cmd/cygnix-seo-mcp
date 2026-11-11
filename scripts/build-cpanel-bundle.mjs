#!/usr/bin/env node
// Builds the upload bundle for cPanel "Setup Node.js App" (host.com.pk / any CloudLinux cPanel host).
//   npm run build && node scripts/build-cpanel-bundle.mjs   -> build/cpanel/cygnix-seo-mcp-cpanel.{zip,tar.gz}
// Upload + extract into the Application root (e.g. ~/mcp-app), then click "Run NPM Install" and "Restart".
// Never upload node_modules: the Node.js Selector manages it (symlink into the app's virtual environment).
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = join(root, "build", "cpanel"); const name = "cygnix-seo-mcp-cpanel"; const dir = join(out, name);
if (!existsSync(join(root, "dist", "hosted", "cpanel.js"))) { console.error("Run `npm run build` first."); process.exit(1); }
rmSync(out, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
for (const p of ["dist", "site", "migrations", "migrations-mysql", "app.cjs", "LICENSE"]) cpSync(join(root, p), join(dir, p), { recursive: true });
mkdirSync(join(dir, "data"), { recursive: true });
writeFileSync(join(dir, "data", ".htaccess"), "Require all denied\n");
const mysql2 = JSON.parse(readFileSync(join(root, "node_modules", "mysql2", "package.json"), "utf8")).version;
writeFileSync(join(dir, "package.json"), JSON.stringify({
  name: "cygnix-seo-mcp-hosted", version: pkg.version, private: true, type: "module", main: "app.cjs",
  description: "Hosted cygnix-seo-mcp (Streamable HTTP) for cPanel Setup Node.js App", license: pkg.license,
  engines: { node: ">=22.13" }, scripts: { start: "node app.cjs" },
  dependencies: { ...pkg.dependencies, mysql2: `^${mysql2}` },
}, null, 2) + "\n");
writeFileSync(join(dir, "README-CPANEL.txt"), [
  "cygnix-seo-mcp hosted bundle for cPanel > Software > Setup Node.js App.",
  "Node.js version: 22 or 24 (22.13+ needed for the default SQLite storage).",
  "Application startup file: app.cjs   Application URL: mcp.cygnixlabs.com",
  "After extracting: Run NPM Install, set the environment variables, Restart.",
  "Full guide: docs/hosting.md (Option A: cPanel) in the GitHub repo.", "",
].join("\n"));
const lock = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" });
if (lock.status !== 0) console.warn("package-lock.json not generated (offline?); cPanel's Run NPM Install works without it.");
// Archives are flat (no top folder) so they extract straight into the Application root.
spawnSync("tar", ["-czf", `${name}.tar.gz`, "-C", name, "."], { cwd: out, stdio: "inherit" });
const z = spawnSync("python3", ["-c", `import shutil; shutil.make_archive("${name}", "zip", "${name}")`], { cwd: out, stdio: "inherit" });
console.log(`Bundle: ${join(out, name)}{.tar.gz${z.status === 0 ? ",.zip" : ""}}`);
