#!/usr/bin/env node
/**
 * scripts/produce-guides.mjs — LeadShelf help-video producer.
 * Ported from leaddrive-v2 (same pipeline: Playwright chromium `recordVideo`
 * 1280×720 + ffmpeg muxes per-scene narration on top).
 *
 * LeadShelf ADAPTATIONS vs the reference:
 *  - AUTH: custom POST /api/auth/login {email,password} → ls_access/ls_refresh
 *    cookies (NOT NextAuth). ls_access lives 15 min and middleware does NOT
 *    auto-refresh → the recorder RE-LOGINS every SESSION_REFRESH_MS and pushes
 *    fresh cookies into the LIVE browser context between scenes (a full film
 *    runs 25-30 min).
 *  - LOCALES: az/ru only; routes are locale-prefixed (`/az/...`, `/ru/...`).
 *  - SCENARIOS: video/scenarios/overrides.mjs ONLY (no browser-guided.json).
 *  - No product tours / help widget in LeadShelf → no dismiss/collapse logic.
 *  - Helpers gain `ensureCursor()` — scenes navigate by real clicks and must
 *    re-inject the cursor overlay after each navigation.
 *
 * VOICE ENGINES (same policy): az → Gemini native TTS (Kore; keys rotate on
 * daily quota), ru → Azure Speech (ru-RU-DmitryNeural). NO local fallback.
 *
 * USAGE
 *   node scripts/produce-guides.mjs <BASE_URL> [langs] [section ...]
 *     BASE_URL   e.g. https://hermescrm.xyz (default HELP_VIDEO_BASE_URL)
 *     langs      "az" or "az,ru" (default "az,ru")
 *     section…   scenario keys to limit the run (default: all)
 *
 * FLAGS (env): FORCE=1 re-record; CLEAN=1 delete targets first (implied by
 * FORCE). READONLY / ALLOW_MUTATIONS: on a remote target declarative click/fill
 * steps degrade to hover; hand-authored `do` scenes are responsible for their
 * own safety (this repo's film only fills-without-submit and hovers mutators).
 *
 * PREREQS: ffmpeg+ffprobe, `playwright` dep (workspace root), keys in
 * apps/web/.env — GEMINI_API_KEY (comma-separated list ok) + AZURE_SPEECH_KEY /
 * AZURE_SPEECH_REGION. HELP_VIDEO_EMAIL/PASSWORD override demo credentials.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, request } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const navItemsPath = resolve(repoRoot, "apps/web/src/components/shell/nav-items.ts");
const outDir = resolve(repoRoot, "video/player");
const tmpRoot = resolve(repoRoot, "video/.tmp-guides");
const audioRoot = resolve(tmpRoot, "audio");

loadProjectEnv();

// ── CLI + flags ────────────────────────────────────────────────────────────
const positionals = process.argv.slice(2).filter((v) => !v.startsWith("-"));
const baseUrl = (positionals[0] || process.env.HELP_VIDEO_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const langs = (positionals[1] || process.env.GUIDE_LANGS || "az,ru")
  .split(",").map((v) => v.trim()).filter(Boolean);
const requestedSections = positionals.slice(2);

const FORCE = envFlag("FORCE");
const CLEAN = envFlag("CLEAN") || FORCE;

// Prod safety for DECLARATIVE steps (hand-authored `do` scenes police
// themselves: fill-never-submit, hover-only on mutating buttons).
const isRemoteTarget = !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(baseUrl);
const READONLY = envFlag("READONLY")
  || ((isRemoteTarget || process.env.NODE_ENV === "production") && !envFlag("ALLOW_MUTATIONS"));

// Voice-per-language routing (az → Gemini quota, ru → Azure fast/uncapped).
const forcedEngine = process.env.TTS_ENGINE || null;
const ENGINE = {
  az: forcedEngine || process.env.ENGINE_AZ || "gemini",
  ru: forcedEngine || process.env.ENGINE_RU || "azure",
};

// Timing knobs: voice starts first, cursor follows LEAD ms later.
const LEAD_MS = Number(process.env.GUIDE_LEAD_MS || 650);
const TAIL_MS = Number(process.env.GUIDE_TAIL_MS || 700);
const END_PAD_MS = Number(process.env.GUIDE_END_PAD_MS || 1200);
const PREROLL_SETTLE_MS = Number(process.env.GUIDE_PREROLL_MS || 900);
// ls_access TTL is 15 min; refresh the session well inside it.
const SESSION_REFRESH_MS = Number(process.env.GUIDE_SESSION_REFRESH_MS || 8 * 60 * 1000);

// Viewport == video size (1:1): poster matches the frame, no cursor remapping.
const videoSize = { width: 1280, height: 720 };
const viewport = { ...videoSize };

// Cursor + click-pulse styles (LeadShelf has no tour/help widget to hide).
const GUIDE_CSS = [
  "#ld-pilot-cursor{position:fixed;z-index:2147483647;width:28px;height:28px;left:0;top:0;pointer-events:none;transform:translate(-100px,-100px);transition:transform .12s linear;filter:drop-shadow(0 10px 14px rgba(15,23,42,.25));}",
  "#ld-pilot-cursor:before{content:'';position:absolute;left:7px;top:1px;width:0;height:0;border-right:18px solid transparent;border-bottom:25px solid #fff;transform:rotate(-24deg);}",
  "#ld-pilot-cursor:after{content:'';position:absolute;left:8px;top:3px;width:0;height:0;border-right:13px solid transparent;border-bottom:19px solid #111827;transform:rotate(-24deg);}",
  ".ld-pilot-pulse{position:fixed;z-index:2147483645;width:64px;height:64px;border:4px solid #FF4D00;border-radius:999px;pointer-events:none;transform:translate(-50%,-50%) scale(.3);opacity:.75;animation:ldPilotPulse .5s ease-out forwards;}",
  "@keyframes ldPilotPulse{to{transform:translate(-50%,-50%) scale(1.25);opacity:0;}}",
].join("\n");

// Gemini keys: GEMINI_API_KEY[,key2,…] (+ numbered/env-name variants).
const geminiKeys = (() => {
  const raw = [];
  for (const base of ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENAI_API_KEY"]) {
    for (const suffix of ["", "2", "3", "4", "5", "_2", "_3", "_4", "_5"]) {
      const v = process.env[`${base}${suffix}`];
      if (v) raw.push(v);
    }
  }
  const keys = [];
  for (const v of raw) for (const k of String(v).split(",").map((s) => s.trim()).filter(Boolean)) if (!keys.includes(k)) keys.push(k);
  return keys;
})();
let gKeyIdx = 0;
const gExhausted = new Set();
const geminiModel = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const geminiVoice = process.env.GEMINI_TTS_VOICE || "Kore";
const geminiMaxRetries = Number(process.env.GEMINI_MAX_RETRIES || 10);
const geminiWindowMs = Number(process.env.GEMINI_WINDOW_MS || 60000);

// Azure Speech (ru).
const azureKey = firstEnv("AZURE_SPEECH_KEY", "SPEECH_KEY", "AZURE_AI_SPEECH_KEY");
const azureRegion = firstEnv("AZURE_SPEECH_REGION", "SPEECH_REGION", "AZURE_AI_SPEECH_REGION");
const azureEndpoint = firstEnv("AZURE_SPEECH_ENDPOINT", "SPEECH_ENDPOINT").replace(/\/$/, "");
const azureFormat = process.env.AZURE_SPEECH_OUTPUT_FORMAT || "audio-24khz-160kbitrate-mono-mp3";
const azureVoices = {
  az: process.env.AZURE_SPEECH_VOICE_AZ || "az-AZ-BabekNeural",
  ru: process.env.AZURE_SPEECH_VOICE_RU || "ru-RU-DmitryNeural",
};
const azureLangs = { az: "az-AZ", ru: "ru-RU" };

// ── Scenarios: hand-authored overrides are the ONLY source in LeadShelf ─────
const overridesPath = resolve(repoRoot, "video/scenarios/overrides.mjs");
if (!existsSync(overridesPath)) throw new Error(`No scenarios: ${overridesPath} missing`);
const overrides = (await import(pathToFileURL(overridesPath).href)).default || {};
const getScenario = (slug) => overrides[slug];
const unitsOf = (scenario) => scenario.scenes || scenario.steps || [];

const allSlugs = Object.keys(overrides);
for (const slug of requestedSections) {
  if (!overrides[slug]) throw new Error(`Unknown section "${slug}". Known: ${allSlugs.join(", ")}`);
}
const sections = requestedSections.length ? requestedSections : allSlugs;
reportNavCoverage();

mkdirSync(outDir, { recursive: true });
mkdirSync(audioRoot, { recursive: true });

// ── Preflight ────────────────────────────────────────────────────────────────
const neededEngines = new Set(langs.map((l) => ENGINE[l]));
if (neededEngines.has("gemini") && !geminiKeys.length) {
  throw new Error("GEMINI_API_KEY is required for the az voice. Set it in apps/web/.env — do not commit it.");
}
if (neededEngines.has("azure") && !azureKey) {
  throw new Error("AZURE_SPEECH_KEY is required for the ru voice. Set it in apps/web/.env.");
}
if (neededEngines.has("azure") && !azureRegion && !azureEndpoint) {
  throw new Error("AZURE_SPEECH_REGION or AZURE_SPEECH_ENDPOINT is required for the ru voice.");
}

console.log(`▶ base=${baseUrl}  langs=${langs.join(",")}  sections=${sections.length}  FORCE=${FORCE}`);
console.log(`▶ engines: ${langs.map((l) => `${l}→${ENGINE[l]}`).join("  ")}${neededEngines.has("gemini") ? `  (Gemini keys: ${geminiKeys.length}${geminiKeys.length > 1 ? " — rotating on daily quota" : ""})` : ""}`);
console.log(`▶ target=${isRemoteTarget ? "REMOTE" : "local"}  READONLY=${READONLY}${READONLY ? " (declarative clicks→hover)" : ""}`);

const summary = [];
const quotaState = { exhausted: false };
for (const lang of langs) {
  await produceLanguage(lang);
  if (quotaState.exhausted) break;
}

console.log("\n════════ SUMMARY ════════");
for (const row of summary) console.log(row);
if (quotaState.exhausted) {
  console.log("\n⛔ Stopped: daily Gemini TTS quota reached on ALL keys. Re-run the same command");
  console.log("   (WITHOUT FORCE) after the quota resets — finished sections are skipped.");
}
const failed = summary.filter((r) => r.includes("FAIL")).length;
if (failed) {
  console.error(`\n${failed} section(s) failed — see log above.`);
  process.exit(1);
}

// ═════════════════════════════════════════════════════════════════════════
// Per-language pipeline
// ═════════════════════════════════════════════════════════════════════════
async function produceLanguage(lang) {
  console.log(`\n╔══ LANGUAGE: ${lang} (voice: ${ENGINE[lang]}) ══════════════════`);

  // 1) Pre-generate ALL scene audio (browser closed → session can't idle out
  //    while Gemini's rate-limit window ticks). Durations drive scene holds.
  console.log(`  ♪ generating scene audio for ${sections.length} section(s) …`);
  const audioBySection = {};
  for (const slug of sections) {
    if (isValidRender(videoOut(slug, lang), posterOut(slug, lang)) && !FORCE) continue;
    try {
      audioBySection[slug] = await ensureSceneAudio(slug, lang);
    } catch (error) {
      if (error.code === "GEMINI_DAILY_QUOTA") {
        console.warn(`\n  ⛔ ${error.message}. Recording what already has audio.`);
        quotaState.exhausted = true;
        break;
      }
      console.error(`  ✖ audio ${slug}.${lang}: ${error.message}`);
      summary.push(`FAIL  ${slug}.${lang}  (audio: ${error.message})`);
    }
  }

  // 2) Login once, then record; the session is re-freshed between scenes.
  const api = await request.newContext({ baseURL: baseUrl });
  await loginWithRetry(api);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport,
    deviceScaleFactor: 1,
    recordVideo: { dir: tmpRoot, size: videoSize },
  });
  const session = { api, context, lastRefresh: Date.now() };
  await installInitScripts(context, lang);

  try {
    for (const slug of sections) {
      const out = videoOut(slug, lang);
      const poster = posterOut(slug, lang);
      if (isValidRender(out, poster) && !FORCE) {
        console.log(`  ⏭ ${slug}.${lang} already rendered — skip (FORCE=1 to redo)`);
        summary.push(`SKIP  ${slug}.${lang}`);
        continue;
      }
      const audio = audioBySection[slug];
      if (!audio) {
        if (!quotaState.exhausted) summary.push(`FAIL  ${slug}.${lang}  (no audio)`);
        continue;
      }
      if (CLEAN) { rmSync(out, { force: true }); rmSync(poster, { force: true }); }
      try {
        await recordSection(session, slug, lang, audio, out, poster);
        summary.push(`OK    ${slug}.${lang}`);
        console.log(`  ✔ ${slug}.${lang} → ${rel(out)}`);
      } catch (error) {
        summary.push(`FAIL  ${slug}.${lang}  (${error.message})`);
        console.error(`  ✖ ${slug}.${lang}: ${error.message}`);
      }
    }
  } finally {
    await context.close();
    await browser.close();
    await api.dispose();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Recording a single section → webm + clean poster + mux
// ═════════════════════════════════════════════════════════════════════════
async function recordSection(session, slug, lang, audio, out, poster) {
  const scenario = getScenario(slug);
  const units = unitsOf(scenario);
  const isDo = Boolean(scenario.scenes);
  const page = await session.context.newPage();
  const t0 = Date.now();
  let posterSaved = false;
  const offsets = [];

  try {
    let currentRoute = null;

    const gotoRoute = async (route) => {
      const path = route === "/" ? "" : route;
      await page.goto(`${baseUrl}/${lang}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.locator("main h1, main h2").first().waitFor({ state: "visible", timeout: 20000 })
        .catch(() => page.locator("main, body").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {}));
      await applyGuideStyles(page);
      await page.waitForTimeout(PREROLL_SETTLE_MS);
      currentRoute = route;
    };

    await gotoRoute(units[0]?.route || scenario.route);

    // CLEAN poster before the cursor overlay exists.
    await page.screenshot({ path: poster, type: "jpeg", quality: 90 }).catch(() => {});
    posterSaved = true;

    await injectCursor(page);
    const helpers = makeHelpers(page);

    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      const durMs = audio[i]?.durationMs ?? 6000;

      await refreshSessionIfDue(session); // keep ls_access alive through a 30-min film

      if (unit.route && unit.route !== currentRoute) {
        await gotoRoute(unit.route);
        await injectCursor(page);
      }

      offsets[i] = Date.now() - t0;
      await sleep(LEAD_MS);
      helpers.setSceneBudget(durMs);
      try {
        if (isDo) await unit.do?.(page, lang, helpers);
        else await performAction(page, unit);
      } catch (e) { log(`      · scene ${i + 1} action skipped: ${e.message}`); }

      const targetEnd = offsets[i] + durMs + TAIL_MS;
      const remain = targetEnd - (Date.now() - t0);
      if (remain > 0) await sleep(remain);
    }

    await sleep(END_PAD_MS);
  } finally {
    await page.close();
  }

  const webm = await page.video().path();
  muxSection(webm, audio, offsets, out);
  rmSync(webm, { force: true });

  if (!posterSaved || !existsSync(poster)) {
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", out,
      "-vf", "select=eq(n\\,0)", "-vframes", "1", poster], { stdio: "inherit" });
  }
  if (!isValidRender(out, poster)) throw new Error("post-render verification failed");
}

async function performAction(page, step) {
  const target = await firstLocator(page, step.target);
  await target?.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const pointer = await firstLocator(page, step.pointerTarget || step.target);
  const box = await pointer?.boundingBox().catch(() => null);
  const x = box ? box.x + box.width / 2 : viewport.width / 2;
  const y = box ? box.y + Math.min(box.height / 2, 40) : viewport.height / 2;

  await page.mouse.move(x, y, { steps: 18 });
  await page.waitForTimeout(250);

  if (READONLY && (step.action === "click" || step.action === "fill")) {
    await pointer?.hover({ timeout: 6000 }).catch(() => {});
    await pulse(page, x, y);
    return;
  }

  switch (step.action) {
    case "click":
      await page.mouse.click(x, y).catch(() => {});
      await pulse(page, x, y);
      break;
    case "hover":
      await pointer?.hover({ timeout: 6000 }).catch(() => {});
      break;
    default:
      await page.mouse.wheel(0, 240).catch(() => {});
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ffmpeg mux
// ═════════════════════════════════════════════════════════════════════════
function muxSection(webm, audio, offsetsMs, out) {
  const LEAD_IN_MS = 400;
  const defined = offsetsMs.filter((o) => typeof o === "number" && o >= 0);
  const headTrimMs = defined.length ? Math.max(0, Math.round(Math.min(...defined) - LEAD_IN_MS)) : 0;
  const inputs = ["-y", "-hide_banner", "-loglevel", "error"];
  if (headTrimMs > 0) inputs.push("-ss", (headTrimMs / 1000).toFixed(3));
  inputs.push("-i", webm);
  const filters = [];
  const mixLabels = [];
  let n = 0;
  let audioEndMs = 0;
  for (let i = 0; i < audio.length; i += 1) {
    if (!audio[i]?.path || !existsSync(audio[i].path)) continue;
    inputs.push("-i", audio[i].path);
    n += 1;
    const off = Math.max(0, Math.round((offsetsMs[i] ?? 0) - headTrimMs));
    filters.push(`[${n}:a]adelay=${off}|${off}[a${n}]`);
    mixLabels.push(`[a${n}]`);
    audioEndMs = Math.max(audioEndMs, off + (audio[i].durationMs || 0));
  }
  if (!n) throw new Error("no scene audio to mux");

  const outSec = ((audioEndMs + 900) / 1000).toFixed(2);
  filters.unshift(`[0:v]scale=${videoSize.width}:${videoSize.height},format=yuv420p,tpad=stop_mode=clone:stop_duration=${outSec}[v]`);
  filters.push(`${mixLabels.join("")}amix=inputs=${n}:normalize=0:dropout_transition=0[aout]`);

  execFileSync("ffmpeg", [
    ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k",
    "-movflags", "+faststart",
    "-t", outSec,
    out,
  ], { stdio: "inherit" });
}

// ═════════════════════════════════════════════════════════════════════════
// TTS layer — ENGINE[lang] dispatch; NO local fallback
// ═════════════════════════════════════════════════════════════════════════
async function ensureSceneAudio(slug, lang) {
  const scenario = getScenario(slug);
  const units = unitsOf(scenario);
  const dir = resolve(audioRoot, `${slug}.${lang}`);
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (let i = 0; i < units.length; i += 1) {
    const text = localized(units[i].voice, lang)
      || localized(units[i].heading, lang)
      || localized(scenario.title, lang) || "";
    const mp3 = resolve(dir, `scene-${String(i + 1).padStart(2, "0")}.mp3`);
    if (!existsSync(mp3) || FORCE) {
      console.log(`    ♪ ${slug}.${lang} scene ${i + 1}/${units.length}`);
      await tts(text, lang, mp3);
    }
    out.push({ path: mp3, durationMs: Math.round(ffprobeDuration(mp3) * 1000) });
  }
  return out;
}

async function tts(text, lang, outMp3) {
  const engine = ENGINE[lang];
  if (engine === "gemini") return geminiTTS(text, outMp3);
  if (engine === "azure") return azureTTS(text, lang, outMp3);
  throw new Error(`No TTS engine mapped for lang "${lang}"`);
}

async function geminiTTS(text, outMp3) {
  const body = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: geminiVoice } } },
    },
  };
  const nKeys = Math.max(1, geminiKeys.length);
  const throwIfAllExhausted = () => {
    if (gExhausted.size >= nKeys) {
      const err = new Error(`daily TTS quota reached on all ${nKeys} Gemini key(s)`);
      err.code = "GEMINI_DAILY_QUOTA";
      throw err;
    }
  };
  const rotate = () => { let g = 0; do { gKeyIdx = (gKeyIdx + 1) % nKeys; } while (gExhausted.has(gKeyIdx) && g++ < nKeys); };
  const maxAttempts = geminiMaxRetries * nKeys;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAllExhausted();
    while (gExhausted.has(gKeyIdx)) gKeyIdx = (gKeyIdx + 1) % nKeys;
    const keyNo = gKeyIdx + 1;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKeys[gKeyIdx]}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));

    if (res.status === 429) {
      const b = (await res.text?.().catch(() => "")) || "";
      const retrySec = parseRetrySeconds(res, b);
      if (retrySec != null && retrySec > 120) {
        gExhausted.add(gKeyIdx);
        console.log(`      ⏳ Gemini key #${keyNo} daily quota reached${nKeys > 1 ? ` — failing over (${gExhausted.size}/${nKeys})` : ""}`);
        throwIfAllExhausted();
        rotate();
        continue;
      }
      if (nKeys > 1 && gExhausted.size < nKeys - 1) { rotate(); await sleep(600); continue; }
      const wait = Math.min(retrySec != null ? retrySec * 1000 : geminiWindowMs, geminiWindowMs) + 500;
      console.log(`      ⏳ Gemini 429 (rate/min) — waiting ${Math.round(wait / 1000)}s (attempt ${attempt}/${maxAttempts})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const detail = (await res.text?.().catch(() => "")) || "";
      if (res.status >= 500 && attempt < maxAttempts) { await sleep(3000); continue; }
      throw new Error(`Gemini TTS ${res.status} (key #${keyNo}): ${String(detail).slice(0, 300)}`);
    }

    const json = await res.json();
    const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const b64 = part?.inlineData?.data;
    if (!b64) {
      // Occasionally a 200 arrives with an empty candidate — retry, don't die.
      if (attempt < maxAttempts) { await sleep(2000); continue; }
      throw new Error(`Gemini TTS returned no audio: ${JSON.stringify(json).slice(0, 300)}`);
    }
    const pcm = resolve(dirname(outMp3), `${basename(outMp3)}.pcm`);
    writeFileSync(pcm, Buffer.from(b64, "base64"));
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
      "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm,
      "-codec:a", "libmp3lame", "-q:a", "3", outMp3], { stdio: "inherit" });
    rmSync(pcm, { force: true });
    await sleep(1000);
    return;
  }
  throw new Error(`Gemini TTS exhausted ${maxAttempts} attempts across ${nKeys} key(s)`);
}

async function azureTTS(text, lang, outMp3) {
  const voice = azureVoices[lang] || azureVoices.ru;
  const xmlLang = azureLangs[lang] || "ru-RU";
  const url = azureEndpoint
    ? `${azureEndpoint}/tts/cognitiveservices/v1`
    : `https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = [
    `<speak version="1.0" xml:lang="${xmlLang}" xmlns="http://www.w3.org/2001/10/synthesis">`,
    `  <voice name="${voice}"><prosody rate="-4%">${escapeXml(text)}</prosody></voice>`,
    "</speak>",
  ].join("\n");
  const delays = [0, 2000, 6000, 12000];
  let lastErr;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) await sleep(delays[attempt]);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": azureKey,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": azureFormat,
        "User-Agent": "leadshelf-produce-guides",
      },
      body: ssml,
      signal: AbortSignal.timeout(45000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
    if (res.ok) {
      writeFileSync(outMp3, Buffer.from(await res.arrayBuffer()));
      return;
    }
    lastErr = new Error(`Azure Speech ${res.status}: ${String(await res.text?.().catch(() => "")).slice(0, 200)}`);
    console.warn(`      ⚠ ${lastErr.message} (retry ${attempt + 1}/${delays.length})`);
  }
  throw lastErr;
}

// ═════════════════════════════════════════════════════════════════════════
// Browser plumbing (custom LeadShelf auth, cursor overlay)
// ═════════════════════════════════════════════════════════════════════════
async function loginWithRetry(api, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    if (i) await sleep(2000 * i);
    try {
      const res = await api.post("/api/auth/login", {
        data: {
          email: process.env.HELP_VIDEO_EMAIL || "admin@leadshelf.com",
          password: process.env.HELP_VIDEO_PASSWORD || "demo1234",
        },
      });
      if (res.ok()) {
        const body = await res.json().catch(() => ({}));
        if (body?.user?.id || body?.user?.email) return body.user;
        lastErr = new Error("login 200 but no user in response");
      } else {
        lastErr = new Error(`login HTTP ${res.status()}`);
      }
    } catch (error) {
      lastErr = error;
    }
    console.warn(`  ⚠ login attempt ${i + 1}/${attempts} failed: ${lastErr.message}`);
  }
  throw new Error(`login failed after ${attempts} attempts: ${lastErr?.message}`);
}

// ls_access lives 15 min and the film runs longer: re-login through the API
// context and push the fresh cookies into the LIVE browser context. Runs
// between scenes only, so it never disturbs an in-flight action.
async function refreshSessionIfDue(session) {
  if (Date.now() - session.lastRefresh < SESSION_REFRESH_MS) return;
  try {
    await loginWithRetry(session.api, 2);
    const state = await session.api.storageState();
    await session.context.addCookies(state.cookies);
    session.lastRefresh = Date.now();
    log("      ↻ session cookies refreshed");
  } catch (e) {
    console.warn(`      ⚠ session refresh failed (${e.message}) — continuing with current cookies`);
  }
}

async function installInitScripts(context, lang) {
  await context.addInitScript(({ lang }) => {
    try { document.documentElement.lang = lang; } catch {}
  }, { lang });
}

async function applyGuideStyles(page) {
  await page.addStyleTag({ content: GUIDE_CSS }).catch(() => {});
}

async function injectCursor(page) {
  await applyGuideStyles(page); // navigation may have dropped the <style> too
  await page.evaluate(() => {
    if (!document.getElementById("ld-pilot-cursor")) {
      const cursor = document.createElement("div");
      cursor.id = "ld-pilot-cursor";
      document.body.appendChild(cursor);
      window.addEventListener("mousemove", (e) => {
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }, { passive: true });
    }
  }).catch(() => {});
}

async function pulse(page, x, y) {
  await page.evaluate(({ x, y }) => {
    const el = document.createElement("div");
    el.className = "ld-pilot-pulse";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 560);
  }, { x, y }).catch(() => {});
}

// ═════════════════════════════════════════════════════════════════════════
// Helpers passed to hand-authored `do` scenes
// ═════════════════════════════════════════════════════════════════════════
function makeHelpers(page) {
  const point = async (sel) => {
    const loc = await firstLocator(page, sel);
    await loc?.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    const box = await loc?.boundingBox().catch(() => null);
    const x = box ? box.x + box.width / 2 : viewport.width / 2;
    const y = box ? box.y + Math.min(box.height / 2, 40) : viewport.height / 2;
    await page.mouse.move(x, y, { steps: 18 });
    return { loc, x, y };
  };
  let _sceneT0 = Date.now();
  let _sceneMs = 6000;
  return {
    firstLocator: (sel) => firstLocator(page, sel),
    sleep,
    setSceneBudget(ms) { _sceneT0 = Date.now(); _sceneMs = ms || 6000; },
    async holdUntil(frac) { const target = _sceneT0 + Math.max(0, Math.min(1, frac)) * _sceneMs; const remain = target - Date.now(); if (remain > 0) await sleep(remain); },
    async ensureCursor() { await injectCursor(page); },
    async moveTo(sel) { await point(sel); await page.waitForTimeout(200); },
    async hover(sel) { const { loc } = await point(sel); await loc?.hover({ timeout: 6000 }).catch(() => {}); await page.waitForTimeout(300); },
    async click(sel) {
      const { loc, x, y } = await point(sel);
      await page.waitForTimeout(250);
      await (loc?.click({ timeout: 8000 }).catch(() => page.mouse.click(x, y).catch(() => {})));
      await pulse(page, x, y);
      await page.waitForTimeout(400);
    },
    async fill(sel, text) {
      const { loc } = await point(sel);
      await loc?.click({ timeout: 6000 }).catch(() => {});
      await loc?.selectText().catch(() => {});
      await loc?.pressSequentially(String(text), { delay: 26, timeout: 20000 }).catch(() => {});
    },
  };
}

async function firstLocator(page, selectorOrList) {
  const list = Array.isArray(selectorOrList) ? selectorOrList : [selectorOrList];
  for (const sel of list.filter(Boolean)) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) return loc;
  }
  const main = page.locator("main").first();
  if (await main.count().catch(() => 0)) return main;
  return page.locator("body").first();
}

function videoOut(slug, lang) { return resolve(outDir, `${slug}.${lang}.VOICE.mp4`); }
function posterOut(slug, lang) { return resolve(outDir, `${slug}.${lang}.poster.jpg`); }

function isValidRender(mp4, poster) {
  if (!existsSync(mp4) || !existsSync(poster)) return false;
  try {
    const meta = JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
      "-of", "json", mp4,
    ], { encoding: "utf8" }));
    const v = meta.streams?.find((s) => s.codec_type === "video");
    const hasAudio = meta.streams?.some((s) => s.codec_type === "audio");
    return Boolean(hasAudio) && v?.width === videoSize.width && v?.height === videoSize.height
      && Number(meta.format?.duration || 0) >= 6;
  } catch { return false; }
}

function ffprobeDuration(file) {
  return Number(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ], { encoding: "utf8" }).trim()) || 0;
}

// Warn (don't fail) if the live nav has items with no matching scenario.
function reportNavCoverage() {
  let items = [];
  try {
    const src = readFileSync(navItemsPath, "utf8");
    items = [...src.matchAll(/key:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)]
      .map((m) => ({ key: m[1], href: m[2] }));
  } catch { return; }
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const keys = new Set(allSlugs);
  const missing = items.filter((it) => !keys.has(kebab(it.key)) && !keys.has(it.href.replace(/^\//, "") || "overview"));
  console.log(`▶ coverage: ${allSlugs.length} scenario(s) vs ${items.length} nav items`);
  if (missing.length) {
    console.warn(`  ⚠ ${missing.length} nav route(s) with no scenario yet:`);
    for (const m of missing) console.warn(`    ${m.href}  (key: ${m.key})`);
  }
}

function localized(value, lang) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[lang] || value.az || value.ru || "";
}

function parseRetrySeconds(res, body) {
  const h = res.headers?.get?.("retry-after");
  if (h && Number.isFinite(Number(h))) return Number(h);
  const m = String(body || "").match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Math.round(Number(m[3] || 0));
}

function basename(p) { return p.split("/").pop(); }
function rel(p) { return p.replace(`${repoRoot}/`, ""); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function log(msg) { if (process.env.GUIDE_VERBOSE) console.log(msg); }
function envFlag(name) { return ["1", "true", "yes"].includes(String(process.env[name] || "").toLowerCase()); }

function escapeXml(v) {
  return String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function firstEnv(...names) {
  for (const n of names) { if (process.env[n]) return process.env[n]; }
  return "";
}

function loadProjectEnv() {
  for (const name of [".env.local", ".env", "apps/web/.env.local", "apps/web/.env"]) {
    const path = resolve(repoRoot, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key] !== undefined) continue;
      let val = raw.trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}
