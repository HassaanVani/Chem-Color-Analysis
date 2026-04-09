import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react'
import { Button } from '@/components/ui/button'
import {
  Settings, Image as ImageIcon, BarChart3, Upload, Trash2,
  Wand2, Grid, ChevronLeft, ChevronRight, Palette, ListTree, Loader2,
  Menu, X, ChevronDown, ChevronUp, Plus, HelpCircle, Undo2, Redo2, CheckCircle2, PlayCircle, Keyboard, RefreshCw, Camera, SwatchBook, LayoutGrid
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ImageViewer } from '@/components/features/ImageViewer'
const RegressionStudio = lazy(() => import('@/components/features/RegressionStudio').then(m => ({ default: m.RegressionStudio })))
import { SettingsPanel } from '@/components/features/SettingsPanel'
import { ShapesList } from '@/components/features/ShapesList'
import { ColorAnalysisPanel } from '@/components/features/ColorAnalysisPanel'
import { Tutorial } from '@/components/features/Tutorial'
import { KeyboardShortcuts } from '@/components/features/KeyboardShortcuts'
import { isOpenCVReady, autoDetectCircles, autoDetectRectangles } from '@/lib/opencvUtils'
import { computeCircleConfidence, computeRectConfidence } from '@/lib/confidenceUtils'
import { PLATE_CONFIGS, getPlateTemplate, generatePlateShapes } from '@/lib/plateUtils'
import type { WellPlateSize, PlateOverlayState } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useServiceWorker } from '@/hooks/useServiceWorker'
import { PWAStatus } from '@/components/ui/pwa-status'

