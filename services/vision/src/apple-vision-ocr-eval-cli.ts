import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { evaluateAppleVisionOcr } from "./apple-vision-ocr-eval"
import { visionEvalManifestSchema } from "./evaluation"

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const manifestArg = argument("--manifest")
  const ocrDirArg = argument("--ocr-dir")
  const outputArg = argument("--output")
  if (!manifestArg || !ocrDirArg || !outputArg) {
    throw new Error(
      "Usage: node --import tsx src/apple-vision-ocr-eval-cli.ts --manifest <path> --ocr-dir <path> --output <path>",
    )
  }

  const manifestPath = resolve(manifestArg)
  const ocrDir = resolve(ocrDirArg)
  const outputPath = isAbsolute(outputArg) ? outputArg : join(process.cwd(), outputArg)
  const manifest = visionEvalManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")))
  const report = await evaluateAppleVisionOcr({
    manifest,
    loadRows: async (sampleId) => JSON.parse(await readFile(join(ocrDir, `${sampleId}.json`), "utf8")),
  })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  process.stdout.write(`${outputPath}\n`)
}

await main()
