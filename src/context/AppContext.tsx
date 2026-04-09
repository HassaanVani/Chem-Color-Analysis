import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { Shape, CommittedPoint, DetectionSettings, AppState } from '../types'
import { defaultDetectionSettings } from '../types'
import type { RegressionModel } from '../lib/regressionUtils'
import type { ColorCalibration } from '../lib/colorCalibration'
import { defaultColorCalibration } from '../lib/colorCalibration'
import { useUndoRedo } from '../hooks/useUndoRedo'
import {
    loadCachedImages,
    loadCachedAppState,
    debouncedSaveState,
    forceSaveState,
    clearAllCache,
    hasCachedData,
    setSaveErrorCallback
} from '../lib/cacheUtils'

interface AppContextType extends AppState {
    setImages: React.Dispatch<React.SetStateAction<HTMLImageElement[]>>
    setCurrentImageIndex: (index: number) => void
    setShapes: React.Dispatch<React.SetStateAction<Shape[]>>
    addShape: (shape: Shape) => void
    removeShape: (id: string) => void
    updateShape: (id: string, updates: Partial<Shape>) => void
    clearShapesForImage: (imageIndex: number) => void
    removeImage: (imageIndex: number) => void
    clearAllImages: () => void
    regressionModels: Record<string, RegressionModel>
    setRegressionModels: React.Dispatch<React.SetStateAction<Record<string, RegressionModel>>>
    setCommittedPoints: React.Dispatch<React.SetStateAction<CommittedPoint[]>>
    setIsGridView: (isGrid: boolean) => void
    setDetectionSettings: React.Dispatch<React.SetStateAction<DetectionSettings>>
    setColorMode: (mode: 'RGB' | 'CMYK' | 'HSL' | 'HSV') => void
    setRawRgbMode: (raw: boolean) => void
    setZoomLevel: (zoom: number) => void
    setRotationAngle: (angle: number) => void
    setBoundingBox: (box: { x: number; y: number; width: number; height: number } | null) => void
    selectedShapeId: string | null
    setSelectedShapeId: (id: string | null) => void
    calibrationMode: 'none' | 'min' | 'max' | 'white' | 'black'
    setCalibrationMode: (mode: 'none' | 'min' | 'max' | 'white' | 'black') => void
    colorCalibration: ColorCalibration
    setColorCalibration: React.Dispatch<React.SetStateAction<ColorCalibration>>
    undo: () => void
    redo: () => void
    canUndo: boolean
    canRedo: boolean
    heatmapMode: boolean
    setHeatmapMode: (mode: boolean) => void
    heatmapChannel: string
    setHeatmapChannel: (channel: string) => void
    // Cache controls
    clearCache: () => Promise<void>
    saveCache: () => void
    isCacheLoaded: boolean
    lastSaveError: string | null
    clearSaveError: () => void
}

const AppContext = createContext<AppContextType | undefined>(undefined)

