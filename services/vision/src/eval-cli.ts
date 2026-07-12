import { config as loadDotenv } from "dotenv"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { visionEvalManifestSchema } from "./evaluation"
import { runVisionEval } from "./eval-runner"
import { createConfiguredVisionProvider } from "./provider"

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function mimeType(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === ".png") return "image/png"
  if (extension === ".webp") return "image/webp"
  if (extension === ".gif") return "image/gif"
  return "image/jpeg"
}

function privatePhotoPath(photoRef: string, root: string, datasetId: string): string {
  const url = new URL(photoRef)
  if (url.protocol !== "private:" || url.hostname !== datasetId) {
    throw new Error(`unsupported_private_photo_ref:${photoRef}`)
  }
  const path = resolve(root, decodeURIComponent(url.pathname.replace(/^\/+/, "")))
  const relativePath = relative(root, path)
  if (relativePath.startsWith("..") || isAbsolute(relativePath) || relativePath.split(sep).includes("..")) {
    throw new Error(`private_photo_ref_outside_dataset:${photoRef}`)
  }
  return path
}

async function main() {
  const manifestPathArg = argument("--manifest")
  if (!manifestPathArg) {
    throw new Error(
      "Usage: pnpm --filter @leadshelf/vision eval -- --manifest <path> [--env <path>] [--output <path>] [--allow-external]",
    )
  }
  const manifestPath = resolve(manifestPathArg)
  const envPath = argument("--env")
  if (envPath) loadDotenv({ path: resolve(envPath), override: true })
  const manifest = visionEvalManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")))
  const datasetRoot = dirname(manifestPath)
  const provider = createConfiguredVisionProvider()
  const report = await runVisionEval({
    manifest,
    provider,
    allowExternal: hasFlag("--allow-external"),
    resolvePhotoRef: async (photoRef) => {
      const path = privatePhotoPath(photoRef, datasetRoot, manifest.datasetId)
      const content = await readFile(path)
      return `data:${mimeType(path)};base64,${content.toString("base64")}`
    },
  })
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  const outputPathArg = argument("--output")
  if (outputPathArg) {
    const outputPath = isAbsolute(outputPathArg) ? outputPathArg : join(process.cwd(), outputPathArg)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, serialized, "utf8")
    process.stdout.write(`${outputPath}\n`)
  } else {
    process.stdout.write(serialized)
  }
}

await main()
