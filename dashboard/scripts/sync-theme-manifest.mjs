import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(here, "../../shared/themes/builtins.json")
const targetPath = resolve(here, "../generated/themes/builtins.json")

await mkdir(dirname(targetPath), { recursive: true })
const payload = await readFile(sourcePath, "utf8")
await writeFile(targetPath, payload)
