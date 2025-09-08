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

interface ProcessStepData {
    id: string
    name: string
    description?: string
    parent_step_id?: string
    metadata?: any
}

interface ProcessFlowEdgeData {
    id: string
    from_step_id: string
    to_step_id: string
    edge_type_id: string
    metadata?: any
    edge_type: {
        name: string
        color: string
        pattern: string
        icon: string
        description: string
    }
}

interface ProcessStep extends d3.SimulationNodeDatum {
    id: string
    name: string
    description?: string
    parent_step_id?: string
    children: ProcessStep[]
    level: number
    flowLevel?: number
    shape: 'circle' | 'rectangle'
    size: number
    color: string
    data: ProcessStepData
}

interface ProcessFlowEdge extends d3.SimulationLinkDatum<ProcessStep> {
    source: string | ProcessStep
    target: string | ProcessStep
    type: string
    color: string
    pattern: string
    icon: string
    data: ProcessFlowEdgeData
}

interface ProcessFlowData {
    steps: ProcessStep[]
    edges: ProcessFlowEdge[]
}

// Process step colors based on hierarchy level
const STEP_COLORS = {
    level0: '#8b5cf6', // purple-500 - top level
    level1: '#3b82f6', // blue-500 - sub processes
    level2: '#10b981', // emerald-500 - sub-sub processes
    level3: '#f59e0b', // amber-500 - deeper levels
    default: '#6b7280', // gray-500 - fallback
}

// Get step color based on hierarchy level
function getStepColor(level: number): string {
    switch (level) {
        case 0: return STEP_COLORS.level0
        case 1: return STEP_COLORS.level1
        case 2: return STEP_COLORS.level2
        case 3: return STEP_COLORS.level3
        default: return STEP_COLORS.default
    }
}

// Get step shape and size based on children - Obsidian style
function getStepVisual(step: ProcessStep): { shape: 'circle' | 'rectangle', size: number } {
    const hasChildren = step.children.length > 0
    return {
        shape: 'circle', // Obsidian-style: All nodes are circles
        size: hasChildren ? 16 : 12 // Slightly larger for nodes with children, but all circles
    }
}

// Calculate hierarchical positions for nested layout
function calculateHierarchicalPositions(steps: ProcessStep[], width: number, height: number) {
    const rootSteps = steps.filter(step => !step.parent_step_id)
    const padding = 150 // Increased padding for more edge space

    // Position root steps in a more spaced out grid with larger cells
    const cols = Math.min(2, Math.ceil(Math.sqrt(rootSteps.length))) // Reduced max columns for wider spread
    const rows = Math.ceil(rootSteps.length / cols)
    const cellWidth = (width - padding * 2) / cols
    const cellHeight = (height - padding * 2) / rows

    // Add extra spacing between cells
    const extraSpacing = 100
    const actualCellWidth = cellWidth + extraSpacing
    const actualCellHeight = cellHeight + extraSpacing

    rootSteps.forEach((rootStep, index) => {
        const col = index % cols
        const row = Math.floor(index / cols)

        // Position root step with much more spacing
        rootStep.x = padding + col * actualCellWidth + actualCellWidth / 2
        rootStep.y = padding + row * actualCellHeight + actualCellHeight / 2

        // Position children within the parent rectangle
        positionChildrenInParent(rootStep)
    })
}

function positionChildrenInParent(parentStep: ProcessStep) {
    if (parentStep.children.length === 0) return

    const parentSize = parentStep.size
    const containerWidth = parentSize * 1.4 // Available width within parent
    const containerHeight = parentSize * 0.6 // Available height within parent

    // Sort children by name for consistent ordering
    const sortedChildren = [...parentStep.children].sort((a, b) => a.name.localeCompare(b.name))

    if (sortedChildren.length === 1) {
        // Single child goes in center
        sortedChildren[0].x = parentStep.x!
        sortedChildren[0].y = parentStep.y! + 10 // Slightly below center
    } else {
        // Multiple children arranged horizontally with equal spacing
        const totalSpacing = containerWidth * 0.8 // Use 80% of available width
        const childSpacing = totalSpacing / (sortedChildren.length - 1)
        const startX = parentStep.x! - totalSpacing / 2

        sortedChildren.forEach((child, index) => {
            child.x = startX + (index * childSpacing)
            child.y = parentStep.y! + 10 // Slightly below parent center
        })
    }

    // Recursively position grandchildren
    sortedChildren.forEach(child => positionChildrenInParent(child))
}

