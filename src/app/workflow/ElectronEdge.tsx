"use client"

import React, { useMemo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'

// A solid edge with a glowing "electron" particle traveling along the path
// - No dashed stroke
// - Particle animates when data.animate === true
export default function ElectronEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, label, selected, data }: any) {
    const [edgePath, labelX, labelY] = useMemo(() => {
        return getBezierPath({
            sourceX,
            sourceY,
            targetX,
            targetY,
            sourcePosition,
            targetPosition,
        })
    }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition])

    const animate = !!data?.animate

    return (
        <g className="react-flow__edge electron-edge">
            {/* Defs: glow filters and radial gradient for neon particle */}
            <defs>
                {/* Soft glow for edge path */}
                <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                {/* Stronger neon glow for the particle, unique per edge to avoid collisions */}
                <filter id={`neon-glow-${id}`} x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur stdDeviation="4.5" result="b" />
                    <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                    </feMerge>
                </filter>
                {/* Radial gradient to simulate neon core to halo */}
                <radialGradient id={`electron-grad-${id}`}>
                    <stop offset="0%" stopColor="#e0f2fe" />
                    <stop offset="60%" stopColor="#93c5fd" />
                    <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.0" />
                </radialGradient>
            </defs>

            {/* Hidden path to drive motion path */}
            <path id={`edge-path-${id}`} d={edgePath} fill="none" stroke="none" />

            {/* Glow underlay for neon tube look */}
            <path d={edgePath} fill="none" stroke="#60a5fa" strokeWidth={6} opacity={0.35} filter="url(#edge-glow)" />

            {/* Crisp visible edge */}
            <BaseEdge id={id} path={edgePath} style={{ stroke: '#60a5fa', strokeWidth: 2, opacity: 0.98 }} markerEnd={markerEnd} />

            {/* Neon electron traveling along the path */}
            {animate && (
                <g>
                    <circle r={3} fill={`url(#electron-grad-${id})`} filter={`url(#neon-glow-${id})`}>
                        <animateMotion dur="1.6s" repeatCount="indefinite">
                            <mpath href={`#edge-path-${id}`} />
                        </animateMotion>
                    </circle>
                    {/* subtle outer halo */}
                    <circle r={6} fill="#60a5fa" opacity={0.12} filter={`url(#neon-glow-${id})`}>
                        <animateMotion dur="1.6s" repeatCount="indefinite">
                            <mpath href={`#edge-path-${id}`} />
                        </animateMotion>
                    </circle>
                </g>
            )}

            {/* Label */}
            {label && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                            pointerEvents: 'all',
                        }}
                        className="rounded-sm text-[11px] font-semibold text-white bg-gray-950 px-1.5 py-[1px] border border-gray-800 shadow-sm"
                    >
                        {label}
                    </div>
                </EdgeLabelRenderer>
            )}
        </g>
    )
}
