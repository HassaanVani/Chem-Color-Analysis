import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Scatter } from 'react-chartjs-2'
import { rgbToCmyk } from '@/lib/imageUtils'
import { calibrateColor } from '@/lib/colorCalibration'
import { Download, Upload, FileSpreadsheet, Layers, ImageDown, ClipboardCopy, Loader2, X, GitCompareArrows, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Shape, CommittedPoint } from '@/types'
import { parseConcentrationCSV } from '@/lib/plateUtils'
import {
    fitLinear, fitQuadratic, fitPower, fitLogarithmic, fitBest,
    evaluateModel, predict as predictFromModel, formatEquation,
    computeRSE, computeResiduals,
    type RegressionModel, type RegressionModelType, type ResidualPoint
} from '@/lib/regressionUtils'
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    ScatterController,
    type ChartDataset,
    type TooltipItem,
    type Plugin
} from 'chart.js'

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    ScatterController
)

type ColorChannel = 'red' | 'green' | 'blue' | 'cyan' | 'magenta' | 'yellow' | 'black' | 'magnitude'

const ALL_CHANNELS: ColorChannel[] = ['red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'black', 'magnitude']

function computeAllModels(
    shapes: Shape[],
    committedPoints: CommittedPoint[],
    modelType: RegressionModelType | 'best',
    getColorValue: (color: [number, number, number], ch: ColorChannel) => number,
    excludedLabels?: Set<string>
): Record<string, RegressionModel> | null {
    const points = committedPoints
        .filter(pt => !excludedLabels?.has(pt.label))
        .map(pt => {
            const shape = shapes.find(s => s.label === pt.label)
            if (!shape) return null
            return { concentration: pt.y, color: shape.color, label: pt.label }
        })
        .filter(Boolean) as { concentration: number; color: [number, number, number]; label: string }[]

    if (points.length < 2) return null

    const newModels: Record<string, RegressionModel> = {}
    ALL_CHANNELS.forEach(channel => {
        const xs = points.map(pt => pt.concentration)
        const ys = points.map(pt => getColorValue(pt.color, channel))

        let model: RegressionModel | null = null
        switch (modelType) {
            case 'linear': model = fitLinear(xs, ys); break
            case 'quadratic': model = fitQuadratic(xs, ys); break
            case 'power': model = fitPower(xs, ys); break
            case 'logarithmic': model = fitLogarithmic(xs, ys); break
            case 'best': model = fitBest(xs, ys); break
        }
        if (model) newModels[channel] = model
    })

    return newModels
}

function DilutionSeriesModal({ shapes, onApply, onClose }: {
    shapes: Shape[]
    onApply: (points: CommittedPoint[]) => void
    onClose: () => void
}) {
    const [startConc, setStartConc] = useState(100)
    const [factor, setFactor] = useState(2)
    const [count, setCount] = useState(Math.min(shapes.length, 6))
    const [direction, setDirection] = useState<'high-to-low' | 'low-to-high'>('high-to-low')
    const [preset, setPreset] = useState<'2x' | '5x' | '10x' | 'custom'>('2x')

    const handlePresetChange = (p: typeof preset) => {
        setPreset(p)
        if (p === '2x') setFactor(2)
        else if (p === '5x') setFactor(5)
        else if (p === '10x') setFactor(10)
    }

    const sortedLabels = shapes.map(s => s.label)

    const preview = (() => {
        const values: number[] = []
        for (let i = 0; i < count; i++) {
            values.push(startConc / Math.pow(factor, i))
        }
        if (direction === 'low-to-high') values.reverse()
        return sortedLabels.slice(0, count).map((label, i) => ({ label, y: values[i] }))
    })()

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border rounded-xl shadow-2xl max-w-sm w-full mx-4 p-4 space-y-4" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Dilution Series</h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs text-muted-foreground">Starting Concentration</label>
                        <input type="number" step="any" value={startConc} onChange={e => setStartConc(parseFloat(e.target.value) || 0)}
                            className="w-full bg-background border rounded px-2 py-1 text-sm mt-1" />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Dilution Factor</label>
                        <div className="flex gap-1 mt-1">
                            {(['2x', '5x', '10x', 'custom'] as const).map(p => (
                                <button key={p} onClick={() => handlePresetChange(p)}
                                    className={`px-2 py-1 text-xs rounded ${preset === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                    {preset === 'custom' && (
                        <div>
                            <label className="text-xs text-muted-foreground">Custom Factor</label>
                            <input type="number" step="any" value={factor} onChange={e => setFactor(parseFloat(e.target.value) || 2)}
                                className="w-full bg-background border rounded px-2 py-1 text-sm mt-1" />
                        </div>
                    )}
                    <div>
                        <label className="text-xs text-muted-foreground">Standards ({count})</label>
                        <input type="range" min={1} max={shapes.length} value={count} onChange={e => setCount(parseInt(e.target.value))}
                            className="w-full mt-1" />
                    </div>
                    <div>
                        <label className="text-xs text-muted-foreground">Direction</label>
                        <div className="flex gap-1 mt-1">
                            {(['high-to-low', 'low-to-high'] as const).map(d => (
                                <button key={d} onClick={() => setDirection(d)}
                                    className={`px-2 py-1 text-xs rounded flex-1 ${direction === d ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                                    {d === 'high-to-low' ? 'High \u2192 Low' : 'Low \u2192 High'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="border rounded p-2 bg-muted/30 max-h-32 overflow-y-auto">
                    <div className="text-[10px] text-muted-foreground mb-1">Preview:</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
                        {preview.map(p => (
                            <div key={p.label} className="flex justify-between">
                                <span className="font-bold">{p.label}</span>
                                <span>{p.y.toFixed(3)}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
                    <Button size="sm" className="flex-1" onClick={() => { onApply(preview); onClose() }}>Apply</Button>
                </div>
            </div>
        </div>
    )
}

function CSVImportModal({ shapes, onApply, onClose }: {
    shapes: Shape[]
    onApply: (points: CommittedPoint[]) => void
    onClose: () => void
}) {
    const [csvText, setCsvText] = useState('')
    const fileRef = useRef<HTMLInputElement>(null)

    const parsed = parseConcentrationCSV(csvText)
    const shapeLabels = new Set(shapes.map(s => s.label))
    const matched = parsed.filter(p => shapeLabels.has(p.label))
    const unmatched = parsed.filter(p => !shapeLabels.has(p.label))

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => { if (typeof reader.result === 'string') setCsvText(reader.result) }
        reader.readAsText(file)
    }

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-card border rounded-xl shadow-2xl max-w-md w-full mx-4 p-4 space-y-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Import Concentrations (CSV)</h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
                <p className="text-[11px] text-muted-foreground">Paste or upload CSV with <code className="bg-muted px-1 rounded">label,concentration</code> per line.</p>
                <textarea
                    value={csvText}
                    onChange={e => setCsvText(e.target.value)}
                    placeholder={"A1,0.5\nA2,1.0\nA3,2.0\n..."}
                    className="w-full h-28 bg-background border rounded p-2 text-xs font-mono resize-none"
                />
                <div className="flex items-center gap-2">
                    <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={handleFile} />
                    <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                        <Upload className="h-3 w-3 mr-1" /> Upload File
                    </Button>
                    <span className="text-[10px] text-muted-foreground flex-1 text-right">
                        {parsed.length > 0 && `${matched.length} matched, ${unmatched.length} unmatched`}
                    </span>
                </div>
                {matched.length > 0 && (
                    <div className="border rounded p-2 bg-muted/30 max-h-32 overflow-y-auto">
                        <div className="text-[10px] text-muted-foreground mb-1">Preview ({matched.length} points):</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono">
                            {matched.map(p => (
                                <div key={p.label} className="flex justify-between">
                                    <span className="font-bold">{p.label}</span>
                                    <span>{p.concentration}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {unmatched.length > 0 && (
                    <p className="text-[10px] text-amber-500">
                        {unmatched.length} label(s) not found: {unmatched.slice(0, 5).map(u => u.label).join(', ')}{unmatched.length > 5 ? '...' : ''}
                    </p>
                )}
                <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
                    <Button size="sm" className="flex-1" disabled={matched.length === 0} onClick={() => {
                        onApply(matched.map(m => ({ label: m.label, y: m.concentration })))
                        onClose()
                    }}>
                        Apply {matched.length > 0 && `(${matched.length})`}
                    </Button>
                </div>
            </div>
        </div>
    )
}

interface ExportedModel {
    version: string
    exportDate: string
    committedPoints: { label: string; y: number }[]
    shapeData: { label: string; color: [number, number, number] }[]
    regressionModels: Record<string, RegressionModel>
    modelType?: RegressionModelType | 'best'
}

export function RegressionStudio() {
    const { shapes, committedPoints, setCommittedPoints, regressionModels, setRegressionModels, colorCalibration, rawRgbMode } = useApp()
    const { toast } = useToast()
    const [activeCharts, setActiveCharts] = useState<ColorChannel[]>(['red', 'green', 'blue'])
    const [selectedPoint, setSelectedPoint] = useState<{ label: string; color: [number, number, number] } | null>(null)
    const [modelType, setModelType] = useState<RegressionModelType | 'best'>('linear')
    const [overlayMode, setOverlayMode] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const chartsContainerRef = useRef<HTMLDivElement>(null)
    const inputRefsMap = useRef<Map<string, HTMLInputElement>>(new Map())
    const [focusedLabel, setFocusedLabel] = useState<string | null>(null)
    const [showDilutionModal, setShowDilutionModal] = useState(false)
    const [predictionChannel, setPredictionChannel] = useState<ColorChannel | 'auto'>('auto')
    const [excludedPoints, setExcludedPoints] = useState<Set<string>>(new Set())
    const [showResiduals, setShowResiduals] = useState(false)
    const [multiModelMode, setMultiModelMode] = useState(false)
    const [showCSVImport, setShowCSVImport] = useState(false)
    const [mobileRegTab, setMobileRegTab] = useState<'data' | 'charts'>('data')

    const getDisplayColor = (color: [number, number, number]): [number, number, number] => {
        if (rawRgbMode) return color
        return calibrateColor(color, colorCalibration)
    }

    const getColorValue = (color: [number, number, number], channel: ColorChannel): number => {
        const c = getDisplayColor(color)
        const cmyk = rgbToCmyk(c)
        switch (channel) {
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

    const effectivePredChannel: ColorChannel = useMemo(() => {
        if (predictionChannel !== 'auto') return predictionChannel
        let bestCh: ColorChannel = 'magnitude'
        let bestR2 = -1
        for (const [ch, model] of Object.entries(regressionModels)) {
            if (model.r2 > bestR2) { bestR2 = model.r2; bestCh = ch as ColorChannel }
        }
        return bestCh
    }, [predictionChannel, regressionModels])

    const rseValue = (() => {
        const model = regressionModels[effectivePredChannel]
        if (!model) return null
        const points = committedPoints
            .filter(pt => !excludedPoints.has(pt.label))
            .map(pt => {
                const shape = shapes.find(s => s.label === pt.label)
                if (!shape) return null
                return { x: pt.y, y: getColorValue(shape.color, effectivePredChannel) }
            })
            .filter(Boolean) as { x: number; y: number }[]
        if (points.length < 3) return null
        return computeRSE(model, points.map(p => p.x), points.map(p => p.y))
    })()

    const residualsData = (() => {
        const results: Record<string, ResidualPoint[]> = {}
        for (const ch of activeCharts) {
            const model = regressionModels[ch]
            if (!model) continue
            const points = committedPoints
                .filter(pt => !excludedPoints.has(pt.label))
                .map(pt => {
                    const shape = shapes.find(s => s.label === pt.label)
                    if (!shape) return null
                    return { label: pt.label, x: pt.y, y: getColorValue(shape.color, ch as ColorChannel) }
                })
                .filter(Boolean) as { label: string; x: number; y: number }[]
            if (points.length >= 2) results[ch] = computeResiduals(model, points)
        }
        return results
    })()

    const shapeLabels = shapes.map(s => s.label)

    const handleInputKeyDown = (e: React.KeyboardEvent, currentLabel: string) => {
        const idx = shapeLabels.indexOf(currentLabel)
        let targetIdx: number | null = null

        if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault()
            targetIdx = idx + 1
        } else if ((e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowUp') {
            e.preventDefault()
            targetIdx = idx - 1
        }

        if (targetIdx !== null && targetIdx >= 0 && targetIdx < shapeLabels.length) {
            inputRefsMap.current.get(shapeLabels[targetIdx])?.focus()
        }
    }

    const handlePaste = (e: React.ClipboardEvent, currentLabel: string) => {
        const text = e.clipboardData.getData('text/plain')
        if (!text.includes('\t') && !text.includes('\n')) return
        e.preventDefault()
        const values = text.split(/[\t\n\r]+/).map(v => v.trim()).filter(v => v !== '')
        const startIdx = shapeLabels.indexOf(currentLabel)
        values.forEach((val, i) => {
            const targetIdx = startIdx + i
            if (targetIdx < shapeLabels.length) {
                handleConcentrationChange(shapeLabels[targetIdx], val)
            }
        })
    }

    const handleConcentrationChange = (label: string, value: string) => {
        if (value === '') {
            setCommittedPoints(prev => prev.filter(p => p.label !== label))
            return
        }
        const num = parseFloat(value)
        if (isNaN(num)) return

        setCommittedPoints(prev => {
            const existing = prev.find(p => p.label === label)
            if (existing) {
                return prev.map(p => p.label === label ? { ...p, y: num } : p)
            } else {
                return [...prev, { label, y: num }]
            }
        })
    }

    const [isAutoFitting, setIsAutoFitting] = useState(false)
    const autoFitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Auto-fit regression as concentrations are entered (300ms debounce)
    useEffect(() => {
        if (autoFitTimerRef.current) clearTimeout(autoFitTimerRef.current)

        const validPoints = committedPoints.filter(pt => shapes.some(s => s.label === pt.label))
        if (validPoints.length < 2) return

        autoFitTimerRef.current = setTimeout(() => {
            setIsAutoFitting(true)
            queueMicrotask(() => {
                const newModels = computeAllModels(shapes, committedPoints, modelType, getColorValue, excludedPoints)
                if (newModels) setRegressionModels(newModels)
                setIsAutoFitting(false)
            })
        }, 300)

        return () => {
            if (autoFitTimerRef.current) clearTimeout(autoFitTimerRef.current)
        }
    }, [committedPoints, shapes, modelType, excludedPoints]) // eslint-disable-line react-hooks/exhaustive-deps

    const runRegression = () => {
        const newModels = computeAllModels(shapes, committedPoints, modelType, getColorValue, excludedPoints)
        if (!newModels) {
            toast('Need at least 2 data points with known concentrations', 'error')
            return
        }
        setRegressionModels(newModels)
        toast('Regression complete', 'success')
    }

    const handleAutoExcludeOutliers = () => {
        const channelResiduals = residualsData[effectivePredChannel]
        if (!channelResiduals || channelResiduals.length === 0) {
            toast('Run regression first to identify outliers', 'info')
            return
        }
        const outlierLabels = channelResiduals
            .filter(r => Math.abs(r.standardizedResidual) > 2)
            .map(r => r.label)
        if (outlierLabels.length === 0) {
            toast('No outliers detected (all |std. residual| < 2)', 'info')
            return
        }
        const beforeR2 = regressionModels[effectivePredChannel]?.r2
        setExcludedPoints(prev => {
            const next = new Set(prev)
            outlierLabels.forEach(l => next.add(l))
            return next
        })
        const r2Text = beforeR2 !== undefined ? ` (was R\u00b2=${beforeR2.toFixed(4)})` : ''
        toast(`Excluded ${outlierLabels.length} outlier(s)${r2Text}`, 'success')
    }

    const createMultiModelChartData = (channel: ColorChannel) => {
        const dataPoints = committedPoints
            .filter(pt => !excludedPoints.has(pt.label))
            .map(pt => {
                const shape = shapes.find(s => s.label === pt.label)
                if (!shape) return null
                return { x: pt.y, y: getColorValue(shape.color, channel), label: pt.label, color: shape.color, stdDev: shape.colorStdDev }
            })
            .filter(Boolean) as { x: number; y: number; label: string; color: [number, number, number]; stdDev?: [number, number, number] }[]

        const datasets: ChartDataset<'scatter'>[] = [{
            label: channel.charAt(0).toUpperCase() + channel.slice(1),
            data: dataPoints,
            borderColor: channelColors[channel],
            backgroundColor: channelColors[channel],
            pointRadius: 8,
            pointHoverRadius: 12,
            showLine: false
        }]

        if (dataPoints.length < 2) return { datasets }

        const xs = dataPoints.map(p => p.x)
        const ys = dataPoints.map(p => p.y)
        const minX = Math.min(...xs) * 0.9
        const maxX = Math.max(...xs) * 1.1

        const modelConfigs: { type: RegressionModelType; color: string; dash: number[]; label: string }[] = [
            { type: 'linear', color: '#ffffff', dash: [], label: 'Linear' },
            { type: 'quadratic', color: '#06b6d4', dash: [5, 5], label: 'Quadratic' },
            { type: 'power', color: '#f59e0b', dash: [2, 2], label: 'Power' },
            { type: 'logarithmic', color: '#ec4899', dash: [10, 5, 2, 5], label: 'Logarithmic' },
        ]

        for (const cfg of modelConfigs) {
            let model: RegressionModel | null = null
            try {
                switch (cfg.type) {
                    case 'linear': model = fitLinear(xs, ys); break
                    case 'quadratic': model = fitQuadratic(xs, ys); break
                    case 'power': model = fitPower(xs, ys); break
                    case 'logarithmic': model = fitLogarithmic(xs, ys); break
                }
            } catch { /* skip models that fail */ }
            if (!model || !isFinite(model.r2)) continue

            const numPoints = model.type === 'linear' ? 2 : 50
            const step = (maxX - minX) / (numPoints - 1)
            const curveData = []
            for (let i = 0; i < numPoints; i++) {
                const x = minX + step * i
                const y = evaluateModel(model, x)
                if (isFinite(y)) curveData.push({ x, y })
            }

            datasets.push({
                label: `${cfg.label} (R\u00b2=${model.r2.toFixed(4)})`,
                data: curveData,
                borderColor: cfg.color,
                backgroundColor: 'transparent',
                borderDash: cfg.dash,
                pointRadius: 0,
                showLine: true,
                borderWidth: 2
            })
        }

        return { datasets }
    }

    const exportModel = () => {
        const exportData: ExportedModel = {
            version: '4.0',
            exportDate: new Date().toISOString(),
            committedPoints: committedPoints,
            shapeData: shapes.map(s => ({ label: s.label, color: s.color })),
            regressionModels: regressionModels,
            modelType
        }

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `chemclub-model-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    const exportCSV = () => {
        const headers = ['Label', 'Type', 'R', 'G', 'B', 'C', 'M', 'Y', 'K', 'Magnitude', 'Concentration', 'Predicted']
        const rows = shapes.map(shape => {
            const c = getDisplayColor(shape.color)
            const cmyk = rgbToCmyk(c)
            const mag = Math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2)
            const committed = committedPoints.find(p => p.label === shape.label)
            const channelVal = getColorValue(shape.color, effectivePredChannel)
            const model = regressionModels[effectivePredChannel]
            const predicted = model ? predictFromModel(model, channelVal) : null
            return [
                shape.label,
                committed ? 'standard' : 'unknown',
                c[0], c[1], c[2],
                (cmyk[0] * 100).toFixed(1), (cmyk[1] * 100).toFixed(1), (cmyk[2] * 100).toFixed(1), (cmyk[3] * 100).toFixed(1),
                mag.toFixed(2),
                committed?.y ?? '',
                predicted !== null && !isNaN(predicted) ? predicted.toFixed(3) : ''
            ].join(',')
        })

        const csv = [headers.join(','), ...rows].join('\n')
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `chemclub-data-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    const copyToClipboard = () => {
        const headers = ['Label', 'Type', 'R', 'G', 'B', 'Concentration', 'Predicted']
        const rows = shapes.map(shape => {
            const c = getDisplayColor(shape.color)
            const committed = committedPoints.find(p => p.label === shape.label)
            const channelVal = getColorValue(shape.color, effectivePredChannel)
            const model = regressionModels[effectivePredChannel]
            const predicted = model ? predictFromModel(model, channelVal) : null
            return [
                shape.label,
                committed ? 'standard' : 'unknown',
                c[0], c[1], c[2],
                committed?.y ?? '',
                predicted !== null && !isNaN(predicted) ? predicted.toFixed(3) : ''
            ].join('\t')
        })
        const text = [headers.join('\t'), ...rows].join('\n')
        navigator.clipboard.writeText(text).then(() => {
            toast('Data copied to clipboard', 'success')
        }).catch(() => {
            toast('Failed to copy to clipboard', 'error')
        })
    }

    const validateImportData = (data: unknown): { valid: boolean; error?: string; data?: ExportedModel } => {
        if (!data || typeof data !== 'object') return { valid: false, error: 'File does not contain a valid JSON object' }

        const d = data as Record<string, unknown>

        if (d.committedPoints !== undefined) {
            if (!Array.isArray(d.committedPoints)) return { valid: false, error: '"committedPoints" must be an array' }
            for (const pt of d.committedPoints) {
                if (typeof pt !== 'object' || pt === null) return { valid: false, error: 'Each committed point must be an object' }
                const p = pt as Record<string, unknown>
                if (typeof p.label !== 'string') return { valid: false, error: 'Each committed point must have a string "label"' }
                if (typeof p.y !== 'number' || isNaN(p.y as number)) return { valid: false, error: `Committed point "${p.label}" has an invalid concentration value` }
            }
        }

        if (d.regressionModels !== undefined) {
            if (typeof d.regressionModels !== 'object' || d.regressionModels === null || Array.isArray(d.regressionModels)) {
                return { valid: false, error: '"regressionModels" must be an object' }
            }
            const validTypes = ['linear', 'quadratic', 'power', 'logarithmic']
            for (const [key, model] of Object.entries(d.regressionModels as Record<string, unknown>)) {
                if (typeof model !== 'object' || model === null) return { valid: false, error: `Model "${key}" is not a valid object` }
                const m = model as Record<string, unknown>
                if ('type' in m && !validTypes.includes(m.type as string)) {
                    return { valid: false, error: `Model "${key}" has invalid type "${m.type}". Expected: ${validTypes.join(', ')}` }
                }
                if (typeof m.r2 !== 'number') return { valid: false, error: `Model "${key}" is missing a numeric "r2" field` }
            }
        }

        if (d.modelType !== undefined) {
            const validModelTypes = ['linear', 'quadratic', 'power', 'logarithmic', 'best']
            if (!validModelTypes.includes(d.modelType as string)) {
                return { valid: false, error: `Invalid modelType "${d.modelType}"` }
            }
        }

        return { valid: true, data: data as ExportedModel }
    }

    const importModel = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = (event) => {
            try {
                const raw = JSON.parse(event.target?.result as string)
                const result = validateImportData(raw)

                if (!result.valid || !result.data) {
                    toast(`Import failed: ${result.error}`, 'error')
                    return
                }

                const data = result.data

                if (data.committedPoints) {
                    setCommittedPoints(data.committedPoints)
                }
                if (data.regressionModels) {
                    // Backward compat: old models without 'type' field => linear
                    const migrated: Record<string, RegressionModel> = {}
                    for (const [key, model] of Object.entries(data.regressionModels)) {
                        if (!('type' in model)) {
                            const legacy = model as unknown as { m: number; b: number; r2: number }
                            migrated[key] = { type: 'linear', m: legacy.m, b: legacy.b, r2: legacy.r2 }
                        } else {
                            migrated[key] = model
                        }
                    }
                    setRegressionModels(migrated)
                }
                if (data.modelType) {
                    setModelType(data.modelType)
                }

                toast(`Imported model from ${data.exportDate || 'unknown date'} with ${data.committedPoints?.length || 0} data points`, 'success')
            } catch {
                toast('Failed to import: file is not valid JSON', 'error')
            }
        }
        reader.readAsText(file)
        e.target.value = ''
    }

    const exportChartsPNG = useCallback(() => {
        const container = chartsContainerRef.current
        if (!container) return

        const canvases = container.querySelectorAll('canvas')
        if (canvases.length === 0) {
            toast('No charts to export', 'info')
            return
        }

        // Combine all chart canvases into a single image
        const padding = 16
        const cols = Math.min(canvases.length, overlayMode ? 1 : 2)
        const rows = Math.ceil(canvases.length / cols)
        const cellW = canvases[0].width
        const cellH = canvases[0].height
        const totalW = cols * cellW + (cols + 1) * padding
        const totalH = rows * cellH + (rows + 1) * padding + 40 // extra for title

        const exportCanvas = document.createElement('canvas')
        exportCanvas.width = totalW
        exportCanvas.height = totalH
        const ctx = exportCanvas.getContext('2d')
        if (!ctx) return

        ctx.fillStyle = '#0f0f0f'
        ctx.fillRect(0, 0, totalW, totalH)

        // Title
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 16px system-ui, sans-serif'
        ctx.fillText('ChemClub Analyst — Regression Charts', padding, 28)

        canvases.forEach((canvas, i) => {
            const col = i % cols
            const row = Math.floor(i / cols)
            const x = padding + col * (cellW + padding)
            const y = 40 + padding + row * (cellH + padding)
            ctx.drawImage(canvas, x, y)
        })

        const url = exportCanvas.toDataURL('image/png')
        const a = document.createElement('a')
        a.href = url
        a.download = `chemclub-charts-${new Date().toISOString().slice(0, 10)}.png`
        a.click()
        toast('Charts exported as PNG', 'success')
    }, [overlayMode, toast])

    const channelColors: Record<ColorChannel, string> = {
        red: '#ef4444',
        green: '#22c55e',
        blue: '#3b82f6',
        cyan: '#06b6d4',
        magenta: '#d946ef',
        yellow: '#eab308',
        black: '#71717a',
        magnitude: '#a855f7'
    }

    const toggleChart = (channel: ColorChannel) => {
        setActiveCharts(prev =>
            prev.includes(channel)
                ? prev.filter(c => c !== channel)
                : [...prev, channel]
        )
    }

    const createChartData = (channel: ColorChannel) => {
        const dataPoints = committedPoints.map(pt => {
            const shape = shapes.find(s => s.label === pt.label)
            if (!shape) return null
            return {
                x: pt.y,
                y: getColorValue(shape.color, channel),
                label: pt.label,
                color: shape.color,
                stdDev: shape.colorStdDev
            }
        }).filter(Boolean) as { x: number; y: number; label: string; color: [number, number, number]; stdDev?: [number, number, number] }[]

        const datasets: ChartDataset<'scatter'>[] = [{
            label: channel.charAt(0).toUpperCase() + channel.slice(1),
            data: dataPoints,
            borderColor: channelColors[channel],
            backgroundColor: channelColors[channel],
            pointRadius: 8,
            pointHoverRadius: 12,
            showLine: false
        }]

        const model = regressionModels[channel]
        if (model && dataPoints.length >= 2) {
            const xValues = dataPoints.map(p => p.x)
            const minX = Math.min(...xValues) * 0.9
            const maxX = Math.max(...xValues) * 1.1
            const numPoints = model.type === 'linear' ? 2 : 50
            const step = (maxX - minX) / (numPoints - 1)

            const curveData = []
            for (let i = 0; i < numPoints; i++) {
                const x = minX + step * i
                curveData.push({ x, y: evaluateModel(model, x) })
            }

            datasets.push({
                label: `R² = ${model.r2.toFixed(4)}`,
                data: curveData,
                borderColor: channelColors[channel],
                backgroundColor: 'transparent',
                borderDash: [5, 5],
                pointRadius: 0,
                showLine: true,
                borderWidth: 2
            })
        }

        return { datasets }
    }

    const createOverlayChartData = () => {
        const datasets: ChartDataset<'scatter'>[] = []

        for (const channel of activeCharts) {
            const dataPoints = committedPoints.map(pt => {
                const shape = shapes.find(s => s.label === pt.label)
                if (!shape) return null
                return { x: pt.y, y: getColorValue(shape.color, channel) }
            }).filter(Boolean) as { x: number; y: number }[]

            datasets.push({
                label: channel.charAt(0).toUpperCase() + channel.slice(1),
                data: dataPoints,
                borderColor: channelColors[channel],
                backgroundColor: channelColors[channel],
                pointRadius: 6,
                showLine: false
            })

            const model = regressionModels[channel]
            if (model && dataPoints.length >= 2) {
                const xValues = dataPoints.map(p => p.x)
                const minX = Math.min(...xValues) * 0.9
                const maxX = Math.max(...xValues) * 1.1
                const numPoints = model.type === 'linear' ? 2 : 50
                const step = (maxX - minX) / (numPoints - 1)
                const curveData = []
                for (let i = 0; i < numPoints; i++) {
                    const x = minX + step * i
                    curveData.push({ x, y: evaluateModel(model, x) })
                }

                datasets.push({
                    label: `${channel} fit`,
                    data: curveData,
                    borderColor: channelColors[channel],
                    backgroundColor: 'transparent',
                    borderDash: [5, 5],
                    pointRadius: 0,
                    showLine: true,
                    borderWidth: 2
                })
            }
        }

        return { datasets }
    }

    // Error bars plugin
    const errorBarPlugin: Plugin<'scatter'> = {
        id: 'errorBars',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx
            const dataset = chart.data.datasets[0]
            if (!dataset) return

            const meta = chart.getDatasetMeta(0)
            const points = dataset.data as ({ x: number; y: number; stdDev?: [number, number, number] })[]
            points.forEach((point, i: number) => {
                if (!point.stdDev) return
                const { x } = meta.data[i].getProps(['x', 'y'])
                const channelIdx = activeCharts[0] === 'red' ? 0 : activeCharts[0] === 'green' ? 1 : 2
                const sd = point.stdDev[channelIdx] || 0
                if (sd <= 0) return

                const yScale = chart.scales.y
                const yTop = yScale.getPixelForValue(point.y + sd)
                const yBot = yScale.getPixelForValue(point.y - sd)

                ctx.save()
                ctx.strokeStyle = 'rgba(255,255,255,0.5)'
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.moveTo(x, yTop)
                ctx.lineTo(x, yBot)
                // caps
                ctx.moveTo(x - 3, yTop)
                ctx.lineTo(x + 3, yTop)
                ctx.moveTo(x - 3, yBot)
                ctx.lineTo(x + 3, yBot)
                ctx.stroke()
                ctx.restore()
            })
        }
    }

    const chartOptions = (channel: ColorChannel) => ({
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: overlayMode || multiModelMode, labels: { font: { size: 10 } } },
            tooltip: {
                callbacks: {
                    label: (context: TooltipItem<'scatter'>) => {
                        const point = context.raw as { x: number; y: number; label?: string }
                        if (point.label) {
                            return [`Sample: ${point.label}`, `Conc: ${point.x}`, `Value: ${point.y.toFixed(2)}`]
                        }
                        return `${point.y.toFixed(2)}`
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'linear' as const,
                title: { display: true, text: 'Concentration (mM)', font: { size: 10 } },
                grid: { color: 'rgba(255,255,255,0.05)' }
            },
            y: {
                type: 'linear' as const,
                title: { display: true, text: overlayMode ? 'Value' : channel, font: { size: 10 } },
                grid: { color: 'rgba(255,255,255,0.05)' }
            }
        }
    })

    if (shapes.length === 0) {
        return (
            <div className="h-full w-full flex items-center justify-center">
                <div className="text-center text-muted-foreground max-w-xs mx-auto">
                    <p className="text-lg font-medium">No data available</p>
                    <p className="text-sm mt-2">Detect or draw shapes on images first, then return here for regression analysis.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="h-full overflow-auto p-4 space-y-4">
            <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={importModel} />

            {/* ── Controls Strip ── */}
            <div className="space-y-2 border border-border/40 rounded-lg p-3 bg-card/50">
                {/* Row 1: Model type + Prediction channel */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground shrink-0">Model</span>
                        {(['linear', 'quadratic', 'power', 'logarithmic', 'best'] as const).map(mt => (
                            <button
                                key={mt}
                                onClick={() => setModelType(mt)}
                                className={`px-2 py-1 text-[11px] rounded transition-all ${modelType === mt
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    }`}
                            >
                                {mt === 'best' ? 'Best' : mt.charAt(0).toUpperCase() + mt.slice(1)}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground shrink-0">Predict</span>
                        <select
                            value={predictionChannel}
                            onChange={e => setPredictionChannel(e.target.value as ColorChannel | 'auto')}
                            className="bg-muted/30 border border-border/50 rounded px-2 py-1 text-[11px] text-foreground"
                        >
                            <option value="auto">Auto (Best R²)</option>
                            {ALL_CHANNELS.map(ch => (
                                <option key={ch} value={ch}>
                                    {ch.charAt(0).toUpperCase() + ch.slice(1)}
                                    {regressionModels[ch] ? ` (R²=${regressionModels[ch].r2.toFixed(3)})` : ''}
                                </option>
                            ))}
                        </select>
                        {predictionChannel === 'auto' && regressionModels[effectivePredChannel] && (
                            <span className="text-[11px] font-mono text-muted-foreground">
                                → {effectivePredChannel} <span className="text-primary">R²={regressionModels[effectivePredChannel].r2.toFixed(3)}</span>
                            </span>
                        )}
                    </div>
                </div>
                {/* Row 2: Channel toggles */}
                <div className="flex overflow-x-auto md:overflow-visible md:flex-wrap items-center gap-1 pt-1 border-t border-border/30">
                    <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mr-1 shrink-0">Charts</span>
                    {(['red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'black', 'magnitude'] as ColorChannel[]).map(ch => (
                        <button
                            key={ch}
                            onClick={() => toggleChart(ch)}
                            className={`shrink-0 px-1.5 py-1 text-[11px] rounded transition-all ${activeCharts.includes(ch)
                                ? 'text-white'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                }`}
                            style={{ backgroundColor: activeCharts.includes(ch) ? channelColors[ch] : undefined }}
                        >
                            {ch.slice(0, 3).toUpperCase()}
                            {regressionModels[ch] && (
                                <span className="ml-0.5 text-[9px] opacity-70">{regressionModels[ch].r2.toFixed(2)}</span>
                            )}
                        </button>
                    ))}
                    <div className="w-px h-4 bg-border/40 mx-1 shrink-0" />
                    <button
                        onClick={() => { setOverlayMode(!overlayMode); if (!overlayMode) setMultiModelMode(false) }}
                        className={`shrink-0 px-1.5 py-1 text-[11px] rounded transition-all flex items-center gap-1 ${overlayMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    >
                        <Layers className="h-3 w-3" /> Overlay
                    </button>
                    <button
                        onClick={() => { setMultiModelMode(!multiModelMode); if (!multiModelMode) setOverlayMode(false) }}
                        className={`shrink-0 px-1.5 py-1 text-[11px] rounded transition-all flex items-center gap-1 ${multiModelMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    >
                        <GitCompareArrows className="h-3 w-3" /> Compare
                    </button>
                    <button
                        onClick={() => setShowResiduals(!showResiduals)}
                        className={`shrink-0 px-1.5 py-1 text-[11px] rounded transition-all ${showResiduals ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}
                    >
                        Residuals
                    </button>
                    {isAutoFitting && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
                </div>
            </div>

            {/* Selected Point Info */}
            {selectedPoint && (
                <div className="flex items-center gap-3 p-2 bg-card rounded-lg border">
                    <div
                        className="w-8 h-8 rounded border"
                        style={{ backgroundColor: `rgb(${selectedPoint.color.join(',')})` }}
                    />
                    <div className="text-sm">
                        <span className="font-bold">{selectedPoint.label}</span>
                        <span className="text-muted-foreground ml-2">
                            RGB({selectedPoint.color.join(', ')})
                        </span>
                    </div>
                    <button
                        onClick={() => setSelectedPoint(null)}
                        className="ml-auto text-muted-foreground hover:text-foreground"
                    >&times;</button>
                </div>
            )}

            {/* Mobile Tab Switcher */}
            <div className="flex md:hidden border rounded-lg overflow-hidden">
                <button
                    className={cn("flex-1 py-2.5 text-xs font-medium min-h-[44px]", mobileRegTab === 'data' ? 'bg-primary text-primary-foreground' : 'bg-card')}
                    onClick={() => setMobileRegTab('data')}
                >
                    Data Table
                </button>
                <button
                    className={cn("flex-1 py-2.5 text-xs font-medium min-h-[44px]", mobileRegTab === 'charts' ? 'bg-primary text-primary-foreground' : 'bg-card')}
                    onClick={() => setMobileRegTab('charts')}
                >
                    Charts
                </button>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
                {/* Data Table */}
                <div className={cn("xl:col-span-1 border rounded-lg overflow-hidden bg-card", mobileRegTab === 'charts' && "hidden md:block")}>
                    <div className="p-2 bg-muted/50 border-b text-xs font-semibold flex items-center justify-between">
                        <span>Data Points</span>
                        <div className="flex gap-1">
                            <button onClick={() => setShowDilutionModal(true)} className="px-1.5 py-0.5 text-[10px] bg-muted rounded hover:bg-muted-foreground/20" title="Fill dilution series">
                                Fill Series
                            </button>
                            <button onClick={() => setShowCSVImport(true)} className="px-1.5 py-0.5 text-[10px] bg-muted rounded hover:bg-muted-foreground/20" title="Import concentrations from CSV">
                                CSV
                            </button>
                            <button onClick={handleAutoExcludeOutliers} className="px-1.5 py-0.5 text-[10px] bg-muted rounded hover:bg-muted-foreground/20 flex items-center gap-0.5" title="Auto-exclude points with |std. residual| > 2" disabled={Object.keys(regressionModels).length === 0}>
                                <Zap className="h-2.5 w-2.5" /> Outliers
                            </button>
                            <button onClick={() => setCommittedPoints([])} className="px-1.5 py-0.5 text-[10px] bg-muted rounded hover:bg-muted-foreground/20 text-destructive" title="Clear all concentrations" disabled={committedPoints.length === 0}>
                                Clear
                            </button>
                        </div>
                    </div>
                    <div className="max-h-64 md:max-h-80 overflow-y-auto overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-muted/30 sticky top-0">
                                <tr>
                                    <th className="p-1.5 text-left">Label</th>
                                    <th className="p-1.5 text-left">RGB</th>
                                    <th className="p-1.5 text-left">Conc.</th>
                                    <th className="p-1.5 text-left">Pred.</th>
                                    <th className="p-1 w-6"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {shapes.map(shape => {
                                    const committed = committedPoints.find(p => p.label === shape.label)
                                    const c = getDisplayColor(shape.color)
                                    const channelValue = getColorValue(shape.color, effectivePredChannel)
                                    const model = regressionModels[effectivePredChannel]
                                    const predicted = model ? predictFromModel(model, channelValue) : null
                                    const isExcluded = excludedPoints.has(shape.label)
                                    const residual = residualsData[effectivePredChannel]?.find(r => r.label === shape.label)
                                    const isOutlier = residual && Math.abs(residual.standardizedResidual) > 2

                                    return (
                                        <tr key={shape.id} className={`border-t border-muted hover:bg-muted/20 ${
                                            focusedLabel === shape.label ? 'bg-primary/5 ring-1 ring-primary/20' :
                                            isExcluded ? 'opacity-40' :
                                            !committed && model ? 'bg-amber-500/5 border-l-2 border-l-amber-500/30' : ''
                                        }`}>
                                            <td className="p-1.5">
                                                <div className="flex items-center gap-1">
                                                    <div
                                                        className="w-3 h-3 rounded"
                                                        style={{ backgroundColor: `rgb(${c.join(',')})` }}
                                                    />
                                                    <span className={`font-mono font-bold ${isExcluded ? 'line-through' : ''}`}>{shape.label}</span>
                                                    {isOutlier && !isExcluded && (
                                                        <span className="text-amber-500 text-[10px]" title={`Std. residual: ${residual!.standardizedResidual.toFixed(2)}`}>&#9888;</span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-1.5 font-mono text-[10px] text-muted-foreground">
                                                {c.join(',')}
                                                {shape.colorStdDev && (
                                                    <span className="text-muted-foreground/50"> &plusmn;{shape.colorStdDev[0]}</span>
                                                )}
                                            </td>
                                            <td className="p-1.5">
                                                <input
                                                    ref={el => { if (el) inputRefsMap.current.set(shape.label, el); else inputRefsMap.current.delete(shape.label) }}
                                                    type="number"
                                                    step="any"
                                                    className="w-16 bg-background border rounded px-1.5 py-1 text-xs"
                                                    placeholder="0.00"
                                                    value={committed?.y ?? ''}
                                                    onChange={(e) => handleConcentrationChange(shape.label, e.target.value)}
                                                    onKeyDown={(e) => handleInputKeyDown(e, shape.label)}
                                                    onPaste={(e) => handlePaste(e, shape.label)}
                                                    onFocus={() => setFocusedLabel(shape.label)}
                                                    onBlur={() => setFocusedLabel(null)}
                                                />
                                            </td>
                                            <td className={`p-1.5 font-mono text-[10px] ${!committed && model ? 'text-amber-400' : 'text-muted-foreground'}`}>
                                                {predicted !== null && !isNaN(predicted) ? (
                                                    <>
                                                        {predicted.toFixed(3)}
                                                        {!committed && rseValue !== null && isFinite(rseValue) && (
                                                            <span className="text-muted-foreground/50"> &plusmn;{rseValue.toFixed(1)}</span>
                                                        )}
                                                    </>
                                                ) : '\u2014'}
                                            </td>
                                            <td className="p-1 w-6">
                                                {committed && (
                                                    <button
                                                        onClick={() => setExcludedPoints(prev => {
                                                            const next = new Set(prev)
                                                            if (next.has(shape.label)) next.delete(shape.label)
                                                            else next.add(shape.label)
                                                            return next
                                                        })}
                                                        className={`w-4 h-4 rounded border text-[8px] flex items-center justify-center ${isExcluded ? 'bg-destructive/20 border-destructive text-destructive' : 'border-muted-foreground/30 hover:border-foreground'}`}
                                                        title={isExcluded ? 'Include this point' : 'Exclude from regression'}
                                                    >
                                                        {isExcluded ? '\u2715' : ''}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Equations + Charts */}
                <div className={cn("xl:col-span-3 space-y-4", mobileRegTab === 'data' && "hidden md:block")}>
                    {/* Equations */}
                    {Object.keys(regressionModels).length > 0 && (
                        <div className="border rounded-lg p-3 bg-card">
                            <h3 className="text-xs font-semibold mb-2">Regression Equations</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
                                {(['red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'black', 'magnitude'] as ColorChannel[]).map(ch => {
                                    const model = regressionModels[ch]
                                    if (!model) return null
                                    return (
                                        <div key={ch} className="p-2 rounded bg-muted/30 text-[10px]">
                                            <span className="font-bold block" style={{ color: channelColors[ch] }}>{ch}</span>
                                            <div className="font-mono truncate" title={formatEquation(model)}>{formatEquation(model)}</div>
                                            <div className="text-muted-foreground">R²={model.r2.toFixed(3)} ({model.type})</div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Charts */}
                    <div ref={chartsContainerRef}>
                    {overlayMode ? (
                        <div className="bg-card border rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-semibold">All Channels Overlay</h4>
                            </div>
                            <div className="h-56 md:h-72">
                                <Scatter options={chartOptions('magnitude')} data={createOverlayChartData()} />
                            </div>
                        </div>
                    ) : (
                        <div className={`grid gap-3 ${activeCharts.length === 1 ? 'grid-cols-1' : activeCharts.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
                            {activeCharts.map(ch => (
                                <div key={ch} className="bg-card border rounded-lg p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-xs font-semibold capitalize" style={{ color: channelColors[ch] }}>
                                            {ch}{multiModelMode ? ' — Model Comparison' : ''}
                                        </h4>
                                        {!multiModelMode && regressionModels[ch] && (
                                            <span className="text-[10px] text-muted-foreground">
                                                R² = {regressionModels[ch].r2.toFixed(3)}
                                            </span>
                                        )}
                                    </div>
                                    <div className={multiModelMode ? "h-52 md:h-64" : "h-40 md:h-48"}>
                                        <Scatter
                                            options={chartOptions(ch)}
                                            data={multiModelMode ? createMultiModelChartData(ch) : createChartData(ch)}
                                            plugins={multiModelMode ? [] : [errorBarPlugin]}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    </div>

                    {/* Residual Plots */}
                    {showResiduals && Object.keys(residualsData).length > 0 && (
                        <div className="mt-4 space-y-3">
                            <h3 className="text-xs font-semibold">Residual Plots</h3>
                            <div className={`grid gap-3 ${activeCharts.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'}`}>
                                {activeCharts.map(ch => {
                                    const data = residualsData[ch]
                                    if (!data || data.length === 0) return null
                                    return (
                                        <div key={`residual-${ch}`} className="bg-card border rounded-lg p-3">
                                            <h4 className="text-xs font-semibold capitalize mb-2" style={{ color: channelColors[ch] }}>
                                                {ch} Residuals
                                            </h4>
                                            <div className="h-32 md:h-40">
                                                <Scatter
                                                    data={{
                                                        datasets: [{
                                                            label: 'Residuals',
                                                            data: data.map(r => ({ x: r.concentration, y: r.residual })),
                                                            borderColor: channelColors[ch],
                                                            backgroundColor: data.map(r =>
                                                                Math.abs(r.standardizedResidual) > 2 ? '#f59e0b' : channelColors[ch]
                                                            ),
                                                            pointRadius: 6,
                                                            showLine: false
                                                        }, {
                                                            label: 'Zero',
                                                            data: [
                                                                { x: Math.min(...data.map(r => r.concentration)) * 0.9, y: 0 },
                                                                { x: Math.max(...data.map(r => r.concentration)) * 1.1, y: 0 }
                                                            ],
                                                            borderColor: 'rgba(255,255,255,0.3)',
                                                            borderDash: [4, 4],
                                                            pointRadius: 0,
                                                            showLine: true,
                                                            borderWidth: 1
                                                        }]
                                                    }}
                                                    options={{
                                                        responsive: true,
                                                        maintainAspectRatio: false,
                                                        plugins: { legend: { display: false } },
                                                        scales: {
                                                            x: { type: 'linear' as const, title: { display: true, text: 'Conc.', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
                                                            y: { type: 'linear' as const, title: { display: true, text: 'Residual', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }
                                                        }
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Actions bar */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/30">
                <Button size="sm" onClick={runRegression} disabled={committedPoints.length < 2}>Run Regression</Button>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => fileInputRef.current?.click()}><Upload className="w-3.5 h-3.5 mr-1" /> Import</Button>
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={exportModel} disabled={committedPoints.length === 0}><Download className="w-3.5 h-3.5 mr-1" /> JSON</Button>
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={exportCSV} disabled={shapes.length === 0}><FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> CSV</Button>
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={copyToClipboard} disabled={shapes.length === 0}><ClipboardCopy className="w-3.5 h-3.5 mr-1" /> Copy</Button>
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={exportChartsPNG} disabled={activeCharts.length === 0 || committedPoints.length < 2}><ImageDown className="w-3.5 h-3.5 mr-1" /> PNG</Button>
            </div>

            {showDilutionModal && (
                <DilutionSeriesModal
                    shapes={shapes}
                    onApply={(points) => {
                        setCommittedPoints(prev => {
                            const newLabels = new Set(points.map(p => p.label))
                            const kept = prev.filter(p => !newLabels.has(p.label))
                            return [...kept, ...points]
                        })
                    }}
                    onClose={() => setShowDilutionModal(false)}
                />
            )}
            {showCSVImport && (
                <CSVImportModal
                    shapes={shapes}
                    onApply={(points) => {
                        setCommittedPoints(prev => {
                            const newLabels = new Set(points.map(p => p.label))
                            const kept = prev.filter(p => !newLabels.has(p.label))
                            return [...kept, ...points]
                        })
                    }}
                    onClose={() => setShowCSVImport(false)}
                />
            )}
        </div>
    )
}
