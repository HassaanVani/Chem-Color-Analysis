import { useState, useRef, useEffect } from 'react'
import { useApp } from '@/context/AppContext'
import { Button } from '@/components/ui/button'
import { Trash2, ArrowUpDown, ArrowDown, ArrowUp, ArrowRight, ArrowLeft, X, Pipette } from 'lucide-react'
import { rgbToCmyk, rgbToHsl, rgbToHsv } from '@/lib/imageUtils'
import { calibrateColor } from '@/lib/colorCalibration'
import { getConfidenceColor } from '@/lib/confidenceUtils'

type SortDirection = 'top-to-bottom' | 'left-to-right'
type SortOrder = 'ascending' | 'descending'

function EditableLabel({
    value,
    onChange,
}: {
    value: string
    onChange: (v: string) => void
}) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(value)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        setDraft(value)
    }, [value])

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [editing])

    if (!editing) {
        return (
            <span
                className="text-sm font-mono font-semibold text-foreground cursor-text hover:text-primary transition-colors"
                onClick={(e) => {
                    e.stopPropagation()
                    setEditing(true)
                }}
                title="Click to edit label"
            >
                {value}
            </span>
        )
    }

    return (
        <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
                onChange(draft)
                setEditing(false)
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    onChange(draft)
                    setEditing(false)
                }
                if (e.key === 'Escape') {
                    setDraft(value)
                    setEditing(false)
                }
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-mono font-semibold text-foreground bg-muted/30 border border-primary/50 rounded px-1.5 py-0.5 outline-none w-20 focus:ring-1 focus:ring-primary/30"
        />
    )
}

