import { useApp } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import { Circle, Square, Info, Crosshair, Trash2, Database, X } from 'lucide-react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useToast } from '@/components/ui/toast'
import { hasCachedData, estimateCacheSize, formatBytes } from '@/lib/cacheUtils'

function BoundInput({ value, onChange, className = '' }: {
    value: number
    onChange: (v: number) => void
    className?: string
}) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(String(value))
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => { setDraft(String(value)) }, [value])
    useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

    const commit = useCallback(() => {
        setEditing(false)
        const n = parseFloat(draft)
        if (!isNaN(n) && n >= 0) onChange(n)
        else setDraft(String(value))
    }, [draft, value, onChange])

    if (!editing) {
        return (
            <button
                onClick={() => setEditing(true)}
                className={`text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted/60 px-1.5 py-0.5 rounded transition-colors cursor-text ${className}`}
            >
                {value}
            </button>
        )
    }

    return (
        <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false) } }}
            className={`w-10 text-[11px] font-mono bg-muted text-foreground px-1.5 py-0.5 rounded outline-none ring-1 ring-primary ${className}`}
        />
    )
}

function SliderWithBounds({ value, onChange, defaultMin, defaultMax, step = 1 }: {
    value: number
    onChange: (v: number) => void
    defaultMin: number
    defaultMax: number
    step?: number
}) {
    const [bounds, setBounds] = useState({ min: defaultMin, max: defaultMax })

    // Auto-expand bounds if value exceeds them (e.g. set via crosshair calibration)
    const effectiveMin = Math.min(bounds.min, value)
    const effectiveMax = Math.max(bounds.max, value)

    return (
        <div className="space-y-0.5">
            <input
                type="range"
                min={effectiveMin} max={effectiveMax} step={step}
                value={value}
                onChange={e => onChange(step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value))}
                className="w-full"
            />
            <div className="flex justify-between">
                <BoundInput value={bounds.min} onChange={v => setBounds(b => ({ ...b, min: v }))} />
                <BoundInput value={bounds.max} onChange={v => setBounds(b => ({ ...b, max: v }))} />
            </div>
        </div>
    )
}

function Tooltip({ text }: { text: string }) {
    const [show, setShow] = useState(false)
    const [coords, setCoords] = useState({ top: 0, left: 0 })
    const triggerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (show && triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect()
            const viewportWidth = window.innerWidth
            const tooltipWidth = 200

            if (rect.right + tooltipWidth + 20 > viewportWidth) {
                if (rect.left - tooltipWidth - 20 > 0) {
                    setCoords({ top: rect.top, left: rect.left - tooltipWidth - 10 })
                } else {
                    setCoords({ top: rect.bottom + 5, left: rect.left - tooltipWidth / 2 })
                }
            } else {
                setCoords({ top: rect.top, left: rect.right + 10 })
            }
        }
    }, [show])

    return (
        <div className="relative inline-block z-[200]" ref={triggerRef}>
            <Info
                className="w-3 h-3 text-muted-foreground cursor-help ml-1 hover:text-foreground transition-colors"
                onMouseEnter={() => setShow(true)}
                onMouseLeave={() => setShow(false)}
            />
            {show && (
                <div
                    className="fixed z-[9999] w-48 p-2 bg-popover border rounded-md shadow-lg text-xs text-popover-foreground"
                    style={{ top: coords.top, left: coords.left }}
                >
                    {text}
                </div>
            )}
        </div>
    )
}


