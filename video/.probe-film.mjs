#!/usr/bin/env node
/**
 * video/.probe-film.mjs — LIVE selector probe for the overview film.
 * Executes every scene's `do` against the real stand (same clicks/fills the
 * recorder will do — all mutation-safe by scenario design) with instrumented
 * helpers: each h.* call logs WHICH selector of its fallback list resolved.
 * "⛔ FELL-BACK" = none matched → the cursor would land on <main> (bad).
 *
 * Usage: node video/.probe-film.mjs <BASE_URL> [lang]
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, request } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const overrides = (await import(pathToFileURL(resolve(repoRoot, "video/scenarios/overrides.mjs")).href)).default;

const baseUrl = (process.argv[2] || "https://hermescrm.xyz").replace(/\/$/, "");
const langsArg = (process.argv[3] || "az").split(",");

const report = [];
const issue = (s) => { report.push(s); console.log(s); };

async function firstMatch(page, selectorOrList) {
  const list = Array.isArray(selectorOrList) ? selectorOrList : [selectorOrList];
  for (const sel of list.filter(Boolean)) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      const vis = await loc.isVisible().catch(() => false);
      return { loc, sel, vis };
    }
  }
  return { loc: null, sel: null, vis: false };
}

function makeProbeHelpers(page, sceneNo, lang) {
  const probe = async (kind, sel, act) => {
    const { loc, sel: hit, vis } = await firstMatch(page, sel);
    const tag = `s${String(sceneNo.n).padStart(2, "0")}.${lang} ${kind}`;
    if (!loc) issue(`  ⛔ ${tag} FELL-BACK (none matched): ${JSON.stringify(sel).slice(0, 110)}`);
    else if (!vis) issue(`  ⚠ ${tag} matched but NOT VISIBLE: ${hit}`);
    else console.log(`  ✓ ${tag} → ${hit}`);
    if (loc && act) await act(loc).catch((e) => issue(`  ⚠ ${tag} action failed on ${hit}: ${String(e.message).slice(0, 90)}`));
  };
  return {
    firstLocator: (sel) => firstMatch(page, sel).then((r) => r.loc),
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 400))),
    setSceneBudget() {},
    async holdUntil() {},
    async ensureCursor() {},
    async moveTo(sel) { await probe("moveTo", sel, (l) => l.scrollIntoViewIfNeeded({ timeout: 5000 })); },
    async hover(sel) { await probe("hover", sel, (l) => l.hover({ timeout: 5000 })); },
    async click(sel) { await probe("click", sel, (l) => l.click({ timeout: 8000 })); await page.waitForTimeout(700); },
    async fill(sel, text) {
      await probe("fill ", sel, async (l) => {
        await l.click({ timeout: 5000 });
        await l.selectText().catch(() => {});
        await l.pressSequentially(String(text), { delay: 5, timeout: 15000 });
      });
    },
  };
}

for (const lang of langsArg) {
  console.log(`\n══════ PROBE lang=${lang} base=${baseUrl} ══════`);
  const api = await request.newContext({ baseURL: baseUrl });
  const res = await api.post("/api/auth/login", {
    data: { email: process.env.HELP_VIDEO_EMAIL || "admin@leadshelf.com", password: process.env.HELP_VIDEO_PASSWORD || "demo1234" },
  });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  for (const [slug, scenario] of Object.entries(overrides)) {
    const route = scenario.route === "/" ? "" : scenario.route;
    await page.goto(`${baseUrl}/${lang}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    console.log(`\n── ${slug} (${scenario.scenes.length} scenes)`);
    const sceneNo = { n: 0 };
    for (const scene of scenario.scenes) {
      sceneNo.n += 1;
      const h = makeProbeHelpers(page, sceneNo, lang);
      try {
        await scene.do?.(page, lang, h);
      } catch (e) {
        issue(`  ⛔ s${String(sceneNo.n).padStart(2, "0")}.${lang} scene threw: ${String(e.message).slice(0, 120)}`);
      }
      await page.waitForTimeout(400);
    }
  }
  await context.close();
  await browser.close();
  await api.dispose();
}

console.log(`\n══════ PROBE RESULT: ${report.length} issue(s) ══════`);
for (const r of report) console.log(r);
process.exit(0);
