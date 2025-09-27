'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { supabase } from '@/lib/supabase'
import * as d3 from 'd3-force'
import { select as d3Select } from 'd3-selection'
import { drag as d3Drag } from 'd3-drag'
import { zoom as d3Zoom } from 'd3-zoom'

type GraphNode = d3.SimulationNodeDatum & {
    id: string
    name: string
}

type GraphLink = d3.SimulationLinkDatum<GraphNode> & {
    id: string
    source: string | GraphNode
    target: string | GraphNode
    type?: string
}

export default function WikiGraph({ title = 'wiki' }: { title?: string }) {
    const { user, loading } = useAuth()
    const { selectedOrgId } = useOrg()
    const router = useRouter()
    const svgRef = useRef<SVGSVGElement>(null)
    const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
    const [dims, setDims] = useState({ width: 800, height: 600 })
    const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] })
    const [rootId, setRootId] = useState<string | null>(null)

    useEffect(() => {
        if (!loading && !user) router.push('/login')
    }, [user, loading, router])

    useEffect(() => {
        const onResize = () => setDims({ width: window.innerWidth, height: window.innerHeight - 64 })
        onResize()
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])

    const fetchData = useCallback(async () => {
        if (!selectedOrgId) return setGraph({ nodes: [], links: [] })
        const { data, error } = await supabase
            .schema('structure')
            .from('edges')
            .select(`
        id,
        organisation_id,
        from_node:from_node_id(id,name),
        to_node:to_node_id(id,name)
      `)
            .eq('organisation_id', selectedOrgId)

        if (error) {
            console.error(error)
            setGraph({ nodes: [], links: [] })
            return
        }

        const nodeMap = new Map<string, GraphNode>()
        const links: GraphLink[] = []

        const pick = (n: any): { id: string; name: string } | null => {
            if (!n) return null
            const v = Array.isArray(n) ? n[0] : n
            if (!v) return null
            return { id: String(v.id), name: String(v.name ?? 'Untitled') }
        }

        for (const e of (data as any[] | null) || []) {
            const fn = pick((e as any).from_node)
            const tn = pick((e as any).to_node)
            if (fn && !nodeMap.has(fn.id)) nodeMap.set(fn.id, { id: fn.id, name: fn.name })
            if (tn && !nodeMap.has(tn.id)) nodeMap.set(tn.id, { id: tn.id, name: tn.name })
            if (fn && tn) links.push({ id: String((e as any).id), source: fn.id, target: tn.id })
        }

        const nodes = Array.from(nodeMap.values())

        // Determine root: node with no incoming edges. If exactly one, center it.
        const incoming = new Map<string, number>()
        nodes.forEach(n => incoming.set(n.id, 0))
        links.forEach(l => incoming.set(typeof l.target === 'string' ? l.target : l.target.id, (incoming.get(typeof l.target === 'string' ? l.target : l.target.id) || 0) + 1))
        const roots = nodes.filter(n => (incoming.get(n.id) || 0) === 0)
        const root = roots.length >= 1 ? roots[0].id : null
        setRootId(root)

        setGraph({ nodes, links })
    }, [selectedOrgId])

    useEffect(() => {
        if (user && selectedOrgId) fetchData()
    }, [user, selectedOrgId, fetchData])

    // Render force graph
    useEffect(() => {
        if (!svgRef.current) return
        const svg = d3Select(svgRef.current)
        svg.selectAll('*').remove()

        // Neon glow filter for flow particles
        const defs = svg.append('defs')
        const neon = defs.append('filter')
            .attr('id', 'neon-glow')
            .attr('x', '-50%')
            .attr('y', '-50%')
            .attr('width', '200%')
            .attr('height', '200%')
        neon.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 5).attr('result', 'blur')
        const merge = neon.append('feMerge')
        merge.append('feMergeNode').attr('in', 'blur')
        merge.append('feMergeNode').attr('in', 'SourceGraphic')

        const container = svg.append('g')
        const zoom = d3Zoom<SVGSVGElement, unknown>().scaleExtent([0.05, 8]).on('zoom', (e) => container.attr('transform', e.transform))
        svg.call(zoom as any)

        if (!graph.nodes.length) return

        // Degree map to scale spacing by connectivity
        const degree = new Map<string, number>()
        graph.nodes.forEach(n => degree.set(n.id, 0))
        graph.links.forEach(l => {
            const sid = typeof l.source === 'string' ? l.source : l.source.id
            const tid = typeof l.target === 'string' ? l.target : l.target.id
            degree.set(sid, (degree.get(sid) || 0) + 1)
            degree.set(tid, (degree.get(tid) || 0) + 1)
        })

        // Label sizing: scale with font size (base previously ~15px)
        const labelFontSize = 60 // 300% more => ~4x previous 15px
        const labelScale = labelFontSize / 15
        const estimateLabelHalfWidth = (name: string) => Math.min(180 * labelScale, name.length * 6 * labelScale)
        const spreadFactor = Math.min(4, 1 + Math.log2(graph.nodes.length + 1))
        // Ideal per-node spacing based on canvas area and node count (keeps even spread without changing link distance)
        const area = dims.width * dims.height
        const idealSpacing = Math.sqrt(area / Math.max(1, graph.nodes.length)) * 0.65

        // Node radius scaled by degree for better visual prominence
        const sizeFactor = 3.6 // 50% larger than previous (2.4 -> 3.6)
        const nodeRadius = (n: GraphNode) => {
            const d = degree.get(n.id) || 0
            const base = 16 + Math.sqrt(d) * 4 // base 16px + scale with degree
            return base * sizeFactor
        }

        const linkForce = d3.forceLink<GraphNode, GraphLink>(graph.links)
            .id(d => d.id)
            .distance((l) => {
                const s = typeof l.source === 'string' ? l.source : l.source.id
                const t = typeof l.target === 'string' ? l.target : l.target.id
                const ds = degree.get(s) || 0
                const dt = degree.get(t) || 0
                // Longer distance for higher-degree connections and bigger graphs
                return Math.min(1200, (220 + 36 * (ds + dt)) * spreadFactor)
            })
            .strength(0.05)

        const chargeForce = d3.forceManyBody<GraphNode>()
            .strength((n) => {
                const d = degree.get(n.id) || 0
                return (-1400 - d * 160) * spreadFactor
            })
            .distanceMax(4000)

        const collideForce = d3.forceCollide<GraphNode>()
            .radius((n) => {
                // Enforce a minimum spacing floor so nodes are evenly distributed even with short links
                const contentRadius = nodeRadius(n) + estimateLabelHalfWidth(n.name) + 12
                return Math.max(contentRadius, idealSpacing)
            })
            .strength(1.0)
            .iterations(3)

        const sim = d3.forceSimulation<GraphNode>(graph.nodes)
            .force('link', linkForce)
            .force('charge', chargeForce)
            .force('center', d3.forceCenter(dims.width / 2, dims.height / 2).strength(0.02))
            .force('collide', collideForce)
            .velocityDecay(0.25)
            .alphaDecay(0.006)
            .alphaMin(0.0005)
            .alpha(1)

        // Center and pin single root if present
        if (rootId) {
            const root = graph.nodes.find(n => n.id === rootId)
            if (root) {
                root.fx = dims.width / 2
                root.fy = dims.height / 2
            }
        }

        simulationRef.current = sim

        const link = container.append('g')
            .attr('stroke', '#64748b')
            .attr('stroke-opacity', 0.75)
            .selectAll('line')
            .data(graph.links)
            .enter().append('line')
            .attr('stroke-linecap', 'round')
            .attr('stroke-width', (d) => {
                const sid = typeof d.source === 'string' ? d.source : d.source.id
                const tid = typeof d.target === 'string' ? d.target : d.target.id
                const ds = degree.get(sid) || 0
                const dt = degree.get(tid) || 0
                const scale = Math.sqrt(ds + dt)
                // Base 2.2px up to ~5.5px for very connected links
                return Math.min(5.5, 2.2 + 0.8 * scale)
            })

        // Flow particles layer (above links, below nodes)
        const flowLayer = container.append('g').attr('class', 'flow-layer')

        const node = container.append('g').selectAll('g')
            .data(graph.nodes)
            .enter().append('g')
            .call(
                d3Drag<SVGGElement, GraphNode>()
                    .on('start', (event, d) => {
                        if (!event.active) sim.alphaTarget(0.3).restart()
                        d.fx = d.x
                        d.fy = d.y
                    })
                    .on('drag', (event, d) => {
                        d.fx = event.x
                        d.fy = event.y
                    })
                    .on('end', (event, d) => {
                        if (!event.active) sim.alphaTarget(0)
                        // Keep root pinned; others free
                        if (d.id === rootId) {
                            d.fx = dims.width / 2
                            d.fy = dims.height / 2
                        } else {
                            d.fx = null
                            d.fy = null
                        }
                    })
            )

        node.append('circle')
            .attr('r', d => nodeRadius(d))
            .attr('fill', d => (d.id === rootId ? '#fbbf24' : '#8b5cf6'))
            .attr('stroke', '#fff')
            .attr('stroke-width', 2)
        node.append('text')
            .text(d => d.name)
            .attr('x', 0)
            .attr('y', d => nodeRadius(d) + Math.max(20, labelFontSize * 0.9))
            .attr('text-anchor', 'middle')
            .attr('font-size', labelFontSize)
            .attr('fill', '#e5e7eb')

        // Compute BFS levels from root for staggered flow
        const nodeLevel = new Map<string, number>()
        if (rootId) {
            nodeLevel.set(rootId, 0)
            const out = new Map<string, string[]>()
            graph.links.forEach(l => {
                const s = typeof l.source === 'string' ? l.source : l.source.id
                const t = typeof l.target === 'string' ? l.target : l.target.id
                if (!out.has(s)) out.set(s, [])
                out.get(s)!.push(t)
            })
            const q: string[] = [rootId]
            while (q.length) {
                const u = q.shift()!
                const next = (nodeLevel.get(u) || 0) + 1
                for (const v of out.get(u) || []) {
                    if (!nodeLevel.has(v)) {
                        nodeLevel.set(v, next)
                        q.push(v)
                    }
                }
            }
        }

        // One neon particle per link (group with glow + core)
        const neonColor = '#22d3ee'
        const flowDots = flowLayer.selectAll('g.flow-dot')
            .data(graph.links)
            .enter()
            .append('g')
            .attr('class', 'flow-dot')
            .attr('opacity', 0)

        flowDots.append('circle')
            .attr('class', 'glow')
            .attr('r', 10)
            .attr('fill', neonColor)
            .attr('opacity', 0.35)
            .attr('filter', 'url(#neon-glow)')

        flowDots.append('circle')
            .attr('class', 'core')
            .attr('r', 5)
            .attr('fill', neonColor)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 0.8)

        // Animate particles along links from root outward
        let rafId = 0
        const period = 2400
        const delayPerLevel = 380
        const startTime = performance.now()
        const animateFlow = (time: number) => {
            const elapsed = time - startTime
            flowDots.each(function (d: any) {
                const s = (typeof d.source === 'string' ? graph.nodes.find(n => n.id === d.source) : d.source) as GraphNode
                const t = (typeof d.target === 'string' ? graph.nodes.find(n => n.id === d.target) : d.target) as GraphNode
                if (!s || !t) return
                const lvl = nodeLevel.get(typeof d.source === 'string' ? d.source : (d.source as GraphNode).id) || 0
                const delay = lvl * delayPerLevel
                if (elapsed < delay) {
                    (this as SVGCircleElement).setAttribute('opacity', '0')
                    return
                }
                const local = (elapsed - delay) % period
                const p = local / period
                const x = (s.x || 0) + ((t.x || 0) - (s.x || 0)) * p
                const y = (s.y || 0) + ((t.y || 0) - (s.y || 0)) * p
                d3Select(this)
                    .attr('opacity', 1)
                    .attr('transform', `translate(${x},${y})`)
            })
            rafId = requestAnimationFrame(animateFlow)
        }
        if (rootId) {
            rafId = requestAnimationFrame(animateFlow)
        }

        sim.on('tick', () => {
            (link as any)
                .attr('x1', (d: any) => (d.source as GraphNode).x || 0)
                .attr('y1', (d: any) => (d.source as GraphNode).y || 0)
                .attr('x2', (d: any) => (d.target as GraphNode).x || 0)
                .attr('y2', (d: any) => (d.target as GraphNode).y || 0)

            node.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`)
        })

        return () => {
            if (rafId) cancelAnimationFrame(rafId)
        }

    }, [graph, dims, rootId])

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-100">Loading…</div>
        )
    }

    if (!user) return null

    return (
        <div className="min-h-screen bg-gray-950">
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        <div className="text-xl font-semibold text-yellow-400">{title}</div>
                        <div className="text-xs text-gray-400">{user?.email}</div>
                    </div>
                </div>
            </nav>
            <main className="w-full h-screen">
                <svg ref={svgRef} width={dims.width} height={dims.height} style={{ background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)' }} />
            </main>
        </div>
    )
}
