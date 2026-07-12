import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"
import {
  validateVisionEvalManifest,
  visionEvalManifestSchema,
  visionEvalManifestStats,
} from "./evaluation"
import {
  addSampleToManifest,
  datasetAnnotationsFileSchema,
  DEFAULT_SPLIT_RATIOS,
  parseSplitRatios,
} from "./dataset"

// CLI для приватного eval-датасета (фото и манифест НЕ живут в Git):
//   check      — целостность манифеста (дубликаты, leakage, golden)
//   stats      — покрытие по split/source/scenario/condition
//   add-sample — добавить фото + аннотации; split детерминированный
// Usage:
//   node --import tsx src/dataset-cli.ts check --manifest <path>
//   node --import tsx src/dataset-cli.ts stats --manifest <path>
//   node --import tsx src/dataset-cli.ts add-sample --manifest <path> \
//     --id <sampleId> --photo <file> --annotations <file.json> \
//     --planogram-version <id> [--golden-ref <photoRef>] [--scenario <s>] \
//     [--source real|synthetic] [--split auto|calibration|validation|test] \
//     [--ratios 40,40,20] [--notes <text>]

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function loadManifest(manifestPath: string) {
  return visionEvalManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")))
}

async function main() {
  const command = process.argv[2]
  const manifestPathArg = argument("--manifest")
  if (!command || !manifestPathArg) {
    throw new Error("Usage: dataset-cli <check|stats|add-sample> --manifest <path> [...]")
  }
  const manifestPath = resolve(manifestPathArg)
  const manifest = await loadManifest(manifestPath)

  if (command === "check") {
    const issues = validateVisionEvalManifest(manifest)
    if (issues.length > 0) {
      process.stderr.write(`${issues.join("\n")}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write("manifest_ok\n")
    return
  }

  if (command === "stats") {
    process.stdout.write(`${JSON.stringify(visionEvalManifestStats(manifest), null, 2)}\n`)
    return
  }

  if (command === "add-sample") {
    const id = argument("--id")
    const photoPathArg = argument("--photo")
    const annotationsPathArg = argument("--annotations")
    const planogramVersionId = argument("--planogram-version")
    if (!id || !photoPathArg || !annotationsPathArg || !planogramVersionId) {
      throw new Error("add-sample requires --id, --photo, --annotations, --planogram-version")
    }
    const sourceKind = argument("--source") ?? "real"
    if (sourceKind !== "real" && sourceKind !== "synthetic") {
      throw new Error(`invalid_source_kind:${sourceKind}`)
    }
    const split = argument("--split") ?? "auto"
    if (!["auto", "calibration", "validation", "test"].includes(split)) {
      throw new Error(`invalid_split:${split}`)
    }
    const ratiosArg = argument("--ratios")
    const ratios = ratiosArg ? parseSplitRatios(ratiosArg) : DEFAULT_SPLIT_RATIOS
    const annotations = datasetAnnotationsFileSchema.parse(
      JSON.parse(await readFile(resolve(annotationsPathArg), "utf8")),
    )

    // Фото копируется внутрь приватного датасета: photos/<id><ext>.
    const datasetRoot = dirname(manifestPath)
    const photoSource = resolve(photoPathArg)
    const extension = extname(photoSource).toLowerCase() || ".jpg"
    const photoRelative = `photos/${basename(id)}${extension}`
    const photoTarget = join(datasetRoot, photoRelative)
    const photoRef = `private://${manifest.datasetId}/${photoRelative}`

    const { manifest: next, assignedSplit } = addSampleToManifest(manifest, {
      id,
      photoRef,
      goldenReferenceRef: argument("--golden-ref") ?? null,
      planogramVersionId,
      scenario: argument("--scenario") as never,
      sourceKind,
      notes: argument("--notes"),
      split: split as never,
      ratios,
      annotations,
    })

    await mkdir(dirname(photoTarget), { recursive: true })
    await copyFile(photoSource, photoTarget)
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, "utf8")
    process.stdout.write(
      `${JSON.stringify({ id, photoRef, assignedSplit, sourceKind }, null, 2)}\n`,
    )
    return
  }

  throw new Error(`unknown_command:${command}`)
}

await main()
