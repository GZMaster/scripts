// Name: Clip and Espanso
// Description: Trim a video to a short clip, convert to GIF/MP4, and register an Espanso trigger. Opens a related YouTube search.
// Author: GZMaster
// GitHub:

import "@johnlindquist/kit"
import YAML from "yaml"

// Small helpers
const sanitizeTrigger = (s: string) =>
  (s.startsWith(":") ? s : `:${s}`)
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .toLowerCase()

const findEspansoDir = async (): Promise<string> => {
  const candidates: string[] = []
  if (isMac) candidates.push(home("Library", "Application Support", "espanso"))
  if (isLinux) candidates.push(home(".config", "espanso"))
  if (isWin) {
    const appData = process.env.APPDATA || home("AppData", "Roaming")
    candidates.push(path.join(appData, "espanso"))
  }
  for (const dir of candidates) {
    if (await pathExists(dir)) return dir
  }
  // Fallback: ask user
  const picked = await selectFolder("Select your espanso config directory (contains a 'match' folder)")
  return picked
}

// Ensure ffmpeg/ffprobe
if (!which("ffmpeg") || !which("ffprobe")) {
  await div(
    md(`# Missing ffmpeg/ffprobe
Please install ffmpeg (which includes ffprobe) and try again.
- macOS: brew install ffmpeg
- Windows: winget install Gyan.FFmpeg or choco install ffmpeg
- Linux: sudo apt-get install ffmpeg`)
  )
  exit(1)
}

// Choose input video
let selection = (await getSelectedFile()) || ""
let inputPath = ""

if (selection) {
  const items = selection.split("\n").filter(Boolean)
  inputPath =
    items.length > 1
      ? await arg("Select a file", items.map(p => ({ name: path.basename(p), description: p, value: p })))
      : items[0]
} else {
  inputPath = await selectFile("Pick a video to clip")
}

if (!inputPath || !(await pathExists(inputPath))) {
  await notify({ title: "Clip and Espanso", body: "No valid file selected." })
  exit()
}

// Probe duration
let totalDurationSec = 0
try {
  const { stdout } = await $`ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 ${inputPath}`
  totalDurationSec = parseFloat(String(stdout).trim())
} catch {
  await notify({ title: "Clip and Espanso", body: "Failed to read duration. Ensure ffmpeg is installed." })
  exit()
}

const parsed = path.parse(inputPath)
const baseName = parsed.name
const suggestedTrigger = sanitizeTrigger(baseName)

// Gather settings
const [triggerRaw, caption, headStr, tailStr] = await fields([
  { label: "Espanso Trigger", value: suggestedTrigger },
  { label: "Caption / Search Keywords", value: baseName },
  { label: "Trim head (seconds)", value: "2" },
  { label: "Trim tail (seconds)", value: "2" },
])

const formatChoice = await arg("Output format", ["gif", "mp4"])

const trigger = sanitizeTrigger(triggerRaw || suggestedTrigger)
const head = Math.max(0, Number(headStr) || 0)
const tail = Math.max(0, Number(tailStr) || 0)
const newDuration = totalDurationSec - (head + tail)

if (!isFinite(newDuration) || newDuration <= 0) {
  await div(md(`Total duration (${totalDurationSec.toFixed(2)}s) is too short to remove ${head + tail}s.`))
  exit(1)
}

// Build output path
const stamped = Math.floor(Date.now() / 1000)
const outExt = formatChoice === "gif" ? ".gif" : ".mp4"
const outName = `${baseName}-clip-${stamped}${outExt}`
const outputPath = path.join(parsed.dir, outName)

// Step 1:
const cmd =
  formatChoice === "gif"
    ? `ffmpeg -y -ss ${head} -t ${newDuration.toFixed(3)} -i "${inputPath}" -vf "fps=12,scale=600:-1:flags=lanczos" -loop 0 "${outputPath}"`
    : `ffmpeg -y -ss ${head} -t ${newDuration.toFixed(3)} -i "${inputPath}" -c copy "${outputPath}"`

await div({
  html: md(`
## Processing Clip
- Input: ${path.basename(inputPath)}
- Trim head: ${head}s
- Trim tail: ${tail}s
- Output: ${path.basename(outputPath)}
- Format: ${formatChoice}

Running:

\`\`\`sh
${cmd}
\`\`\`
`),
  onInit: async () => {
    try {
      const result = await exec(cmd, { all: true })
      console.log(result.all || "")
      submit("done")
    } catch (error: any) {
      console.log(error?.all || error?.message || String(error))
      submit("error")
    }
  },
})

if (!(await pathExists(outputPath))) {
  await notify({ title: "Clip and Espanso", body: "Conversion failed." })
  exit(1)
}

await notify({ title: "Clip Ready", body: path.basename(outputPath) })
await revealFile(outputPath)

// Step 2:
type EspansoDoc = { matches?: { trigger: string; replace: string }[] }
const espansoDir = await findEspansoDir()
const matchDir = path.join(espansoDir, "match")
await ensureDir(matchDir)
const kitYmlPath = path.join(matchDir, "kit.yml")

let doc: EspansoDoc = { matches: [] }
try {
  if (await pathExists(kitYmlPath)) {
    const existing = await readFile(kitYmlPath, "utf8")
    const parsedYaml = YAML.parse(existing) as EspansoDoc
    doc.matches = Array.isArray(parsedYaml?.matches) ? parsedYaml.matches : []
  }
} catch {
  doc = { matches: [] }
}

// Create Markdown snippet pointing to the local file path
const rel = outputPath
const replacement =
  outExt === ".gif"
    ? `![${caption}](${rel})`
    : `[${caption}](${rel})`

// Update or add match
const idx = doc.matches!.findIndex(m => m.trigger === trigger)
if (idx >= 0) {
  doc.matches![idx].replace = replacement
} else {
  doc.matches!.push({ trigger, replace: replacement })
}

await div({
  html: md(`
## Registering Espanso Trigger
- Trigger: \`${trigger}\`
- Replacement (Markdown):

\`\`\`
${replacement}
\`\`\`
`),
  onInit: async () => {
    try {
      const yaml = YAML.stringify({ matches: doc.matches })
      await writeFile(kitYmlPath, yaml)
      try {
        await $`espanso restart`
      } catch {
        // espanso may not be running or not in PATH; ignore
      }
      submit("done")
    } catch (err) {
      console.log(err)
      submit("error")
    }
  },
})

await copy(replacement)
toast(`Trigger added: ${trigger} — Markdown copied to clipboard`, { autoClose: 3500 })

// Inspired by "Search on YouTube":
const query = (caption || baseName).toLowerCase().trim().replaceAll(" ", "+")
const yt = `https://www.youtube.com/results?search_query=${query}`
open(yt)