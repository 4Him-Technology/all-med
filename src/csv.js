// RFC 4180: aspas duplas protegem vírgula, quebra de linha e aspas escapadas ("")
export function parseCsv(text) {
  const s = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }

  const [header, ...data] = rows
  if (!header) return []
  const keys = header.map((h) => h.trim())
  return data.filter((r) => r.some((v) => v !== '')).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])))
}
