'use client'

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useOrg } from '@/contexts/OrgContext'
import { supabase } from '@/lib/supabase'
import * as d3 from 'd3-force'
import { select as d3Select, Selection } from 'd3-selection'
import { drag as d3Drag } from 'd3-drag'
import { zoom as d3Zoom } from 'd3-zoom'

interface NodeData {
    id: string
    node_type_id: string
    name: string
    entity_id?: string
    metadata?: any
    created_at: string
    node_type: {
        name: string
        schema_name?: string
        table_name?: string
        label?: any
    }
}

interface EdgeData {
    id: string
    from_node_id: string
    to_node_id: string
    edge_type_id: string
    metadata?: any
    edge_type: {
        name: string
        schema_name?: string
        table_name?: string
    }
}

interface GraphNode extends d3.SimulationNodeDatum {
    id: string
    name: string
    type: string
    color: string
    size: number
    flowLevel?: number
    data: NodeData
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
    source: string | GraphNode
    target: string | GraphNode
    type: string
    data: EdgeData
}

interface GraphData {
    nodes: GraphNode[]
    links: GraphLink[]
}

// Obsidian-style color palette
const NODE_COLORS = {
    default: '#8b5cf6', // purple-500
    user: '#60a5fa', // blue-400
    employment_position: '#34d399', // emerald-400
    employment_role: '#f87171', // red-400
    organisation: '#fbbf24', // yellow-400
    branch: '#06b6d4', // cyan-500
    payroll_category: '#a78bfa', // violet-400
    person: '#60a5fa', // blue-400
    project: '#34d399', // emerald-400
    document: '#f87171', // red-400
    concept: '#a78bfa', // violet-400
    event: '#fb7185', // pink-400
    location: '#06b6d4', // cyan-500
}

// Edge type colors - distinctive colors for each edge type
const EDGE_COLORS = {
    // Primary relationship types
    'User Role Position': '#fbbf24', // yellow-400
    'Employee Position': '#34d399', // emerald-400
    'Position Role': '#f87171', // red-400
    'Organisation Branch': '#06b6d4', // cyan-500
    'Branch Department': '#a78bfa', // violet-400
    'Employee Department': '#fb7185', // pink-400

    // Hierarchical relationships
    'Reports To': '#3b82f6', // blue-500
    'Manages': '#10b981', // emerald-500
    'Supervises': '#f59e0b', // amber-500
    'Reports': '#ef4444', // red-500

    // Project relationships
    'Project Member': '#8b5cf6', // purple-500
    'Project Lead': '#06b6d4', // cyan-500
    'Project Manager': '#f97316', // orange-500
    'Assigned To': '#84cc16', // lime-500

    // Document relationships
    'Document Owner': '#ec4899', // pink-500
    'Document Viewer': '#6366f1', // indigo-500
    'Document Editor': '#14b8a6', // teal-500
    'Created By': '#f472b6', // pink-400

    // Operational relationships
    'Process Flow': '#0ea5e9', // sky-500
    'Workflow': '#8b5cf6', // purple-500
    'Task Assignment': '#22c55e', // green-500
    'Resource Allocation': '#f59e0b', // amber-500

    // Location relationships
    'Located At': '#06b6d4', // cyan-500
    'Works At': '#10b981', // emerald-500
    'Based In': '#3b82f6', // blue-500

    // Time-based relationships
    'Schedule': '#f97316', // orange-500
    'Shift': '#84cc16', // lime-500
    'Roster': '#ec4899', // pink-500

    // Additional common relationship types
    'Subordinate': '#94a3b8', // gray-400 (neutral hierarchy)
    'Collaborates With': '#22d3ee', // cyan-400 (partnership)
    'Reviewed By': '#8b5cf6', // purple-500 (validation)
    'Approval Chain': '#dc2626', // red-600 (formal approval)
    'Operates From': '#f97316', // orange-500 (operational base)
    'Timeframe': '#6366f1', // indigo-500 (duration)
    'Communicates With': '#22d3ee', // cyan-400 (communication)
    'Notifies': '#fbbf24', // yellow-400 (notification)
    'Escalates To': '#ef4444', // red-500 (escalation)
    'Receives From': '#34d399', // emerald-400 (receipt)
    'Budget Approval': '#dc2626', // red-600 (financial authority)
    'Cost Center': '#f59e0b', // amber-500 (cost management)
    'Revenue Source': '#22c55e', // green-500 (income)
    'Expense Category': '#ef4444', // red-500 (expenditure)
    'Has Access To': '#6366f1', // indigo-500 (access rights)
    'Grants Permission': '#8b5cf6', // purple-500 (authorization)
    'Requires Approval': '#f97316', // orange-500 (approval needed)
    'Security Clearance': '#dc2626', // red-600 (security)

    // Default fallback
    'default': '#6b7280', // gray-500
}

// Fallback colors for unknown edge types - ensuring good contrast and accessibility
const FALLBACK_EDGE_COLORS = [
    '#8b5cf6', // purple-500
    '#06b6d4', // cyan-500
    '#f59e0b', // amber-500
    '#ef4444', // red-500
    '#10b981', // emerald-500
    '#3b82f6', // blue-500
    '#f97316', // orange-500
    '#84cc16', // lime-500
    '#ec4899', // pink-500
    '#6366f1', // indigo-500
]

