export type Point = { x: number; y: number }

export type ShapeType = 'rectangle' | 'circle'

export interface Shape {
    id: string
    label: string
    type: ShapeType
    x: number
    y: number
    width?: number
    height?: number
    radius?: number
    color: [number, number, number]
    colorStdDev?: [number, number, number]
    imageIndex: number
    auto?: boolean
    confidence?: number
}

export type WellPlateSize = 6 | 12 | 24 | 48 | 96

export interface WellPlateTemplate {
    size: WellPlateSize
    rows: number
    cols: number
}

export interface PlateOverlayState {
    template: WellPlateTemplate
    x: number
    y: number
    width: number
    height: number
}

export interface CommittedPoint {
    label: string
    y: number
}

export interface DetectionSettings {
    mode: 'circle' | 'rectangle'
    param1: number
    param2: number
    minRadius: number
    maxRadius: number
    restrictedArea: number
    minArea: number
    maxArea: number
    epsilon: number
    // Preprocessing settings
    brightness: number      // -100 to 100
    contrast: number        // 0.5 to 3.0
    claheEnabled: boolean   // Adaptive histogram equalization
    claheClipLimit: number  // 1.0 to 8.0
    sharpenEnabled: boolean
    sharpenAmount: number   // 0.5 to 3.0
    blurKernelSize: number  // 3, 5, 7, 9, 11
}

export interface AppState {
    images: HTMLImageElement[]
    currentImageIndex: number
    shapes: Shape[]
    committedPoints: CommittedPoint[]
    isGridView: boolean
    detectionSettings: DetectionSettings
    colorMode: 'RGB' | 'CMYK' | 'HSL' | 'HSV'
    rawRgbMode: boolean
    zoomLevel: number
    rotationAngle: number
    boundingBox: { x: number; y: number; width: number; height: number } | null
}

export const defaultDetectionSettings: DetectionSettings = {
    mode: 'circle',
    param1: 30,
    param2: 40,
    minRadius: 10,
    maxRadius: 100,
    restrictedArea: 70,
    minArea: 500,
    maxArea: 10000,
    epsilon: 0.02,
    // Preprocessing defaults
    brightness: 0,
    contrast: 1.0,
    claheEnabled: false,
    claheClipLimit: 2.0,
    sharpenEnabled: false,
    sharpenAmount: 1.0,
    blurKernelSize: 9
}
