#!/usr/bin/env node
// pi-starter installer: merges starter config into your pi agent dir without
// overwriting anything you already have, then installs the starter packages.
//
//   node install.mjs                 # everything
//   node install.mjs --dry-run       # show what would change
//   node install.mjs --only mcp,settings,extensions
//   node install.mjs --skip-packages
//
// Respects PI_CODING_AGENT_DIR (default ~/.pi/agent).

import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipPackages = args.includes("--skip-packages");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? new Set((args[onlyIdx + 1] ?? "").split(",")) : null;
const want = (step) => !only || only.has(step);

const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const vars = { ...loadEnvFile(join(root, "org.env")), ...nonEmpty(process.env) };

const log = (...m) => console.log(...m);
const warn = (...m) => console.warn("  !", ...m);

log(`pi-starter → ${agentDir}${dryRun ? " (dry run)" : ""}\n`);
if (!dryRun) mkdirSync(agentDir, { recursive: true });

if (want("settings")) mergeTopLevel("settings.json");
if (want("models")) mergeEntries("models.json", "providers");
if (want("mcp")) mergeEntries("mcp.json", "mcpServers");
if (want("extensions")) copyExtensions();
if (want("packages") && !skipPackages) installPackages();

log("\nDone. Next: export runtime secrets (see README), then run `pi` and `/mcp` to sign in.");

// ---------------------------------------------------------------------------

function mergeTopLevel(file) {
  const tpl = readJson(join(root, "templates", file));
  const target = join(agentDir, file);
  const cur = existsSync(target) ? readJson(target) : {};
  const added = [];
  for (const [k, v] of Object.entries(tpl)) {
    if (!(k in cur)) {
      cur[k] = v;
      added.push(k);
    }
  }
  report(file, added, []);
  if (added.length) write(target, cur);
}

function mergeEntries(file, key) {
  const tpl = readJson(join(root, "templates", file));
  const target = join(agentDir, file);
  const cur = existsSync(target) ? readJson(target) : {};
  for (const [k, v] of Object.entries(tpl)) if (k !== key && !(k in cur)) cur[k] = v;
  cur[key] ??= {};

  const added = [];
  const skipped = [];
  for (const [name, entry] of Object.entries(tpl[key] ?? {})) {
    if (name in cur[key]) {
      skipped.push(`${name} (already configured)`);
      continue;
    }
    const missing = (entry._requires ?? []).filter((v) => !vars[v]);
    if (missing.length) {
      skipped.push(`${name} (set ${missing.join(", ")} in org.env)`);
      continue;
    }
    const { _requires, ...clean } = entry;
    cur[key][name] = render(clean);
    added.push(name);
  }
  report(file, added, skipped);
  if (added.length) write(target, cur);
}

function copyExtensions() {
  const srcDir = join(root, "extensions");
  const dstDir = join(agentDir, "extensions");
  if (!existsSync(srcDir)) {
    log("extensions\n  = none to copy");
    return;
  }
  log("extensions");
  if (!dryRun) mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dst = join(dstDir, entry.name);
    if (existsSync(dst)) {
      log(`  = ${entry.name} (already exists)`);
      continue;
    }
    log(`  + ${entry.name}`);
    if (!dryRun) cpSync(join(srcDir, entry.name), dst, { recursive: true });
  }
}

function installPackages() {
  const { packages } = readJson(join(root, "templates", "packages.json"));
  const settingsPath = join(agentDir, "settings.json");
  const have = new Set(
    (existsSync(settingsPath) ? (readJson(settingsPath).packages ?? []) : []).map((p) =>
      typeof p === "string" ? p : p.source,
    ),
  );
  log("packages");
  for (const { source } of packages) {
    if (have.has(source)) {
      log(`  = ${source} (already installed)`);
      continue;
    }
    log(`  + ${source}`);
    if (dryRun) continue;
    const r = spawnSync("pi", ["install", source], { stdio: "inherit" });
    if (r.error) warn(`could not run pi: ${r.error.message}. Is pi on your PATH?`);
    else if (r.status !== 0) warn(`pi install ${source} exited with ${r.status}`);
  }
}

// Replace {{VAR}} placeholders (install-time). ${VAR} is left for pi to resolve at runtime.
function render(value) {
  if (typeof value === "string") return value.replace(/\{\{(\w+)\}\}/g, (_, v) => vars[v]);
  if (Array.isArray(value)) return value.map(render);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, render(v)]));
  return value;
}

function report(file, added, skipped) {
  log(file);
  for (const a of added) log(`  + ${a}`);
  for (const s of skipped) log(`  - ${s}`);
  if (!added.length && !skipped.length) log("  = nothing to add");
}

function write(path, obj) {
  if (dryRun) return;
  if (existsSync(path)) copyFileSync(path, `${path}.bak-${Date.now()}`);
  writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`Could not parse ${path}: ${e.message}`);
    process.exit(1);
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/(^|\s+)#.*$/, "").replace(/^(['"])(.*)\1$/, "$2");
    if (val) out[m[1]] = val;
  }
  return out;
}

function nonEmpty(env) {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v));
}
