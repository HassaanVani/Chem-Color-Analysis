import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useApp } from '@/context/AppContext'
import type { Shape } from '@/types'
import { v4 as uuidv4 } from 'uuid'
import { ZoomIn, ZoomOut, Maximize, MousePointer2, Circle, Square, RotateCcw, RotateCw, Crop, X, Eye, EyeOff, Thermometer, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { extractColorFromShape, extractColorStats, rgbToCmyk } from '@/lib/imageUtils'
import { calibrateColor } from '@/lib/colorCalibration'
import { isOpenCVReady } from '@/lib/opencvUtils'
import { hitTestShape, getCursorForHit, type HitResult } from '@/hooks/useShapeDrag'
import { computeHeatmapColor } from '@/lib/plateUtils'
import type { PlateOverlayState } from '@/types'

type ColorChannel = 'red' | 'green' | 'blue' | 'cyan' | 'magenta' | 'yellow' | 'black' | 'magnitude'

interface ImageViewerProps {
    plateOverlay?: PlateOverlayState | null
    setPlateOverlay?: (overlay: PlateOverlayState | null) => void
    onConfirmPlate?: () => void
}

export function ImageViewer({ plateOverlay, setPlateOverlay, onConfirmPlate }: ImageViewerProps = {}) {
    const {
        images, currentImageIndex, setCurrentImageIndex, shapes, addShape, updateShape, setSelectedShapeId,
        zoomLevel, setZoomLevel, rotationAngle, setRotationAngle,
        detectionSettings, setDetectionSettings, selectedShapeId,
        boundingBox, setBoundingBox,
        calibrationMode, setCalibrationMode, setColorCalibration,
        heatmapMode, setHeatmapMode, heatmapChannel, setHeatmapChannel,
        rawRgbMode, colorCalibration
    } = useApp()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const calibrationModeRef = useRef(calibrationMode)
    useEffect(() => {
        calibrationModeRef.current = calibrationMode
    }, [calibrationMode])

    const [offset, setOffset] = useState({ x: 0, y: 0 })
    const [isDragging, setIsDragging] = useState(false)
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

    const [drawingMode, setDrawingMode] = useState<'none' | 'rectangle' | 'circle' | 'crop'>(
        detectionSettings.mode
    )
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawStart, setDrawStart] = useState({ x: 0, y: 0 })
    const [currentDraftShape, setCurrentDraftShape] = useState<Partial<Shape> | null>(null)
    const [spacePressed, setSpacePressed] = useState(false)
    const [lastTouchDist, setLastTouchDist] = useState(0)
    const [isTouchPanning, setIsTouchPanning] = useState(false)
    const [touchStartX, setTouchStartX] = useState(0)
    const [touchStartTime, setTouchStartTime] = useState(0)
    const [showPreprocessing, setShowPreprocessing] = useState(true)

    // Shape drag state
    const [shapeDragState, setShapeDragState] = useState<{
        shapeId: string
        hit: HitResult
        startPt: { x: number; y: number }
        startShape: { x: number; y: number; width?: number; height?: number; radius?: number }
    } | null>(null)

    const [plateDragCorner, setPlateDragCorner] = useState<string | null>(null)
    const [plateDragStart, setPlateDragStart] = useState<{ x: number; y: number; overlay: PlateOverlayState } | null>(null)

    const currentImage = images[currentImageIndex]

    const hasPreprocessing = detectionSettings.brightness !== 0 ||
        detectionSettings.contrast !== 1.0 ||
        detectionSettings.claheEnabled ||
        detectionSettings.sharpenEnabled

    const preprocessedImage = useMemo(() => {
        if (!currentImage || !hasPreprocessing || !showPreprocessing) return null

        const canvas = document.createElement('canvas')
        canvas.width = currentImage.width
        canvas.height = currentImage.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(currentImage, 0, 0)

        if (detectionSettings.brightness !== 0 || detectionSettings.contrast !== 1.0) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const data = imageData.data
            const brightness = detectionSettings.brightness
            const contrast = detectionSettings.contrast

            for (let i = 0; i < data.length; i += 4) {
                data[i] = Math.max(0, Math.min(255, contrast * (data[i] - 128) + 128 + brightness))
                data[i + 1] = Math.max(0, Math.min(255, contrast * (data[i + 1] - 128) + 128 + brightness))
                data[i + 2] = Math.max(0, Math.min(255, contrast * (data[i + 2] - 128) + 128 + brightness))
            }
            ctx.putImageData(imageData, 0, 0)
        }

        if (detectionSettings.claheEnabled && isOpenCVReady()) {
            try {
                const cv = window.cv!
                const src = cv.imread(canvas)
                const gray = new cv.Mat()
                cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

                const clahe = new cv.CLAHE(detectionSettings.claheClipLimit, new cv.Size(8, 8))
                clahe.apply(gray, gray)
                clahe.delete()

                const dst = new cv.Mat()
                cv.cvtColor(gray, dst, cv.COLOR_GRAY2RGBA)
                cv.imshow(canvas, dst)

                src.delete()
                gray.delete()
                dst.delete()
            } catch (e) {
                console.warn('CLAHE preview failed:', e)
            }
        }

        const img = new Image()
        img.src = canvas.toDataURL()
        return img
    }, [currentImage, detectionSettings.brightness, detectionSettings.contrast,
        detectionSettings.claheEnabled, detectionSettings.claheClipLimit,
        hasPreprocessing, showPreprocessing])

    const lastDetectionModeRef = useRef(detectionSettings.mode)
    useEffect(() => {
        if (detectionSettings.mode === lastDetectionModeRef.current) return
        lastDetectionModeRef.current = detectionSettings.mode
        if (drawingMode !== 'none' && drawingMode !== 'crop' && calibrationMode === 'none') {
            // Sync drawing tool when detection mode changes in settings
            const nextMode = detectionSettings.mode === 'circle' ? 'circle' as const : 'rectangle' as const
            queueMicrotask(() => setDrawingMode(nextMode))
        }
    }, [detectionSettings.mode, drawingMode, calibrationMode])

    const prevImageIndexRef = useRef(currentImageIndex)
    useEffect(() => {
        if (currentImageIndex === prevImageIndexRef.current) return
        prevImageIndexRef.current = currentImageIndex
        queueMicrotask(() => setOffset({ x: 0, y: 0 }))
    }, [currentImageIndex])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !e.repeat) {
                e.preventDefault()
                setSpacePressed(true)
            }
        }
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                setSpacePressed(false)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('keyup', handleKeyUp)
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('keyup', handleKeyUp)
        }
    }, [])

    const draw = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas || !currentImage) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)

        ctx.save()
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate((rotationAngle * Math.PI) / 180)
        ctx.scale(zoomLevel, zoomLevel)
        ctx.translate(-currentImage.width / 2 + offset.x / zoomLevel, -currentImage.height / 2 + offset.y / zoomLevel)

        const displayImage = (preprocessedImage && preprocessedImage.complete) ? preprocessedImage : currentImage
        ctx.drawImage(displayImage, 0, 0)

        if (boundingBox) {
            ctx.beginPath()
            ctx.strokeStyle = '#f97316'
            ctx.lineWidth = 3 / zoomLevel
            ctx.setLineDash([8 / zoomLevel, 4 / zoomLevel])
            ctx.rect(boundingBox.x, boundingBox.y, boundingBox.width, boundingBox.height)
            ctx.stroke()
            ctx.setLineDash([])

            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
            ctx.fillRect(0, 0, currentImage.width, boundingBox.y)
            ctx.fillRect(0, boundingBox.y + boundingBox.height, currentImage.width, currentImage.height - boundingBox.y - boundingBox.height)
            ctx.fillRect(0, boundingBox.y, boundingBox.x, boundingBox.height)
            ctx.fillRect(boundingBox.x + boundingBox.width, boundingBox.y, currentImage.width - boundingBox.x - boundingBox.width, boundingBox.height)

            ctx.fillStyle = '#f97316'
            ctx.font = `bold ${14 / zoomLevel}px sans-serif`
            ctx.fillText('ROI', boundingBox.x + 4 / zoomLevel, boundingBox.y + 16 / zoomLevel)
        }

        const currentShapes = shapes.filter(s => s.imageIndex === currentImageIndex)

        currentShapes.forEach(shape => {
            const isSelected = shape.id === selectedShapeId
            ctx.lineWidth = isSelected ? 4 / zoomLevel : 2 / zoomLevel

            if (shape.type === 'rectangle') {
                ctx.beginPath()
                ctx.strokeStyle = isSelected ? '#f59e0b' : '#3b82f6'
                ctx.fillStyle = isSelected ? 'rgba(245, 158, 11, 0.2)' : 'rgba(59, 130, 246, 0.1)'
                ctx.rect(shape.x, shape.y, shape.width || 0, shape.height || 0)
                ctx.fill()
                ctx.stroke()

                if (isSelected) {
                    ctx.shadowColor = '#f59e0b'
                    ctx.shadowBlur = 10 / zoomLevel
                    ctx.stroke()
                    ctx.shadowBlur = 0

                    // Draw corner handles
                    const w = shape.width || 0, h = shape.height || 0
                    const handleSize = 6 / zoomLevel
                    ctx.fillStyle = '#f59e0b'
                    for (const [cx, cy] of [[shape.x, shape.y], [shape.x + w, shape.y], [shape.x, shape.y + h], [shape.x + w, shape.y + h]]) {
                        ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize)
                    }
                }

                const sampleFactor = detectionSettings.restrictedArea / 100
                const margin = (1 - sampleFactor) / 2
                const sampleX = shape.x + (shape.width || 0) * margin
                const sampleY = shape.y + (shape.height || 0) * margin
                const sampleW = (shape.width || 0) * sampleFactor
                const sampleH = (shape.height || 0) * sampleFactor
                ctx.beginPath()
                ctx.strokeStyle = isSelected ? 'rgba(245, 158, 11, 0.6)' : 'rgba(59, 130, 246, 0.6)'
                ctx.lineWidth = 2 / zoomLevel
                ctx.setLineDash([3 / zoomLevel, 3 / zoomLevel])
                ctx.rect(sampleX, sampleY, sampleW, sampleH)
                ctx.stroke()
                ctx.setLineDash([])
            } else if (shape.type === 'circle') {
                ctx.beginPath()
                ctx.strokeStyle = isSelected ? '#f59e0b' : '#22c55e'
                ctx.fillStyle = isSelected ? 'rgba(245, 158, 11, 0.2)' : 'rgba(34, 197, 94, 0.1)'
                ctx.arc(shape.x, shape.y, shape.radius || 0, 0, 2 * Math.PI)
                ctx.fill()
                ctx.stroke()

                if (isSelected) {
                    ctx.shadowColor = '#f59e0b'
                    ctx.shadowBlur = 10 / zoomLevel
                    ctx.stroke()
                    ctx.shadowBlur = 0

                    // Draw edge highlight
                    ctx.beginPath()
                    ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)'
                    ctx.lineWidth = 6 / zoomLevel
                    ctx.arc(shape.x, shape.y, shape.radius || 0, 0, 2 * Math.PI)
                    ctx.stroke()
                }

                const sampleRadius = (shape.radius || 0) * (detectionSettings.restrictedArea / 100)
                ctx.beginPath()
                ctx.strokeStyle = isSelected ? 'rgba(245, 158, 11, 0.6)' : 'rgba(34, 197, 94, 0.6)'
                ctx.lineWidth = 2 / zoomLevel
                ctx.setLineDash([3 / zoomLevel, 3 / zoomLevel])
                ctx.arc(shape.x, shape.y, sampleRadius, 0, 2 * Math.PI)
                ctx.stroke()
                ctx.setLineDash([])
            }

            ctx.fillStyle = isSelected ? '#f59e0b' : 'white'
            ctx.strokeStyle = 'black'
            ctx.lineWidth = 3 / zoomLevel
            ctx.font = `bold ${(isSelected ? 16 : 14) / zoomLevel}px sans-serif`
            const labelX = shape.type === 'circle' ? shape.x - 5 / zoomLevel : shape.x
            const labelY = shape.type === 'circle' ? shape.y - (shape.radius || 0) - 5 / zoomLevel : shape.y - 5 / zoomLevel
            ctx.strokeText(shape.label, labelX, labelY)
            ctx.fillText(shape.label, labelX, labelY)
        })

        // Heatmap overlay
        if (heatmapMode && currentShapes.length > 0) {
            const getChannelValue = (color: [number, number, number], ch: string): number => {
                const c = rawRgbMode ? color : calibrateColor(color, colorCalibration)
                const cmyk = rgbToCmyk(c)
                switch (ch) {
                    case 'red': return c[0]
                    case 'green': return c[1]
                    case 'blue': return c[2]
                    case 'cyan': return cmyk[0] * 100
                    case 'magenta': return cmyk[1] * 100
                    case 'yellow': return cmyk[2] * 100
                    case 'black': return cmyk[3] * 100
                    case 'magnitude': return Math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2)
                    default: return 0
                }
            }
            const values = currentShapes.map(s => getChannelValue(s.color, heatmapChannel))
            const minV = Math.min(...values)
            const maxV = Math.max(...values)

            currentShapes.forEach((shape, i) => {
                const hc = computeHeatmapColor(values[i], minV, maxV)
                ctx.globalAlpha = 0.55
                ctx.fillStyle = `rgb(${hc[0]},${hc[1]},${hc[2]})`
                if (shape.type === 'circle') {
                    ctx.beginPath()
                    ctx.arc(shape.x, shape.y, shape.radius || 0, 0, 2 * Math.PI)
                    ctx.fill()
                } else {
                    ctx.fillRect(shape.x, shape.y, shape.width || 0, shape.height || 0)
                }
                ctx.globalAlpha = 1
            })

            // Legend bar
            const legendW = 120 / zoomLevel
            const legendH = 12 / zoomLevel
            const legendX = currentImage.width - legendW - 10 / zoomLevel
            const legendY = currentImage.height - legendH - 25 / zoomLevel
            for (let i = 0; i < 60; i++) {
                const t = i / 59
                const lc = computeHeatmapColor(minV + t * (maxV - minV), minV, maxV)
                ctx.fillStyle = `rgb(${lc[0]},${lc[1]},${lc[2]})`
                ctx.fillRect(legendX + (legendW * i) / 60, legendY, legendW / 60 + 1, legendH)
            }
            ctx.fillStyle = 'white'
            ctx.strokeStyle = 'black'
            ctx.lineWidth = 2 / zoomLevel
            ctx.font = `${10 / zoomLevel}px sans-serif`
            ctx.strokeText(minV.toFixed(0), legendX, legendY + legendH + 10 / zoomLevel)
            ctx.fillText(minV.toFixed(0), legendX, legendY + legendH + 10 / zoomLevel)
            const maxLabel = maxV.toFixed(0)
            const maxLabelW = ctx.measureText(maxLabel).width
            ctx.strokeText(maxLabel, legendX + legendW - maxLabelW, legendY + legendH + 10 / zoomLevel)
            ctx.fillText(maxLabel, legendX + legendW - maxLabelW, legendY + legendH + 10 / zoomLevel)
        }

        // Plate template overlay (positioning mode)
        if (plateOverlay) {
            const { template, x: px, y: py, width: pw, height: ph, rotation: plateRot, wellRadiusFactor: wrf } = plateOverlay
            const cellW = pw / template.cols
            const cellH = ph / template.rows
            const r = Math.min(cellW, cellH) * (wrf ?? 0.38)
            const plateCX = px + pw / 2
            const plateCY = py + ph / 2
            const plateRad = ((plateRot ?? 0) * Math.PI) / 180

            // Apply rotation around plate center
            ctx.save()
            ctx.translate(plateCX, plateCY)
            ctx.rotate(plateRad)
            ctx.translate(-plateCX, -plateCY)

            // Outer boundary
            ctx.strokeStyle = '#a855f7'
            ctx.lineWidth = 2 / zoomLevel
            ctx.setLineDash([6 / zoomLevel, 4 / zoomLevel])
            ctx.strokeRect(px, py, pw, ph)
            ctx.setLineDash([])

            // Wells
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)'
            ctx.lineWidth = 1.5 / zoomLevel
            for (let row = 0; row < template.rows; row++) {
                for (let col = 0; col < template.cols; col++) {
                    const cx = px + cellW * (col + 0.5)
                    const cy = py + cellH * (row + 0.5)
                    ctx.beginPath()
                    ctx.arc(cx, cy, r, 0, 2 * Math.PI)
                    ctx.stroke()
                }
            }

            // Corner drag handles
            const handleSize = 8 / zoomLevel
            ctx.fillStyle = '#a855f7'
            for (const [hx, hy] of [[px, py], [px + pw, py], [px, py + ph], [px + pw, py + ph]]) {
                ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize)
            }

            // Label
            ctx.fillStyle = '#a855f7'
            ctx.font = `bold ${14 / zoomLevel}px sans-serif`
            ctx.fillText(`${template.size}-well`, px + 4 / zoomLevel, py - 6 / zoomLevel)

            ctx.restore()
        }

        // Draw draft shape
        if (currentDraftShape && isDrawing) {
            ctx.beginPath()
            ctx.lineWidth = 2 / zoomLevel
            ctx.setLineDash([5 / zoomLevel, 5 / zoomLevel])

            const cm = calibrationModeRef.current
            if (cm === 'min') {
                ctx.strokeStyle = '#06b6d4'
                ctx.lineWidth = 3 / zoomLevel
                ctx.arc(currentDraftShape.x!, currentDraftShape.y!, currentDraftShape.radius || 0, 0, 2 * Math.PI)
            } else if (cm === 'max') {
                ctx.strokeStyle = '#d946ef'
                ctx.lineWidth = 3 / zoomLevel
                ctx.arc(currentDraftShape.x!, currentDraftShape.y!, currentDraftShape.radius || 0, 0, 2 * Math.PI)
            } else if (cm === 'white' || cm === 'black') {
                ctx.strokeStyle = cm === 'white' ? '#ffffff' : '#888888'
                ctx.lineWidth = 3 / zoomLevel
                ctx.arc(currentDraftShape.x!, currentDraftShape.y!, currentDraftShape.radius || 0, 0, 2 * Math.PI)
            } else if (drawingMode === 'rectangle') {
                ctx.strokeStyle = '#3b82f6'
                ctx.rect(currentDraftShape.x!, currentDraftShape.y!, currentDraftShape.width!, currentDraftShape.height!)
            } else if (drawingMode === 'circle') {
                ctx.strokeStyle = '#22c55e'
                ctx.arc(currentDraftShape.x!, currentDraftShape.y!, currentDraftShape.radius!, 0, 2 * Math.PI)
            } else if (drawingMode === 'crop') {
                ctx.strokeStyle = '#f97316'
                ctx.lineWidth = 3 / zoomLevel
                ctx.rect(currentDraftShape.x!, currentDraftShape.y!, currentDraftShape.width!, currentDraftShape.height!)
            }
            ctx.stroke()
            ctx.setLineDash([])
        }

        ctx.restore()
    }, [currentImage, zoomLevel, rotationAngle, offset, shapes, currentImageIndex, currentDraftShape, isDrawing, drawingMode, detectionSettings.restrictedArea, selectedShapeId, boundingBox, preprocessedImage, heatmapMode, heatmapChannel, rawRgbMode, colorCalibration, plateOverlay])

    useEffect(() => {
        draw()
    }, [draw])

    useEffect(() => {
        if (!preprocessedImage) return
        const handler = () => draw()
        preprocessedImage.addEventListener('load', handler)
        return () => preprocessedImage.removeEventListener('load', handler)
    }, [preprocessedImage, draw])

    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current && canvasRef.current) {
                canvasRef.current.width = containerRef.current.clientWidth
                canvasRef.current.height = containerRef.current.clientHeight
                draw()
            }
        }
        window.addEventListener('resize', handleResize)
        handleResize()
        return () => window.removeEventListener('resize', handleResize)
    }, [draw])

    const getImagePoint = (e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas || !currentImage) return { x: 0, y: 0 }
        const rect = canvas.getBoundingClientRect()

        const canvasX = e.clientX - rect.left
        const canvasY = e.clientY - rect.top

        const centerX = canvas.width / 2
        const centerY = canvas.height / 2

        let x = canvasX - centerX
        let y = canvasY - centerY

        const rad = (-rotationAngle * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const rx = x * cos - y * sin
        const ry = x * sin + y * cos

        x = rx / zoomLevel + currentImage.width / 2 - offset.x / zoomLevel
        y = ry / zoomLevel + currentImage.height / 2 - offset.y / zoomLevel

        return { x, y }
    }

    const handleMouseDown = (e: React.MouseEvent) => {
        const isCalibrating = calibrationModeRef.current !== 'none'

        // Plate overlay corner drag
        if (plateOverlay && setPlateOverlay) {
            const pt = getImagePoint(e)
            const { x: px, y: py, width: pw, height: ph, rotation: plateRot } = plateOverlay
            const tol = 15 / zoomLevel

            // Un-rotate the mouse point into plate-local space
            const plateCX = px + pw / 2
            const plateCY = py + ph / 2
            const negRad = -((plateRot ?? 0) * Math.PI) / 180
            const cosN = Math.cos(negRad)
            const sinN = Math.sin(negRad)
            const dx0 = pt.x - plateCX
            const dy0 = pt.y - plateCY
            const localPt = { x: plateCX + dx0 * cosN - dy0 * sinN, y: plateCY + dx0 * sinN + dy0 * cosN }

            const corners = [
                { name: 'tl', cx: px, cy: py },
                { name: 'tr', cx: px + pw, cy: py },
                { name: 'bl', cx: px, cy: py + ph },
                { name: 'br', cx: px + pw, cy: py + ph },
            ]
            for (const c of corners) {
                if (Math.abs(localPt.x - c.cx) < tol && Math.abs(localPt.y - c.cy) < tol) {
                    setPlateDragCorner(c.name)
                    setPlateDragStart({ x: pt.x, y: pt.y, overlay: { ...plateOverlay } })
                    return
                }
            }
            // Check body drag (inside the plate boundary, in local space)
            if (localPt.x >= px && localPt.x <= px + pw && localPt.y >= py && localPt.y <= py + ph) {
                setPlateDragCorner('body')
                setPlateDragStart({ x: pt.x, y: pt.y, overlay: { ...plateOverlay } })
                return
            }
        }

        // Pan mode: middle click, alt+click, spacebar
        if (e.button === 1 || (e.button === 0 && e.altKey) || spacePressed) {
            setIsDragging(true)
            setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
            return
        }

        // In 'none' mode (pan/select) and not calibrating: try hit-testing shapes
        if (drawingMode === 'none' && !isCalibrating) {
            const pt = getImagePoint(e)
            const currentShapes = shapes.filter(s => s.imageIndex === currentImageIndex)

            // Hit test in reverse order (top shape first)
            for (let i = currentShapes.length - 1; i >= 0; i--) {
                const shape = currentShapes[i]
                const hit = hitTestShape(pt, shape, zoomLevel)
                if (hit) {
                    setSelectedShapeId(shape.id)
                    setShapeDragState({
                        shapeId: shape.id,
                        hit,
                        startPt: pt,
                        startShape: {
                            x: shape.x,
                            y: shape.y,
                            width: shape.width,
                            height: shape.height,
                            radius: shape.radius
                        }
                    })
                    return
                }
            }

            // No shape hit - pan
            setSelectedShapeId(null)
            setIsDragging(true)
            setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
            return
        }

        // Start drawing
        setIsDrawing(true)
        const pt = getImagePoint(e)
        setDrawStart(pt)

        if (drawingMode === 'crop' && !isCalibrating) {
            setCurrentDraftShape({ x: pt.x, y: pt.y, width: 0, height: 0 })
        } else {
            setCurrentDraftShape({ x: pt.x, y: pt.y, width: 0, height: 0, radius: 0 })
        }
    }

    const handleMouseMove = (e: React.MouseEvent) => {
        // Plate overlay drag
        if (plateDragCorner && plateDragStart && plateOverlay && setPlateOverlay) {
            const pt = getImagePoint(e)
            const dx = pt.x - plateDragStart.x
            const dy = pt.y - plateDragStart.y
            const o = plateDragStart.overlay

            if (plateDragCorner === 'body') {
                setPlateOverlay({ ...plateOverlay, x: o.x + dx, y: o.y + dy })
            } else if (plateDragCorner === 'tl') {
                setPlateOverlay({ ...plateOverlay, x: o.x + dx, y: o.y + dy, width: o.width - dx, height: o.height - dy })
            } else if (plateDragCorner === 'tr') {
                setPlateOverlay({ ...plateOverlay, y: o.y + dy, width: o.width + dx, height: o.height - dy })
            } else if (plateDragCorner === 'bl') {
                setPlateOverlay({ ...plateOverlay, x: o.x + dx, width: o.width - dx, height: o.height + dy })
            } else if (plateDragCorner === 'br') {
                setPlateOverlay({ ...plateOverlay, width: o.width + dx, height: o.height + dy })
            }
            return
        }

        // Shape drag/resize
        if (shapeDragState) {
            const pt = getImagePoint(e)
            const dx = pt.x - shapeDragState.startPt.x
            const dy = pt.y - shapeDragState.startPt.y
            const s = shapeDragState.startShape

            if (shapeDragState.hit === 'body') {
                updateShape(shapeDragState.shapeId, { x: s.x + dx, y: s.y + dy })
            } else if (shapeDragState.hit === 'edge') {
                // Circle resize
                const distFromCenter = Math.sqrt(
                    (pt.x - s.x) ** 2 + (pt.y - s.y) ** 2
                )
                updateShape(shapeDragState.shapeId, { radius: Math.max(5, distFromCenter) })
            } else if (shapeDragState.hit?.startsWith('corner-')) {
                // Rectangle resize via corners
                const corner = shapeDragState.hit
                let newX = s.x, newY = s.y, newW = s.width || 0, newH = s.height || 0

                if (corner === 'corner-br') {
                    newW = (s.width || 0) + dx
                    newH = (s.height || 0) + dy
                } else if (corner === 'corner-bl') {
                    newX = s.x + dx
                    newW = (s.width || 0) - dx
                    newH = (s.height || 0) + dy
                } else if (corner === 'corner-tr') {
                    newY = s.y + dy
                    newW = (s.width || 0) + dx
                    newH = (s.height || 0) - dy
                } else if (corner === 'corner-tl') {
                    newX = s.x + dx
                    newY = s.y + dy
                    newW = (s.width || 0) - dx
                    newH = (s.height || 0) - dy
                }

                updateShape(shapeDragState.shapeId, {
                    x: newX, y: newY,
                    width: Math.max(10, newW),
                    height: Math.max(10, newH)
                })
            }
            return
        }

        if (isDragging) {
            setOffset({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            })
            return
        }

        if (isDrawing && currentDraftShape) {
            const pt = getImagePoint(e)
            const cm = calibrationModeRef.current
            if (cm !== 'none') {
                const dx = pt.x - drawStart.x
                const dy = pt.y - drawStart.y
                const radius = Math.sqrt(dx * dx + dy * dy)
                setCurrentDraftShape({ ...currentDraftShape, radius })
            } else if (drawingMode === 'rectangle' || drawingMode === 'crop') {
                setCurrentDraftShape({
                    ...currentDraftShape,
                    width: pt.x - drawStart.x,
                    height: pt.y - drawStart.y
                })
            } else if (drawingMode === 'circle') {
                const dx = pt.x - drawStart.x
                const dy = pt.y - drawStart.y
                const radius = Math.sqrt(dx * dx + dy * dy)
                setCurrentDraftShape({ ...currentDraftShape, radius })
            }
        }

        // Update cursor for shape hover in none mode
        if (drawingMode === 'none' && !isDragging && !shapeDragState && !isDrawing) {
            const pt = getImagePoint(e)
            const currentShapes = shapes.filter(s => s.imageIndex === currentImageIndex)
            let cursor = 'grab'
            for (let i = currentShapes.length - 1; i >= 0; i--) {
                const hit = hitTestShape(pt, currentShapes[i], zoomLevel)
                if (hit) {
                    cursor = getCursorForHit(hit)
                    break
                }
            }
            if (canvasRef.current) canvasRef.current.style.cursor = cursor
        }
    }

    const handleMouseUp = () => {
        // Finalize plate drag
        if (plateDragCorner) {
            setPlateDragCorner(null)
            setPlateDragStart(null)
            return
        }

        // Finalize shape drag
        if (shapeDragState) {
            // Re-extract color after drag
            if (currentImage) {
                const shape = shapes.find(s => s.id === shapeDragState.shapeId)
                if (shape) {
                    const tempCanvas = document.createElement('canvas')
                    tempCanvas.width = currentImage.width
                    tempCanvas.height = currentImage.height
                    const tempCtx = tempCanvas.getContext('2d')
                    if (tempCtx) {
                        tempCtx.drawImage(currentImage, 0, 0)
                        const stats = extractColorStats(tempCtx, shape)
                        updateShape(shape.id, { color: stats.mean, colorStdDev: stats.stdDev })
                    }
                }
            }
            setShapeDragState(null)
            return
        }

        if (isDragging) {
            setIsDragging(false)
            return
        }

        if (isDrawing && currentDraftShape && currentImage) {
            setIsDrawing(false)

            const minSize = 5

            if (drawingMode === 'crop') {
                if (Math.abs(currentDraftShape.width || 0) < minSize || Math.abs(currentDraftShape.height || 0) < minSize) {
                    setCurrentDraftShape(null)
                    return
                }

                const x = currentDraftShape.width! < 0 ? currentDraftShape.x! + currentDraftShape.width! : currentDraftShape.x!
                const y = currentDraftShape.height! < 0 ? currentDraftShape.y! + currentDraftShape.height! : currentDraftShape.y!
                const width = Math.abs(currentDraftShape.width!)
                const height = Math.abs(currentDraftShape.height!)

                setBoundingBox({ x, y, width, height })
                setCurrentDraftShape(null)
                return
            }

            const currentCalibrationMode = calibrationModeRef.current
            if (currentCalibrationMode !== 'none') {
                const radius = currentDraftShape.radius || 0
                if (radius < 3) {
                    setCurrentDraftShape(null)
                    return
                }

                if (currentCalibrationMode === 'min') {
                    setDetectionSettings(prev => ({ ...prev, minRadius: Math.round(radius) }))
                } else if (currentCalibrationMode === 'max') {
                    setDetectionSettings(prev => ({ ...prev, maxRadius: Math.round(radius) }))
                } else if (currentCalibrationMode === 'white' || currentCalibrationMode === 'black') {
                    // Extract average color from the drawn circle for calibration
                    const tempCanvas = document.createElement('canvas')
                    tempCanvas.width = currentImage.width
                    tempCanvas.height = currentImage.height
                    const tempCtx = tempCanvas.getContext('2d')
                    if (tempCtx) {
                        tempCtx.drawImage(currentImage, 0, 0)
                        const color = extractColorFromShape(tempCtx, {
                            type: 'circle',
                            x: currentDraftShape.x!,
                            y: currentDraftShape.y!,
                            radius
                        })
                        if (currentCalibrationMode === 'white') {
                            setColorCalibration(prev => ({ ...prev, whiteRef: color }))
                        } else {
                            setColorCalibration(prev => ({ ...prev, blackRef: color }))
                        }
                    }
                }

                setCalibrationMode('none')
                setCurrentDraftShape(null)
                return
            }

            if (drawingMode === 'rectangle') {
                if (Math.abs(currentDraftShape.width || 0) < minSize || Math.abs(currentDraftShape.height || 0) < minSize) {
                    setCurrentDraftShape(null)
                    return
                }
            } else if ((currentDraftShape.radius || 0) < minSize) {
                setCurrentDraftShape(null)
                return
            }

            const newShape: Shape = {
                id: uuidv4(),
                label: getNextLabel(),
                type: drawingMode as 'rectangle' | 'circle',
                x: currentDraftShape.x!,
                y: currentDraftShape.y!,
                width: currentDraftShape.width,
                height: currentDraftShape.height,
                radius: currentDraftShape.radius,
                color: [0, 0, 0],
                imageIndex: currentImageIndex
            }

            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = currentImage.width
            tempCanvas.height = currentImage.height
            const tempCtx = tempCanvas.getContext('2d')
            if (tempCtx) {
                tempCtx.drawImage(currentImage, 0, 0)
                const stats = extractColorStats(tempCtx, newShape)
                newShape.color = stats.mean
                newShape.colorStdDev = stats.stdDev
            }

            addShape(newShape)
            setCurrentDraftShape(null)
        }
    }

    const getNextLabel = () => {
        const english = 'abcdefghijklmnopqrstuvwxyz'
        const greek = '\u03b1\u03b2\u03b3\u03b4\u03b5\u03b6\u03b7\u03b8\u03b9\u03ba\u03bb\u03bc\u03bd\u03be\u03bf\u03c0\u03c1\u03c3\u03c4\u03c5\u03c6\u03c7\u03c8\u03c9'
        const arabic = '\u0627\u0628\u062a\u062b\u062c\u062d\u062e\u062f\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637\u0638\u0639\u063a\u0641\u0642\u0643\u0644\u0645\u0646\u0647\u0648\u064a'
        const allLabels = english + greek + arabic

        const usedLabels = new Set(shapes.map(s => s.label))

        for (const char of allLabels) {
            if (!usedLabels.has(char)) return char
        }

        let num = 1
        while (usedLabels.has(`#${num}`)) num++
        return `#${num}`
    }

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault()
        const delta = -e.deltaY * 0.001
        const newZoom = Math.min(Math.max(0.1, zoomLevel + delta), 10)
        setZoomLevel(newZoom)
    }

    const getTouchPoint = (touch: React.Touch) => {
        const canvas = canvasRef.current
        if (!canvas || !currentImage) return { x: 0, y: 0 }
        const rect = canvas.getBoundingClientRect()

        const canvasX = touch.clientX - rect.left
        const canvasY = touch.clientY - rect.top

        const centerX = canvas.width / 2
        const centerY = canvas.height / 2

        let x = canvasX - centerX
        let y = canvasY - centerY

        const rad = (-rotationAngle * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const rx = x * cos - y * sin
        const ry = x * sin + y * cos

        x = rx / zoomLevel + currentImage.width / 2 - offset.x / zoomLevel
        y = ry / zoomLevel + currentImage.height / 2 - offset.y / zoomLevel

        return { x, y }
    }

    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            )
            setLastTouchDist(dist)
            setIsTouchPanning(true)
        } else if (e.touches.length === 1) {
            const touch = e.touches[0]
            setTouchStartX(touch.clientX)
            setTouchStartTime(Date.now())
            if (drawingMode === 'none') {
                setIsTouchPanning(true)
                setDragStart({ x: touch.clientX - offset.x, y: touch.clientY - offset.y })
            } else {
                const pt = getTouchPoint(touch)
                setIsDrawing(true)
                setDrawStart(pt)
                setCurrentDraftShape({
                    x: pt.x,
                    y: pt.y,
                    width: 0,
                    height: 0,
                    radius: 0
                })
            }
        }
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 2 && lastTouchDist > 0) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            )
            const scale = dist / lastTouchDist
            setZoomLevel(Math.min(Math.max(0.1, zoomLevel * scale), 10))
            setLastTouchDist(dist)
        } else if (e.touches.length === 1) {
            const touch = e.touches[0]
            if (isTouchPanning && drawingMode === 'none') {
                setOffset({
                    x: touch.clientX - dragStart.x,
                    y: touch.clientY - dragStart.y
                })
            } else if (isDrawing && currentDraftShape) {
                const pt = getTouchPoint(touch)
                if (drawingMode === 'rectangle') {
                    setCurrentDraftShape({
                        ...currentDraftShape,
                        width: pt.x - drawStart.x,
                        height: pt.y - drawStart.y
                    })
                } else if (drawingMode === 'circle') {
                    const dx = pt.x - drawStart.x
                    const dy = pt.y - drawStart.y
                    const radius = Math.sqrt(dx * dx + dy * dy)
                    setCurrentDraftShape({ ...currentDraftShape, radius })
                }
            }
        }
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
        setLastTouchDist(0)
        setIsTouchPanning(false)

        // Detect horizontal swipe to navigate images
        if (drawingMode === 'none' && e.changedTouches.length === 1 && !shapeDragState) {
            const dx = e.changedTouches[0].clientX - touchStartX
            const dt = Date.now() - touchStartTime
            const velocity = Math.abs(dx) / dt

            if (Math.abs(dx) > 80 && velocity > 0.3 && dt < 500) {
                if (dx < 0 && currentImageIndex < images.length - 1) {
                    setCurrentImageIndex(currentImageIndex + 1)
                    return
                } else if (dx > 0 && currentImageIndex > 0) {
                    setCurrentImageIndex(currentImageIndex - 1)
                    return
                }
            }
        }

        handleMouseUp()
    }

    const getCursorClass = () => {
        if (isDragging || shapeDragState?.hit === 'body') return 'cursor-grabbing'
        if (spacePressed) return 'cursor-grab'
        if (drawingMode === 'none') return '' // cursor set via ref
        return 'cursor-crosshair'
    }

    return (
        <div className="relative w-full h-full bg-neutral-900 overflow-hidden pb-16 md:pb-0" ref={containerRef}>
            <canvas
                ref={canvasRef}
                className={`block touch-none ${getCursorClass()}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            />

            {/* Drawing Tools */}
            <div className="absolute top-14 md:top-16 left-2 md:left-4 flex flex-col gap-0.5 bg-card/95 backdrop-blur-lg p-1 md:p-1.5 rounded-lg shadow-xl border border-border/40">
                <Button
                    size="icon"
                    variant={drawingMode === 'none' ? 'default' : 'ghost'}
                    onClick={() => setDrawingMode('none')}
                    title="Pan/Select/Drag"
                    className="h-9 w-9 md:h-8 md:w-8"
                >
                    <MousePointer2 className="h-4 w-4" />
                </Button>
                <Button
                    size="icon"
                    variant={drawingMode === 'rectangle' ? 'default' : 'ghost'}
                    onClick={() => setDrawingMode('rectangle')}
                    title="Draw Rectangle"
                    className="h-9 w-9 md:h-8 md:w-8"
                >
                    <Square className="h-4 w-4" />
                </Button>
                <Button
                    size="icon"
                    variant={drawingMode === 'circle' ? 'default' : 'ghost'}
                    onClick={() => setDrawingMode('circle')}
                    title="Draw Circle"
                    className="h-9 w-9 md:h-8 md:w-8"
                >
                    <Circle className="h-4 w-4" />
                </Button>
                <div className="w-full h-px bg-muted-foreground/30 my-0.5" />
                <Button
                    size="icon"
                    variant={drawingMode === 'crop' ? 'default' : 'ghost'}
                    onClick={() => setDrawingMode('crop')}
                    title="Select Region of Interest"
                    className="h-9 w-9 md:h-8 md:w-8"
                >
                    <Crop className="h-4 w-4" />
                </Button>
                {boundingBox && (
                    <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setBoundingBox(null)}
                        title="Clear ROI"
                        className="h-9 w-9 md:h-8 md:w-8 text-orange-500 hover:text-orange-400"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
                {hasPreprocessing && (
                    <>
                        <div className="w-full h-px bg-muted-foreground/30 my-0.5" />
                        <Button
                            size="icon"
                            variant={showPreprocessing ? 'default' : 'ghost'}
                            onClick={() => setShowPreprocessing(!showPreprocessing)}
                            title={showPreprocessing ? "Hide preprocessing preview" : "Show preprocessing preview"}
                            className="h-9 w-9 md:h-8 md:w-8"
                        >
                            {showPreprocessing ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                    </>
                )}
                <div className="w-full h-px bg-muted-foreground/30 my-0.5" />
                <Button
                    size="icon"
                    variant={heatmapMode ? 'default' : 'ghost'}
                    onClick={() => setHeatmapMode(!heatmapMode)}
                    title={heatmapMode ? "Disable heatmap" : "Enable heatmap overlay"}
                    className="h-9 w-9 md:h-8 md:w-8"
                >
                    <Thermometer className="h-4 w-4" />
                </Button>
                {heatmapMode && (
                    <select
                        value={heatmapChannel}
                        onChange={e => setHeatmapChannel(e.target.value)}
                        className="w-full bg-background border rounded px-1 py-0.5 text-[9px]"
                        title="Heatmap channel"
                    >
                        {(['red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'black', 'magnitude'] as ColorChannel[]).map(ch => (
                            <option key={ch} value={ch}>{ch.slice(0, 3).toUpperCase()}</option>
                        ))}
                    </select>
                )}
            </div>

            {/* Plate template controls panel */}
            {plateOverlay && onConfirmPlate && setPlateOverlay && (
                <div className="absolute top-2 right-2 md:right-4 flex flex-col gap-2 bg-card/95 backdrop-blur-lg p-2.5 rounded-lg shadow-xl border border-purple-500/40 z-10 min-w-[200px]">
                    <div className="text-[11px] font-semibold text-purple-400 tracking-wide uppercase">{plateOverlay.template.size}-Well Plate</div>

                    {/* Rotation slider */}
                    <div className="space-y-0.5">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-medium text-muted-foreground">Rotation</label>
                            <span className="text-[10px] font-mono text-muted-foreground">{plateOverlay.rotation ?? 0}°</span>
                        </div>
                        <input
                            type="range"
                            min="-180"
                            max="180"
                            step="1"
                            value={plateOverlay.rotation ?? 0}
                            onChange={e => setPlateOverlay({ ...plateOverlay, rotation: Number(e.target.value) })}
                            className="w-full h-1.5 accent-purple-500 cursor-pointer"
                        />
                    </div>

                    {/* Well radius slider */}
                    <div className="space-y-0.5">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-medium text-muted-foreground">Well Radius</label>
                            <span className="text-[10px] font-mono text-muted-foreground">{Math.round((plateOverlay.wellRadiusFactor ?? 0.38) * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min="10"
                            max="90"
                            step="1"
                            value={Math.round((plateOverlay.wellRadiusFactor ?? 0.38) * 100)}
                            onChange={e => setPlateOverlay({ ...plateOverlay, wellRadiusFactor: Number(e.target.value) / 100 })}
                            className="w-full h-1.5 accent-purple-500 cursor-pointer"
                        />
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-1 pt-0.5">
                        <Button size="sm" variant="default" onClick={onConfirmPlate} className="flex-1 h-7 px-2 text-xs bg-purple-600 hover:bg-purple-700">
                            <Check className="h-3.5 w-3.5 mr-1" /> Confirm
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPlateOverlay(null)} className="h-7 px-2 text-xs">
                            <X className="h-3.5 w-3.5 mr-1" /> Cancel
                        </Button>
                    </div>
                </div>
            )}

            {/* Zoom/Rotation Controls */}
            <div className="absolute bottom-18 md:bottom-4 right-2 md:right-4 flex gap-0.5 md:gap-1 bg-card/95 backdrop-blur-lg p-1 md:p-1.5 rounded-lg shadow-xl border border-border/40">
                <Button size="icon" variant="ghost" onClick={() => setRotationAngle(rotationAngle - 1)} className="h-8 w-8">
                    <RotateCcw className="h-4 w-4" />
                </Button>
                <span className="hidden md:flex items-center text-xs w-10 justify-center">{rotationAngle}&deg;</span>
                <Button size="icon" variant="ghost" onClick={() => setRotationAngle(rotationAngle + 1)} className="h-8 w-8">
                    <RotateCw className="h-4 w-4" />
                </Button>
                <div className="w-px bg-muted-foreground/30 mx-0.5 md:mx-1" />
                <Button size="icon" variant="ghost" onClick={() => setZoomLevel(Math.max(0.1, zoomLevel - 0.1))} className="h-8 w-8">
                    <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="hidden md:flex items-center text-xs w-12 justify-center">{Math.round(zoomLevel * 100)}%</span>
                <Button size="icon" variant="ghost" onClick={() => setZoomLevel(Math.min(10, zoomLevel + 0.1))} className="h-8 w-8">
                    <ZoomIn className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => { setZoomLevel(1); setOffset({ x: 0, y: 0 }); setRotationAngle(0) }} className="h-8 w-8">
                    <Maximize className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