export function ShapesList() {
    const {
        shapes, currentImageIndex, removeShape, updateShape, colorMode,
        selectedShapeId, setSelectedShapeId, setShapes,
        rawRgbMode, colorCalibration, clearShapesForImage
    } = useApp()

    const [showQuickSort, setShowQuickSort] = useState(false)
    const [sortDirection, setSortDirection] = useState<SortDirection>('top-to-bottom')
    const [sortOrder, setSortOrder] = useState<SortOrder>('ascending')

    const currentShapes = shapes.filter(s => s.imageIndex === currentImageIndex)

    const getColor = (rgb: [number, number, number]) =>
        rawRgbMode ? rgb : calibrateColor(rgb, colorCalibration)

    const formatColor = (rgb: [number, number, number]) => {
        const c = getColor(rgb)
        switch (colorMode) {
            case 'RGB': return `RGB(${c[0]}, ${c[1]}, ${c[2]})`
            case 'CMYK': {
                const cmyk = rgbToCmyk(c)
                return `C${(cmyk[0] * 100).toFixed(0)} M${(cmyk[1] * 100).toFixed(0)} Y${(cmyk[2] * 100).toFixed(0)} K${(cmyk[3] * 100).toFixed(0)}`
            }
            case 'HSL': {
                const hsl = rgbToHsl(c)
                return `H${hsl[0]} S${hsl[1]}% L${hsl[2]}%`
            }
            case 'HSV': {
                const hsv = rgbToHsv(c)
                return `H${hsv[0]} S${hsv[1]}% V${hsv[2]}%`
            }
        }
    }

    const formatStdDev = (stdDev: [number, number, number]) => {
        const avg = Math.round((stdDev[0] + stdDev[1] + stdDev[2]) / 3)
        return `\u00b1${avg}`
    }

    const handleQuickSort = () => {
        const existingLabels = currentShapes.map(s => s.label)
        const sortedLabels = [...existingLabels].sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        )

        const sortedShapes = [...currentShapes].sort((a, b) => {
            const posA = sortDirection === 'top-to-bottom' ? a.y : a.x
            const posB = sortDirection === 'top-to-bottom' ? b.y : b.x
            return sortOrder === 'ascending' ? posA - posB : posB - posA
        })

        const updates: { id: string; label: string }[] = sortedShapes.map((shape, idx) => ({
            id: shape.id,
            label: sortedLabels[idx]
        }))

        setShapes(prev => prev.map(s => {
            const update = updates.find(u => u.id === s.id)
            return update ? { ...s, label: update.label } : s
        }))

        setShowQuickSort(false)
    }

    // -- Empty state --
    if (currentShapes.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <Pipette className="h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm text-muted-foreground">
                    No shapes detected
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                    Draw regions or use auto-detection to sample colors.
                </p>
            </div>
        )
    }

    // -- Main list --
    return (
        <div className="p-3 space-y-2">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                        Samples
                    </span>
                    <span className="text-[10px] font-mono font-medium text-primary bg-primary/10 rounded-full px-2 py-0.5 leading-none">
                        {currentShapes.length}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 rounded-full px-2.5 text-[11px] font-medium text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => clearShapesForImage(currentImageIndex)}
                    >
                        <X className="h-3 w-3 mr-1" />
                        Clear
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className={`h-6 rounded-full px-2.5 text-[11px] font-medium ${
                            showQuickSort
                                ? 'text-primary bg-primary/10'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setShowQuickSort(!showQuickSort)}
                    >
                        <ArrowUpDown className="h-3 w-3 mr-1" />
                        Sort
                    </Button>
                </div>
            </div>

            {/* Sort panel */}
            {showQuickSort && (
                <div className="bg-muted/20 border border-border rounded-lg p-3 space-y-2.5">
                    <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                        Sort Labels by Position
                    </div>

                    <div className="flex gap-1.5">
                        <Button
                            size="sm"
                            variant={sortDirection === 'top-to-bottom' ? 'default' : 'outline'}
                            className="flex-1 h-7 text-xs rounded-md"
                            onClick={() => setSortDirection('top-to-bottom')}
                        >
                            {sortOrder === 'ascending'
                                ? <ArrowDown className="h-3 w-3 mr-1" />
                                : <ArrowUp className="h-3 w-3 mr-1" />
                            }
                            Vertical
                        </Button>
                        <Button
                            size="sm"
                            variant={sortDirection === 'left-to-right' ? 'default' : 'outline'}
                            className="flex-1 h-7 text-xs rounded-md"
                            onClick={() => setSortDirection('left-to-right')}
                        >
                            {sortOrder === 'ascending'
                                ? <ArrowRight className="h-3 w-3 mr-1" />
                                : <ArrowLeft className="h-3 w-3 mr-1" />
                            }
                            Horizontal
                        </Button>
                    </div>

                    <div className="flex gap-1.5">
                        <Button
                            size="sm"
                            variant={sortOrder === 'ascending' ? 'default' : 'outline'}
                            className="flex-1 h-7 text-xs rounded-md"
                            onClick={() => setSortOrder('ascending')}
                        >
                            Ascending
                        </Button>
                        <Button
                            size="sm"
                            variant={sortOrder === 'descending' ? 'default' : 'outline'}
                            className="flex-1 h-7 text-xs rounded-md"
                            onClick={() => setSortOrder('descending')}
                        >
                            Descending
                        </Button>
                    </div>

                    <Button
                        size="sm"
                        className="w-full h-8 text-xs rounded-md font-medium"
                        onClick={handleQuickSort}
                    >
                        Apply Sort
                    </Button>
                </div>
            )}

            {/* Shape items */}
            <div className="space-y-1.5">
                {currentShapes.map(shape => {
                    const c = getColor(shape.color)
                    const isSelected = selectedShapeId === shape.id
                    const hasStdDev = shape.colorStdDev && (
                        shape.colorStdDev[0] > 0 || shape.colorStdDev[1] > 0 || shape.colorStdDev[2] > 0
                    )

                    return (
                        <div
                            key={shape.id}
                            className={`group flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                                isSelected
                                    ? 'border border-primary/50 bg-primary/5'
                                    : 'border border-border/50 hover:border-border'
                            }`}
                            onClick={() => setSelectedShapeId(isSelected ? null : shape.id)}
                        >
                            {/* Color swatch */}
                            <div
                                className="w-8 h-8 rounded-lg shadow-inner border border-white/10 flex-shrink-0"
                                style={{ backgroundColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})` }}
                            />

                            {/* Label + color info */}
                            <div className="flex-1 min-w-0 space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                    <EditableLabel
                                        value={shape.label}
                                        onChange={(v) => updateShape(shape.id, { label: v })}
                                    />
                                    {shape.confidence !== undefined && (
                                        <span
                                            className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full leading-none"
                                            style={{ backgroundColor: getConfidenceColor(shape.confidence), color: shape.confidence >= 0.4 ? '#000' : '#fff' }}
                                            title={`Detection confidence: ${(shape.confidence * 100).toFixed(0)}%`}
                                        >
                                            {(shape.confidence * 100).toFixed(0)}%
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[11px] font-mono text-muted-foreground tracking-wide truncate">
                                        {formatColor(shape.color)}
                                    </span>
                                    {hasStdDev && (
                                        <span className="text-[10px] font-mono text-muted-foreground/50">
                                            {formatStdDev(shape.colorStdDev!)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Delete button — hover reveal */}
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    removeShape(shape.id)
                                }}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
