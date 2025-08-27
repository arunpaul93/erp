"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"

export type WfNode = { id: string; x: number; y: number; label: string }
export type WfEdge = { id: string; from: string; to: string }
export type WorkflowGraph = { nodes: WfNode[]; edges: WfEdge[] }

function uid() { return Math.random().toString(36).slice(2, 9) }

export default function WorkflowEditor({ value, onChange, height = 480 }: { value?: WorkflowGraph | null, onChange?: (g: WorkflowGraph) => void, height?: number }) {
    const [open, setOpen] = useState(false)
    const [nodes, setNodes] = useState<WfNode[]>([])
    const [edges, setEdges] = useState<WfEdge[]>([])
    // selection
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
    // viewport (pan/zoom)
    const [scale, setScale] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const isPanningRef = useRef(false)
    const lastPanPtRef = useRef<{ x: number; y: number } | null>(null)
    const spaceDownRef = useRef(false)
    // canvas/container and interaction refs
    const containerRef = useRef<HTMLDivElement | null>(null)
    const draggingRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
    // live connect preview uses state to trigger re-render during drag
    const [connect, setConnect] = useState<{ fromId: string; x: number; y: number } | null>(null)
    const connectRef = useRef<typeof connect>(null)
    const longPressTimerRef = useRef<number | null>(null)
    const nodesRef = useRef<WfNode[]>([])
    const edgesRef = useRef<WfEdge[]>([])
    const graphStrRef = useRef<string>("")
    // visual constants (keep in sync when checking hitboxes)
    const NODE_W = 160
    const NODE_H = 64
    const ARROW_W = 12
    const ARROW_H = 8
    const ARROW_MARGIN = 4
    const CLEAR = 12
    const LANE_STEP = 8
    const EDGE_CLEAR = 6
    const MAX_LANE_TRIES = 12
    const CORNER_R = 14

    type Rect = { x: number; y: number; w: number; h: number; id: string }
    const intersectsH = (y: number, x1: number, x2: number, r: Rect) => {
        const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1]
        return (
            y > r.y - CLEAR && y < r.y + r.h + CLEAR &&
            b > r.x - CLEAR && a < r.x + r.w + CLEAR
        )
    }
    const intersectsV = (x: number, y1: number, y2: number, r: Rect) => {
        const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1]
        return (
            x > r.x - CLEAR && x < r.x + r.w + CLEAR &&
            b > r.y - CLEAR && a < r.y + r.h + CLEAR
        )
    }

    const laneKeyY = (y: number) => Math.round(y / LANE_STEP) * LANE_STEP
    const laneKeyX = (x: number) => Math.round(x / LANE_STEP) * LANE_STEP
    const segRectH = (y: number, x1: number, x2: number): Rect => ({ x: Math.min(x1, x2), y: y - EDGE_CLEAR / 2, w: Math.abs(x2 - x1), h: EDGE_CLEAR, id: `eh-${Math.random()}` })
    const segRectV = (x: number, y1: number, y2: number): Rect => ({ x: x - EDGE_CLEAR / 2, y: Math.min(y1, y2), w: EDGE_CLEAR, h: Math.abs(y2 - y1), id: `ev-${Math.random()}` })

    // normalization for change detection and loop protection
    const lastFromPropsRef = useRef<string | null>(null)
    const lastEmittedRef = useRef<string | null>(null)
    const norm = (g: WorkflowGraph) => JSON.stringify({
        nodes: [...(g.nodes || [])]
            .map(n => ({ id: n.id, x: Math.round(n.x), y: Math.round(n.y), label: n.label }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        edges: [...(g.edges || [])]
            .map(e => ({ id: e.id, from: e.from, to: e.to }))
            .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)))
    })

    // hydrate from external value when it actually changes
    useEffect(() => {
        if (!value) return
        const incoming: WorkflowGraph = {
            nodes: Array.isArray(value.nodes) ? value.nodes : [],
            edges: Array.isArray(value.edges) ? value.edges : []
        }
        const incStr = norm(incoming)
        lastFromPropsRef.current = incStr
        if (graphStrRef.current !== incStr) {
            setNodes(incoming.nodes)
            setEdges(incoming.edges)
        }
    }, [value])

    // keep live mirrors
    useEffect(() => { nodesRef.current = nodes }, [nodes])
    useEffect(() => { edgesRef.current = edges }, [edges])
    useEffect(() => { graphStrRef.current = norm({ nodes: nodesRef.current, edges: edgesRef.current }) }, [nodes, edges])

    // propagate to parent, deduping echoes
    useEffect(() => {
        const out: WorkflowGraph = { nodes, edges }
        const outStr = norm(out)
        graphStrRef.current = outStr
        if (lastFromPropsRef.current === outStr) return
        if (lastEmittedRef.current === outStr) return
        lastEmittedRef.current = outStr
        onChange?.(out)
    }, [nodes, edges, onChange])

    // graph helpers
    const addNode = () => {
        const id = uid()
        const x = 80 + (nodes.length % 6) * 180
        const y = 80 + Math.floor(nodes.length / 6) * 120
        setNodes(prev => [...prev, { id, x, y, label: `Step ${prev.length + 1}` }])
    }
    const removeNode = (id: string) => {
        setNodes(prev => prev.filter(n => n.id !== id))
        setEdges(prev => prev.filter(e => e.from !== id && e.to !== id))
    }
    const addEdge = (from: string, to: string) => {
        if (!from || !to || from === to) return
        setEdges(prev => {
            if (prev.some(e => e.from === from && e.to === to)) return prev
            return [...prev, { id: uid(), from, to }]
        })
    }
    type RouteResult = { d: string; usedYs: number[]; usedXs: number[]; edgeRects: Rect[] }
    const route = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        fromId: string,
        toId: string | undefined,
        obstacles: Rect[],
        usedYs: Set<number>,
        usedXs: Set<number>
    ): RouteResult => {
        const rects: Rect[] = obstacles
        const endX = bx
        const toRight = endX >= ax

        // utility
        const blockedH = (y: number, x1: number, x2: number, ignore?: Set<string>) => rects.some(r => (ignore?.has(r.id) ? false : intersectsH(y, x1, x2, r)))
        const blockedV = (x: number, y1: number, y2: number, ignore?: Set<string>) => rects.some(r => (ignore?.has(r.id) ? false : intersectsV(x, y1, y2, r)))
        const reserve = (ys: number[], xs: number[]) => { ys.forEach(y => usedYs.add(laneKeyY(y))); xs.forEach(x => usedXs.add(laneKeyX(x))) }
        const build = (segments: Array<{ kind: 'H' | 'V'; a: number; b: number; c: number }>) => {
            const parts: string[] = []
            let lastX = ax, lastY = ay
            const edgeRects: Rect[] = []
            for (const s of segments) {
                if (s.kind === 'H') {
                    const y = s.c, x1 = s.a, x2 = s.b
                    parts.push(`L ${x1},${y}`, `L ${x2},${y}`)
                    edgeRects.push(segRectH(y, x1, x2))
                    lastX = x2; lastY = y
                } else {
                    const x = s.c, y1 = s.a, y2 = s.b
                    parts.push(`L ${x},${y1}`, `L ${x},${y2}`)
                    edgeRects.push(segRectV(x, y1, y2))
                    lastX = x; lastY = y2
                }
            }
            const d = `M ${ax},${ay} ${parts.join(' ')} L ${endX},${by}`
            return { d, edgeRects }
        }

        // Leftward policy: always go under
        if (!toRight) {
            const src = nodesRef.current.find(n => n.id === fromId)
            const tgt = nodesRef.current.find(n => n.id === toId)
            const srcBottom = (src?.y ?? ay) + NODE_H
            const tgtBottom = (tgt?.y ?? by) + NODE_H
            let yUnder = Math.max(srcBottom, tgtBottom) + CLEAR
            let tries = 0
            // find free horizontal lane only moving downward
            while ((blockedH(yUnder, Math.min(ax, bx), Math.max(ax, bx)) || usedYs.has(laneKeyY(yUnder))) && tries++ < MAX_LANE_TRIES) {
                yUnder += LANE_STEP
            }
            // pick channels
            let v1x = ax - CLEAR
            let v2x = bx + CLEAR
            tries = 0
            while ((blockedV(v1x, Math.min(ay, yUnder), Math.max(ay, yUnder), new Set([fromId])) || usedXs.has(laneKeyX(v1x))) && tries++ < MAX_LANE_TRIES) v1x -= LANE_STEP
            tries = 0
            while ((blockedV(v2x, Math.min(by, yUnder), Math.max(by, yUnder), toId ? new Set([toId]) : undefined) || usedXs.has(laneKeyX(v2x))) && tries++ < MAX_LANE_TRIES) v2x += LANE_STEP

            const segs: Array<{ kind: 'H' | 'V'; a: number; b: number; c: number }> = []
            segs.push({ kind: 'V', a: ay, b: yUnder, c: v1x })
            segs.push({ kind: 'H', a: v1x, b: v2x, c: yUnder })
            segs.push({ kind: 'V', a: yUnder, b: by, c: v2x })
            const { d, edgeRects } = build(segs)
            reserve([ay, yUnder, by], [v1x, v2x])
            return { d, usedYs: [laneKeyY(ay), laneKeyY(yUnder), laneKeyY(by)], usedXs: [laneKeyX(v1x), laneKeyX(v2x)], edgeRects }
        }

        // Rightward: always detour (no straight-line fast path)

        let sx = ax + CLEAR
        let tx = endX - CLEAR
        // Prefer an escape lane above both nodes; fallback to below if above is exhausted
        const src = nodesRef.current.find(n => n.id === fromId)
        const tgt = nodesRef.current.find(n => n.id === toId)
        const topY = Math.min(src?.y ?? ay, tgt?.y ?? by)
        const bottomY = Math.max((src?.y ?? ay) + NODE_H, (tgt?.y ?? by) + NODE_H)
        let escapeY = topY - CLEAR - LANE_STEP
        let guard = 0
        let changed = true
        while (changed && guard++ < 80) {
            changed = false
            // 1) H ax->sx @ ay
            for (const r of rects) {
                if (r.id === fromId) continue
                if (intersectsH(ay, ax, sx, r)) { sx = r.x + r.w + CLEAR + 0.1; changed = true; break }
            }
            if (!changed && usedXs.has(laneKeyX(sx))) { sx += LANE_STEP; changed = true }
            if (changed) continue

            // 2) V ay->escapeY @ sx
            for (const r of rects) {
                const y1 = Math.min(ay, escapeY), y2 = Math.max(ay, escapeY)
                if (r.id === fromId) continue
                if (intersectsV(sx, y1, y2, r)) { sx = r.x + r.w + CLEAR + 0.1; changed = true; break }
            }
            if (!changed && usedXs.has(laneKeyX(sx))) { sx += LANE_STEP; changed = true }
            if (changed) continue

            // 3) H sx->tx @ escapeY (prefer above; if blocked repeatedly, nudge further up; if we tried too much, fallback below)
            for (const r of rects) {
                if (intersectsH(escapeY, sx, tx, r)) { escapeY = r.y - CLEAR; changed = true; break }
            }
            if (!changed && usedYs.has(laneKeyY(escapeY))) { escapeY -= LANE_STEP; changed = true }
            if (!changed && guard > 30) {
                // fallback: try below both nodes
                let fallbackY = bottomY + CLEAR + LANE_STEP
                if (escapeY >= topY - CLEAR - LANE_STEP) { escapeY = fallbackY; changed = true }
            }
            if (changed) continue

            // 4) V escapeY->by @ tx
            for (const r of rects) {
                const y1 = Math.min(escapeY, by), y2 = Math.max(escapeY, by)
                if (r.id === toId) continue
                if (intersectsV(tx, y1, y2, r)) { tx = r.x - CLEAR - 0.1; changed = true; break }
            }
            if (!changed && usedXs.has(laneKeyX(tx))) { tx -= LANE_STEP; changed = true }
            if (changed) continue

            // 5) H tx->endX @ by (do not alter escapeY here; only move tx left to clear)
            for (const r of rects) {
                if (r.id === toId) continue
                if (intersectsH(by, tx, endX, r)) { tx = r.x - CLEAR - 0.1; changed = true; break }
            }
        }

        // Build path with crisp final bend
        const segs: Array<{ kind: 'H' | 'V'; a: number; b: number; c: number }> = []
        segs.push({ kind: 'H', a: ax, b: sx, c: ay })
        segs.push({ kind: 'V', a: ay, b: escapeY, c: sx })
        segs.push({ kind: 'H', a: sx, b: tx, c: escapeY })
        segs.push({ kind: 'V', a: escapeY, b: by, c: tx })
        const { d, edgeRects } = build(segs)
        reserve([ay, escapeY, by], [sx, tx])
        return { d, usedYs: [laneKeyY(ay), laneKeyY(escapeY), laneKeyY(by)], usedXs: [laneKeyX(sx), laneKeyX(tx)], edgeRects }
    }
    // auto layout (simple levels by indegree)
    const autoLayout = () => {
        const indeg = new Map<string, number>()
        nodes.forEach(n => indeg.set(n.id, 0))
        edges.forEach(e => indeg.set(e.to, (indeg.get(e.to) || 0) + 1))
        const levels: string[][] = []
        const q: string[] = []
        indeg.forEach((d, id) => { if (d === 0) q.push(id) })
        const rem = edges.map(e => ({ ...e }))
        const seen = new Set<string>()
        while (q.length) {
            const level: string[] = []
            const next: string[] = []
            q.forEach(id => { if (!seen.has(id)) { level.push(id); seen.add(id) } })
            if (level.length) levels.push(level)
            level.forEach(id => {
                for (let i = rem.length - 1; i >= 0; i--) {
                    const e = rem[i]
                    if (e.from === id) {
                        rem.splice(i, 1)
                        const d = (indeg.get(e.to) || 0) - 1
                        indeg.set(e.to, d)
                        if (d === 0) next.push(e.to)
                    }
                }
            })
            q.splice(0, q.length, ...next)
        }
        const cyclic = nodes.filter(n => !seen.has(n.id)).map(n => n.id)
        if (cyclic.length) levels.push(cyclic)

        const nodeSize = { w: NODE_W, h: NODE_H }
        const xGap = 120, yGap = 120
        const pos = new Map<string, { x: number; y: number }>()
        levels.forEach((ids, li) => {
            const total = ids.length * nodeSize.w + (ids.length - 1) * xGap
            const startX = Math.max(40, (window.innerWidth - total) / 2)
            const y = 80 + li * (nodeSize.h + yGap)
            ids.forEach((id, idx) => pos.set(id, { x: startX + idx * (nodeSize.w + xGap), y }))
        })
        setNodes(prev => prev.map(n => ({ ...n, ...(pos.get(n.id) || n) })))
    }

    // helpers to convert client coords to world (viewport) coords
    const clientToWorld = (clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect()
        const cx = rect ? clientX - rect.left : clientX
        const cy = rect ? clientY - rect.top : clientY
        return { x: (cx - pan.x) / scale, y: (cy - pan.y) / scale }
    }

    // dragging (node move) and connecting (drag from handle), plus panning
    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            // panning
            if (isPanningRef.current && lastPanPtRef.current) {
                const rect = containerRef.current?.getBoundingClientRect()
                const cx = e.clientX - (rect?.left ?? 0)
                const cy = e.clientY - (rect?.top ?? 0)
                const dx = cx - lastPanPtRef.current.x
                const dy = cy - lastPanPtRef.current.y
                setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }))
                lastPanPtRef.current = { x: cx, y: cy }
                return
            }
            // connect preview drag
            if (connectRef.current) {
                const { x: nx, y: ny } = clientToWorld(e.clientX, e.clientY)
                setConnect(prev => (prev ? { ...prev, x: nx, y: ny } : prev))
            }
            // node dragging
            const d = draggingRef.current
            if (d) {
                const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY)
                setNodes(prev => prev.map(n => n.id === d.id ? { ...n, x: wx - d.dx, y: wy - d.dy } : n))
            }
        }
        const onUp = () => {
            // end panning
            isPanningRef.current = false
            lastPanPtRef.current = null
            // finalize connect if hovering over a node
            if (connectRef.current) {
                const { fromId, x, y } = connectRef.current
                const target = nodesRef.current.find(n => x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H && n.id !== fromId)
                if (target) addEdge(fromId, target.id)
            }
            setConnect(null)
            draggingRef.current = null
        }
        const onKeyDown = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDownRef.current = true }
        const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDownRef.current = false }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
    }, [])

    useEffect(() => { connectRef.current = connect }, [connect])

    const onMouseDownNode = (e: React.MouseEvent, id: string) => {
        const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY)
        const node = nodesRef.current.find(n => n.id === id)
        const dx = node ? wx - node.x : 0
        const dy = node ? wy - node.y : 0
        // store pointer offset inside the node (world coords)
        draggingRef.current = { id, dx, dy }
        e.stopPropagation()
    }

    // context menu for delete
    const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
    const openMenu = (id: string, clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect()
        const x = rect ? clientX - rect.left : clientX
        const y = rect ? clientY - rect.top : clientY
        setMenu({ id, x, y })
    }
    const closeMenu = () => setMenu(null)

    const preview = useMemo(() => `${nodes.length} node${nodes.length === 1 ? "" : "s"}, ${edges.length} edge${edges.length === 1 ? "" : "s"}`, [nodes.length, edges.length])

    // Precompute routed edge paths with lane registries and accumulated edge obstacles
    const routed = useMemo(() => {
        // node obstacles (all nodes), we will exclude source/target per edge
        const nodeRects: Rect[] = nodes.map(n => ({ x: n.x, y: n.y, w: NODE_W, h: NODE_H, id: n.id }))
        const usedYs = new Set<number>()
        const usedXs = new Set<number>()
        const accEdgeRects: Rect[] = []
        const paths: { id: string; d: string }[] = []
        // Deterministic iteration: current order
        for (const e of edges) {
            const a = nodes.find(n => n.id === e.from)
            const b = nodes.find(n => n.id === e.to)
            if (!a || !b) continue
            const rightward = a.x <= b.x
            const ax = rightward ? a.x + NODE_W : a.x
            const ay = a.y + NODE_H / 2
            const bx = rightward ? b.x : b.x + NODE_W
            const by = b.y + NODE_H / 2
            const perEdgeObstacles = accEdgeRects.concat(nodeRects.filter(r => r.id !== a.id && r.id !== b.id))
            const res = route(ax, ay, bx, by, a.id, b.id, perEdgeObstacles, usedYs, usedXs)
            paths.push({ id: e.id, d: res.d })
            accEdgeRects.push(...res.edgeRects)
        }
        return { paths, usedYs, usedXs, accEdgeRects, nodeRects }
    }, [nodes, edges])

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/80 p-3">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-sm text-gray-300">Visual workflow</div>
                    <div className="text-xs text-gray-400">{preview}</div>
                </div>
                <button type="button" className="text-yellow-400 border border-yellow-500/40 px-3 py-1 rounded" onClick={() => setOpen(true)}>Open editor</button>
            </div>

            {open && (
                <div className="fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
                    <div className="absolute inset-0 p-4 flex flex-col">
                        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex items-center gap-2">
                            <button type="button" className="text-yellow-400 border border-yellow-500/40 px-3 py-1 rounded" onClick={addNode}>Add node</button>
                            <button type="button" className="text-yellow-400 border border-yellow-500/40 px-3 py-1 rounded" onClick={autoLayout}>Auto layout</button>
                            <div className="h-5 w-px bg-gray-800 mx-1" />
                            <button type="button" className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded" onClick={() => setScale(s => Math.min(3, s * 1.1))}>Zoom in</button>
                            <button type="button" className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded" onClick={() => setScale(s => Math.max(0.25, s / 1.1))}>Zoom out</button>
                            <button type="button" className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded" onClick={() => { setScale(1); setPan({ x: 0, y: 0 }) }}>Reset view</button>
                            <div className="ml-auto flex items-center gap-2">
                                <button type="button" className="bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 px-3 py-1 rounded" onClick={() => setOpen(false)}>Close</button>
                            </div>
                        </div>

                        <div
                            ref={containerRef}
                            className="relative flex-1 mt-3 rounded-lg border border-gray-800 overflow-hidden"
                            style={{
                                backgroundColor: '#0b0f14',
                                backgroundImage: 'radial-gradient(#1e293b 1px, transparent 1px)',
                                backgroundSize: '16px 16px',
                            }}
                            onWheel={(e) => {
                                if (!e.ctrlKey) return
                                e.preventDefault()
                                const rect = containerRef.current?.getBoundingClientRect()
                                const cx = (e.clientX - (rect?.left ?? 0))
                                const cy = (e.clientY - (rect?.top ?? 0))
                                const worldBefore = { x: (cx - pan.x) / scale, y: (cy - pan.y) / scale }
                                const next = e.deltaY < 0 ? Math.min(3, scale * 1.1) : Math.max(0.25, scale / 1.1)
                                setScale(next)
                                // keep cursor world point fixed
                                setPan({ x: cx - worldBefore.x * next, y: cy - worldBefore.y * next })
                            }}
                            onMouseDown={(e) => {
                                if (e.button === 1 || spaceDownRef.current) {
                                    // begin panning
                                    const rect = containerRef.current?.getBoundingClientRect()
                                    lastPanPtRef.current = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
                                    isPanningRef.current = true
                                    e.preventDefault()
                                }
                            }}
                            onContextMenu={(e) => { /* allow node context menus, but avoid opening on background while space-panning */ if (spaceDownRef.current) e.preventDefault() }}
                        >
                            {/* viewport wrapper applies pan/zoom to both graph and nodes */}
                            <div
                                className="absolute inset-0"
                                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0' }}
                            >
                                <svg
                                    className="absolute inset-0 w-full h-full"
                                    onMouseDown={() => { /* prevent background panning starting when clicking empty svg */ }}
                                    onClick={() => setSelectedEdgeId(null)}
                                >
                                    <defs>
                                        <marker id="arrow-default" markerWidth="12" markerHeight="8" refX="12" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                                            <path d="M0,0 L12,4 L0,8 z" fill="#94a3b8" />
                                        </marker>
                                        <marker id="arrow-selected" markerWidth="12" markerHeight="8" refX="12" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                                            <path d="M0,0 L12,4 L0,8 z" fill="#22c55e" />
                                        </marker>
                                    </defs>
                                    {routed.paths.map(p => {
                                        const selected = selectedEdgeId === p.id
                                        const color = selected ? '#22c55e' : '#94a3b8'
                                        const width = selected ? 3.5 : 2.5
                                        const marker = selected ? 'url(#arrow-selected)' : 'url(#arrow-default)'
                                        return (
                                            <g key={p.id}>
                                                {/* wide invisible hit area for easy clicking */}
                                                <path
                                                    d={p.d}
                                                    stroke="transparent"
                                                    strokeWidth={14}
                                                    fill="none"
                                                    onClick={(e) => { e.stopPropagation(); setSelectedEdgeId(prev => prev === p.id ? null : p.id) }}
                                                    style={{ cursor: 'pointer' }}
                                                />
                                                {/* visible edge */}
                                                <path
                                                    d={p.d}
                                                    stroke={color}
                                                    strokeWidth={width}
                                                    fill="none"
                                                    markerEnd={marker}
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    style={selected ? { filter: 'drop-shadow(0 0 2px #22c55e)' } : undefined}
                                                />
                                            </g>
                                        )
                                    })}
                                    {connect && (() => {
                                        const src = nodes.find(n => n.id === connect!.fromId)
                                        if (!src) return null
                                        const ax = src.x + NODE_W, ay = src.y + NODE_H / 2
                                        const bx = connect!.x, by = connect!.y
                                        // Use copies so preview doesn't reserve lanes
                                        const usedYs = new Set<number>(routed.usedYs)
                                        const usedXs = new Set<number>(routed.usedXs)
                                        const perEdgeObstacles = routed.accEdgeRects.concat(routed.nodeRects.filter(r => r.id !== src.id))
                                        const res = route(ax, ay, bx, by, src.id, undefined, perEdgeObstacles, usedYs, usedXs)
                                        return <path d={res.d} stroke="#f59e0b" strokeWidth={2} fill="none" markerEnd="url(#arrow-default)" strokeLinecap="round" strokeLinejoin="round" />
                                    })()}
                                </svg>

                                {nodes.map(n => (
                                    <div key={n.id}
                                        className={`absolute select-none rounded-md shadow-md border`}
                                        style={{ left: n.x, top: n.y }}
                                        onMouseDown={(e) => { setSelectedEdgeId(null); onMouseDownNode(e, n.id) }}
                                        onContextMenu={(e) => { e.preventDefault(); openMenu(n.id, e.clientX, e.clientY) }}
                                        onTouchStart={(e) => {
                                            if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current)
                                            const touch = e.touches[0]
                                            longPressTimerRef.current = window.setTimeout(() => openMenu(n.id, touch.clientX, touch.clientY), 600)
                                        }}
                                        onTouchEnd={() => { if (longPressTimerRef.current) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null } }}
                                    >
                                        <div
                                            className="relative"
                                            style={{ width: NODE_W, height: NODE_H, background: '#ffffff', borderColor: '#d1d5db', borderRadius: 10 }}
                                        >
                                            {/* left target handle */}
                                            <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-slate-400" />
                                            {/* right source handle */}
                                            <button
                                                type="button"
                                                className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-slate-400 hover:bg-yellow-400 cursor-crosshair"
                                                onMouseDown={(e) => {
                                                    e.stopPropagation()
                                                    setSelectedEdgeId(null)
                                                    setConnect({ fromId: n.id, x: n.x + NODE_W, y: n.y + NODE_H / 2 })
                                                }}
                                                aria-label="Start connection"
                                            />
                                            {/* label inside node */}
                                            <input
                                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-16px)] text-center bg-transparent outline-none text-sm text-gray-900"
                                                value={n.label}
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onChange={(e) => setNodes(prev => prev.map(x => x.id === n.id ? { ...x, label: e.target.value } : x))}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {menu && (
                                <div className="absolute z-10 bg-gray-900 border border-gray-700 rounded shadow text-sm"
                                    style={{ left: menu.x, top: menu.y }}
                                    onMouseLeave={closeMenu}
                                >
                                    <button type="button" className="block w-full text-left px-3 py-2 hover:bg-gray-800 text-red-300"
                                        onClick={() => { removeNode(menu.id); closeMenu() }}>Delete</button>
                                    <button type="button" className="block w-full text-left px-3 py-2 hover:bg-gray-800 text-gray-300"
                                        onClick={closeMenu}>Cancel</button>
                                </div>
                            )}

                            <div className="absolute bottom-2 left-2 text-xs text-gray-400">
                                Tip: Ctrl + wheel to zoom. Hold Space and drag (or middle mouse) to pan. Drag from the right handle to connect. Right-click/long-press to delete.
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* spacer for consistent height in form context */}
            <div className="mt-3" style={{ height: Math.max(0, (height ?? 0) - 480) }} />
        </div>
    )
}