// Get edge color with fallback for unknown types
function getEdgeColor(edgeType: string): string {
    // First try the defined edge colors
    const definedColor = EDGE_COLORS[edgeType as keyof typeof EDGE_COLORS]
    if (definedColor) return definedColor

    // For unknown types, generate a consistent color based on the edge type name
    const hash = edgeType.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const colorIndex = hash % FALLBACK_EDGE_COLORS.length
    return FALLBACK_EDGE_COLORS[colorIndex]
}

// Get edge stroke pattern for additional visual distinction
function getEdgeStrokeDashArray(edgeType: string): string | undefined {
    // Add dashed patterns for certain relationship types to enhance visual distinction
    if (edgeType.toLowerCase().includes('approval') || edgeType.toLowerCase().includes('permission')) {
        return '5,5' // Dashed for approval-related edges
    }
    if (edgeType.toLowerCase().includes('schedule') || edgeType.toLowerCase().includes('time')) {
        return '3,3' // Small dashes for time-related edges
    }
    if (edgeType.toLowerCase().includes('communication') || edgeType.toLowerCase().includes('notification')) {
        return '2,2' // Dotted for communication edges
    }
    return undefined // Solid line for all other edges
}

export default function StructureGraphPage() {
    const { user, loading } = useAuth()
    const { selectedOrgId } = useOrg()
    const router = useRouter()
    const svgRef = useRef<SVGSVGElement>(null)
    const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
    const [availableEdgeTypes, setAvailableEdgeTypes] = useState<string[]>([])
    const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(new Set())
    const [visibleNodeTypes, setVisibleNodeTypes] = useState<Set<string>>(new Set())
    const [selectedLinkIds, setSelectedLinkIds] = useState<Set<string>>(new Set())
    const [showLegend, setShowLegend] = useState(true)

    // Physics control states
    const [showPhysicsPanel, setShowPhysicsPanel] = useState(false)
    const [physicsParams, setPhysicsParams] = useState({
        linkDistance: 80,
        linkStrength: 0.3,
        chargeStrength: -200,
        chargeDistanceMax: 300,
        collisionRadius: 2,
        collisionStrength: 0.8,
        centerStrength: 0.1,
        velocityDecay: 0.4,
        alphaDecay: 0.0228,
        alphaMin: 0.001
    })

    // Refs to D3 selections for incremental updates
    const zoomRef = useRef<any>(null)
    const currentTransformRef = useRef<any>(null)
    const linkSelRef = useRef<Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null>(null)
    const linkLabelSelRef = useRef<Selection<SVGTextElement, GraphLink, SVGGElement, unknown> | null>(null)
    const nodeSelRef = useRef<Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null)

    // Derived: dynamic node types present in current graph
    const nodeTypeStats = useMemo(() => {
        const counts = new Map<string, number>()
        graphData.nodes.forEach(n => {
            counts.set(n.type, (counts.get(n.type) || 0) + 1)
        })
        const entries = Array.from(counts.entries()).map(([type, count]) => ({ type, count }))
        // Keep 'default' last if present
        entries.sort((a, b) => {
            if (a.type === 'default') return 1
            if (b.type === 'default') return -1
            return a.type.localeCompare(b.type)
        })
        return entries
    }, [graphData.nodes])

    // Fast lookup for nodes by id
    const nodeById = useMemo(() => {
        return new Map(graphData.nodes.map(n => [n.id, n]))
    }, [graphData.nodes])

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login')
        }
    }, [user, loading, router])

    // Update dimensions on window resize
    useEffect(() => {
        const updateDimensions = () => {
            setDimensions({
                width: window.innerWidth,
                height: window.innerHeight - 64 // nav height
            })
        }

        updateDimensions()
        window.addEventListener('resize', updateDimensions)
        return () => window.removeEventListener('resize', updateDimensions)
    }, [])

    const fetchStructureData = useCallback(async () => {
        setIsLoading(true)
        setError(null)
        try {
            if (!selectedOrgId) {
                setGraphData({ nodes: [], links: [] })
                setIsLoading(false)
                return
            }

            // Only fetch edges with their connected nodes for the selected organization
            const { data: edgesData, error: edgesError } = await supabase
                .schema('structure')
                .from('edges')
                .select(`
          id,
          organisation_id,
          metadata,
          created_at,
          from_node:from_node_id(id, name, node_types(name)),
          to_node:to_node_id(id, name, node_types(name)),
          edge_type:edge_types(name)
        `)
                .eq('organisation_id', selectedOrgId)

            if (edgesError) throw edgesError

            if (!edgesData || edgesData.length === 0) {
                setGraphData({ nodes: [], links: [] })
                return
            }

            // Create a set of unique nodes from the edges
            const nodeMap = new Map<string, GraphNode>()

            edgesData.forEach((edge: any) => {
                // Add from_node if not already added
                if (edge.from_node && !nodeMap.has(edge.from_node.id)) {
                    const nodeTypeName = edge.from_node.node_types?.name || 'default'
                    nodeMap.set(edge.from_node.id, {
                        id: edge.from_node.id,
                        name: edge.from_node.name || 'Unnamed Node',
                        type: nodeTypeName.toLowerCase().replace(' ', '_'),
                        color: NODE_COLORS[nodeTypeName.toLowerCase().replace(' ', '_') as keyof typeof NODE_COLORS] || NODE_COLORS.default,
                        size: 8 + Math.random() * 4,
                        data: edge.from_node
                    })
                }

                // Add to_node if not already added
                if (edge.to_node && !nodeMap.has(edge.to_node.id)) {
                    const nodeTypeName = edge.to_node.node_types?.name || 'default'
                    nodeMap.set(edge.to_node.id, {
                        id: edge.to_node.id,
                        name: edge.to_node.name || 'Unnamed Node',
                        type: nodeTypeName.toLowerCase().replace(' ', '_'),
                        color: NODE_COLORS[nodeTypeName.toLowerCase().replace(' ', '_') as keyof typeof NODE_COLORS] || NODE_COLORS.default,
                        size: 8 + Math.random() * 4,
                        data: edge.to_node
                    })
                }
            })

            // Convert map to array
            const nodes = Array.from(nodeMap.values())

            // Create links from edges
            const links: GraphLink[] = edgesData
                .filter((edge: any) => edge.from_node && edge.to_node) // Only include edges with valid nodes
                .map((edge: any) => ({
                    source: edge.from_node.id,
                    target: edge.to_node.id,
                    type: edge.edge_type?.name || 'default',
                    data: edge
                }))

            setGraphData({ nodes, links })

            // Collect available edge types and initialize visibility
            const edgeTypes = [...new Set(links.map(link => link.type))]
            console.log('Setting edge types:', edgeTypes, 'from links:', links.length)
            setAvailableEdgeTypes(edgeTypes)

            // Initialize visibility once (first load) to show all edge types
            setVisibleEdgeTypes(prev => (prev.size === 0 ? new Set(edgeTypes) : prev))

            // Initialize visible node types once (first load)
            const nodeTypes = [...new Set(nodes.map(n => n.type))]
            setVisibleNodeTypes(prev => (prev.size === 0 ? new Set(nodeTypes) : prev))

            // Compute flow levels: nodes with no incoming links are level 0; successors increase
            const incoming = new Map<string, number>()
            nodes.forEach(n => incoming.set(n.id, 0))
            links.forEach(l => {
                const tid = typeof l.target === 'string' ? l.target : l.target.id
                incoming.set(tid, (incoming.get(tid) || 0) + 1)
            })
            const adj = new Map<string, GraphNode[]>()
            nodes.forEach(n => adj.set(n.id, []))
            links.forEach(l => {
                const sid = typeof l.source === 'string' ? l.source : l.source.id
                const tid = typeof l.target === 'string' ? l.target : l.target.id
                const s = nodeMap.get(sid)
                const t = nodeMap.get(tid)
                if (s && t) adj.get(s.id)!.push(t)
            })
            const q: GraphNode[] = []
            nodes.forEach(n => {
                n.flowLevel = undefined
                if ((incoming.get(n.id) || 0) === 0) {
                    n.flowLevel = 0
                    q.push(n)
                }
            })
            while (q.length) {
                const u = q.shift()!
                const next = (u.flowLevel || 0) + 1
                for (const v of adj.get(u.id) || []) {
                    if (v.flowLevel == null || next > v.flowLevel) {
                        v.flowLevel = next
                        q.push(v)
                    }
                }
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load structure data')
        } finally {
            setIsLoading(false)
        }
    }, [selectedOrgId])

    // Log selectedOrgId changes for debugging
    useEffect(() => {
        console.log('StructureGraph: selectedOrgId changed to:', selectedOrgId)
    }, [selectedOrgId])

    // D3 Force Simulation
    useEffect(() => {
        if (!graphData.nodes.length || !svgRef.current) return

        const svg = d3Select(svgRef.current)
        svg.selectAll('*').remove() // Clear previous render

        const { width, height } = dimensions

        // Create container for zoomable content first
        const container = svg.append('g').attr('class', 'zoom-container')

        // Create zoom behavior
        const zoom = d3Zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                container.attr('transform', event.transform)
                currentTransformRef.current = event.transform
            })

        // Preserve existing zoom transform if available
        if (currentTransformRef.current && zoomRef.current) {
            svg.call(zoom.transform, currentTransformRef.current)
        }

        zoomRef.current = zoom
        svg.call(zoom)

        // Clicking on empty background clears selected links
        svg.on('click', null)
        svg.on('click', (event) => {
            // Only clear if clicking directly on SVG background, not during zoom/pan
            if (event.target === svg.node()) {
                setSelectedLinkIds(new Set())
            }
        })

        // Filter nodes and links based on visibility state
        const nodeVisible = (nodeId: string) => {
            const n = nodeById.get(nodeId)
            return !!n && visibleNodeTypes.has(n.type)
        }
        const filteredLinks = graphData.links.filter(link => {
            const srcId = typeof link.source === 'string' ? link.source : link.source.id
            const tgtId = typeof link.target === 'string' ? link.target : link.target.id
            return visibleEdgeTypes.has(link.type) && nodeVisible(srcId) && nodeVisible(tgtId)
        })

        // Debug logging
        console.log('Debug info:', {
            totalLinks: graphData.links.length,
            filteredLinks: filteredLinks.length,
            visibleEdgeTypesSize: visibleEdgeTypes.size,
            visibleEdgeTypes: Array.from(visibleEdgeTypes),
            linkTypes: graphData.links.map(l => l.type),
            availableEdgeTypes: availableEdgeTypes
        })

        // Visible nodes
        const visibleNodes = graphData.nodes.filter(n => visibleNodeTypes.has(n.type))
        // Create simulation: left-to-right flow using flowLevel columns and y-banding
        const maxLevel = Math.max(0, ...visibleNodes.map(n => n.flowLevel ?? 0))
        const leftMargin = 120
        const rightMargin = 160
        const colWidth = Math.max(1, (width - leftMargin - rightMargin) / Math.max(1, maxLevel))

        const simulation = d3.forceSimulation<GraphNode>(visibleNodes)
            .force('link', d3.forceLink<GraphNode, GraphLink>(filteredLinks)
                .id(d => d.id)
                .distance(physicsParams.linkDistance)
                .strength(physicsParams.linkStrength)
            )
            .force('charge', d3.forceManyBody()
                .strength(physicsParams.chargeStrength)
                .distanceMax(physicsParams.chargeDistanceMax)
            )
            .force('collision', d3.forceCollide<GraphNode>()
                .radius(d => d.size + physicsParams.collisionRadius)
                .strength(physicsParams.collisionStrength)
            )
            .force('x-level', d3.forceX<GraphNode>(d => leftMargin + (d.flowLevel ?? 0) * colWidth).strength(0.45))
            .force('y-band', d3.forceY<GraphNode>((d, i) => height / 2 + (i - (visibleNodes.length - 1) / 2) * 8).strength(0.08))
            .velocityDecay(physicsParams.velocityDecay)
            .alphaDecay(physicsParams.alphaDecay)
            .alphaMin(physicsParams.alphaMin)

        simulationRef.current = simulation

        // Create links
        const link = container.append('g')
            .attr('class', 'links')
            .selectAll('line')
            .data(filteredLinks)
            .enter().append('line')
            .attr('stroke', (d: GraphLink) => getEdgeColor(d.type))
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', (d: GraphLink) => selectedLinkIds.has(d.data.id) ? 2.5 : 1.5)
            .attr('stroke-dasharray', (d: GraphLink) => getEdgeStrokeDashArray(d.type) || null)
            .attr('data-selected', (d: GraphLink) => selectedLinkIds.has(d.data.id) ? '1' : '0')
            .style('cursor', 'pointer')
            .on('mouseover', function (event, d) {
                d3Select(this)
                    .attr('stroke', getEdgeColor(d.type))
                    .attr('stroke-opacity', 1)
                    .attr('stroke-width', 3)
            })
            .on('mouseout', function (event, d) {
                d3Select(this)
                    .attr('stroke', getEdgeColor(d.type))
                    .attr('stroke-opacity', 0.6)
                    .attr('stroke-width', (this as SVGLineElement).getAttribute('data-selected') === '1' ? 2.5 : 1.5)
            })
            .on('click', function (event, d) {
                event.stopPropagation()
                // toggle selection for this link
                const next = new Set(selectedLinkIds)
                if (next.has(d.data.id)) next.delete(d.data.id)
                else next.add(d.data.id)
                setSelectedLinkIds(next)
            })

        link.append('title')
            .text((d: GraphLink) => {
                const src = typeof d.source === 'string' ? nodeById.get(d.source) : d.source
                const tgt = typeof d.target === 'string' ? nodeById.get(d.target) : d.target
                return `${d.type}: ${src?.name ?? 'Unknown'} → ${tgt?.name ?? 'Unknown'}`
            })

        console.log('Created', link.size(), 'link elements for', filteredLinks.length, 'links to show')

        // Create link labels (edge type names), hidden by default
        const linkLabels = container.append('g')
            .attr('class', 'link-labels')
            .selectAll('text')
            .data(filteredLinks)
            .enter().append('text')
            .text((d: GraphLink) => d.type)
            .attr('font-size', 8)
            .attr('font-family', 'Inter, sans-serif')
            .attr('fill', '#e5e7eb')
            .attr('stroke', '#0f172a')
            .attr('stroke-width', 2)
            .attr('paint-order', 'stroke')
            .attr('text-anchor', 'middle')
            .attr('opacity', (d: GraphLink) => selectedLinkIds.has(d.data.id) ? 1 : 0)
            .style('pointer-events', 'none')

        // cache selections for later incremental updates
        linkSelRef.current = link as unknown as Selection<SVGLineElement, GraphLink, SVGGElement, unknown>
        linkLabelSelRef.current = linkLabels as unknown as Selection<SVGTextElement, GraphLink, SVGGElement, unknown>

        // Create nodes - create ALL nodes, handle visibility separately
        const node = container.append('g')
            .attr('class', 'nodes')
            .selectAll('g')
            .data(graphData.nodes) // Use all nodes, not filtered
            .enter().append('g')
            .attr('class', 'node')
            .style('cursor', 'pointer')
            .style('display', (d: GraphNode) => visibleNodeTypes.has(d.type) ? null : 'none') // Set initial visibility

        // Cache node selection for incremental updates
        nodeSelRef.current = node as unknown as Selection<SVGGElement, GraphNode, SVGGElement, unknown>

        node.call(d3Drag<SVGGElement, GraphNode>()
            .on('start', (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart()
                d.fx = d.x
                d.fy = d.y
            })
            .on('drag', (event, d) => {
                d.fx = event.x
                d.fy = event.y
            })
            .on('end', (event, d) => {
                if (!event.active) simulation.alphaTarget(0)
                d.fx = null
                d.fy = null
            })
        )

        // Add circles to nodes
        node.append('circle')
            .attr('r', d => d.size)
            .attr('fill', d => d.color)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', 2)
            .attr('stroke-opacity', 0.8)
            .style('filter', 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.3))')

        // Add labels to nodes
        node.append('text')
            .text(d => d.name)
            .attr('x', 0)
            .attr('y', d => d.size + 16)
            .attr('text-anchor', 'middle')
            .attr('font-family', 'Inter, sans-serif')
            .attr('font-size', '12px')
            .attr('fill', '#e5e7eb')
            .attr('font-weight', '500')
            .style('pointer-events', 'none')
            .style('user-select', 'none')

        // Add hover effects
        node
            .on('mouseover', function (event, d) {
                d3Select(this).select('circle')
                    .transition()
                    .duration(200)
                    .attr('r', d.size * 1.2)
                    .style('filter', 'drop-shadow(0 0 12px rgba(139, 92, 246, 0.6))')

                // Highlight connected links
                link
                    .attr('stroke', (l: GraphLink) => getEdgeColor(l.type))
                    .attr('stroke-width', (l: GraphLink) => ((l.source as GraphNode).id === d.id || (l.target as GraphNode).id === d.id) ? 3 : 1.2)
                    .attr('stroke-opacity', (l: GraphLink) => ((l.source as GraphNode).id === d.id || (l.target as GraphNode).id === d.id) ? 0.9 : 0.2)

                // do not change labels on hover; selection controls visibility
            })
            .on('mouseout', function (event, d) {
                d3Select(this).select('circle')
                    .transition()
                    .duration(200)
                    .attr('r', d.size)
                    .style('filter', 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.3))')

                // Reset link styles
                link
                    .attr('stroke', (l: GraphLink) => getEdgeColor(l.type))
                    .attr('stroke-width', 1.5)
                    .attr('stroke-opacity', 0.6)
            })
            .on('click', function (event) {
                // prevent background from clearing selection when clicking on a node
                event.stopPropagation()
            })

        // Update positions on simulation tick
        simulation.on('tick', () => {
            const edgePointRight = (n: GraphNode) => ({ x: (n.x ?? 0) + n.size, y: n.y ?? 0 })
            const edgePointLeft = (n: GraphNode) => ({ x: (n.x ?? 0) - n.size, y: n.y ?? 0 })

            link
                .attr('x1', d => edgePointRight(d.source as GraphNode).x)
                .attr('y1', d => edgePointRight(d.source as GraphNode).y)
                .attr('x2', d => edgePointLeft(d.target as GraphNode).x)
                .attr('y2', d => edgePointLeft(d.target as GraphNode).y)

            // position labels at link midpoints
            linkLabels
                .attr('x', d => (((d.source as GraphNode).x! + (d.target as GraphNode).x!) / 2))
                .attr('y', d => (((d.source as GraphNode).y! + (d.target as GraphNode).y!) / 2))

            node
                .attr('transform', d => `translate(${d.x},${d.y})`)
        })

        return () => {
            simulation.stop()
        }
    }, [graphData, dimensions, nodeById, availableEdgeTypes])

    // Separate effect to update visibility without recreating the entire graph
    useEffect(() => {
        if (!linkSelRef.current || !linkLabelSelRef.current || !nodeSelRef.current || !simulationRef.current) return

        // Filter nodes and links based on visibility state
        const nodeVisible = (nodeId: string) => {
            const n = nodeById.get(nodeId)
            return !!n && visibleNodeTypes.has(n.type)
        }
        const filteredLinks = graphData.links.filter(link => {
            const srcId = typeof link.source === 'string' ? link.source : link.source.id
            const tgtId = typeof link.target === 'string' ? link.target : link.target.id
            return visibleEdgeTypes.has(link.type) && nodeVisible(srcId) && nodeVisible(tgtId)
        })
        const visibleNodes = graphData.nodes.filter(n => visibleNodeTypes.has(n.type))

        // Update link visibility based on filtered data
        const filteredLinkIds = new Set(filteredLinks.map(l => l.data.id))
        linkSelRef.current
            .style('display', function (d: any) {
                const link = d as GraphLink
                return filteredLinkIds.has(link.data.id) ? null : 'none'
            })
        linkLabelSelRef.current
            .style('display', function (d: any) {
                const link = d as GraphLink
                return filteredLinkIds.has(link.data.id) ? null : 'none'
            })

        // Update node visibility using cached selection
        const visibleNodeIds = new Set(visibleNodes.map(n => n.id))
        console.log('Updating node visibility:', {
            totalNodes: graphData.nodes.length,
            visibleNodeTypes: Array.from(visibleNodeTypes),
            visibleNodeIds: Array.from(visibleNodeIds),
            nodeSelectionSize: nodeSelRef.current.size()
        })

        nodeSelRef.current
            .style('display', function (d: any) {
                const node = d as GraphNode
                const isVisible = visibleNodeTypes.has(node.type)
                return isVisible ? null : 'none'
            })

        // Update simulation forces with new filtered data
        const simulation = simulationRef.current
        simulation.nodes(visibleNodes)
        simulation.force('link', d3.forceLink<GraphNode, GraphLink>(filteredLinks)
            .id(d => d.id)
            .distance(physicsParams.linkDistance)
            .strength(physicsParams.linkStrength)
        )
        simulation.alpha(0.3).restart()

        console.log('Node toggle update complete:', {
            visibleNodes: visibleNodes.length,
            visibleLinks: filteredLinks.length,
            visibleNodeTypes: Array.from(visibleNodeTypes)
        })
    }, [visibleEdgeTypes, visibleNodeTypes, graphData, nodeById])

    // Incremental visual update for link selection without rebuilding the graph
    useEffect(() => {
        if (!linkSelRef.current || !linkLabelSelRef.current) return
        linkSelRef.current
            .attr('data-selected', (d: GraphLink) => selectedLinkIds.has(d.data.id) ? '1' : '0')
            .attr('stroke-width', (d: GraphLink) => selectedLinkIds.has(d.data.id) ? 2.5 : 1.5)
        linkLabelSelRef.current
            .attr('opacity', (d: GraphLink) => selectedLinkIds.has(d.data.id) ? 1 : 0)
    }, [selectedLinkIds])

    // Update simulation physics when parameters change
    useEffect(() => {
        const simulation = simulationRef.current
        if (!simulation) return

        // Update all force parameters
        const linkForce = simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>
        if (linkForce) {
            linkForce.distance(physicsParams.linkDistance).strength(physicsParams.linkStrength)
        }

        const chargeForce = simulation.force('charge') as d3.ForceManyBody<GraphNode>
        if (chargeForce) {
            chargeForce.strength(physicsParams.chargeStrength).distanceMax(physicsParams.chargeDistanceMax)
        }

        const centerForce = simulation.force('center') as d3.ForceCenter<GraphNode>
        if (centerForce) {
            centerForce.strength(physicsParams.centerStrength)
        }

        const collisionForce = simulation.force('collision') as d3.ForceCollide<GraphNode>
        if (collisionForce) {
            collisionForce
                .radius(d => d.size + physicsParams.collisionRadius)
                .strength(physicsParams.collisionStrength)
        }

        // Update simulation parameters
        simulation
            .velocityDecay(physicsParams.velocityDecay)
            .alphaDecay(physicsParams.alphaDecay)
            .alphaMin(physicsParams.alphaMin)
            .alpha(0.3)
            .restart()
    }, [physicsParams])

    useEffect(() => {
        if (user && selectedOrgId) {
            fetchStructureData()
        }
    }, [user, selectedOrgId, fetchStructureData])

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <div className="text-lg text-gray-100">Loading...</div>
            </div>
        )
    }

    if (!user) {
        return null // Will redirect to login
    }

    return (
        <div className="min-h-screen bg-gray-950">
            <nav className="bg-gray-900 shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center">
                            <button
                                onClick={() => router.push('/home')}
                                className="text-xl font-semibold text-yellow-400 hover:text-yellow-300"
                            >
                                ⚡ Minnal
                            </button>
                        </div>
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={fetchStructureData}
                                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-3 py-1 rounded text-sm font-medium"
                                disabled={isLoading}
                            >
                                {isLoading ? 'Refreshing...' : 'Refresh'}
                            </button>
                            <span className="text-sm text-gray-300">
                                {user.email}
                            </span>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="w-full h-screen">
                <div className="flex h-full">
                    {/* Graph Container */}
                    <div className="flex-1 relative bg-gray-950 overflow-hidden">
                        {error ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-red-400 mb-2">Error loading structure data</div>
                                    <div className="text-gray-400 text-sm">{error}</div>
                                    <button
                                        onClick={fetchStructureData}
                                        className="mt-4 bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded text-sm"
                                    >
                                        Retry
                                    </button>
                                </div>
                            </div>
                        ) : isLoading ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-gray-100">Loading structure graph...</div>
                            </div>
                        ) : !selectedOrgId ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-gray-400 mb-2">No organization selected</div>
                                    <div className="text-gray-500 text-sm">Please select an organization to view its structure</div>
                                </div>
                            </div>
                        ) : graphData.nodes.length === 0 ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-gray-400 mb-2">No structure data found</div>
                                    <div className="text-gray-500 text-sm">Add nodes and edges to visualize your organizational structure</div>
                                </div>
                            </div>
                        ) : (
                            <svg
                                ref={svgRef}
                                width={dimensions.width}
                                height={dimensions.height}
                                style={{ background: 'radial-gradient(circle at center, #1e293b 0%, #0f172a 100%)' }}
                            />
                        )}

                        {/* Edge Type Legend */}
                        {graphData.links.length > 0 && availableEdgeTypes.length > 0 && (
                            <div className="absolute top-4 left-4 bg-gray-900/95 backdrop-blur border border-gray-700 rounded-lg p-4 max-w-xs">
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-semibold text-gray-100">Edge Types</h3>
                                    <button
                                        onClick={() => setShowLegend(!showLegend)}
                                        className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                                    >
                                        {showLegend ? 'Hide' : 'Show'}
                                    </button>
                                </div>
                                {showLegend && (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between pb-2 border-b border-gray-700">
                                            <span className="text-xs text-gray-400">Show/Hide:</span>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => setVisibleEdgeTypes(new Set(availableEdgeTypes))}
                                                    className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors px-1"
                                                >
                                                    All
                                                </button>
                                                <span className="text-xs text-gray-600">|</span>
                                                <button
                                                    onClick={() => setVisibleEdgeTypes(new Set())}
                                                    className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors px-1"
                                                >
                                                    None
                                                </button>
                                            </div>
                                        </div>
                                        {availableEdgeTypes.map(edgeType => {
                                            const isVisible = visibleEdgeTypes.has(edgeType)
                                            const linkCount = graphData.links.filter(link => link.type === edgeType).length
                                            const edgeColor = getEdgeColor(edgeType)
                                            return (
                                                <div key={edgeType} className="flex items-center gap-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={isVisible}
                                                        onChange={(e) => {
                                                            const newVisibleTypes = new Set(visibleEdgeTypes)
                                                            if (e.target.checked) {
                                                                newVisibleTypes.add(edgeType)
                                                            } else {
                                                                newVisibleTypes.delete(edgeType)
                                                            }
                                                            setVisibleEdgeTypes(newVisibleTypes)
                                                        }}
                                                        className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-yellow-400 focus:ring-yellow-400 focus:ring-1"
                                                    />
                                                    <div className="flex items-center gap-2 flex-1">
                                                        <div
                                                            className={`w-8 h-0.5 ${isVisible ? 'opacity-100' : 'opacity-50'}`}
                                                            style={{ backgroundColor: edgeColor }}
                                                        ></div>
                                                        <span className={`text-xs ${isVisible ? 'text-gray-300' : 'text-gray-500'}`}>
                                                            {edgeType} ({linkCount})
                                                        </span>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                        {/* Node Types toggles */}
                                        {nodeTypeStats.length > 0 && (
                                            <div className="pt-3 mt-1 border-t border-gray-700">
                                                <div className="flex items-center justify-between pb-2">
                                                    <div className="text-xs font-semibold text-gray-300">Node Types</div>
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => setVisibleNodeTypes(new Set(nodeTypeStats.map(nt => nt.type)))}
                                                            className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors px-1"
                                                        >
                                                            All
                                                        </button>
                                                        <span className="text-xs text-gray-600">|</span>
                                                        <button
                                                            onClick={() => setVisibleNodeTypes(new Set())}
                                                            className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors px-1"
                                                        >
                                                            None
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    {nodeTypeStats.map(({ type, count }) => {
                                                        const color = NODE_COLORS[type as keyof typeof NODE_COLORS] || NODE_COLORS.default
                                                        const isVisible = visibleNodeTypes.has(type)
                                                        return (
                                                            <label key={type} className="flex items-center gap-2 cursor-pointer select-none">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isVisible}
                                                                    onChange={(e) => {
                                                                        const next = new Set(visibleNodeTypes)
                                                                        if (e.target.checked) next.add(type)
                                                                        else next.delete(type)
                                                                        setVisibleNodeTypes(next)
                                                                    }}
                                                                    className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-yellow-400 focus:ring-yellow-400 focus:ring-1"
                                                                />
                                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color, opacity: isVisible ? 1 : 0.5 }}></div>
                                                                <span className={`text-xs ${isVisible ? 'text-gray-300' : 'text-gray-500'} capitalize`}>{type.replaceAll('_', ' ')}</span>
                                                                <span className="text-[10px] text-gray-500">({count})</span>
                                                            </label>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        <div className="pt-2 border-t border-gray-700">
                                            <div className="text-xs text-gray-500">
                                                Visible: {
                                                    graphData.links.filter(l => {
                                                        const srcId = typeof l.source === 'string' ? l.source : l.source.id
                                                        const tgtId = typeof l.target === 'string' ? l.target : l.target.id
                                                        const src = nodeById.get(srcId)
                                                        const tgt = nodeById.get(tgtId)
                                                        return (
                                                            visibleEdgeTypes.has(l.type) &&
                                                            (!!src && visibleNodeTypes.has(src.type)) &&
                                                            (!!tgt && visibleNodeTypes.has(tgt.type))
                                                        )
                                                    }).length
                                                } / {graphData.links.length} edges
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Physics Control Panel */}
                        <div className="absolute top-4 right-4">
                            <div className="bg-gray-900/95 backdrop-blur border border-gray-700 rounded-lg">
                                <div className="flex items-center justify-between p-3 border-b border-gray-700">
                                    <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-2">
                                        <span>⚡</span>
                                        Physics Laws
                                    </h3>
                                    <button
                                        onClick={() => setShowPhysicsPanel(!showPhysicsPanel)}
                                        className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
                                    >
                                        {showPhysicsPanel ? 'Hide' : 'Show'}
                                    </button>
                                </div>
                                {showPhysicsPanel && (
                                    <div className="p-4 space-y-4 w-64">
                                        {/* Link Forces */}
                                        <div className="space-y-3">
                                            <h4 className="text-xs font-medium text-gray-300 border-b border-gray-700 pb-1">Link Forces</h4>
                                            <div className="space-y-2">
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-1">
                                                        Distance: {physicsParams.linkDistance}
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="20"
                                                        max="200"
                                                        value={physicsParams.linkDistance}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, linkDistance: parseInt(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-1">
                                                        Strength: {physicsParams.linkStrength.toFixed(2)}
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="1"
                                                        step="0.1"
                                                        value={physicsParams.linkStrength}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, linkStrength: parseFloat(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Charge Forces */}
                                        <div className="space-y-3">
                                            <h4 className="text-xs font-medium text-gray-300 border-b border-gray-700 pb-1">Repulsion Forces</h4>
                                            <div className="space-y-2">
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-1">
                                                        Strength: {physicsParams.chargeStrength}
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="-1000"
                                                        max="-10"
                                                        value={physicsParams.chargeStrength}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, chargeStrength: parseInt(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-1">
                                                        Max Distance: {physicsParams.chargeDistanceMax}
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="100"
                                                        max="1000"
                                                        value={physicsParams.chargeDistanceMax}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, chargeDistanceMax: parseInt(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Collision Forces */}
                                        <div className="space-y-3">
                                            <h4 className="text-xs font-medium text-gray-300 border-b border-gray-700 pb-1">Collision</h4>
                                            <div className="space-y-2">
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-1">
                                                        Radius: +{physicsParams.collisionRadius}px
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="20"
                                                        value={physicsParams.collisionRadius}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, collisionRadius: parseInt(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-1">
                                                        Strength: {physicsParams.collisionStrength.toFixed(2)}
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="1"
                                                        step="0.1"
                                                        value={physicsParams.collisionStrength}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, collisionStrength: parseFloat(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Center Force */}
                                        <div className="space-y-3">
                                            <h4 className="text-xs font-medium text-gray-300 border-b border-gray-700 pb-1">Centering</h4>
                                            <div>
                                                <label className="text-xs text-gray-400 block mb-1">
                                                    Strength: {physicsParams.centerStrength.toFixed(2)}
                                                </label>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.1"
                                                    value={physicsParams.centerStrength}
                                                    onChange={(e) => setPhysicsParams(prev => ({ ...prev, centerStrength: parseFloat(e.target.value) }))}
                                                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                />
                                            </div>
                                        </div>

                                        {/* Simulation Parameters */}
                                        <div className="space-y-3">
                                            <h4 className="text-xs font-medium text-gray-300 border-b border-gray-700 pb-1">Simulation</h4>
                                            <div className="space-y-2">
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-1">
                                                        Velocity Decay: {physicsParams.velocityDecay.toFixed(2)}
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max="1"
                                                        step="0.1"
                                                        value={physicsParams.velocityDecay}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, velocityDecay: parseFloat(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-gray-400 block mb-1">
                                                        Alpha Decay: {physicsParams.alphaDecay.toFixed(4)}
                                                    </label>
                                                    <input
                                                        type="range"
                                                        min="0.001"
                                                        max="0.1"
                                                        step="0.001"
                                                        value={physicsParams.alphaDecay}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, alphaDecay: parseFloat(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Reset Button */}
                                        <div className="pt-3 border-t border-gray-700 space-y-2">
                                            <div className="text-xs text-gray-400 mb-2">Presets:</div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => setPhysicsParams({
                                                        linkDistance: 60,
                                                        linkStrength: 0.5,
                                                        chargeStrength: -150,
                                                        chargeDistanceMax: 200,
                                                        collisionRadius: 1,
                                                        collisionStrength: 0.9,
                                                        centerStrength: 0.2,
                                                        velocityDecay: 0.3,
                                                        alphaDecay: 0.03,
                                                        alphaMin: 0.001
                                                    })}
                                                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white py-1.5 px-2 rounded transition-colors"
                                                >
                                                    Tight
                                                </button>
                                                <button
                                                    onClick={() => setPhysicsParams({
                                                        linkDistance: 120,
                                                        linkStrength: 0.2,
                                                        chargeStrength: -300,
                                                        chargeDistanceMax: 400,
                                                        collisionRadius: 4,
                                                        collisionStrength: 0.6,
                                                        centerStrength: 0.05,
                                                        velocityDecay: 0.6,
                                                        alphaDecay: 0.01,
                                                        alphaMin: 0.001
                                                    })}
                                                    className="text-xs bg-green-600 hover:bg-green-700 text-white py-1.5 px-2 rounded transition-colors"
                                                >
                                                    Loose
                                                </button>
                                                <button
                                                    onClick={() => setPhysicsParams({
                                                        linkDistance: 90,
                                                        linkStrength: 0.8,
                                                        chargeStrength: -100,
                                                        chargeDistanceMax: 250,
                                                        collisionRadius: 1,
                                                        collisionStrength: 1.0,
                                                        centerStrength: 0.3,
                                                        velocityDecay: 0.2,
                                                        alphaDecay: 0.05,
                                                        alphaMin: 0.001
                                                    })}
                                                    className="text-xs bg-purple-600 hover:bg-purple-700 text-white py-1.5 px-2 rounded transition-colors"
                                                >
                                                    Rigid
                                                </button>
                                                <button
                                                    onClick={() => setPhysicsParams({
                                                        linkDistance: 80,
                                                        linkStrength: 0.3,
                                                        chargeStrength: -200,
                                                        chargeDistanceMax: 300,
                                                        collisionRadius: 2,
                                                        collisionStrength: 0.8,
                                                        centerStrength: 0.1,
                                                        velocityDecay: 0.4,
                                                        alphaDecay: 0.0228,
                                                        alphaMin: 0.001
                                                    })}
                                                    className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white py-1.5 px-2 rounded transition-colors"
                                                >
                                                    Default
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Side panel removed */}
                </div>
            </main>
        </div>
    )
}