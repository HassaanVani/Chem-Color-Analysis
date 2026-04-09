import type { Shape } from '@/types'

/**
 * Compute detection confidence for a circle shape.
 * Uses edge gradient strength and interior color uniformity.
 * Expects a full-image ImageData buffer for efficiency (one getImageData per image).
 */
export function computeCircleConfidence(
    imageData: ImageData,
    shape: Shape
): number {
    const { x: cx, y: cy, radius } = shape
    if (!radius || radius < 3) return 0
    const { data, width, height } = imageData

    // 1. Edge gradient score: sample points along the circle boundary
    // Compare intensity just inside vs just outside the edge
    const numSamples = Math.min(36, Math.max(12, Math.round(radius * 2)))
    let gradientSum = 0
    let gradientCount = 0
    const band = Math.max(2, radius * 0.1)

    for (let i = 0; i < numSamples; i++) {
        const angle = (2 * Math.PI * i) / numSamples

        const innerX = Math.round(cx + (radius - band) * Math.cos(angle))
        const innerY = Math.round(cy + (radius - band) * Math.sin(angle))
        const outerX = Math.round(cx + (radius + band) * Math.cos(angle))
        const outerY = Math.round(cy + (radius + band) * Math.sin(angle))

        if (innerX < 0 || innerX >= width || innerY < 0 || innerY >= height) continue
        if (outerX < 0 || outerX >= width || outerY < 0 || outerY >= height) continue

        const innerIdx = (innerY * width + innerX) * 4
        const outerIdx = (outerY * width + outerX) * 4
        const innerGray = 0.299 * data[innerIdx] + 0.587 * data[innerIdx + 1] + 0.114 * data[innerIdx + 2]
        const outerGray = 0.299 * data[outerIdx] + 0.587 * data[outerIdx + 1] + 0.114 * data[outerIdx + 2]

        gradientSum += Math.abs(innerGray - outerGray)
        gradientCount++
    }

    // Normalize: a 50+ gray level difference is considered strong
    const edgeScore = gradientCount > 0
        ? Math.min(1, (gradientSum / gradientCount) / 50)
        : 0

    // 2. Color uniformity: sample interior and compute coefficient of variation
    const uniformity = computeInteriorUniformity(data, width, height, cx, cy, radius * 0.6)

    // Combined score: weight edge more for detection quality
    return clamp01(0.5 * edgeScore + 0.5 * uniformity)
}

/**
 * Compute detection confidence for a rectangle shape.
 * Uses edge sharpness, aspect ratio, and color uniformity.
 */
export function computeRectConfidence(
    imageData: ImageData,
    shape: Shape
): number {
    const w = shape.width || 0
    const h = shape.height || 0
    if (w < 3 || h < 3) return 0
    const { data, width, height } = imageData

    // 1. Aspect ratio score: closer to square is better for well plates
    const aspect = Math.max(w, h) / Math.min(w, h)
    const aspectScore = Math.max(0, 1 - (aspect - 1) * 0.5) // 1.0 at square, 0 at 3:1

    // 2. Edge sharpness: sample along all 4 edges
    const band = Math.max(2, Math.min(w, h) * 0.05)
    let gradientSum = 0
    let gradientCount = 0

    const sampleEdge = (x1: number, y1: number, x2: number, y2: number, nx: number, ny: number) => {
        const steps = Math.max(4, Math.round(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 4))
        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1)
            const ex = Math.round(x1 + (x2 - x1) * t)
            const ey = Math.round(y1 + (y2 - y1) * t)
            const ix = Math.round(ex - nx * band)
            const iy = Math.round(ey - ny * band)
            const ox = Math.round(ex + nx * band)
            const oy = Math.round(ey + ny * band)

            if (ix < 0 || ix >= width || iy < 0 || iy >= height) continue
            if (ox < 0 || ox >= width || oy < 0 || oy >= height) continue

            const iIdx = (iy * width + ix) * 4
            const oIdx = (oy * width + ox) * 4
            const iGray = 0.299 * data[iIdx] + 0.587 * data[iIdx + 1] + 0.114 * data[iIdx + 2]
            const oGray = 0.299 * data[oIdx] + 0.587 * data[oIdx + 1] + 0.114 * data[oIdx + 2]
            gradientSum += Math.abs(iGray - oGray)
            gradientCount++
        }
    }

    // Top, bottom, left, right edges with outward normals
    sampleEdge(shape.x, shape.y, shape.x + w, shape.y, 0, -1)         // top
    sampleEdge(shape.x, shape.y + h, shape.x + w, shape.y + h, 0, 1)  // bottom
    sampleEdge(shape.x, shape.y, shape.x, shape.y + h, -1, 0)         // left
    sampleEdge(shape.x + w, shape.y, shape.x + w, shape.y + h, 1, 0)  // right

    const edgeScore = gradientCount > 0
        ? Math.min(1, (gradientSum / gradientCount) / 50)
        : 0

    // 3. Interior uniformity
    const uniformity = computeInteriorUniformityRect(data, width, height, shape.x, shape.y, w, h)

    return clamp01(0.3 * aspectScore + 0.4 * edgeScore + 0.3 * uniformity)
}

function computeInteriorUniformity(
    data: Uint8ClampedArray,
    imgW: number, imgH: number,
    cx: number, cy: number,
    sampleRadius: number
): number {
    const r2 = sampleRadius * sampleRadius
    const x0 = Math.max(0, Math.floor(cx - sampleRadius))
    const y0 = Math.max(0, Math.floor(cy - sampleRadius))
    const x1 = Math.min(imgW, Math.ceil(cx + sampleRadius))
    const y1 = Math.min(imgH, Math.ceil(cy + sampleRadius))

    let sum = 0, sumSq = 0, count = 0
    for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
            const dx = px - cx, dy = py - cy
            if (dx * dx + dy * dy > r2) continue
            const idx = (py * imgW + px) * 4
            const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
            sum += gray
            sumSq += gray * gray
            count++
        }
    }
    if (count < 4) return 0.5
    const mean = sum / count
    const variance = sumSq / count - mean * mean
    const cv = mean > 0 ? Math.sqrt(Math.max(0, variance)) / mean : 1
    // cv < 0.05 is very uniform, cv > 0.3 is noisy
    return Math.min(1, Math.max(0, 1 - cv * 3))
}

function computeInteriorUniformityRect(
    data: Uint8ClampedArray,
    imgW: number, imgH: number,
    sx: number, sy: number,
    sw: number, sh: number
): number {
    const margin = 0.2
    const x0 = Math.max(0, Math.floor(sx + sw * margin))
    const y0 = Math.max(0, Math.floor(sy + sh * margin))
    const x1 = Math.min(imgW, Math.ceil(sx + sw * (1 - margin)))
    const y1 = Math.min(imgH, Math.ceil(sy + sh * (1 - margin)))

    let sum = 0, sumSq = 0, count = 0
    for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
            const idx = (py * imgW + px) * 4
            const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
            sum += gray
            sumSq += gray * gray
            count++
        }
    }
    if (count < 4) return 0.5
    const mean = sum / count
    const variance = sumSq / count - mean * mean
    const cv = mean > 0 ? Math.sqrt(Math.max(0, variance)) / mean : 1
    return Math.min(1, Math.max(0, 1 - cv * 3))
}

export function getConfidenceColor(score: number): string {
    if (score >= 0.7) return '#22c55e' // green-500
    if (score >= 0.4) return '#f59e0b' // amber-500
    return '#ef4444'                    // red-500
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v))
}