export function SettingsPanel() {
    const {
        detectionSettings,
        setDetectionSettings,
        colorMode,
        setColorMode,
        rawRgbMode,
        setRawRgbMode,
        calibrationMode,
        setCalibrationMode,
        images,
        colorCalibration,
        setColorCalibration,
        clearCache,
        isCacheLoaded
    } = useApp()
    const { toast } = useToast()

    const [isClearing, setIsClearing] = useState(false)
    const [cacheExists, setCacheExists] = useState(false)
    const [storageInfo, setStorageInfo] = useState<{ used: number; quota: number } | null>(null)

    useEffect(() => {
        setCacheExists(hasCachedData())
        estimateCacheSize().then(info => setStorageInfo(info))
    }, [isCacheLoaded])

    const handleClearCache = async () => {
        setIsClearing(true)
        try {
            await clearCache()
            setCacheExists(false)
            toast('Cache cleared', 'success')
        } finally {
            setIsClearing(false)
        }
    }

    const updateSetting = (key: keyof typeof detectionSettings, value: number | boolean | 'circle' | 'rectangle') => {
        setDetectionSettings(prev => ({ ...prev, [key]: value }))
    }

    return (
        <div className="md:w-72 bg-card md:border-l border-border/50 flex flex-col h-full overflow-hidden">
            {/* Header — desktop only */}
            <div className="hidden md:block p-4 border-b border-border/50">
                <h3 className="text-sm font-semibold">Detection Settings</h3>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-6 text-sm">

                {/* ── Detection Mode ── */}
                <div className="space-y-2.5" data-tutorial="detection-mode">
                    <label className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                        Detection Mode
                    </label>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant={detectionSettings.mode === 'circle' ? 'default' : 'outline'}
                            onClick={() => updateSetting('mode', 'circle')}
                            className="flex-1"
                        >
                            <Circle className="w-4 h-4 mr-1.5" /> Circle
                        </Button>
                        <Button
                            size="sm"
                            variant={detectionSettings.mode === 'rectangle' ? 'default' : 'outline'}
                            onClick={() => updateSetting('mode', 'rectangle')}
                            className="flex-1"
                        >
                            <Square className="w-4 h-4 mr-1.5" /> Square
                        </Button>
                    </div>
                </div>

                {/* ── Circle Parameters ── */}
                {detectionSettings.mode === 'circle' && (
                    <div className="space-y-4">
                        <h4 className="text-[11px] uppercase tracking-wider font-medium text-blue-400 border-l-2 border-blue-400 pl-2.5">
                            Circle Detection
                        </h4>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Param1 (Edge)
                                    <Tooltip text="Canny edge detection threshold. Higher values detect fewer, stronger edges. Decrease if circles aren't being detected." />
                                </span>
                                <span className="font-mono">{detectionSettings.param1}</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.param1}
                                onChange={v => updateSetting('param1', v)}
                                defaultMin={10} defaultMax={300}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Param2 (Accum)
                                    <Tooltip text="Circle accumulator threshold. Lower values detect more circles (including false positives). Increase to reduce false detections." />
                                </span>
                                <span className="font-mono">{detectionSettings.param2}</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.param2}
                                onChange={v => updateSetting('param2', v)}
                                defaultMin={10} defaultMax={200}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Min Radius
                                    <Tooltip text="Minimum circle radius in pixels. Set this to exclude small noise detections." />
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <span className="font-mono">{detectionSettings.minRadius}px</span>
                                    <button
                                        onClick={() => setCalibrationMode('min')}
                                        disabled={images.length === 0}
                                        title="Draw a circle on the image to set min radius"
                                        className={`p-1 rounded hover:bg-muted transition-colors ${calibrationMode === 'min' ? 'bg-cyan-500/20 text-cyan-400' : 'text-muted-foreground'} ${images.length === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                    >
                                        <Crosshair className="h-3 w-3" />
                                    </button>
                                </div>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.minRadius}
                                onChange={v => updateSetting('minRadius', v)}
                                defaultMin={1} defaultMax={200}
                            />
                            {calibrationMode === 'min' && (
                                <div className="text-[11px] text-cyan-400 bg-cyan-500/10 px-2.5 py-1.5 rounded">
                                    Draw a circle around the <strong>smallest</strong> well to detect
                                </div>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Max Radius
                                    <Tooltip text="Maximum circle radius in pixels. Set this to exclude large false detections." />
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <span className="font-mono">{detectionSettings.maxRadius}px</span>
                                    <button
                                        onClick={() => setCalibrationMode('max')}
                                        disabled={images.length === 0}
                                        title="Draw a circle on the image to set max radius"
                                        className={`p-1 rounded hover:bg-muted transition-colors ${calibrationMode === 'max' ? 'bg-fuchsia-500/20 text-fuchsia-400' : 'text-muted-foreground'} ${images.length === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                    >
                                        <Crosshair className="h-3 w-3" />
                                    </button>
                                </div>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.maxRadius}
                                onChange={v => updateSetting('maxRadius', v)}
                                defaultMin={10} defaultMax={500}
                            />
                            {calibrationMode === 'max' && (
                                <div className="text-[11px] text-fuchsia-400 bg-fuchsia-500/10 px-2.5 py-1.5 rounded">
                                    Draw a circle around the <strong>largest</strong> well to detect
                                </div>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Sample Area %
                                    <Tooltip text="Percentage of shape area used for color sampling. Lower values sample only the center." />
                                </span>
                                <span className="font-mono">{detectionSettings.restrictedArea}%</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.restrictedArea}
                                onChange={v => updateSetting('restrictedArea', v)}
                                defaultMin={10} defaultMax={100} step={5}
                            />
                        </div>
                    </div>
                )}

                {/* ── Rectangle Parameters ── */}
                {detectionSettings.mode === 'rectangle' && (
                    <div className="space-y-4">
                        <h4 className="text-[11px] uppercase tracking-wider font-medium text-emerald-400 border-l-2 border-emerald-400 pl-2.5">
                            Square Detection
                        </h4>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Min Area
                                    <Tooltip text="Minimum contour area in pixels². Filters out small noise." />
                                </span>
                                <span className="font-mono">{detectionSettings.minArea}px²</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.minArea}
                                onChange={v => updateSetting('minArea', v)}
                                defaultMin={100} defaultMax={10000} step={100}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Max Area
                                    <Tooltip text="Maximum contour area in pixels². Filters out large regions." />
                                </span>
                                <span className="font-mono">{detectionSettings.maxArea}px²</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.maxArea}
                                onChange={v => updateSetting('maxArea', v)}
                                defaultMin={1000} defaultMax={100000} step={1000}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Epsilon
                                    <Tooltip text="Contour approximation accuracy." />
                                </span>
                                <span className="font-mono">{detectionSettings.epsilon.toFixed(3)}</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.epsilon}
                                onChange={v => updateSetting('epsilon', v)}
                                defaultMin={0.01} defaultMax={0.1} step={0.005}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">
                                    Sample Area %
                                    <Tooltip text="Percentage of shape area used for color sampling." />
                                </span>
                                <span className="font-mono">{detectionSettings.restrictedArea}%</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.restrictedArea}
                                onChange={v => updateSetting('restrictedArea', v)}
                                defaultMin={10} defaultMax={100} step={5}
                            />
                        </div>
                    </div>
                )}

                {/* ── Image Preprocessing ── */}
                <div className="space-y-4">
                    <h4 className="text-[11px] uppercase tracking-wider font-medium text-violet-400 border-l-2 border-violet-400 pl-2.5">
                        Image Preprocessing
                    </h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Enhance image before detection. Useful for poor lighting or low contrast.
                    </p>

                    <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                            <span className="flex items-center">Brightness<Tooltip text="Adjust overall image brightness." /></span>
                            <span className="font-mono">{detectionSettings.brightness}</span>
                        </div>
                        <SliderWithBounds
                            value={detectionSettings.brightness}
                            onChange={v => updateSetting('brightness', v)}
                            defaultMin={-100} defaultMax={100} step={5}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                            <span className="flex items-center">Contrast<Tooltip text="Adjust image contrast." /></span>
                            <span className="font-mono">{detectionSettings.contrast.toFixed(1)}x</span>
                        </div>
                        <SliderWithBounds
                            value={detectionSettings.contrast}
                            onChange={v => updateSetting('contrast', v)}
                            defaultMin={0.5} defaultMax={3.0} step={0.1}
                        />
                    </div>

                    <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                            <span className="flex items-center">Blur Kernel<Tooltip text="Size of Gaussian blur before detection." /></span>
                            <span className="font-mono">{detectionSettings.blurKernelSize}px</span>
                        </div>
                        <SliderWithBounds
                            value={detectionSettings.blurKernelSize}
                            onChange={v => updateSetting('blurKernelSize', v)}
                            defaultMin={3} defaultMax={15} step={2}
                        />
                    </div>

                    {/* CLAHE Toggle */}
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground flex items-center">
                            CLAHE
                            <Tooltip text="Contrast Limited Adaptive Histogram Equalization." />
                        </span>
                        <button
                            onClick={() => setDetectionSettings(prev => ({ ...prev, claheEnabled: !prev.claheEnabled }))}
                            className={`w-9 h-5 rounded-full transition-colors relative ${detectionSettings.claheEnabled ? 'bg-primary' : 'bg-muted'}`}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm absolute top-0.5 transition-transform ${detectionSettings.claheEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                        </button>
                    </div>

                    {detectionSettings.claheEnabled && (
                        <div className="space-y-1.5 pl-3 border-l border-violet-400/30">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">Clip Limit<Tooltip text="Controls contrast amplification." /></span>
                                <span className="font-mono">{detectionSettings.claheClipLimit.toFixed(1)}</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.claheClipLimit}
                                onChange={v => updateSetting('claheClipLimit', v)}
                                defaultMin={1.0} defaultMax={8.0} step={0.5}
                            />
                        </div>
                    )}

                    {/* Sharpening Toggle */}
                    <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground flex items-center">
                            Sharpening
                            <Tooltip text="Enhances edges using unsharp mask." />
                        </span>
                        <button
                            onClick={() => setDetectionSettings(prev => ({ ...prev, sharpenEnabled: !prev.sharpenEnabled }))}
                            className={`w-9 h-5 rounded-full transition-colors relative ${detectionSettings.sharpenEnabled ? 'bg-primary' : 'bg-muted'}`}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm absolute top-0.5 transition-transform ${detectionSettings.sharpenEnabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                        </button>
                    </div>

                    {detectionSettings.sharpenEnabled && (
                        <div className="space-y-1.5 pl-3 border-l border-violet-400/30">
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                                <span className="flex items-center">Amount<Tooltip text="Sharpening strength." /></span>
                                <span className="font-mono">{detectionSettings.sharpenAmount.toFixed(1)}x</span>
                            </div>
                            <SliderWithBounds
                                value={detectionSettings.sharpenAmount}
                                onChange={v => updateSetting('sharpenAmount', v)}
                                defaultMin={0.5} defaultMax={3.0} step={0.1}
                            />
                        </div>
                    )}
                </div>

                {/* ── Color Display ── */}
                <div className="space-y-3">
                    <label className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                        Color Mode
                    </label>
                    <div className="grid grid-cols-4 gap-1.5">
                        {(['RGB', 'CMYK', 'HSL', 'HSV'] as const).map(mode => (
                            <Button
                                key={mode}
                                size="sm"
                                variant={colorMode === mode ? 'default' : 'outline'}
                                onClick={() => setColorMode(mode)}
                                className="text-xs px-1"
                            >
                                {mode}
                            </Button>
                        ))}
                    </div>

                    <div className="pt-1">
                        <label className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                            Raw / Calibrated
                        </label>
                        <Button
                            size="sm"
                            variant={rawRgbMode ? 'outline' : 'default'}
                            onClick={() => setRawRgbMode(!rawRgbMode)}
                            className="w-full mt-2"
                        >
                            {rawRgbMode ? 'Raw RGB' : 'Calibrated RGB'}
                        </Button>
                    </div>
                </div>

                {/* ── Color Calibration ── */}
                <div className="space-y-4">
                    <h4 className="text-[11px] uppercase tracking-wider font-medium text-amber-400 border-l-2 border-amber-400 pl-2.5">
                        Color Calibration
                    </h4>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Pick white and black reference points from the image for calibrated color values.
                    </p>

                    {/* White Reference */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">White Reference</span>
                            <div className="flex items-center gap-1.5">
                                {colorCalibration.whiteRef && (
                                    <>
                                        <div
                                            className="w-5 h-5 rounded border border-border"
                                            style={{ backgroundColor: `rgb(${colorCalibration.whiteRef.join(',')})` }}
                                        />
                                        <span className="text-[11px] font-mono text-muted-foreground">
                                            {colorCalibration.whiteRef.join(',')}
                                        </span>
                                        <button
                                            onClick={() => setColorCalibration(prev => ({ ...prev, whiteRef: null }))}
                                            className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => setCalibrationMode('white')}
                                    disabled={images.length === 0}
                                    className={`p-1 rounded transition-colors ${calibrationMode === 'white' ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'} ${images.length === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                    <Crosshair className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                        {calibrationMode === 'white' && (
                            <div className="text-[11px] text-white bg-white/10 px-2.5 py-1.5 rounded">
                                Draw a circle on a <strong>white</strong> area of the image
                            </div>
                        )}
                    </div>

                    {/* Black Reference */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">Black Reference</span>
                            <div className="flex items-center gap-1.5">
                                {colorCalibration.blackRef && (
                                    <>
                                        <div
                                            className="w-5 h-5 rounded border border-border"
                                            style={{ backgroundColor: `rgb(${colorCalibration.blackRef.join(',')})` }}
                                        />
                                        <span className="text-[11px] font-mono text-muted-foreground">
                                            {colorCalibration.blackRef.join(',')}
                                        </span>
                                        <button
                                            onClick={() => setColorCalibration(prev => ({ ...prev, blackRef: null }))}
                                            className="p-0.5 text-muted-foreground hover:text-destructive transition-colors"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => setCalibrationMode('black')}
                                    disabled={images.length === 0}
                                    className={`p-1 rounded transition-colors ${calibrationMode === 'black' ? 'bg-neutral-600/50 text-neutral-300' : 'bg-muted text-muted-foreground hover:text-foreground'} ${images.length === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                    <Crosshair className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                        {calibrationMode === 'black' && (
                            <div className="text-[11px] text-neutral-300 bg-neutral-600/20 px-2.5 py-1.5 rounded">
                                Draw a circle on a <strong>black</strong> area of the image
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Cache Management ── */}
                <div className="space-y-3">
                    <label className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground flex items-center gap-1.5">
                        <Database className="w-3 h-3" />
                        Browser Cache
                    </label>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        Your work is automatically saved to browser storage and restored when you return.
                    </p>

                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${cacheExists ? 'bg-green-500' : 'bg-muted'}`} />
                        <span className="text-xs text-muted-foreground">
                            {cacheExists ? 'Cache active' : 'No cached data'}
                        </span>
                    </div>

                    {storageInfo && storageInfo.quota > 0 && (
                        <div className="space-y-1.5">
                            <div className="flex justify-between text-[11px] text-muted-foreground">
                                <span>{formatBytes(storageInfo.used)} used</span>
                                <span>{formatBytes(storageInfo.quota)} total</span>
                            </div>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${
                                        storageInfo.used / storageInfo.quota > 0.9 ? 'bg-red-500' :
                                        storageInfo.used / storageInfo.quota > 0.7 ? 'bg-yellow-500' : 'bg-green-500'
                                    }`}
                                    style={{ width: `${Math.min(100, (storageInfo.used / storageInfo.quota) * 100)}%` }}
                                />
                            </div>
                            {storageInfo.used / storageInfo.quota > 0.9 && (
                                <p className="text-[11px] text-red-400">Storage nearly full. Consider clearing cache.</p>
                            )}
                        </div>
                    )}

                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearCache}
                        disabled={isClearing || !cacheExists}
                        className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                        <Trash2 className="w-4 h-4 mr-1.5" />
                        {isClearing ? 'Clearing...' : 'Clear Cache'}
                    </Button>
                </div>
            </div>
        </div>
    )
}
