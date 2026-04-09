/**
 * Web Cache System for ChemClub Analyst
 *
 * Uses IndexedDB for large binary data (images) and
 * localStorage for smaller JSON-serializable state (shapes, settings, etc.)
 */

import type { Shape, CommittedPoint, DetectionSettings } from '../types'
import type { RegressionModel } from './regressionUtils'
import type { ColorCalibration } from './colorCalibration'

// ============= IndexedDB for Images =============

const DB_NAME = 'ChemClubCache'
const DB_VERSION = 1
const IMAGE_STORE = 'images'

interface CachedImage {
    id: number
    dataUrl: string
    width: number
    height: number
}

interface CachedAppState {
    shapes: Shape[]
    regressionModels: Record<string, RegressionModel>
    committedPoints: CommittedPoint[]
    detectionSettings: DetectionSettings
    colorMode: 'RGB' | 'CMYK' | 'HSL' | 'HSV'
    rawRgbMode: boolean
    currentImageIndex: number
    isGridView: boolean
    zoomLevel: number
    rotationAngle: number
    boundingBox: { x: number; y: number; width: number; height: number } | null
    imageCount: number
    colorCalibration?: ColorCalibration
    heatmapMode?: boolean
    heatmapChannel?: string
}

let dbInstance: IDBDatabase | null = null

async function openDB(): Promise<IDBDatabase> {
    if (dbInstance) return dbInstance

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            dbInstance = request.result
            resolve(dbInstance)
        }

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result

            if (!db.objectStoreNames.contains(IMAGE_STORE)) {
                db.createObjectStore(IMAGE_STORE, { keyPath: 'id' })
            }
        }
    })
}

function imageToDataUrl(img: HTMLImageElement): string {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get canvas context')
    ctx.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
}

function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = dataUrl
    })
}

// ============= Image Cache Operations =============

export async function cacheImages(images: HTMLImageElement[]): Promise<void> {
    try {
        const db = await openDB()
        const tx = db.transaction(IMAGE_STORE, 'readwrite')
        const store = tx.objectStore(IMAGE_STORE)

        store.clear()

        images.forEach((img, index) => {
            const cachedImage: CachedImage = {
                id: index,
                dataUrl: imageToDataUrl(img),
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height
            }
            store.add(cachedImage)
        })

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        console.error('Error caching images:', error)
    }
}

export async function loadCachedImages(): Promise<HTMLImageElement[]> {
    try {
        const db = await openDB()
        const tx = db.transaction(IMAGE_STORE, 'readonly')
        const store = tx.objectStore(IMAGE_STORE)
        const request = store.getAll()

        return new Promise((resolve, reject) => {
            request.onsuccess = async () => {
                const cachedImages = request.result as CachedImage[]
                cachedImages.sort((a, b) => a.id - b.id)

                const images: HTMLImageElement[] = []
                for (const cached of cachedImages) {
                    try {
                        const img = await dataUrlToImage(cached.dataUrl)
                        images.push(img)
                    } catch (e) {
                        console.error('Error loading cached image:', e)
                    }
                }
                resolve(images)
            }
            request.onerror = () => reject(request.error)
        })
    } catch (error) {
        console.error('Error loading cached images:', error)
        return []
    }
}

export async function clearCachedImages(): Promise<void> {
    try {
        const db = await openDB()
        const tx = db.transaction(IMAGE_STORE, 'readwrite')
        const store = tx.objectStore(IMAGE_STORE)
        store.clear()

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (error) {
        console.error('Error clearing cached images:', error)
    }
}

// ============= LocalStorage for App State =============

const STATE_KEY = 'chemclub_app_state'

export function cacheAppState(state: CachedAppState): void {
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state))
    } catch (error) {
        console.error('Error caching app state:', error)
    }
}

export function loadCachedAppState(): CachedAppState | null {
    try {
        const data = localStorage.getItem(STATE_KEY)
        if (data) {
            return JSON.parse(data) as CachedAppState
        }
    } catch (error) {
        console.error('Error loading cached app state:', error)
    }
    return null
}

export function clearCachedAppState(): void {
    try {
        localStorage.removeItem(STATE_KEY)
    } catch (error) {
        console.error('Error clearing cached app state:', error)
    }
}

// ============= Combined Cache Operations =============

export async function clearAllCache(): Promise<void> {
    await clearCachedImages()
    clearCachedAppState()
}

export function hasCachedData(): boolean {
    return localStorage.getItem(STATE_KEY) !== null
}

// ============= Storage Estimation =============

export async function estimateCacheSize(): Promise<{ used: number; quota: number } | null> {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate()
            return { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
        }
    } catch {
        // Storage API not available
    }
    return null
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// ============= Debounced Save Helper =============

type SaveErrorCallback = (error: string) => void

let saveTimeout: ReturnType<typeof setTimeout> | null = null
let _onSaveError: SaveErrorCallback | null = null

export function setSaveErrorCallback(cb: SaveErrorCallback | null): void {
    _onSaveError = cb
}

function reportSaveError(msg: string): void {
    if (_onSaveError) _onSaveError(msg)
}

export function debouncedSaveState(
    images: HTMLImageElement[],
    state: Omit<CachedAppState, 'imageCount'>
): void {
    if (saveTimeout) {
        clearTimeout(saveTimeout)
    }

    saveTimeout = setTimeout(async () => {
        try {
            cacheAppState({ ...state, imageCount: images.length })
        } catch (e) {
            reportSaveError(`Failed to save app state: ${e instanceof Error ? e.message : 'storage may be full'}`)
        }

        const cachedState = loadCachedAppState()
        if (!cachedState || cachedState.imageCount !== images.length) {
            try {
                await cacheImages(images)
            } catch (e) {
                reportSaveError(`Failed to cache images: ${e instanceof Error ? e.message : 'storage may be full'}`)
            }
        }
    }, 500)
}

export function forceSaveState(
    images: HTMLImageElement[],
    state: Omit<CachedAppState, 'imageCount'>
): void {
    if (saveTimeout) {
        clearTimeout(saveTimeout)
    }
    try {
        cacheAppState({ ...state, imageCount: images.length })
    } catch (e) {
        reportSaveError(`Failed to save app state: ${e instanceof Error ? e.message : 'storage may be full'}`)
    }
    cacheImages(images).catch(e => {
        reportSaveError(`Failed to cache images: ${e instanceof Error ? e.message : 'storage may be full'}`)
    })
}
