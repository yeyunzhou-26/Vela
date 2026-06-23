import zlib from 'zlib'

export async function assertNoEnglishShellChrome(page, label) {
  const bodyText = await page.locator('body').innerText()
  const forbidden = [
    'Dashboard',
    'dashboard',
    'Mission Workspace',
    'Mission List',
    'Mission Plan',
    'Mission guard',
    'Next step',
    'Voice intent',
    'Voice controls',
    'Listen',
    'Stop',
    'Repair',
    'Command or search the current mission',
    'Permission mode',
    'Send to Review',
    'Inspect Spine',
    'Open Guard',
    'Open Review',
    'Approve permission',
    'Record passed check',
    'Smoke Runtime Mission',
    'Policy Blocked Mission',
    'Blocked Review Mission',
    'Smoke UI Mission',
    'Build Vela Shell',
    'Verify Vela mission persistence reaches the first screen.',
    'Resume this mission from persisted runtime state.',
    'Smoke spine data is loaded from the runtime.',
    'Shell Handoff Note',
    'Seed Shell Snapshot',
    'Artifact handoff remains inspectable',
    'Build shell action',
    'Initial shell contract holds',
    'Unresolved shell review check',
    'Reviewer is missing one runtime evidence link.',
    'Entry visual permission gate',
    'Entry visual review blocker',
    'Execute blocked mutation',
    'Evidence trace review',
    'raw failure detail should stay in the spine',
  ]
  const matches = forbidden.filter(item => bodyText.includes(item))
  if (matches.length) {
    const snippets = matches.map(item => {
      const index = bodyText.indexOf(item)
      const start = Math.max(0, index - 40)
      const end = Math.min(bodyText.length, index + item.length + 40)
      return `${item}: ${bodyText.slice(start, end).replace(/\s+/g, ' ')}`
    })
    throw new Error(`${label} leaked English shell chrome: ${matches.join(', ')}\n${snippets.join('\n')}`)
  }
}

export async function assertNoClippedUiText(page, label) {
  const clipped = await page.evaluate(() => {
    const selectors = [
      '.mode-segment-button',
      '.workspace-mode-tab',
      '.voice-control',
      '.voice-states span',
      '.step-action',
      '.attention-action',
      '.surface-row-action',
      '.surface-review-action',
      '.artifact-review-action',
      '.quick-command',
      '.mission-list-item strong',
    ]
    return [...document.querySelectorAll(selectors.join(','))]
      .filter(element => {
        const style = window.getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.width > 1
          && rect.height > 1
          && String(element.textContent || '').trim()
      })
      .map(element => ({
        selector: selectors.find(selector => element.matches(selector)) || element.tagName.toLowerCase(),
        text: String(element.textContent || '').trim().replace(/\s+/g, ' '),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }))
      .filter(item => item.scrollWidth > item.clientWidth + 2 || item.scrollHeight > item.clientHeight + 2)
  })
  if (clipped.length) {
    throw new Error(`${label} has clipped UI text: ${JSON.stringify(clipped.slice(0, 6))}`)
  }
}

export async function assertFocusedWorkbenchGeometry(page, label) {
  const geometry = await page.evaluate(() => {
    function box(selector) {
      const element = document.querySelector(selector)
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      command: box('.top-command-bar'),
      rail: box('.mission-rail'),
      workspace: box('.mission-workspace'),
      spine: box('.intelligence-spine'),
      voice: box('.voice-layer'),
      collapsed: document.querySelector('.intelligence-spine')?.dataset.collapsed || '',
    }
  })
  const { viewport, command, rail, workspace, spine, voice, collapsed } = geometry
  if (!command || !rail || !workspace || !spine || !voice) {
    throw new Error(`${label} missing focused workbench regions: ${JSON.stringify(geometry)}`)
  }
  if (collapsed !== 'true') throw new Error(`${label} should keep Intelligence Spine collapsed: ${collapsed}`)
  if (command.top > 1 || command.height < 44 || command.height > 88 || command.right < viewport.width - 2) {
    throw new Error(`${label} command bar geometry drifted: ${JSON.stringify(command)}`)
  }
  if (rail.left > 1 || rail.right > workspace.left + 1 || rail.top < command.bottom - 1) {
    throw new Error(`${label} rail overlaps command/workspace geometry: ${JSON.stringify({ command, rail, workspace })}`)
  }
  if (workspace.left < rail.right - 1 || workspace.right > spine.left + 1 || workspace.top < command.bottom - 1) {
    throw new Error(`${label} workspace no longer preserves the center surface: ${JSON.stringify({ command, rail, workspace, spine })}`)
  }
  if (spine.width < 52 || spine.width > 96 || spine.right < viewport.width - 1) {
    throw new Error(`${label} collapsed spine geometry drifted: ${JSON.stringify({ spine, viewport })}`)
  }
  if (workspace.width < Math.min(360, viewport.width * 0.45) || workspace.height < Math.min(420, viewport.height * 0.50)) {
    throw new Error(`${label} workspace became too cramped: ${JSON.stringify({ workspace, viewport })}`)
  }
  if (voice.bottom < viewport.height - 28 || voice.width < Math.min(360, viewport.width * 0.42) || voice.left < rail.right - 1 || voice.right > spine.left + 1) {
    throw new Error(`${label} voice layer is no longer bottom-centered in the workbench: ${JSON.stringify({ voice, rail, spine, viewport })}`)
  }
}