export function AppProvider({ children }: { children: React.ReactNode }) {
    const [images, setImages] = useState<HTMLImageElement[]>([])
    const [currentImageIndex, setCurrentImageIndex] = useState(0)
    const [shapes, setShapesInternal] = useState<Shape[]>([])
    const [regressionModels, setRegressionModels] = useState<Record<string, RegressionModel>>({})
    const [committedPoints, setCommittedPoints] = useState<CommittedPoint[]>([])
    const [isGridView, setIsGridView] = useState(false)
    const [detectionSettings, setDetectionSettings] = useState<DetectionSettings>(defaultDetectionSettings)
    const [colorMode, setColorMode] = useState<'RGB' | 'CMYK' | 'HSL' | 'HSV'>('RGB')
    const [rawRgbMode, setRawRgbMode] = useState(true)
    const [zoomLevel, setZoomLevel] = useState(1)
    const [rotationAngle, setRotationAngle] = useState(0)
    const [boundingBox, setBoundingBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
    const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null)
    const [calibrationMode, setCalibrationMode] = useState<'none' | 'min' | 'max' | 'white' | 'black'>('none')
    const [colorCalibration, setColorCalibration] = useState<ColorCalibration>(defaultColorCalibration)
    const [heatmapMode, setHeatmapMode] = useState(false)
    const [heatmapChannel, setHeatmapChannel] = useState('magnitude')
    const [isCacheLoaded, setIsCacheLoaded] = useState(false)
    const [lastSaveError, setLastSaveError] = useState<string | null>(null)

    const undoRedo = useUndoRedo()
    const isInitializing = useRef(true)

    // Register save error callback
    useEffect(() => {
        setSaveErrorCallback((msg) => setLastSaveError(msg))
        return () => setSaveErrorCallback(null)
    }, [])

    // Restore cached data on mount
    useEffect(() => {
        async function restoreCache() {
            if (!hasCachedData()) {
                isInitializing.current = false
                setIsCacheLoaded(true)
                return
            }

            try {
                const cachedImages = await loadCachedImages()
                if (cachedImages.length > 0) {
                    setImages(cachedImages)
                }

                const cachedState = loadCachedAppState()
                if (cachedState) {
                    setShapesInternal(cachedState.shapes || [])
                    setRegressionModels(cachedState.regressionModels || {})
                    setCommittedPoints(cachedState.committedPoints || [])
                    setDetectionSettings(cachedState.detectionSettings || defaultDetectionSettings)
                    setColorMode(cachedState.colorMode || 'RGB')
                    setRawRgbMode(cachedState.rawRgbMode ?? true)
                    setCurrentImageIndex(Math.min(cachedState.currentImageIndex || 0, Math.max(0, cachedImages.length - 1)))
                    setIsGridView(cachedState.isGridView ?? false)
                    setZoomLevel(cachedState.zoomLevel || 1)
                    setRotationAngle(cachedState.rotationAngle || 0)
                    setBoundingBox(cachedState.boundingBox || null)
                    if (cachedState.colorCalibration) {
                        setColorCalibration(cachedState.colorCalibration)
                    }
                    setHeatmapMode(cachedState.heatmapMode ?? false)
                    setHeatmapChannel(cachedState.heatmapChannel ?? 'magnitude')
                }
            } catch (error) {
                console.error('Error restoring cache:', error)
            } finally {
                isInitializing.current = false
                setIsCacheLoaded(true)
            }
        }

        restoreCache()
    }, [])

    // Auto-save state when it changes (debounced)
    useEffect(() => {
        if (isInitializing.current) return

        debouncedSaveState(images, {
            shapes,
            regressionModels,
            committedPoints,
            detectionSettings,
            colorMode,
            rawRgbMode,
            currentImageIndex,
            isGridView,
            zoomLevel,
            rotationAngle,
            boundingBox,
            colorCalibration,
            heatmapMode,
            heatmapChannel
        })
    }, [
        images, shapes, regressionModels, committedPoints,
        detectionSettings, colorMode, rawRgbMode, currentImageIndex,
        isGridView, zoomLevel, rotationAngle, boundingBox, colorCalibration,
        heatmapMode, heatmapChannel
    ])

    const clearCache = useCallback(async () => {
        await clearAllCache()
    }, [])

    const saveCache = useCallback(() => {
        forceSaveState(images, {
            shapes,
            regressionModels,
            committedPoints,
            detectionSettings,
            colorMode,
            rawRgbMode,
            currentImageIndex,
            isGridView,
            zoomLevel,
            rotationAngle,
            boundingBox,
            colorCalibration,
            heatmapMode,
            heatmapChannel
        })
    }, [
        images, shapes, regressionModels, committedPoints,
        detectionSettings, colorMode, rawRgbMode, currentImageIndex,
        isGridView, zoomLevel, rotationAngle, boundingBox, colorCalibration,
        heatmapMode, heatmapChannel
    ])

    // Undo/redo wrappers
    const pushAndSet = useCallback((updater: (prev: Shape[]) => Shape[]) => {
        setShapesInternal(prev => {
            undoRedo.pushState(prev)
            return updater(prev)
        })
    }, [undoRedo])

    const setShapes: React.Dispatch<React.SetStateAction<Shape[]>> = useCallback((action) => {
        if (typeof action === 'function') {
            pushAndSet(action)
        } else {
            pushAndSet(() => action)
        }
    }, [pushAndSet])

    const addShape = useCallback((shape: Shape) => {
        pushAndSet(prev => [...prev, shape])
    }, [pushAndSet])

    const removeShape = useCallback((id: string) => {
        pushAndSet(prev => prev.filter(s => s.id !== id))
    }, [pushAndSet])

    const updateShape = useCallback((id: string, updates: Partial<Shape>) => {
        pushAndSet(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
    }, [pushAndSet])

    const clearShapesForImage = useCallback((imageIndex: number) => {
        pushAndSet(prev => prev.filter(s => s.imageIndex !== imageIndex))
    }, [pushAndSet])

    const removeImage = useCallback((imageIndex: number) => {
        setImages(prev => prev.filter((_, i) => i !== imageIndex))
        pushAndSet(prev =>
            prev
                .filter(s => s.imageIndex !== imageIndex)
                .map(s => s.imageIndex > imageIndex ? { ...s, imageIndex: s.imageIndex - 1 } : s)
        )
        if (currentImageIndex >= imageIndex && currentImageIndex > 0) {
            setCurrentImageIndex(currentImageIndex - 1)
        }
    }, [currentImageIndex, pushAndSet])

    const clearAllImages = useCallback(() => {
        setImages([])
        pushAndSet(() => [])
        setCurrentImageIndex(0)
        setCommittedPoints([])
        setRegressionModels({})
        setBoundingBox(null)
        setSelectedShapeId(null)
    }, [pushAndSet])

    const undo = useCallback(() => {
        const prev = undoRedo.undo(shapes)
        if (prev) setShapesInternal(prev)
    }, [undoRedo, shapes])

    const redo = useCallback(() => {
        const next = undoRedo.redo(shapes)
        if (next) setShapesInternal(next)
    }, [undoRedo, shapes])

    // Global keyboard shortcuts for undo/redo
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault()
                if (e.shiftKey) {
                    redo()
                } else {
                    undo()
                }
            }
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [undo, redo])

    return (
        <AppContext.Provider value={{
            images, setImages,
            currentImageIndex, setCurrentImageIndex,
            shapes, setShapes,
            addShape, removeShape, updateShape, clearShapesForImage, removeImage, clearAllImages,
            regressionModels, setRegressionModels,
            committedPoints, setCommittedPoints,
            isGridView, setIsGridView,
            detectionSettings, setDetectionSettings,
            colorMode, setColorMode,
            rawRgbMode, setRawRgbMode,
            zoomLevel, setZoomLevel,
            rotationAngle, setRotationAngle,
            boundingBox, setBoundingBox,
            selectedShapeId, setSelectedShapeId,
            calibrationMode, setCalibrationMode,
            colorCalibration, setColorCalibration,
            heatmapMode, setHeatmapMode,
            heatmapChannel, setHeatmapChannel,
            undo, redo,
            canUndo: undoRedo.canUndo,
            canRedo: undoRedo.canRedo,
            clearCache, saveCache, isCacheLoaded,
            lastSaveError, clearSaveError: () => setLastSaveError(null)
        }}>
            {children}
        </AppContext.Provider>
    )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
    const context = useContext(AppContext)
    if (context === undefined) {
        throw new Error('useApp must be used within an AppProvider')
    }
    return context
}
