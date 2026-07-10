import { cpSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const standaloneRoot = resolve(appRoot, ".next/standalone/apps/web")
const standaloneNext = resolve(standaloneRoot, ".next")
mkdirSync(standaloneNext, { recursive: true })
cpSync(resolve(appRoot, ".next/static"), resolve(standaloneNext, "static"), { recursive: true })
if (existsSync(resolve(appRoot, "public"))) {
  cpSync(resolve(appRoot, "public"), resolve(standaloneRoot, "public"), { recursive: true })
}
process.env.HOSTNAME ??= "127.0.0.1"
process.env.PORT ??= "3100"
await import(pathToFileURL(resolve(standaloneRoot, "server.js")).href)