export default function ProcessFlowPage() {
    const { user, loading } = useAuth()
    const { selectedOrgId } = useOrg()
    const router = useRouter()
    const svgRef = useRef<SVGSVGElement>(null)
    const simulationRef = useRef<d3.Simulation<ProcessStep, ProcessFlowEdge> | null>(null)
    const [processFlowData, setProcessFlowData] = useState<ProcessFlowData>({ steps: [], edges: [] })
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
    const [availableEdgeTypes, setAvailableEdgeTypes] = useState<string[]>([])
    const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(new Set())
    const [selectedEdgeIds, setSelectedEdgeIds] = useState<Set<string>>(new Set())
    const [showLegend, setShowLegend] = useState(true)
    // Removed layoutStartStepId for pure Obsidian-style physics

    // Physics control states - Obsidian-style parameters
    const [showPhysicsPanel, setShowPhysicsPanel] = useState(false)
    const [physicsParams, setPhysicsParams] = useState({
        linkDistance: 80,         // Closer connections for organic clustering
        linkStrength: 0.7,        // Stronger connections to form natural groups
        chargeStrength: -200,     // Moderate repulsion for organic spread
        chargeDistanceMax: 300,   // Localized repulsion zones
        collisionRadius: 8,       // Minimal collision for natural overlap
        collisionStrength: 0.6,   // Softer collision boundaries
        centerStrength: 0.02,     // Very weak center pull for organic distribution
        velocityDecay: 0.4,       // Standard physics damping
        alphaDecay: 0.0228,       // Standard settling time
        alphaMin: 0.001
    })

    // Refs to D3 selections for incremental updates
    const zoomRef = useRef<any>(null)
    const currentTransformRef = useRef<any>(null)
    const edgeSelRef = useRef<Selection<SVGLineElement, ProcessFlowEdge, SVGGElement, unknown> | null>(null)
    const stepSelRef = useRef<Selection<SVGGElement, ProcessStep, SVGGElement, unknown> | null>(null)

    // Fetch process flow data from Supabase
    const fetchProcessFlowData = useCallback(async () => {
        if (!selectedOrgId) return

        setIsLoading(true)
        setError(null)

        try {
            // Fetch process steps
            const { data: stepsData, error: stepsError } = await supabase
                .from('process_step')
                .select('*')
                .eq('organisation_id', selectedOrgId)

            if (stepsError) throw stepsError

            // Fetch process flow edges with edge types
            const { data: edgesData, error: edgesError } = await supabase
                .from('process_flow_edge')
                .select(`
                    id,
                    from_step_id,
                    to_step_id,
                    edge_type_id,
                    metadata,
                    edge_type:edge_type_id(name, color, pattern, icon, description)
                `)
                .eq('organisation_id', selectedOrgId)

            if (edgesError) throw edgesError

            if (!stepsData || stepsData.length === 0) {
                setProcessFlowData({ steps: [], edges: [] })
                return
            }

            // Build hierarchy: map steps and find their children
            const stepMap = new Map<string, ProcessStep>()
            const rootSteps: ProcessStep[] = []

            // First pass: create all steps
            stepsData.forEach((stepData: ProcessStepData) => {
                const step: ProcessStep = {
                    id: stepData.id,
                    name: stepData.name,
                    description: stepData.description,
                    parent_step_id: stepData.parent_step_id,
                    children: [],
                    level: 0, // Will be calculated
                    shape: 'circle', // Will be updated based on children
                    size: 15,
                    color: STEP_COLORS.level0,
                    data: stepData
                }
                stepMap.set(stepData.id, step)

                if (!stepData.parent_step_id) {
                    rootSteps.push(step)
                }
            })

            // Second pass: build parent-child relationships and calculate levels
            const calculateLevel = (step: ProcessStep, currentLevel: number = 0) => {
                step.level = currentLevel
                step.color = getStepColor(currentLevel)

                // Find children
                stepsData.forEach((stepData: ProcessStepData) => {
                    if (stepData.parent_step_id === step.id) {
                        const child = stepMap.get(stepData.id)
                        if (child) {
                            step.children.push(child)
                            calculateLevel(child, currentLevel + 1)
                        }
                    }
                })

                // Update visual properties based on children
                const visual = getStepVisual(step)
                step.shape = visual.shape
                step.size = visual.size
            }

            rootSteps.forEach(step => calculateLevel(step))

            // Create flat array of all steps
            const allSteps = Array.from(stepMap.values())

            // Create edges (map to node objects since physics is disabled)
            const edges: ProcessFlowEdge[] = (edgesData || [])
                .filter((edge: any) => edge.from_step_id && edge.to_step_id)
                .map((edge: any) => {
                    const sourceNode = stepMap.get(edge.from_step_id)
                    const targetNode = stepMap.get(edge.to_step_id)
                    if (!sourceNode || !targetNode) return null
                    return {
                        source: sourceNode,
                        target: targetNode,
                        type: edge.edge_type?.name || 'Sequential',
                        color: edge.edge_type?.color || '#3b82f6',
                        pattern: edge.edge_type?.pattern || 'solid',
                        icon: edge.edge_type?.icon || '→',
                        data: edge
                    } as ProcessFlowEdge
                })
                .filter((e: any): e is ProcessFlowEdge => e !== null)

            setProcessFlowData({ steps: allSteps, edges })

            // Collect available edge types and initialize visibility
            const edgeTypes = [...new Set(edges.map(edge => edge.type))]
            setAvailableEdgeTypes(edgeTypes)
            setVisibleEdgeTypes(prev => (prev.size === 0 ? new Set(edgeTypes) : prev))

            // Compute flow-based levels (first step on the left, others to the right)
            // Start nodes: those with no incoming edges
            const incomingCount = new Map<string, number>()
            allSteps.forEach(s => incomingCount.set(s.id, 0))
            edges.forEach(e => {
                const t = (e.target as ProcessStep).id
                incomingCount.set(t, (incomingCount.get(t) || 0) + 1)
            })
            const queue: ProcessStep[] = []
            allSteps.forEach(s => {
                (s as any).flowLevel = undefined
                if ((incomingCount.get(s.id) || 0) === 0) {
                    s.flowLevel = 0
                    queue.push(s)
                }
            })
            // BFS layering
            const adj = new Map<string, ProcessStep[]>()
            allSteps.forEach(s => adj.set(s.id, []))
            edges.forEach(e => {
                const s = e.source as ProcessStep
                const t = e.target as ProcessStep
                adj.get(s.id)!.push(t)
            })
            while (queue.length) {
                const u = queue.shift()!
                const nextL = (u.flowLevel || 0) + 1
                for (const v of adj.get(u.id) || []) {
                    if (v.flowLevel == null || nextL > v.flowLevel) {
                        v.flowLevel = nextL
                        queue.push(v)
                    }
                }
            }

        } catch (error) {
            console.error('Error fetching process flow data:', error)
            setError(error instanceof Error ? error.message : 'An error occurred')
        } finally {
            setIsLoading(false)
        }
    }, [selectedOrgId])

    // Handle window resize
    useEffect(() => {
        const handleResize = () => {
            setDimensions({
                width: window.innerWidth,
                height: window.innerHeight - 60 // Account for navbar
            })
        }

        handleResize()
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    // Initialize and update D3 visualization
    useEffect(() => {
        if (!svgRef.current || processFlowData.steps.length === 0) return

        const svg = d3Select(svgRef.current)
        const { width, height } = dimensions

        // Clear previous content
        svg.selectAll('*').remove()

        // Setup zoom behavior
        const zoom = d3Zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                container.attr('transform', event.transform)
                currentTransformRef.current = event.transform
            })

        svg.call(zoom as any)
        zoomRef.current = zoom

        // Create main container
        const container = svg.append('g')

        // Filter visible edges
        const filteredEdges = processFlowData.edges.filter(edge => visibleEdgeTypes.has(edge.type))

        // Obsidian-style: Random initial positions for organic clustering
        processFlowData.steps.forEach(step => {
            // Random positions within the viewport for natural physics settling
            step.x = Math.random() * (width - 200) + 100
            step.y = Math.random() * (height - 200) + 100
        })

        // Single-start flow levels to avoid many roots on the left
        const stepById = new Map(processFlowData.steps.map(s => [s.id, s] as const))
        const allEdges = processFlowData.edges // use all edges for stable layout
        const outAdj = new Map<string, ProcessStep[]>()
        const indeg = new Map<string, number>()
        processFlowData.steps.forEach(s => { outAdj.set(s.id, []); indeg.set(s.id, 0) })
        allEdges.forEach(e => {
            const s = e.source as ProcessStep
            const t = e.target as ProcessStep
            if (s && t) {
                outAdj.get(s.id)!.push(t)
                indeg.set(t.id, (indeg.get(t.id) || 0) + 1)
            }
        })
        // Obsidian-style: Remove all flow level computation for pure physics
        // Just need the basic adjacency structure for edge processing

        // Stop any prior simulation
        if (simulationRef.current) {
            simulationRef.current.stop()
            simulationRef.current = null
        }

        // Detect bidirectional edges and add offset information
        const edgeMap = new Map<string, ProcessFlowEdge[]>()
        filteredEdges.forEach(edge => {
            const sourceId = edge.data.from_step_id
            const targetId = edge.data.to_step_id
            const key = sourceId < targetId ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`
            if (!edgeMap.has(key)) edgeMap.set(key, [])
            edgeMap.get(key)!.push(edge)
        })

        // Add bidirectional offset information to edges
        const edgesWithOffset = filteredEdges.map(edge => {
            const sourceId = edge.data.from_step_id
            const targetId = edge.data.to_step_id
            const key = sourceId < targetId ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`
            const edgeGroup = edgeMap.get(key)!

            let offset = 0
            let isBidirectional = false

            if (edgeGroup.length > 1) {
                isBidirectional = true
                // Find which direction this edge is
                const isForward = sourceId < targetId
                if (isForward) {
                    offset = -10 // offset one way
                } else {
                    offset = 10 // offset the other way
                }
            }

            return { ...edge, offset, isBidirectional }
        })

        // Split edges: inter-container (under) vs intra-container (over) for better visibility
        const interEdges = edgesWithOffset.filter(e => {
            const s = e.source as ProcessStep
            const t = e.target as ProcessStep
            const sameParent = !!(s.parent_step_id && s.parent_step_id === t.parent_step_id)
            const parentChild = s.id === t.parent_step_id || t.id === s.parent_step_id
            return !(sameParent || parentChild)
        })
        const intraEdges = edgesWithOffset.filter(e => {
            const s = e.source as ProcessStep
            const t = e.target as ProcessStep
            const sameParent = !!(s.parent_step_id && s.parent_step_id === t.parent_step_id)
            const parentChild = s.id === t.parent_step_id || t.id === s.parent_step_id
            return (sameParent || parentChild)
        })

        // Inter-container edges (rendered under nodes)
        const edgesUnder = container.append('g')
            .attr('class', 'edges-under')
            .selectAll('line')
            .data(interEdges)
            .enter().append('line')
            .attr('stroke', (d: any) => d.color)
            .attr('stroke-opacity', 0.95)
            .attr('stroke-width', (d: any) => {
                const baseWidth = selectedEdgeIds.has(d.data.id) ? 3.2 : 2.6
                return d.isBidirectional ? baseWidth + 0.5 : baseWidth // Slightly thicker for bidirectional
            })
            .attr('stroke-dasharray', (d: any) => {
                if (d.isBidirectional) {
                    // Special pattern for bidirectional edges
                    return '6,2,2,2'
                }
                switch (d.pattern) {
                    case 'dashed': return '8,4'
                    case 'dotted': return '2,3'
                    default: return null
                }
            })
            .attr('marker-end', 'url(#arrowhead)')
            .style('cursor', 'pointer')
            .on('click', function (event, d) {
                event.stopPropagation()
                const next = new Set(selectedEdgeIds)
                if (next.has(d.data.id)) next.delete(d.data.id)
                else next.add(d.data.id)
                setSelectedEdgeIds(next)
            })

        // Intra-container edges (rendered over nodes so they aren't hidden by containers)
        const edgesOver = container.append('g')
            .attr('class', 'edges-over')
            .selectAll('line')
            .data(intraEdges)
            .enter().append('line')
            .attr('stroke', (d: any) => d.color)
            .attr('stroke-opacity', 1)
            .attr('stroke-width', (d: any) => {
                const baseWidth = selectedEdgeIds.has(d.data.id) ? 3.2 : 2.8
                return d.isBidirectional ? baseWidth + 0.5 : baseWidth // Slightly thicker for bidirectional
            })
            .attr('stroke-dasharray', (d: any) => {
                if (d.isBidirectional) {
                    // Special pattern for bidirectional edges
                    return '6,2,2,2'
                }
                switch (d.pattern) {
                    case 'dashed': return '8,4'
                    case 'dotted': return '2,3'
                    default: return null
                }
            })
            .attr('marker-end', 'url(#arrowhead)')
            .style('cursor', 'pointer')
            .on('click', function (event, d) {
                event.stopPropagation()
                const next = new Set(selectedEdgeIds)
                if (next.has(d.data.id)) next.delete(d.data.id)
                else next.add(d.data.id)
                setSelectedEdgeIds(next)
            })

        // Add arrowhead marker
        const defs = svg.append('defs')
        defs.append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 8)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#e5e7eb')

        // Cache edge selection (unused in static mode)
        edgeSelRef.current = null

        // Create step groups with dragging integrated with physics
        const stepGroups = container.append('g')
            .attr('class', 'steps')
            .selectAll('g')
            .data(processFlowData.steps)
            .enter().append('g')
            .attr('class', 'step')
            .style('cursor', 'pointer')
            .call(d3Drag<SVGGElement, ProcessStep>()
                .on('start', function (event, d) {
                    if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.3).restart()
                    // Fix during drag
                    d.fx = d.x
                    d.fy = d.y
                })
                .on('drag', function (event, d) {
                    if (d.parent_step_id) {
                        // Child node - constrain within parent while dragging
                        const parent = processFlowData.steps.find(s => s.id === d.parent_step_id)
                        if (parent && parent.x !== undefined && parent.y !== undefined) {
                            const containerWidth = parent.size * 2.0
                            const containerHeight = parent.size * 0.8
                            const maxX = parent.x + containerWidth / 2 - 15
                            const minX = parent.x - containerWidth / 2 + 15
                            const maxY = parent.y + containerHeight / 2
                            const minY = parent.y - 5
                            d.fx = Math.max(minX, Math.min(maxX, event.x))
                            d.fy = Math.max(minY, Math.min(maxY, event.y))
                        } else {
                            d.fx = event.x
                            d.fy = event.y
                        }
                    } else {
                        // Parent node - move freely
                        d.fx = event.x
                        d.fy = event.y
                    }
                })
                .on('end', function (event, d) {
                    if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0)
                    // Release after drag
                    d.fx = null
                    d.fy = null
                })
            )

        // Add shapes to step groups
        stepGroups.each(function (d) {
            const group = d3Select(this)

            if (d.shape === 'rectangle') {
                // Rectangle container for parent processes - cleaner design
                const rectWidth = d.size * 2.2
                const rectHeight = d.size * 1.2

                // Main container with solid border
                group.append('rect')
                    .attr('width', rectWidth)
                    .attr('height', rectHeight)
                    .attr('x', -rectWidth / 2)
                    .attr('y', -rectHeight / 2)
                    .attr('fill', 'rgba(139, 92, 246, 0.05)') // Very light background
                    .attr('stroke', d.color)
                    .attr('stroke-width', 2)
                    .attr('rx', 12)
                    .style('filter', 'drop-shadow(0 2px 8px rgba(139, 92, 246, 0.15))')

                // Clean title area
                group.append('rect')
                    .attr('width', rectWidth - 4)
                    .attr('height', 20)
                    .attr('x', -rectWidth / 2 + 2)
                    .attr('y', -rectHeight / 2 + 2)
                    .attr('fill', d.color)
                    .attr('rx', 6)

                // Title text
                group.append('text')
                    .text(d.name)
                    .attr('x', 0)
                    .attr('y', -rectHeight / 2 + 15)
                    .attr('text-anchor', 'middle')
                    .attr('font-family', 'Inter, sans-serif')
                    .attr('font-size', '11px')
                    .attr('fill', '#ffffff')
                    .attr('font-weight', '600')
                    .style('pointer-events', 'none')
                    .style('user-select', 'none')

                // Entry connector (left side)
                group.append('circle')
                    .attr('cx', -rectWidth / 2)
                    .attr('cy', 0)
                    .attr('r', 3)
                    .attr('fill', d.color)
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 2)

                // Exit connector (right side)
                group.append('circle')
                    .attr('cx', rectWidth / 2)
                    .attr('cy', 0)
                    .attr('r', 3)
                    .attr('fill', d.color)
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 2)

            } else {
                // Clean circles for leaf processes
                group.append('circle')
                    .attr('r', d.size)
                    .attr('fill', d.color)
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 2)
                    .style('filter', 'drop-shadow(0 2px 4px rgba(139, 92, 246, 0.3))')

                // Entry connector (left side)
                group.append('circle')
                    .attr('cx', -d.size)
                    .attr('cy', 0)
                    .attr('r', 3)
                    .attr('fill', d.color)
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 2)

                // Exit connector (right side)
                group.append('circle')
                    .attr('cx', d.size)
                    .attr('cy', 0)
                    .attr('r', 3)
                    .attr('fill', d.color)
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 2)

                // Process step label - positioned below the circle
                group.append('text')
                    .text(d.name)
                    .attr('x', 0)
                    .attr('y', d.size + 14)
                    .attr('text-anchor', 'middle')
                    .attr('font-family', 'Inter, sans-serif')
                    .attr('font-size', '9px')
                    .attr('fill', '#e5e7eb')
                    .attr('font-weight', '500')
                    .style('pointer-events', 'none')
                    .style('user-select', 'none')
            }
        })

        // Cache step selection
        stepSelRef.current = stepGroups as unknown as Selection<SVGGElement, ProcessStep, SVGGElement, unknown>

            // Ensure edges-over group renders above nodes
            ; (edgesOver as any).raise()

        // Function to update positions (used by physics tick and drags)
        const updatePositions = () => {
            const updateEdgeSel = (sel: any) => sel
                .attr('x1', (d: any) => {
                    const source = d.source as ProcessStep
                    const target = d.target as ProcessStep

                    // Calculate direction vector
                    const dx = (target.x ?? 0) - (source.x ?? 0)
                    const dy = (target.y ?? 0) - (source.y ?? 0)
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    if (dist === 0) return source.x ?? 0

                    // Obsidian-style: Simple circle-to-circle connections
                    const radius = source.size * 0.9
                    let x1 = (source.x ?? 0) + (dx / dist) * radius

                    // Apply perpendicular offset for bidirectional edges
                    if (d.offset) {
                        const perpX = -dy / dist
                        x1 += perpX * d.offset
                    }
                    return x1
                })
                .attr('y1', (d: any) => {
                    const source = d.source as ProcessStep
                    const target = d.target as ProcessStep

                    // Calculate direction vector
                    const dx = (target.x ?? 0) - (source.x ?? 0)
                    const dy = (target.y ?? 0) - (source.y ?? 0)
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    if (dist === 0) return source.y ?? 0

                    // Obsidian-style: Simple circle-to-circle connections
                    const radius = source.size * 0.9
                    let y1 = (source.y ?? 0) + (dy / dist) * radius

                    // Apply perpendicular offset for bidirectional edges
                    if (d.offset) {
                        const perpY = dx / dist
                        y1 += perpY * d.offset
                    }
                    return y1
                })
                .attr('x2', (d: any) => {
                    const source = d.source as ProcessStep
                    const target = d.target as ProcessStep

                    // Calculate direction vector (from source to target)
                    const dx = (target.x ?? 0) - (source.x ?? 0)
                    const dy = (target.y ?? 0) - (source.y ?? 0)
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    if (dist === 0) return target.x ?? 0

                    // Obsidian-style: Simple circle-to-circle connections
                    const radius = target.size * 0.9
                    let x2 = (target.x ?? 0) - (dx / dist) * radius

                    // Apply perpendicular offset for bidirectional edges
                    if (d.offset) {
                        const perpX = -dy / dist
                        x2 += perpX * d.offset
                    }
                    return x2
                })
                .attr('y2', (d: any) => {
                    const source = d.source as ProcessStep
                    const target = d.target as ProcessStep

                    // Calculate direction vector (from source to target)
                    const dx = (target.x ?? 0) - (source.x ?? 0)
                    const dy = (target.y ?? 0) - (source.y ?? 0)
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    if (dist === 0) return target.y ?? 0

                    // Obsidian-style: Simple circle-to-circle connections
                    const radius = target.size * 0.9
                    let y2 = (target.y ?? 0) - (dy / dist) * radius

                    // Apply perpendicular offset for bidirectional edges
                    if (d.offset) {
                        const perpY = dx / dist
                        y2 += perpY * d.offset
                    }
                    return y2
                })

            updateEdgeSel(edgesUnder)
            updateEdgeSel(edgesOver)

            stepGroups
                .attr('transform', d => `translate(${d.x},${d.y})`)
        }

        // Constraint: keep children within parent rectangles during simulation
        const idMap = new Map(processFlowData.steps.map(s => [s.id, s] as const))
        const enforceChildBounds = () => {
            // Obsidian-style: No hierarchical constraints, let physics work naturally
            // Comment out child bounds enforcement for organic clustering
            /*
            processFlowData.steps.forEach(d => {
                if (d.parent_step_id) {
                    const parent = idMap.get(d.parent_step_id)
                    if (!parent || parent.x === undefined || parent.y === undefined) return
                    const containerWidth = parent.size * 2.0
                    const containerHeight = parent.size * 0.8
                    const maxX = parent.x + containerWidth / 2 - 15
                    const minX = parent.x - containerWidth / 2 + 15
                    const maxY = parent.y + containerHeight / 2
                    const minY = parent.y - 5
                    d.x = Math.max(minX, Math.min(maxX, d.x ?? parent.x))
                    d.y = Math.max(minY, Math.min(maxY, d.y ?? parent.y))
                }
            })
            */
        }

        // Create physics simulation
        const sim = d3.forceSimulation<ProcessStep>(processFlowData.steps)
            .force('link', d3.forceLink<ProcessStep, ProcessFlowEdge>(filteredEdges as any)
                .id((n: any) => n.id)
                .distance(physicsParams.linkDistance)
                .strength(physicsParams.linkStrength)
            )
            .force('charge', d3.forceManyBody().strength(physicsParams.chargeStrength).distanceMax(physicsParams.chargeDistanceMax))
            .force('collide', d3.forceCollide<ProcessStep>().radius(d => {
                // Obsidian-style: minimal collision for natural clustering
                const baseRadius = d.shape === 'rectangle' ? d.size * 0.8 : d.size * 1.1
                return baseRadius + physicsParams.collisionRadius
            }).strength(physicsParams.collisionStrength))
            .force('center', d3.forceCenter(width / 2, height / 2).strength(physicsParams.centerStrength))
            .velocityDecay(physicsParams.velocityDecay)
            .alphaDecay(physicsParams.alphaDecay)
            .alphaMin(physicsParams.alphaMin)
            .on('tick', () => {
                enforceChildBounds()
                updatePositions()
            })

        simulationRef.current = sim

        // Kick it off
        sim.alpha(1).restart()
    }, [processFlowData, dimensions, visibleEdgeTypes, selectedEdgeIds])

    // No physics simulation to update

    useEffect(() => {
        if (user && selectedOrgId) {
            fetchProcessFlowData()
        }
    }, [user, selectedOrgId, fetchProcessFlowData])

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <div className="text-lg text-gray-100">Loading...</div>
            </div>
        )
    }

    if (!user) {
        router.push('/login')
        return null
    }

    if (!selectedOrgId) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-950">
                <div className="text-center">
                    <div className="text-gray-400 mb-2">No organization selected</div>
                    <div className="text-gray-500 text-sm">Please select an organization to view process flows</div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-950 text-gray-100">
            {/* Navigation */}
            <nav className="bg-gray-900/60 backdrop-blur border-b border-gray-800">
                <div className="w-full px-4">
                    <div className="flex items-center justify-between h-14">
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={() => router.push('/home')}
                                className="text-yellow-400 hover:text-yellow-300 transition-colors text-sm font-medium"
                            >
                                ⚡ Minnal
                            </button>
                        </div>
                        <div className="flex items-center space-x-4">
                            <button
                                onClick={fetchProcessFlowData}
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
                    {/* Process Flow Container */}
                    <div className="flex-1 relative bg-gray-950 overflow-hidden">
                        {error ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-red-400 mb-2">Error loading process flow data</div>
                                    <div className="text-gray-400 text-sm">{error}</div>
                                    <button
                                        onClick={fetchProcessFlowData}
                                        className="mt-4 bg-yellow-400 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded text-sm"
                                    >
                                        Retry
                                    </button>
                                </div>
                            </div>
                        ) : isLoading ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-gray-100">Loading process flow...</div>
                            </div>
                        ) : processFlowData.steps.length === 0 ? (
                            <div className="h-full flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-gray-400 mb-2">No process flow data found</div>
                                    <div className="text-gray-500 text-sm">Add process steps to visualize your workflow</div>
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
                        {processFlowData.edges.length > 0 && availableEdgeTypes.length > 0 && (
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
                                            const edgeCount = processFlowData.edges.filter(edge => edge.type === edgeType).length
                                            const sampleEdge = processFlowData.edges.find(edge => edge.type === edgeType)
                                            const edgeColor = sampleEdge?.color || '#3b82f6'
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
                                                            {edgeType} ({edgeCount})
                                                        </span>
                                                    </div>
                                                </div>
                                            )
                                        })}

                                        {/* Bidirectional edges info */}
                                        <div className="pt-2 border-t border-gray-700">
                                            <div className="flex items-center gap-2">
                                                <div
                                                    className="w-8 h-0.5 bg-gray-400"
                                                    style={{
                                                        background: 'repeating-linear-gradient(to right, #9ca3af 0px, #9ca3af 6px, transparent 6px, transparent 8px, #9ca3af 8px, #9ca3af 10px, transparent 10px, transparent 12px)'
                                                    }}
                                                ></div>
                                                <span className="text-xs text-gray-400">
                                                    Bidirectional (offset)
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Obsidian-style: No layout controls needed, pure physics */}
                    </div>
                </div>
            </main>
        </div>
    )
}