function assertPng(buffer, expectedWidth, expectedHeight, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw new Error(`${label} screenshot was not captured`)
  }
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') {
    throw new Error(`${label} screenshot is not a PNG`)
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${label} screenshot size mismatch: ${width}x${height}`)
  }
  if (buffer.length < 12000) {
    throw new Error(`${label} screenshot is unexpectedly small`)
  }
}

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  return pb <= pc ? up : upLeft
}

function decodePng(buffer, label) {
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error(`${label} screenshot is not a PNG`)

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idatChunks = []

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error(`${label} screenshot PNG is truncated`)
    const data = buffer.subarray(dataStart, dataEnd)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }

  const channelsByType = { 0: 1, 2: 3, 4: 2, 6: 4 }
  const channels = channelsByType[colorType]
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(`${label} screenshot PNG format is unsupported: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`)
  }
  if (!width || !height || !idatChunks.length) throw new Error(`${label} screenshot PNG is missing image data`)

  const raw = zlib.inflateSync(Buffer.concat(idatChunks))
  const stride = width * channels
  const expectedRawSize = (stride + 1) * height
  if (raw.length < expectedRawSize) {
    throw new Error(`${label} screenshot PNG data is too small: ${raw.length} < ${expectedRawSize}`)
  }

  const rgba = new Uint8ClampedArray(width * height * 4)
  const previous = Buffer.alloc(stride)
  const row = Buffer.alloc(stride)
  let source = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source]
    source += 1
    for (let x = 0; x < stride; x += 1) {
      const value = raw[source]
      source += 1
      const left = x >= channels ? row[x - channels] : 0
      const up = previous[x]
      const upLeft = x >= channels ? previous[x - channels] : 0
      if (filter === 0) row[x] = value
      else if (filter === 1) row[x] = (value + left) & 255
      else if (filter === 2) row[x] = (value + up) & 255
      else if (filter === 3) row[x] = (value + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) row[x] = (value + paethPredictor(left, up, upLeft)) & 255
      else throw new Error(`${label} screenshot PNG uses unsupported filter ${filter}`)
    }

    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * channels
      const targetIndex = (y * width + x) * 4
      if (colorType === 0) {
        const gray = row[sourceIndex]
        rgba[targetIndex] = gray
        rgba[targetIndex + 1] = gray
        rgba[targetIndex + 2] = gray
        rgba[targetIndex + 3] = 255
      } else if (colorType === 2) {
        rgba[targetIndex] = row[sourceIndex]
        rgba[targetIndex + 1] = row[sourceIndex + 1]
        rgba[targetIndex + 2] = row[sourceIndex + 2]
        rgba[targetIndex + 3] = 255
      } else if (colorType === 4) {
        const gray = row[sourceIndex]
        rgba[targetIndex] = gray
        rgba[targetIndex + 1] = gray
        rgba[targetIndex + 2] = gray
        rgba[targetIndex + 3] = row[sourceIndex + 1]
      } else {
        rgba[targetIndex] = row[sourceIndex]
        rgba[targetIndex + 1] = row[sourceIndex + 1]
        rgba[targetIndex + 2] = row[sourceIndex + 2]
        rgba[targetIndex + 3] = row[sourceIndex + 3]
      }
    }
    previous.set(row)
  }

  return { width, height, rgba }
}

function pixelStats(image, rect = {}) {
  const left = Math.max(0, Math.floor(rect.left ?? 0))
  const top = Math.max(0, Math.floor(rect.top ?? 0))
  const right = Math.min(image.width, Math.ceil(rect.right ?? image.width))
  const bottom = Math.min(image.height, Math.ceil(rect.bottom ?? image.height))
  const step = Math.max(1, Math.floor(rect.step ?? 4))
  const topLeft = [
    image.rgba[0],
    image.rgba[1],
    image.rgba[2],
  ]
  let total = 0
  let visible = 0
  let contrastPixels = 0
  let minLum = 255
  let maxLum = 0
  let sumLum = 0
  let sumLumSq = 0
  const colors = new Set()

  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      total += 1
      const index = (y * image.width + x) * 4
      const r = image.rgba[index]
      const g = image.rgba[index + 1]
      const b = image.rgba[index + 2]
      const a = image.rgba[index + 3]
      if (a <= 16) continue
      visible += 1
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      minLum = Math.min(minLum, lum)
      maxLum = Math.max(maxLum, lum)
      sumLum += lum
      sumLumSq += lum * lum
      colors.add(`${r >> 4},${g >> 4},${b >> 4}`)
      const delta = Math.abs(r - topLeft[0]) + Math.abs(g - topLeft[1]) + Math.abs(b - topLeft[2])
      if (delta > 36) contrastPixels += 1
    }
  }

  const mean = visible ? sumLum / visible : 0
  const variance = visible ? Math.max(0, (sumLumSq / visible) - (mean * mean)) : 0
  return {
    total,
    visible,
    uniqueColors: colors.size,
    luminanceRange: visible ? maxLum - minLum : 0,
    luminanceStdDev: Math.sqrt(variance),
    visibleRatio: total ? visible / total : 0,
    contrastRatio: visible ? contrastPixels / visible : 0,
  }
}

function assertRegionPixels(image, rect, label, { minUniqueColors, minLuminanceRange, minContrastRatio = 0.01 }) {
  const stats = pixelStats(image, rect)
  if (stats.visibleRatio < 0.98 || stats.uniqueColors < minUniqueColors || stats.luminanceRange < minLuminanceRange || stats.contrastRatio < minContrastRatio) {
    throw new Error(`${label} region looks blank or flat: ${JSON.stringify(stats)}`)
  }
}

export function assertVisualScreenshot(buffer, expectedWidth, expectedHeight, label) {
  assertPng(buffer, expectedWidth, expectedHeight, label)
  const image = decodePng(buffer, label)
  const overall = pixelStats(image)
  if (overall.uniqueColors < 28 || overall.luminanceRange < 70 || overall.luminanceStdDev < 16 || overall.contrastRatio < 0.03) {
    throw new Error(`${label} screenshot lacks visual detail: ${JSON.stringify(overall)}`)
  }
  assertRegionPixels(image, { top: 0, bottom: Math.min(96, image.height), step: 3 }, `${label} command bar`, {
    minUniqueColors: 10,
    minLuminanceRange: 36,
  })
  assertRegionPixels(image, {
    left: Math.round(image.width * 0.16),
    right: Math.round(image.width * 0.86),
    top: Math.round(image.height * 0.18),
    bottom: Math.round(image.height * 0.70),
    step: 4,
  }, `${label} mission workspace`, {
    minUniqueColors: 16,
    minLuminanceRange: 45,
    minContrastRatio: 0.015,
  })
  assertRegionPixels(image, {
    left: Math.max(0, image.width - 88),
    right: image.width,
    top: Math.round(image.height * 0.12),
    bottom: Math.round(image.height * 0.82),
    step: 3,
  }, `${label} collapsed spine`, {
    minUniqueColors: 8,
    minLuminanceRange: 32,
  })
  assertRegionPixels(image, {
    left: Math.round(image.width * 0.22),
    right: Math.round(image.width * 0.78),
    top: Math.round(image.height * 0.78),
    bottom: image.height,
    step: 3,
  }, `${label} voice layer`, {
    minUniqueColors: 10,
    minLuminanceRange: 36,
  })
}

export async function assertFocusedWorkbenchScreenshot(page, label, screenshotPath, expectedWidth, expectedHeight) {
  await assertNoEnglishShellChrome(page, label)
  await assertNoClippedUiText(page, label)
  await assertFocusedWorkbenchGeometry(page, label)
  assertVisualScreenshot(
    await page.screenshot({ path: screenshotPath }),
    expectedWidth,
    expectedHeight,
    label,
  )
}