function App() {
  const [activeTab, setActiveTab] = useState<'detect' | 'analyze'>('detect')
  const [showSettings, setShowSettings] = useState(true)
  const [rightPanel, setRightPanel] = useState<'shapes' | 'colors'>('shapes')
  const [isDetecting, setIsDetecting] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'none' | 'images' | 'info' | 'settings'>('none')
  const [mobilePanelHeight, setMobilePanelHeight] = useState<'half' | 'full'>('half')
  const panelDragStartY = useRef(0)
  const [showTutorial, setShowTutorial] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showPlateMenu, setShowPlateMenu] = useState(false)
  const [plateOverlay, setPlateOverlay] = useState<PlateOverlayState | null>(null)
  const [colorScheme, setColorScheme] = useState<'labline' | 'midnight'>('midnight')
  const toggleColorScheme = () => {
    const next = colorScheme === 'labline' ? 'midnight' : 'labline'
    setColorScheme(next)
    if (next === 'midnight') document.documentElement.setAttribute('data-theme', 'original')
    else document.documentElement.removeAttribute('data-theme')
  }

  // Apply default theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'original')
  }, [])
  const [opencvReady, setOpencvReady] = useState(false)
  const [opencvFailed, setOpencvFailed] = useState(false)
  const [confirmState, setConfirmState] = useState<{ open: boolean; message: string; onConfirm: () => void }>({ open: false, message: '', onConfirm: () => { } })
  const { isOffline, hasUpdate, dismissUpdate } = useServiceWorker()
  const {
    images, setImages, setCurrentImageIndex, currentImageIndex,
    removeImage, clearAllImages, clearShapesForImage, isGridView, setIsGridView,
    shapes, setShapes, detectionSettings, boundingBox,
    undo, redo, canUndo, canRedo,
    lastSaveError, clearSaveError
  } = useApp()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  // Surface cache save errors
  useEffect(() => {
    if (lastSaveError) {
      toast(lastSaveError, 'error')
      clearSaveError()
    }
  }, [lastSaveError]) // eslint-disable-line react-hooks/exhaustive-deps

  // '?' key opens keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        setShowShortcuts(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Poll for OpenCV readiness with timeout
  useEffect(() => {
    if (opencvReady) return
    if (opencvFailed) return
    const start = Date.now()
    const interval = setInterval(() => {
      if (isOpenCVReady()) {
        setOpencvReady(true)
        setOpencvFailed(false)
        clearInterval(interval)
      } else if (Date.now() - start > 15000) {
        setOpencvFailed(true)
        clearInterval(interval)
        toast('OpenCV failed to load — auto-detection is unavailable. Check your internet connection and reload.', 'error')
      }
    }, 500)
    return () => clearInterval(interval)
  }, [opencvReady, opencvFailed]) // eslint-disable-line react-hooks/exhaustive-deps

  const retryOpenCV = () => {
    const existing = document.querySelector('script[src*="opencv.js"]')
    if (existing) existing.remove()
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://docs.opencv.org/4.x/opencv.js'
    script.type = 'text/javascript'
    document.head.appendChild(script)
    setOpencvFailed(false)
    setOpencvReady(false)
  }

  const loadImageFiles = useCallback((files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    Promise.all(
      imageFiles.map(file => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`Failed to load ${file.name}`))
        img.src = URL.createObjectURL(file)
      }))
    ).then(newImages => {
      setImages(prev => [...prev, ...newImages])
      toast(`Loaded ${newImages.length} image${newImages.length > 1 ? 's' : ''}`, 'success')
    }).catch(err => {
      toast(err.message || 'Failed to load one or more images', 'error')
    })
  }, [setImages, toast])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      loadImageFiles(Array.from(e.target.files))
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      loadImageFiles(Array.from(e.dataTransfer.files))
    }
  }

  const handlePlateTemplate = (size: WellPlateSize) => {
    const currentImage = images[currentImageIndex]
    if (!currentImage) return
    setShowPlateMenu(false)
    const template = getPlateTemplate(size)
    const imgW = currentImage.naturalWidth || currentImage.width
    const imgH = currentImage.naturalHeight || currentImage.height
    // Default: 80% of image, centered
    const w = imgW * 0.8
    const h = imgH * 0.8
    setPlateOverlay({
      template,
      x: (imgW - w) / 2,
      y: (imgH - h) / 2,
      width: w,
      height: h,
    })
  }

  const handleConfirmPlateOverlay = () => {
    if (!plateOverlay) return
    const currentImage = images[currentImageIndex]
    if (!currentImage) return
    const newShapes = generatePlateShapes(plateOverlay, currentImageIndex, currentImage, detectionSettings.restrictedArea)
    const scored = scoreShapeConfidence(newShapes, currentImage)
    setShapes(prev => [
      ...prev.filter(s => s.imageIndex !== currentImageIndex),
      ...scored
    ])
    setPlateOverlay(null)
    toast(`Generated ${scored.length} wells (${plateOverlay.template.size}-well plate)`, 'success')
  }

  const scoreShapeConfidence = (shapesToScore: typeof shapes, image: HTMLImageElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return shapesToScore
    ctx.drawImage(image, 0, 0)
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return shapesToScore.map(s => ({
      ...s,
      confidence: s.type === 'circle'
        ? computeCircleConfidence(imgData, s)
        : computeRectConfidence(imgData, s)
    }))
  }

  const handleAutoDetect = async () => {
    if (!isOpenCVReady()) {
      toast('OpenCV.js is still loading. Please wait a moment and try again.', 'error')
      return
    }

    const currentImage = images[currentImageIndex]
    if (!currentImage) return

    setIsDetecting(true)

    setTimeout(() => {
      try {
        const existingLabels = new Set(shapes.filter(s => s.imageIndex !== currentImageIndex).map(s => s.label))

        let newShapes
        if (detectionSettings.mode === 'circle') {
          newShapes = autoDetectCircles(currentImage, detectionSettings, currentImageIndex, existingLabels, boundingBox)
        } else {
          newShapes = autoDetectRectangles(currentImage, detectionSettings, currentImageIndex, existingLabels, boundingBox)
        }

        if (newShapes.length === 0) {
          toast('No shapes detected. Try adjusting the detection parameters.', 'info')
        } else {
          const scored = scoreShapeConfidence(newShapes, currentImage)
          setShapes(prev => [
            ...prev.filter(s => s.imageIndex !== currentImageIndex),
            ...scored
          ])
          toast(`Detected ${scored.length} shape${scored.length > 1 ? 's' : ''}`, 'success')
        }
      } catch (error) {
        console.error('Detection error:', error)
        toast(`Detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
      } finally {
        setIsDetecting(false)
      }
    }, 50)
  }

  const handleBatchDetect = async () => {
    if (!isOpenCVReady()) {
      toast('OpenCV.js is still loading.', 'error')
      return
    }
    if (images.length === 0) return

    setIsDetecting(true)
    const allNewShapes: typeof shapes = []
    const existingLabels = new Set<string>()

    for (let i = 0; i < images.length; i++) {
      toast(`Detecting ${i + 1}/${images.length}...`, 'info')
      // yield to UI
      await new Promise(r => setTimeout(r, 50))

      try {
        let detected
        if (detectionSettings.mode === 'circle') {
          detected = autoDetectCircles(images[i], detectionSettings, i, existingLabels, null)
        } else {
          detected = autoDetectRectangles(images[i], detectionSettings, i, existingLabels, null)
        }
        const scored = scoreShapeConfidence(detected, images[i])
        allNewShapes.push(...scored)
      } catch (error) {
        console.error(`Detection failed for image ${i + 1}:`, error)
      }
    }

    setShapes(allNewShapes)
    toast(`Batch complete: ${allNewShapes.length} shapes across ${images.length} images`, 'success')
    setIsDetecting(false)
  }

  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmState({ open: true, message, onConfirm })
  }

  const handlePrevImage = () => {
    if (currentImageIndex > 0) setCurrentImageIndex(currentImageIndex - 1)
  }

  const handleNextImage = () => {
    if (currentImageIndex < images.length - 1) setCurrentImageIndex(currentImageIndex + 1)
  }

  const currentShapeCount = shapes.filter(s => s.imageIndex === currentImageIndex).length

  // Slide-up panel drag handlers
  const handlePanelDragStart = (e: React.TouchEvent) => {
    panelDragStartY.current = e.touches[0].clientY
  }
  const handlePanelDragMove = (e: React.TouchEvent) => {
    e.preventDefault()
  }
  const handlePanelDragEnd = (e: React.TouchEvent) => {
    const delta = e.changedTouches[0].clientY - panelDragStartY.current
    if (delta < -50) setMobilePanelHeight('full')
    else if (delta > 50) {
      if (mobilePanelHeight === 'full') setMobilePanelHeight('half')
      else setMobilePanel('none')
    }
  }

  return (
    <div
      className="flex h-screen w-full flex-col bg-background text-foreground overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* PWA status banners */}
      <PWAStatus isOffline={isOffline} hasUpdate={hasUpdate} onDismissUpdate={dismissUpdate} />

      {/* Drag overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-[9998] bg-primary/10 border-4 border-dashed border-primary pointer-events-none flex items-center justify-center">
          <div className="bg-card px-6 py-4 rounded-xl shadow-2xl text-lg font-medium">
            Drop images here
          </div>
        </div>
      )}

      {/* ═══════════════════ HEADER ═══════════════════ */}
      <header className="flex h-11 items-center border-b border-border/40 bg-card shrink-0 z-50">
        {/* Left — Brand */}
        <div className="flex items-center gap-2.5 px-3 md:px-4 shrink-0">
          <img src="/favicon-removebg-preview.png" alt="ChemClub" className="h-5 w-5" />
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold tracking-tight text-foreground hidden sm:inline">ChemClub Analyst</span>
            <span className="text-[13px] font-semibold tracking-tight text-foreground sm:hidden">ChemClub</span>
            <span className="text-[9px] font-mono font-medium text-muted-foreground bg-muted/60 rounded px-1.5 py-[1px]">4.1</span>
          </div>
          {/* OpenCV chip */}
          <div className="hidden sm:flex items-center" title={opencvReady ? 'OpenCV ready' : opencvFailed ? 'Click to retry' : 'Loading...'}>
            {opencvReady ? (
              <span className="flex items-center gap-1 text-[10px] text-green-400"><CheckCircle2 className="h-3 w-3" /> CV</span>
            ) : opencvFailed ? (
              <button onClick={retryOpenCV} className="flex items-center gap-1 text-[10px] text-destructive hover:text-destructive/80"><RefreshCw className="h-3 w-3" /> retry</button>
            ) : (
              <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
            )}
          </div>
        </div>

        {/* Center — Tabs */}
        <nav className="flex items-end h-full flex-1 justify-center gap-1">
          {([['detect', 'Detection', ImageIcon], ['analyze', 'Regression', BarChart3]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              className={cn(
                "flex items-center gap-1.5 px-3 h-full text-[13px] font-medium transition-colors border-b-2 -mb-px",
                activeTab === key
                  ? "text-primary border-primary"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              )}
              onClick={() => setActiveTab(key as 'detect' | 'analyze')}
              data-tutorial={key === 'analyze' ? 'regression-tab' : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.slice(0, 6)}</span>
            </button>
          ))}
        </nav>

        {/* Right — Actions */}
        <div className="flex items-center gap-0.5 px-2 md:px-3 shrink-0">
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /><span className="hidden md:inline">Load</span>
          </Button>
          <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={handleFileChange} />
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1.5" onClick={() => cameraInputRef.current?.click()}>
            <Camera className="h-3.5 w-3.5" /><span className="hidden md:inline">Camera</span>
          </Button>
          <input type="file" ref={cameraInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleFileChange} />

          <div className="hidden md:block w-px h-4 bg-border/60 mx-1" />
          <Button variant="ghost" size="icon" className="hidden md:flex h-7 w-7" onClick={undo} disabled={!canUndo} title="Undo"><Undo2 className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="hidden md:flex h-7 w-7" onClick={redo} disabled={!canRedo} title="Redo"><Redo2 className="h-3.5 w-3.5" /></Button>
          <div className="hidden md:block w-px h-4 bg-border/60 mx-1" />
          <Button variant="ghost" size="icon" className="hidden md:flex h-7 w-7" onClick={() => setShowTutorial(true)} title="Tutorial"><HelpCircle className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="hidden md:flex h-7 w-7" onClick={() => setShowShortcuts(true)} title="Shortcuts"><Keyboard className="h-3.5 w-3.5" /></Button>
          <div className="hidden md:block w-px h-4 bg-border/60 mx-1" />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleColorScheme} title={colorScheme === 'midnight' ? 'Switch to Labline' : 'Switch to Midnight'}><SwatchBook className="h-3.5 w-3.5" /></Button>
          <Button variant={showSettings ? 'default' : 'ghost'} size="icon" className="hidden md:flex h-7 w-7" onClick={() => setShowSettings(!showSettings)}><Settings className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="md:hidden h-7 w-7" onClick={() => setMobilePanel(mobilePanel === 'none' ? 'settings' : 'none')}>
            {mobilePanel !== 'none' ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>

      {/* ═══════════════════ MAIN ═══════════════════ */}
      <main className="flex-1 flex overflow-hidden relative">
        {activeTab === 'detect' ? (
          <>
            {/* ── Left Sidebar ── */}
            <aside className="hidden md:flex w-[72px] bg-card border-r border-border/40 flex-col shrink-0">
              <div className="p-1.5 border-b border-border/40 flex flex-col gap-1">
                <Button size="sm" variant="outline" className="w-full h-8" onClick={() => fileInputRef.current?.click()} data-tutorial="load-images" title="Add images"><Plus className="h-4 w-4" /></Button>
                <Button size="sm" variant={isGridView ? 'default' : 'ghost'} className="w-full h-8" onClick={() => setIsGridView(!isGridView)} title="Grid view"><Grid className="h-4 w-4" /></Button>
                {images.length > 0 && (
                  <Button size="sm" variant="ghost" className="w-full h-8 text-destructive hover:bg-destructive/10" onClick={() => showConfirm(`Clear all ${images.length} image${images.length > 1 ? 's' : ''}?`, clearAllImages)} title="Clear all"><Trash2 className="h-3.5 w-3.5" /></Button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-1.5 space-y-1.5">
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "relative group cursor-pointer rounded-md overflow-hidden transition-all",
                      currentImageIndex === idx
                        ? "ring-[1.5px] ring-primary shadow-md shadow-primary/15"
                        : "ring-1 ring-border/30 opacity-70 hover:opacity-100 hover:ring-border"
                    )}
                    onClick={() => { setCurrentImageIndex(idx); setIsGridView(false) }}
                  >
                    <img src={img.src} className="w-full aspect-square object-cover" alt={`Image ${idx + 1}`} />
                    <button
                      className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 hover:bg-destructive rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); showConfirm(`Delete image ${idx + 1}?`, () => removeImage(idx)) }}
                    ><X className="h-2.5 w-2.5" /></button>
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] font-mono text-center py-px text-muted-foreground">{idx + 1}</div>
                  </div>
                ))}
              </div>
            </aside>

            {/* ── Canvas Area ── */}
            <div className="flex-1 min-w-0 flex flex-col relative bg-background overflow-hidden">
              {/* Floating toolbar */}
              {!isGridView && (
                <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-0.5 bg-card/95 backdrop-blur-lg border border-border/40 px-1 py-0.5 rounded-lg shadow-xl">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handlePrevImage} disabled={currentImageIndex === 0}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                  <span className="text-[10px] font-mono w-10 text-center text-muted-foreground">{images.length > 0 ? `${currentImageIndex + 1}/${images.length}` : '—'}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleNextImage} disabled={currentImageIndex >= images.length - 1}><ChevronRight className="h-3.5 w-3.5" /></Button>
                  <div className="w-px h-3.5 bg-border/40 mx-0.5" />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleAutoDetect} disabled={images.length === 0 || isDetecting} data-tutorial="autodetect" title="Auto-detect">{isDetecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}</Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleBatchDetect} disabled={images.length === 0 || isDetecting} title="Detect all"><PlayCircle className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => clearShapesForImage(currentImageIndex)} disabled={images.length === 0} title="Clear"><Trash2 className="h-3.5 w-3.5" /></Button>
                  <div className="relative">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowPlateMenu(!showPlateMenu)} disabled={images.length === 0} title="Well plate template"><LayoutGrid className="h-3.5 w-3.5" /></Button>
                    {showPlateMenu && (
                      <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowPlateMenu(false)} />
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-card border rounded-lg shadow-xl z-20 py-1 min-w-[100px]">
                        {([6, 12, 24, 48, 96] as WellPlateSize[]).map(size => (
                          <button key={size} className="w-full px-3 py-1.5 text-xs text-left hover:bg-muted/50 flex justify-between items-center" onClick={() => handlePlateTemplate(size)}>
                            <span className="font-medium">{size}-well</span>
                            <span className="text-muted-foreground text-[10px]">{PLATE_CONFIGS[size].rows}x{PLATE_CONFIGS[size].cols}</span>
                          </button>
                        ))}
                      </div>
                      </>
                    )}
                  </div>
                  <div className="flex md:hidden items-center gap-0.5">
                    <div className="w-px h-3.5 bg-border/40 mx-0.5" />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={undo} disabled={!canUndo}><Undo2 className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={redo} disabled={!canRedo}><Redo2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              )}

              {/* Mobile bottom tab bar */}
              <div className="md:hidden absolute bottom-0 left-0 right-0 z-10 flex bg-card border-t border-border/40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                {([['images', Grid, `Images (${images.length})`], ['info', Palette, `Data (${currentShapeCount})`], ['settings', Settings, 'Settings']] as const).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    className={cn("flex-1 min-h-[44px] py-2 text-[10px] font-medium flex flex-col items-center gap-0.5 transition-colors", mobilePanel === key ? "text-primary" : "text-muted-foreground")}
                    onClick={() => setMobilePanel(mobilePanel === key ? 'none' : key as typeof mobilePanel)}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              {/* Content */}
              {images.length > 0 ? (
                isGridView ? (
                  <div className="h-full w-full overflow-y-auto scrollbar-thin p-4 md:p-6">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {images.map((img, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "group relative aspect-square rounded-lg overflow-hidden cursor-pointer transition-all border",
                            currentImageIndex === idx ? "border-primary ring-1 ring-primary/30" : "border-border/40 hover:border-border"
                          )}
                          onClick={() => { setCurrentImageIndex(idx); setIsGridView(false) }}
                        >
                          <img src={img.src} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                          <span className="absolute bottom-1.5 left-2 text-white text-[11px] font-mono opacity-0 group-hover:opacity-100 transition-opacity">{idx + 1}</span>
                          <button className="absolute top-1.5 right-1.5 p-1 bg-black/50 hover:bg-destructive text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); showConfirm(`Delete image ${idx + 1}?`, () => removeImage(idx)) }}><Trash2 className="h-3 w-3" /></button>
                          {currentImageIndex === idx && <span className="absolute top-1.5 left-1.5 bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded font-mono">SEL</span>}
                        </div>
                      ))}
                      <div className="aspect-square border border-dashed border-border rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/60 hover:bg-muted/20 transition-colors" onClick={() => fileInputRef.current?.click()}>
                        <Plus className="h-5 w-5 text-muted-foreground mb-1.5" />
                        <span className="text-[11px] text-muted-foreground">Add</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ErrorBoundary fallbackTitle="Image viewer crashed"><ImageViewer plateOverlay={plateOverlay} setPlateOverlay={setPlateOverlay} onConfirmPlate={handleConfirmPlateOverlay} /></ErrorBoundary>
                )
              ) : (
                /* ── Empty state ── */
                <div className="h-full w-full flex items-center justify-center pb-16 md:pb-0">
                  <div className="text-center space-y-5 px-6 max-w-sm">
                    <div className="mx-auto w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center">
                      <ImageIcon className="h-7 w-7 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold mb-1">Load well plate images</h2>
                      <p className="text-[13px] text-muted-foreground leading-relaxed">Drag & drop images, or use the buttons below to get started with colorimetric analysis.</p>
                    </div>
                    <ol className="text-left space-y-2 text-[13px] text-muted-foreground">
                      {['Load well plate images', 'Auto-detect or draw sample regions', 'Enter concentrations & run regression'].map((step, i) => (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold font-mono mt-px">{i + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="flex gap-2 justify-center flex-wrap pt-1">
                      <Button size="sm" onClick={() => fileInputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" />Load Images</Button>
                      <Button size="sm" variant="outline" onClick={() => cameraInputRef.current?.click()}><Camera className="mr-1.5 h-3.5 w-3.5" />Camera</Button>
                      <Button size="sm" variant="outline" onClick={() => setShowTutorial(true)}><HelpCircle className="mr-1.5 h-3.5 w-3.5" />Tutorial</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Right Panel ── */}
            <aside className="hidden md:flex w-60 bg-card border-l border-border/40 flex-col shrink-0">
              <div className="flex border-b border-border/40">
                {([['shapes', ListTree, 'Shapes'], ['colors', Palette, 'Colors']] as const).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] font-medium transition-colors border-b-2 -mb-px",
                      rightPanel === key ? "text-foreground border-primary" : "text-muted-foreground hover:text-foreground border-transparent"
                    )}
                    onClick={() => setRightPanel(key as typeof rightPanel)}
                  >
                    <Icon className="h-3.5 w-3.5" />{label}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin">{rightPanel === 'shapes' ? <ShapesList /> : <ColorAnalysisPanel />}</div>
            </aside>

            {/* Desktop Settings */}
            {showSettings && <div className="hidden md:flex shrink-0"><SettingsPanel /></div>}

            {/* ── Mobile Slide-up Panels ── */}
            {mobilePanel !== 'none' && (
              <div className={cn(
                "md:hidden absolute inset-x-0 z-20 bg-card border-t border-border/40 rounded-t-2xl shadow-2xl overflow-hidden flex flex-col animate-in slide-in-from-bottom duration-200",
                mobilePanelHeight === 'full' ? "top-11 bottom-0" : "bottom-14 max-h-[60vh]"
              )} style={mobilePanelHeight === 'half' ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}>
                <div className="flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none" onTouchStart={handlePanelDragStart} onTouchMove={handlePanelDragMove} onTouchEnd={handlePanelDragEnd}>
                  <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
                </div>
                <div className="flex items-center justify-between px-4 pb-2">
                  <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                    {mobilePanel === 'images' && 'Images'}{mobilePanel === 'info' && 'Data'}{mobilePanel === 'settings' && 'Settings'}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMobilePanelHeight(mobilePanelHeight === 'full' ? 'half' : 'full')}>{mobilePanelHeight === 'full' ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setMobilePanel('none'); setMobilePanelHeight('half') }}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto scrollbar-thin border-t border-border/40">
                  {mobilePanel === 'images' && (
                    <div className="p-3 space-y-3">
                      <div className="flex gap-2">
                        <Button className="flex-1" size="sm" variant="outline" onClick={() => { fileInputRef.current?.click(); setMobilePanel('none') }}><Plus className="h-3.5 w-3.5 mr-1.5" /> Add</Button>
                        {images.length > 0 && (
                          <Button size="sm" variant="outline" className="text-destructive border-destructive/30" onClick={() => showConfirm(`Clear all?`, () => { clearAllImages(); setMobilePanel('none') })}><Trash2 className="h-3.5 w-3.5 mr-1.5" /> Clear</Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {images.map((img, idx) => (
                          <div key={idx} className={cn("relative cursor-pointer rounded-md overflow-hidden border", currentImageIndex === idx ? "border-primary" : "border-border/30")}>
                            <img src={img.src} className="w-full aspect-square object-cover" alt={`${idx + 1}`} onClick={() => { setCurrentImageIndex(idx); setMobilePanel('none') }} />
                            <button className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 hover:bg-destructive rounded-full flex items-center justify-center" onClick={(e) => { e.stopPropagation(); showConfirm(`Delete image ${idx + 1}?`, () => removeImage(idx)) }}><X className="h-2.5 w-2.5" /></button>
                            <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] font-mono text-center py-px">{idx + 1}</div>
                          </div>
                        ))}
                      </div>
                      {images.length === 0 && <p className="text-center py-6 text-sm text-muted-foreground">No images loaded</p>}
                    </div>
                  )}
                  {mobilePanel === 'info' && (
                    <div>
                      <div className="flex border-b border-border/40">
                        {([['shapes', 'Shapes'], ['colors', 'Colors']] as const).map(([key, label]) => (
                          <button key={key} className={cn("flex-1 py-2.5 text-xs font-medium min-h-[44px] border-b-2 -mb-px", rightPanel === key ? "text-foreground border-primary" : "text-muted-foreground border-transparent")} onClick={() => setRightPanel(key as typeof rightPanel)}>{label}</button>
                        ))}
                      </div>
                      {rightPanel === 'shapes' ? <ShapesList /> : <ColorAnalysisPanel />}
                    </div>
                  )}
                  {mobilePanel === 'settings' && (
                    <div>
                      <div className="flex gap-2 p-3 border-b border-border/40">
                        <Button size="sm" variant="outline" className="flex-1 min-h-[44px]" onClick={() => { setShowTutorial(true); setMobilePanel('none') }}><HelpCircle className="h-3.5 w-3.5 mr-1.5" /> Tutorial</Button>
                        <Button size="sm" variant="outline" className="flex-1 min-h-[44px]" onClick={() => { setShowShortcuts(true); setMobilePanel('none') }}><Keyboard className="h-3.5 w-3.5 mr-1.5" /> Shortcuts</Button>
                      </div>
                      <SettingsPanel />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <ErrorBoundary fallbackTitle="Regression studio crashed">
            <Suspense fallback={<div className="h-full w-full flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <RegressionStudio />
            </Suspense>
          </ErrorBoundary>
        )}
      </main>

      {/* Footer — desktop only */}
      <footer className="hidden md:flex h-5 items-center justify-center border-t border-border/30 text-[10px] font-mono text-muted-foreground/50 shrink-0">
        Created by: Hassaan Vani, Grady Chen, and Jerry Ma
      </footer>

      {/* Tutorial Overlay */}
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}

      {/* Keyboard Shortcuts */}
      <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmState.open}
        message={confirmState.message}
        destructive
        onConfirm={() => {
          confirmState.onConfirm()
          setConfirmState(s => ({ ...s, open: false }))
        }}
        onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
      />
    </div>
  )
}

export default App
