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

// Get step shape and size based on children
function getStepVisual(step: ProcessStep): { shape: 'circle' | 'rectangle', size: number } {
    const hasChildren = step.children.length > 0
    return {
        shape: hasChildren ? 'rectangle' : 'circle',
        size: hasChildren ? 80 + (step.children.length * 20) : 12
    }
}

// Calculate hierarchical positions for nested layout
function calculateHierarchicalPositions(steps: ProcessStep[], width: number, height: number) {
    const rootSteps = steps.filter(step => !step.parent_step_id)
    const padding = 100
    
    // Position root steps in a more spaced out grid
    const cols = Math.min(3, Math.ceil(Math.sqrt(rootSteps.length)))
    const rows = Math.ceil(rootSteps.length / cols)
    const cellWidth = (width - padding * 2) / cols
    const cellHeight = (height - padding * 2) / rows
    
    rootSteps.forEach((rootStep, index) => {
        const col = index % cols
        const row = Math.floor(index / cols)
        
        // Position root step with more spacing
        rootStep.x = padding + col * cellWidth + cellWidth / 2
        rootStep.y = padding + row * cellHeight + cellHeight / 2
        
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
    const [layoutStartStepId, setLayoutStartStepId] = useState<string | null>(null)
    
    // Physics control states
    const [showPhysicsPanel, setShowPhysicsPanel] = useState(false)
    const [physicsParams, setPhysicsParams] = useState({
        linkDistance: 100,
        linkStrength: 0.4,
        chargeStrength: -300,
        chargeDistanceMax: 400,
        collisionRadius: 5,
        collisionStrength: 0.9,
        centerStrength: 0.1,
        velocityDecay: 0.4,
        alphaDecay: 0.0228,
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

        // Calculate initial hierarchical positions (used as simulation starting points)
        calculateHierarchicalPositions(processFlowData.steps, width, height)

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
        const candidates = processFlowData.steps.filter(s => (indeg.get(s.id) || 0) === 0)
        candidates.sort((a, b) => (outAdj.get(b.id)!.length - outAdj.get(a.id)!.length))
        const defaultStart = (candidates[0]?.id) || processFlowData.steps[0].id
        const startId = layoutStartStepId ?? defaultStart
        if (!layoutStartStepId) setLayoutStartStepId(startId)

        // BFS from selected start; push non-reachable to one column after the deepest
        processFlowData.steps.forEach(s => { s.flowLevel = undefined })
        const q: ProcessStep[] = []
        const start = stepById.get(startId)
        if (start) { start.flowLevel = 0; q.push(start) }
        while (q.length) {
            const u = q.shift()!
            const nextL = (u.flowLevel || 0) + 1
            for (const v of outAdj.get(u.id) || []) {
                if (v.flowLevel == null || nextL > v.flowLevel) {
                    v.flowLevel = nextL
                    q.push(v)
                }
            }
        }
        const maxAssigned = Math.max(0, ...processFlowData.steps.map(s => s.flowLevel ?? 0))
        processFlowData.steps.forEach(s => { if (s.flowLevel == null) s.flowLevel = maxAssigned + 1 })

        // Stop any prior simulation
        if (simulationRef.current) {
            simulationRef.current.stop()
            simulationRef.current = null
        }

        // Split edges: inter-container (under) vs intra-container (over) for better visibility
        const interEdges = filteredEdges.filter(e => {
            const s = e.source as ProcessStep
            const t = e.target as ProcessStep
            const sameParent = !!(s.parent_step_id && s.parent_step_id === t.parent_step_id)
            const parentChild = s.id === t.parent_step_id || t.id === s.parent_step_id
            return !(sameParent || parentChild)
        })
        const intraEdges = filteredEdges.filter(e => {
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
            .attr('stroke', (d: ProcessFlowEdge) => d.color)
            .attr('stroke-opacity', 0.95)
            .attr('stroke-width', (d: ProcessFlowEdge) => selectedEdgeIds.has(d.data.id) ? 3.2 : 2.6)
            .attr('stroke-dasharray', (d: ProcessFlowEdge) => {
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
            .attr('stroke', (d: ProcessFlowEdge) => d.color)
            .attr('stroke-opacity', 1)
            .attr('stroke-width', (d: ProcessFlowEdge) => selectedEdgeIds.has(d.data.id) ? 3.2 : 2.8)
            .attr('stroke-dasharray', (d: ProcessFlowEdge) => {
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
                .on('start', function(event, d) {
                    if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.3).restart()
                    // Fix during drag
                    d.fx = d.x
                    d.fy = d.y
                })
                .on('drag', function(event, d) {
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
                .on('end', function(event, d) {
                    if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0)
                    // Release after drag
                    d.fx = null
                    d.fy = null
                })
            )

        // Add shapes to step groups
        stepGroups.each(function(d) {
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
    ;(edgesOver as any).raise()

        // Function to update positions (used by physics tick and drags)
        const updatePositions = () => {
            const updateEdgeSel = (sel: any) => sel
                .attr('x1', (d: ProcessFlowEdge) => {
                    const source = d.source as ProcessStep
                    // Exit on right side for both rectangles and circles
                    if (source.shape === 'rectangle') return source.x! + (source.size * 2.2) / 2
                    return (source.x ?? 0) + source.size
                })
                .attr('y1', (d: ProcessFlowEdge) => {
                    const source = d.source as ProcessStep
                    return source.y!
                })
                .attr('x2', (d: ProcessFlowEdge) => {
                    const target = d.target as ProcessStep
                    // Entry on left side for both rectangles and circles
                    if (target.shape === 'rectangle') return target.x! - (target.size * 2.2) / 2
                    return (target.x ?? 0) - target.size
                })
                .attr('y2', (d: ProcessFlowEdge) => {
                    const target = d.target as ProcessStep
                    return target.y!
                })

            updateEdgeSel(edgesUnder)
            updateEdgeSel(edgesOver)

            stepGroups
                .attr('transform', d => `translate(${d.x},${d.y})`)
        }

        // Constraint: keep children within parent rectangles during simulation
        const idMap = new Map(processFlowData.steps.map(s => [s.id, s] as const))
        const enforceChildBounds = () => {
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
        }

        // Create physics simulation
    const maxLevel = Math.max(0, ...processFlowData.steps.map(s => s.flowLevel ?? s.level))
        const leftMargin = 120
        const rightMargin = 160
        const colWidth = Math.max(1, (width - leftMargin - rightMargin) / Math.max(1, maxLevel))

        const sim = d3.forceSimulation<ProcessStep>(processFlowData.steps)
            .force('link', d3.forceLink<ProcessStep, ProcessFlowEdge>(filteredEdges as any)
                .id((n: any) => n.id)
                .distance(physicsParams.linkDistance)
                .strength(physicsParams.linkStrength)
            )
            .force('charge', d3.forceManyBody().strength(physicsParams.chargeStrength).distanceMax(physicsParams.chargeDistanceMax))
            .force('collide', d3.forceCollide<ProcessStep>().radius(d => (d.shape === 'rectangle' ? d.size * 1.2 : d.size + physicsParams.collisionRadius)).strength(physicsParams.collisionStrength))
            // Drive a left-to-right layout by pulling nodes to x-columns based on flowLevel (fallback to hierarchy level)
            .force('x-level', d3.forceX<ProcessStep>(d => leftMargin + (d.flowLevel ?? d.level) * colWidth).strength(0.5))
            // Vertical banding: group siblings and spread them by index to avoid overlap
            .force('y-band', d3.forceY<ProcessStep>(d => {
                if (d.parent_step_id) {
                    const p = idMap.get(d.parent_step_id)
                    const base = (p?.y ?? height / 2)
                    // spread siblings +/-
                    const siblings = processFlowData.steps.filter(s => s.parent_step_id === d.parent_step_id)
                    const idx = siblings.findIndex(s => s.id === d.id)
                    const offset = (idx - (siblings.length - 1) / 2) * 30
                    return base + offset
                }
                // roots: preserve initial y placement banded by their index
                const roots = processFlowData.steps.filter(s => !s.parent_step_id)
                const ridx = roots.findIndex(s => s.id === d.id)
                return height / 2 + (ridx - (roots.length - 1) / 2) * 60
            }).strength(0.12))
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
    }, [processFlowData, dimensions, visibleEdgeTypes, selectedEdgeIds, layoutStartStepId])

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
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Layout start picker */}
                        {processFlowData.steps.length > 0 && (
                            <div className="absolute top-4 right-4 bg-gray-900/95 backdrop-blur border border-gray-700 rounded-lg p-3 max-w-xs">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-400 whitespace-nowrap">Start from:</span>
                                    <select
                                        value={layoutStartStepId ?? ''}
                                        onChange={(e) => setLayoutStartStepId(e.target.value || null)}
                                        className="bg-gray-800 text-gray-100 text-xs rounded px-2 py-1 border border-gray-700"
                                    >
                                        {processFlowData.steps.map(s => (
                                            <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* Physics Control Panel removed - no gravity needed */}
                    </div>
                </div>
            </main>
        </div>
    )
}

