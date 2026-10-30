import { execFile } from 'child_process'

let cache: Promise<string[]> | null = null

/** Installed font families, via .NET's InstalledFontCollection (asked once per run, then cached) */
export function installedFonts(): Promise<string[]> {
  cache ??= new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; ' +
          '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object Name'
      ],
      { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
      (err, out) => {
        if (err) {
          cache = null // try again next time
          return resolve([])
        }
        const names = out
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
        resolve([...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })))
      }
    )
  })
  return cache
}
