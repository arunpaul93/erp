'use client';

import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
    Controls,
    MiniMap,
    Connection,
    Edge,
    MarkerType,
    Node,
    addEdge,
    useEdgesState,
    useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';

const GRID_SIZE = 16;

type CanvasProps = {
    initialNodes?: Node[];
    initialEdges?: Edge[];
    readOnly?: boolean;
};

export default function CanvasInner({ initialNodes, initialEdges, readOnly }: CanvasProps) {
    const defaultNodes = useMemo<Node[]>(
        () =>
            initialNodes ?? [
                { id: '1', position: { x: 0, y: 0 }, data: { label: 'Start' }, type: 'input' },
                { id: '2', position: { x: 240, y: 0 }, data: { label: 'Next' } },
            ],
        [initialNodes],
    );

    const defaultEdges = useMemo<Edge[]>(
        () =>
            initialEdges ?? [
                { id: 'e1-2', source: '1', target: '2', markerEnd: { type: MarkerType.ArrowClosed } },
            ],
        [initialEdges],
    );

    const [nodes, setNodes, onNodesChange] = useNodesState(defaultNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(defaultEdges);

    const onConnect = useCallback(
        (params: Connection) =>
            setEdges((eds: Edge[]) =>
                addEdge(
                    { ...params, markerEnd: { type: MarkerType.ArrowClosed } }, // arrowheads like n8n
                    eds,
                ),
            ),
        [setEdges],
    );

    // Fit handled by fitView + fitViewOptions on ReactFlow

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={readOnly ? undefined : onNodesChange}
                onEdgesChange={readOnly ? undefined : onEdgesChange}
                onConnect={readOnly ? undefined : onConnect}
                fitView
                fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
                minZoom={0}
                maxZoom={4}                // similar to n8n
                snapToGrid
                snapGrid={[GRID_SIZE, GRID_SIZE]}
                panOnScroll
                panOnDrag
                zoomOnPinch
                elementsSelectable
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elevateEdgesOnSelect
            >
                <MiniMap pannable zoomable />
                <Controls position="bottom-left" />
            </ReactFlow>
        </div>
    );
}
