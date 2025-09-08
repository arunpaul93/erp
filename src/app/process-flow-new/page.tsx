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
        size: hasChildren ? 30 + (step.children.length * 5) : 15 + Math.random() * 8
    }
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

            // Create edges
            const edges: ProcessFlowEdge[] = (edgesData || [])
                .filter((edge: any) => edge.from_step_id && edge.to_step_id)
                .map((edge: any) => ({
                    source: edge.from_step_id,
                    target: edge.to_step_id,
                    type: edge.edge_type?.name || 'Sequential',
                    color: edge.edge_type?.color || '#3b82f6',
                    pattern: edge.edge_type?.pattern || 'solid',
                    icon: edge.edge_type?.icon || '→',
                    data: edge
                }))

            setProcessFlowData({ steps: allSteps, edges })

            // Collect available edge types and initialize visibility
            const edgeTypes = [...new Set(edges.map(edge => edge.type))]
            setAvailableEdgeTypes(edgeTypes)
            setVisibleEdgeTypes(prev => (prev.size === 0 ? new Set(edgeTypes) : prev))

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

        // Create simulation
        const simulation = d3.forceSimulation<ProcessStep>(processFlowData.steps)
            .force('link', d3.forceLink<ProcessStep, ProcessFlowEdge>(filteredEdges)
                .id(d => d.id)
                .distance(physicsParams.linkDistance)
                .strength(physicsParams.linkStrength)
            )
            .force('charge', d3.forceManyBody()
                .strength(physicsParams.chargeStrength)
                .distanceMax(physicsParams.chargeDistanceMax)
            )
            .force('center', d3.forceCenter(width / 2, height / 2)
                .strength(physicsParams.centerStrength)
            )
            .force('collision', d3.forceCollide<ProcessStep>()
                .radius(d => d.size + physicsParams.collisionRadius)
                .strength(physicsParams.collisionStrength)
            )
            .velocityDecay(physicsParams.velocityDecay)
            .alphaDecay(physicsParams.alphaDecay)
            .alphaMin(physicsParams.alphaMin)

        simulationRef.current = simulation

        // Create edges
        const edges = container.append('g')
            .attr('class', 'edges')
            .selectAll('line')
            .data(filteredEdges)
            .enter().append('line')
            .attr('stroke', (d: ProcessFlowEdge) => d.color)
            .attr('stroke-opacity', 0.6)
            .attr('stroke-width', (d: ProcessFlowEdge) => selectedEdgeIds.has(d.data.id) ? 3 : 2)
            .attr('stroke-dasharray', (d: ProcessFlowEdge) => {
                switch (d.pattern) {
                    case 'dashed': return '8,4'
                    case 'dotted': return '2,3'
                    case 'curved': return null // Handle curved separately
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
            .attr('fill', '#666')

        // Cache edge selection
        edgeSelRef.current = edges as unknown as Selection<SVGLineElement, ProcessFlowEdge, SVGGElement, unknown>

        // Create step groups
        const stepGroups = container.append('g')
            .attr('class', 'steps')
            .selectAll('g')
            .data(processFlowData.steps)
            .enter().append('g')
            .attr('class', 'step')
            .style('cursor', 'pointer')
            .call(d3Drag<SVGGElement, ProcessStep>()
                .on('start', function (event, d) {
                    if (!event.active) simulation.alphaTarget(0.3).restart()
                    d.fx = d.x
                    d.fy = d.y
                })
                .on('drag', function (event, d) {
                    d.fx = event.x
                    d.fy = event.y
                })
                .on('end', function (event, d) {
                    if (!event.active) simulation.alphaTarget(0)
                    d.fx = null
                    d.fy = null
                })
            )

        // Add shapes to step groups
        stepGroups.each(function (d) {
            const group = d3Select(this)

            if (d.shape === 'rectangle') {
                // Rectangle for parent processes
                group.append('rect')
                    .attr('width', d.size * 2)
                    .attr('height', d.size * 1.5)
                    .attr('x', -d.size)
                    .attr('y', -d.size * 0.75)
                    .attr('fill', d.color)
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 2)
                    .attr('rx', 4)
                    .style('filter', 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.3))')
            } else {
                // Circle for leaf processes
                group.append('circle')
                    .attr('r', d.size)
                    .attr('fill', d.color)
                    .attr('stroke', '#ffffff')
                    .attr('stroke-width', 2)
                    .style('filter', 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.3))')
            }
        })

        // Add labels to steps
        stepGroups.append('text')
            .text(d => d.name)
            .attr('x', 0)
            .attr('y', d => d.shape === 'rectangle' ? d.size + 20 : d.size + 16)
            .attr('text-anchor', 'middle')
            .attr('font-family', 'Inter, sans-serif')
            .attr('font-size', '12px')
            .attr('fill', '#e5e7eb')
            .attr('font-weight', '500')
            .style('pointer-events', 'none')
            .style('user-select', 'none')

        // Cache step selection
        stepSelRef.current = stepGroups as unknown as Selection<SVGGElement, ProcessStep, SVGGElement, unknown>

        // Update positions on simulation tick
        simulation.on('tick', () => {
            edges
                .attr('x1', d => (d.source as ProcessStep).x!)
                .attr('y1', d => (d.source as ProcessStep).y!)
                .attr('x2', d => (d.target as ProcessStep).x!)
                .attr('y2', d => (d.target as ProcessStep).y!)

            stepGroups
                .attr('transform', d => `translate(${d.x},${d.y})`)
        })

        return () => {
            simulation.stop()
        }
    }, [processFlowData, dimensions, physicsParams, visibleEdgeTypes, selectedEdgeIds])

    // Update simulation when physics parameters change
    useEffect(() => {
        const simulation = simulationRef.current
        if (!simulation) return

        // Update all force parameters
        const linkForce = simulation.force('link') as d3.ForceLink<ProcessStep, ProcessFlowEdge>
        if (linkForce) {
            linkForce.distance(physicsParams.linkDistance).strength(physicsParams.linkStrength)
        }

        const chargeForce = simulation.force('charge') as d3.ForceManyBody<ProcessStep>
        if (chargeForce) {
            chargeForce.strength(physicsParams.chargeStrength).distanceMax(physicsParams.chargeDistanceMax)
        }

        const centerForce = simulation.force('center') as d3.ForceCenter<ProcessStep>
        if (centerForce) {
            centerForce.strength(physicsParams.centerStrength)
        }

        const collisionForce = simulation.force('collision') as d3.ForceCollide<ProcessStep>
        if (collisionForce) {
            collisionForce
                .radius(d => d.size + physicsParams.collisionRadius)
                .strength(physicsParams.collisionStrength)
        }

        simulation
            .velocityDecay(physicsParams.velocityDecay)
            .alphaDecay(physicsParams.alphaDecay)
            .alphaMin(physicsParams.alphaMin)
            .alpha(0.3)
            .restart()
    }, [physicsParams])

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
                                                        min="50"
                                                        max="300"
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
                                                        max="-50"
                                                        value={physicsParams.chargeStrength}
                                                        onChange={(e) => setPhysicsParams(prev => ({ ...prev, chargeStrength: parseInt(e.target.value) }))}
                                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Presets */}
                                        <div className="pt-3 border-t border-gray-700 space-y-2">
                                            <div className="text-xs text-gray-400 mb-2">Presets:</div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={() => setPhysicsParams({
                                                        linkDistance: 80,
                                                        linkStrength: 0.6,
                                                        chargeStrength: -200,
                                                        chargeDistanceMax: 300,
                                                        collisionRadius: 3,
                                                        collisionStrength: 1.0,
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
                                                        linkDistance: 150,
                                                        linkStrength: 0.3,
                                                        chargeStrength: -400,
                                                        chargeDistanceMax: 500,
                                                        collisionRadius: 8,
                                                        collisionStrength: 0.7,
                                                        centerStrength: 0.05,
                                                        velocityDecay: 0.6,
                                                        alphaDecay: 0.01,
                                                        alphaMin: 0.001
                                                    })}
                                                    className="text-xs bg-green-600 hover:bg-green-700 text-white py-1.5 px-2 rounded transition-colors"
                                                >
                                                    Loose
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}
