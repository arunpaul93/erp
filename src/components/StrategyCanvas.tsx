"use client"

import React, { useEffect, useMemo, useRef, useState } from 'react'

type Entity = {
    id: string
    name: string
    color: string
    values: number[] // value per feature index
    visible?: boolean
}

const colors = [
    '#fbbf24', // amber-400
    '#60a5fa', // blue-400
    '#34d399', // emerald-400
    '#f472b6', // pink-400
    '#c084fc', // violet-400
    '#f87171', // red-400
    '#22d3ee', // cyan-400
]

function uid() {
    return Math.random().toString(36).slice(2, 9)
}

export type CanvasEntity = Entity
export type CanvasData = {
    features: string[]
    minY: number
    maxY: number
    entities: Entity[]
    height?: number
    yStep?: number
}

export default function StrategyCanvas({ value, onChange, fullScreen, selfName }: { value?: CanvasData | null, onChange?: (data: CanvasData) => void, fullScreen?: boolean, selfName?: string }) {
    const [features, setFeatures] = useState<string[]>(['Price', 'Location', 'Returning Customers'])
    const [minY, setMinY] = useState<number>(0)
    const [maxY, setMaxY] = useState<number>(10)
    const [yStep, setYStep] = useState<number | null>(null)
    const [newFeature, setNewFeature] = useState('')
    const [newCompetitor, setNewCompetitor] = useState('')
    const [entities, setEntities] = useState<Entity[]>([{
        id: uid(),
        name: selfName || 'Us',
        color: colors[0],
        values: [],
        visible: true,
    }])

    const svgRef = useRef<SVGSVGElement | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [svgWidth, setSvgWidth] = useState<number>(900)
    const [canvasHeight, setCanvasHeight] = useState<number>(720)
    const [drag, setDrag] = useState<{ entityId: string; index: number } | null>(null)
    const loadedFromValueRef = useRef(false)
    const suppressOnChangeRef = useRef(false)
    const lastSentRef = useRef<string>('')

    // Ensure all entities have values for each feature
    useEffect(() => {
        let anyChanged = false
        const nextEntities = (prev: Entity[]) => prev.map((e) => {
            const next = [...e.values]
            if (next.length < features.length) {
                const pad = features.length - next.length
                next.push(...Array(pad).fill((minY + maxY) / 2))
                anyChanged = true
            } else if (next.length > features.length) {
                next.length = features.length
                anyChanged = true
            }
            if (!anyChanged) return e
            return { ...e, values: next }
        })
        if (features.length === 0) return
        suppressOnChangeRef.current = true
        setEntities(prev => {
            anyChanged = false
            const next = nextEntities(prev)
            return anyChanged ? next : prev
        })
        // After values arrays resized, release suppression then force a re-run of onChange if something changed.
        setTimeout(() => {
            suppressOnChangeRef.current = false
            // Always nudge so parent persists features even if arrays already matched (adding first feature when none existed)
            setEntities(prev => [...prev])
        }, 0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [features.length])

    // propagate changes up
    useEffect(() => {
        if (!onChange) return
        if (suppressOnChangeRef.current) return
        const serialized = JSON.stringify({ f: features, minY, maxY, e: entities, h: canvasHeight, ys: yStep })
        if (lastSentRef.current === serialized) return
        lastSentRef.current = serialized
        onChange({ features, minY, maxY, entities, height: canvasHeight, yStep: yStep ?? undefined })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [features, minY, maxY, entities, canvasHeight, yStep])

    // accept external value (e.g., when loading existing plan)
    useEffect(() => {
        if (!value) return
        if (drag) return // avoid flicker while dragging
        const incoming = JSON.stringify({ f: value.features || [], minY: value.minY, maxY: value.maxY, e: value.entities || [], h: (value as any).height, ys: (value as any).yStep })
        const current = JSON.stringify({ f: features, minY, maxY, e: entities, h: canvasHeight, ys: yStep })
        if (incoming === current) return
        suppressOnChangeRef.current = true
        setFeatures(Array.isArray(value.features) ? value.features : [])
        setMinY(typeof value.minY === 'number' ? value.minY : 0)
        setMaxY(typeof value.maxY === 'number' ? value.maxY : 10)
        if (Array.isArray(value.entities) && value.entities.length > 0) setEntities(value.entities as Entity[])
        if (typeof (value as any).height === 'number' && (value as any).height > 0) setCanvasHeight(Math.min((value as any).height, 1080))
        if (typeof (value as any).yStep === 'number' && (value as any).yStep > 0) setYStep((value as any).yStep)
        loadedFromValueRef.current = true
        // clear suppress flag next tick
        setTimeout(() => { suppressOnChangeRef.current = false }, 0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, drag])

    // If a selfName is provided and we haven't loaded from an external value, name the first entity accordingly
    useEffect(() => {
        if (!selfName) return
        if (loadedFromValueRef.current) return
        setEntities(prev => prev.map((e, i) => i === 0 ? { ...e, name: selfName } : e))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selfName])

    // Drag handlers
    useEffect(() => {
        function onMove(ev: MouseEvent) {
            if (!drag || !svgRef.current) return
            const { entityId, index } = drag
            const svg = svgRef.current
            const rect = svg.getBoundingClientRect()
            const x = ev.clientX - rect.left
            const y = ev.clientY - rect.top
            const { chart } = layout
            // map y to value
            const clampedY = Math.max(chart.y, Math.min(chart.y + chart.h, y))
            const t = 1 - (clampedY - chart.y) / chart.h
            const value = minY + t * (maxY - minY)
            // throttle updates with rAF and update only if the value actually changed
            if (!(window as any).__sc_raf) {
                ; (window as any).__sc_raf = requestAnimationFrame(() => {
                    ; (window as any).__sc_raf = null
                    setEntities(prev => {
                        let changed = false
                        const next = prev.map(e => {
                            if (e.id !== entityId) return e
                            const newVals = e.values.map((v, i) => {
                                if (i !== index) return v
                                const nv = Number(value.toFixed(2))
                                if (nv !== v) changed = true
                                return nv
                            })
                            if (!changed) return e
                            return { ...e, values: newVals }
                        })
                        return changed ? next : prev
                    })
                })
            }
        }
        function onUp() { setDrag(null) }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drag, minY, maxY])

    // Layout (responsive width, taller height)
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        let rafId: number | null = null
        const compute = () => (fullScreen ? window.innerWidth : el.clientWidth)
        const apply = () => {
            const w = compute()
            if (w !== svgWidth) setSvgWidth(w)
        }
        const schedule = () => {
            if (rafId != null) return
            rafId = requestAnimationFrame(() => { rafId = null; apply() })
        }
        // initial
        schedule()
        const RZ = (window as any).ResizeObserver
        let ro: any = null
        if (RZ && !fullScreen) {
            ro = new RZ(() => schedule())
            ro.observe(el)
        }
        const onWin = () => schedule()
        window.addEventListener('resize', onWin)
        return () => {
            if (ro) ro.disconnect()
            window.removeEventListener('resize', onWin)
            if (rafId != null) cancelAnimationFrame(rafId)
        }
    }, [fullScreen, svgWidth])

    const width = svgWidth
    const height = canvasHeight
    const margin = { top: 24, right: fullScreen ? 64 : 24, bottom: 64, left: 48 }
    const chart = { x: margin.left, y: margin.top, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom }

    const layout = { width, height, margin, chart }

    const xForIndex = (i: number) => {
        if (features.length === 1) return chart.x + chart.w / 2
        return chart.x + (i / (features.length - 1)) * chart.w
    }
    const yForValue = (v: number) => {
        const t = (v - minY) / (maxY - minY || 1)
        return chart.y + (1 - t) * chart.h
    }

    const gridTicks = useMemo(() => {
        const ticks: number[] = []
        if (yStep && yStep > 0) {
            // start from the first multiple of yStep >= minY
            const start = Math.ceil(minY / yStep) * yStep
            for (let v = start; v <= maxY + 1e-9; v += yStep) ticks.push(Number(v.toFixed(2)))
            // ensure min and max lines are included
            if (!ticks.includes(minY)) ticks.unshift(Number(minY.toFixed(2)))
            if (!ticks.includes(maxY)) ticks.push(Number(maxY.toFixed(2)))
        } else {
            const steps = 5
            const step = (maxY - minY) / steps
            for (let i = 0; i <= steps; i++) ticks.push(Number((minY + i * step).toFixed(2)))
        }
        return ticks
    }, [minY, maxY, yStep])

    return (
        <div ref={containerRef} className={`rounded-xl border border-gray-800 bg-gray-900 p-4 overflow-hidden ${fullScreen ? 'relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-[100dvw]' : 'w-full'}`}>
            <div className="flex flex-wrap gap-4 mb-4">
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-300">Height</label>
                    <select className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1"
                        value={canvasHeight}
                        onChange={(e) => setCanvasHeight(Number(e.target.value))}>
                        <option value={360}>360 px</option>
                        <option value={480}>480 px</option>
                        <option value={600}>600 px</option>
                        <option value={720}>720 px</option>
                        <option value={840}>840 px</option>
                        <option value={900}>900 px</option>
                        <option value={1080}>1080 px</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-300">Y min</label>
                    <input type="number" className="w-24 bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1" value={minY}
                        onChange={(e) => setMinY(Number(e.target.value))} />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-300">Y max</label>
                    <input type="number" className="w-24 bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1" value={maxY}
                        onChange={(e) => setMaxY(Number(e.target.value))} />
                </div>
                <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-300">Y step</label>
                    <input type="number" min={0} step={0.1} placeholder="auto" className="w-24 bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-2 py-1" value={yStep ?? ''}
                        onChange={(e) => {
                            const v = e.target.value
                            if (v === '') return setYStep(null)
                            const n = Number(v)
                            setYStep(Number.isFinite(n) && n > 0 ? n : null)
                        }} />
                </div>
                <div className="flex items-center gap-2">
                    <input value={newFeature} onChange={e => setNewFeature(e.target.value)} placeholder="Add feature"
                        className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                    <button type="button" className="text-yellow-400" onClick={() => {
                        const f = newFeature.trim()
                        if (!f) return
                        setFeatures(prev => [...prev, f])
                        setEntities(prev => prev.map((e, i) => ({ ...e, values: [...e.values, (minY + maxY) / 2] })))
                        setNewFeature('')
                    }}>+ Feature</button>
                </div>
                <div className="flex items-center gap-2">
                    <input value={newCompetitor} onChange={e => setNewCompetitor(e.target.value)} placeholder="Add competitor"
                        className="bg-gray-800 text-gray-100 border border-gray-700 rounded-md px-3 py-2" />
                    <button type="button" className="text-yellow-400" onClick={() => {
                        const name = newCompetitor.trim()
                        if (!name) return
                        const idx = entities.length % colors.length
                        setEntities(prev => [...prev, { id: uid(), name, color: colors[idx], values: Array(features.length).fill((minY + maxY) / 2), visible: true }])
                        setNewCompetitor('')
                    }}>+ Competitor</button>
                </div>
            </div>

            {/* Feature list with edit/delete */}
            {features.length > 0 && (
                <div className="mb-3">
                    <div className="text-xs text-gray-400 mb-1">Features</div>
                    <div className="flex flex-wrap gap-2">
                        {features.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded px-2 py-1">
                                <input className="bg-transparent text-gray-100 outline-none" value={f} onChange={(e) => {
                                    const v = e.target.value
                                    setFeatures(prev => prev.map((pf, pi) => pi === i ? v : pf))
                                }} />
                                <button type="button" className="text-red-400 text-xs" onClick={() => {
                                    setFeatures(prev => prev.filter((_, pi) => pi !== i))
                                    setEntities(prev => prev.map(e => ({ ...e, values: e.values.filter((_, vi) => vi !== i) })))
                                }}>Delete</button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Entity list with edit/delete/toggle */}
            {entities.length > 0 && (
                <div className="mb-3">
                    <div className="text-xs text-gray-400 mb-1">Entities</div>
                    <div className="flex flex-wrap gap-3">
                        {entities.map((e, idx) => (
                            <div key={e.id} className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded px-2 py-1">
                                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: e.color }} />
                                <input className="bg-transparent text-gray-100 outline-none" value={e.name} onChange={(ev) => {
                                    const v = ev.target.value
                                    setEntities(prev => prev.map(pe => pe.id === e.id ? { ...pe, name: v } : pe))
                                }} />
                                <label className="flex items-center gap-1 text-xs text-gray-300">
                                    <input type="checkbox" className="accent-yellow-400" checked={e.visible !== false} onChange={(ev) => {
                                        const vis = ev.target.checked
                                        setEntities(prev => prev.map(pe => pe.id === e.id ? { ...pe, visible: vis } : pe))
                                    }} />
                                    Show
                                </label>
                                {entities.length > 1 && (
                                    <button type="button" className="text-red-400 text-xs" onClick={() => {
                                        if (entities.length <= 1) return
                                        setEntities(prev => prev.filter(pe => pe.id !== e.id))
                                    }}>Delete</button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="overflow-x-hidden">
                <svg ref={svgRef} width={width} height={height} className="bg-gray-950 rounded-md w-full block">
                    {features.length === 0 && (
                        <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle" fill="#9ca3af" fontSize={14}>
                            Add features to start plotting the canvas
                        </text>
                    )}
                    {/* Y grid */}
                    {gridTicks.map((t, i) => (
                        <g key={i}>
                            <line x1={chart.x} x2={chart.x + chart.w} y1={yForValue(t)} y2={yForValue(t)} stroke="#1f2937" />
                            <text x={chart.x - 8} y={yForValue(t)} fill="#9ca3af" fontSize={10} textAnchor="end" dominantBaseline="middle">{t}</text>
                        </g>
                    ))}

                    {/* X categories */}
                    {features.map((f, i) => {
                        const anchor = i === 0 ? 'start' : (i === features.length - 1 ? 'end' : 'middle')
                        return (
                            <g key={i}>
                                <line x1={xForIndex(i)} x2={xForIndex(i)} y1={chart.y} y2={chart.y + chart.h} stroke="#111827" />
                                <text x={xForIndex(i)} y={chart.y + chart.h + 16} fill="#e5e7eb" fontSize={13} textAnchor={anchor}>{f}</text>
                            </g>
                        )
                    })}

                    {/* Lines and points per entity (visible only) */}
                    {entities.filter(e => e.visible !== false).map((e, ei) => {
                        const pts = e.values.map((v, i) => `${xForIndex(i)},${yForValue(v)}`).join(' ')
                        return (
                            <g key={e.id}>
                                <polyline points={pts} fill="none" stroke={e.color} strokeWidth={2} />
                                {e.values.map((v, i) => (
                                    <circle key={i} cx={xForIndex(i)} cy={yForValue(v)} r={6} fill={e.color}
                                        onMouseDown={() => setDrag({ entityId: e.id, index: i })} style={{ cursor: 'grab' }} />
                                ))}
                            </g>
                        )
                    })}
                </svg>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-3">
                {entities.map(e => (
                    <div key={e.id} className="flex items-center gap-2 text-sm text-gray-200">
                        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: e.color }} />
                        <span>{e.name}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
