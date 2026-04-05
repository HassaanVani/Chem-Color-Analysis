import { useApp } from '@/context/AppContext'
import { rgbToCmyk, rgbToHsl, rgbToHsv } from '@/lib/imageUtils'
import { calibrateColor } from '@/lib/colorCalibration'

export function ColorAnalysisPanel() {
    const { shapes, currentImageIndex, colorMode, rawRgbMode, colorCalibration } = useApp()

    const currentShapes = shapes.filter(s => s.imageIndex === currentImageIndex)

    const getColor = (rgb: [number, number, number]) =>
        rawRgbMode ? rgb : calibrateColor(rgb, colorCalibration)

    const formatColor = (rgb: [number, number, number]) => {
        const c = getColor(rgb)
        switch (colorMode) {
            case 'RGB': return `R:${c[0]} G:${c[1]} B:${c[2]}`
            case 'CMYK': {
                const cmyk = rgbToCmyk(c)
                return `C:${(cmyk[0] * 100).toFixed(0)} M:${(cmyk[1] * 100).toFixed(0)} Y:${(cmyk[2] * 100).toFixed(0)} K:${(cmyk[3] * 100).toFixed(0)}`
            }
            case 'HSL': {
                const hsl = rgbToHsl(c)
                return `H:${hsl[0]} S:${hsl[1]}% L:${hsl[2]}%`
            }
            case 'HSV': {
                const hsv = rgbToHsv(c)
                return `H:${hsv[0]} S:${hsv[1]}% V:${hsv[2]}%`
            }
        }
    }

    if (currentShapes.length === 0) {
        return (
            <div className="p-4 flex flex-col items-center justify-center gap-3 text-center min-h-[120px]">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="w-8 h-8 text-muted-foreground/40"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
                    />
                </svg>
                <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground/60">No color data</p>
                    <p className="text-[11px] text-muted-foreground/40">Detect shapes to begin analysis</p>
                </div>
            </div>
        )
    }

    const avgColor = currentShapes.reduce(
        (acc, s) => {
            const c = getColor(s.color)
            return [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]]
        },
        [0, 0, 0]
    ).map((v: number) => Math.round(v / currentShapes.length)) as [number, number, number]

    const totalMagnitude = currentShapes.map(s => {
        const c = getColor(s.color)
        return Math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2)
    })
    const avgMagnitude = totalMagnitude.reduce((a, b) => a + b, 0) / totalMagnitude.length

    return (
        <div className="p-4 space-y-5">
            {/* Summary Card */}
            <div className="border border-border/50 rounded-lg p-4">
                <h4 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">
                    Summary
                </h4>
                <div className="flex items-start gap-4">
                    {/* Large average color swatch */}
                    <div
                        className="w-12 h-12 rounded-lg shadow-inner border border-border/50 flex-shrink-0"
                        style={{ backgroundColor: `rgb(${avgColor[0]}, ${avgColor[1]}, ${avgColor[2]})` }}
                    />
                    {/* Stats grid */}
                    <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1.5 min-w-0">
                        <div>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Samples</span>
                            <p className="font-mono text-sm text-foreground">{currentShapes.length}</p>
                        </div>
                        <div>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Avg Magnitude</span>
                            <p className="font-mono text-sm text-primary">{avgMagnitude.toFixed(1)}</p>
                        </div>
                        <div className="col-span-2">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">Avg Color</span>
                            <p className="font-mono text-sm text-foreground">{formatColor(avgColor)}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Individual Values */}
            <div>
                <h4 className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-2">
                    Individual Values
                </h4>
                <div className="max-h-52 overflow-y-auto scrollbar-thin space-y-0.5">
                    {currentShapes.map(shape => {
                        const c = getColor(shape.color)
                        const magnitude = Math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2)
                        return (
                            <div
                                key={shape.id}
                                className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-muted/20 transition-colors"
                            >
                                {/* Color swatch */}
                                <div
                                    className="w-6 h-6 rounded-md flex-shrink-0 border border-border/30"
                                    style={{ backgroundColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})` }}
                                />
                                {/* Shape label */}
                                <span className="font-mono font-bold text-sm text-foreground w-8 flex-shrink-0">
                                    {shape.label}
                                </span>
                                {/* Color values + stddev */}
                                <span className="font-mono text-[11px] text-muted-foreground flex-1 min-w-0 truncate">
                                    {formatColor(shape.color)}
                                    {shape.colorStdDev && (
                                        <span className="text-muted-foreground/50 ml-1">
                                            &plusmn;{shape.colorStdDev[0]}
                                        </span>
                                    )}
                                </span>
                                {/* Magnitude — right-aligned, teal accent */}
                                <span className="font-mono text-[11px] text-primary flex-shrink-0">
                                    &Sigma;{magnitude.toFixed(0)}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
