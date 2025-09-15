"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  Connection,
  Edge,
  Handle,
  Node,
  NodeProps,
  Position,
  ReactFlowInstance,
  useEdgesState,
  useNodesState,
  OnConnectStart,
} from "reactflow"
import "reactflow/dist/style.css"
import ELK from "elkjs/lib/elk.bundled.js"
import { supabase } from "@/lib/supabase"
import { useOrg } from "@/contexts/OrgContext"

type StepRow = {
  id: string
  organisation_id: string | null
  name: string
  description: string | null
  metadata: any | null
  parent_step_id: string | null
}

type EdgeRow = {
  id: string
  organisation_id: string | null
  from_step_id: string | null
  to_step_id: string | null
  metadata: any | null
  label: string | null
}

type ProcessNodeData = {
  label: string
  description?: string | null
  parent_step_id?: string | null
  onContextMenu?: (e: React.MouseEvent, nodeId: string) => void
  onDoubleClick?: (nodeId: string) => void
}

const NODE_DEFAULT_WIDTH = 200
const NODE_DEFAULT_HEIGHT = 60

function ProcessNode({ id, data, selected }: NodeProps<ProcessNodeData>) {
  return (
    <div
      onContextMenu={(e) => data.onContextMenu?.(e, id)}
      onDoubleClick={() => data.onDoubleClick?.(id)}
      className={
        "rounded-md border bg-white text-slate-800 shadow-sm px-3 py-2 min-w-[180px]" +
        (selected ? " ring-2 ring-blue-400" : "")
      }
      style={{ width: NODE_DEFAULT_WIDTH }}
    >
      <Handle id="left" type="target" position={Position.Left} />
      <div 
        className={
          "font-medium break-words whitespace-normal" +
          (data.label === "New Step" ? " text-slate-400 italic" : "")
        } 
        title={data.label}
      >
        {data.label || "Untitled"}
      </div>
      {data.description ? (
        <div className="text-xs text-slate-500 break-words whitespace-normal" title={data.description}>
          {data.description}
        </div>
      ) : null}
      <Handle id="right" type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { process: ProcessNode }

type ContextMenuState = {
  x: number
  y: number
  targetType: "node" | "edge"
  targetId: string
} | null

type EditDialogState = {
  id: string
  label: string
  description: string
} | null

async function layoutWithElk(nodes: Node[], edges: Edge[], opts: { ranksep: number; nodesep: number; marginx: number; marginy: number; direction: "LR" | "TB" }) {
  const elk = new ELK()
  const direction = opts.direction === "LR" ? "RIGHT" : "DOWN"
  const graph: any = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.layered.spacing.nodeNodeBetweenLayers": String(opts.ranksep),
      "elk.spacing.nodeNode": String(opts.nodesep),
      "elk.padding.top": String(opts.marginy),
      "elk.padding.bottom": String(opts.marginy),
      "elk.padding.left": String(opts.marginx),
      "elk.padding.right": String(opts.marginx),
    },
    children: nodes.map((n) => ({ id: n.id, width: NODE_DEFAULT_WIDTH, height: NODE_DEFAULT_HEIGHT })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  }

  const res = await elk.layout(graph)
  const positions: Record<string, { x: number; y: number }> = {}
  if (res.children) {
    for (const c of res.children) {
      positions[c.id] = { x: c.x ?? 0, y: c.y ?? 0 }
    }
  }

  const nextNodes = nodes.map((n) => ({
    ...n,
    position: positions[n.id] ?? n.position,
  }))

  return nextNodes
}

export default function ProcessFlowPage() {
  const { selectedOrgId } = useOrg()

  const [nodes, setNodes, onNodesChange] = useNodesState<ProcessNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const [connectFrom, setConnectFrom] = useState<{ nodeId: string; handleId?: string } | null>(null)
  const nodesRef = useRef<Node<ProcessNodeData>[]>([])

  const [menu, setMenu] = useState<ContextMenuState>(null)
  const [editDlg, setEditDlg] = useState<EditDialogState>(null)

  const [originalNodeIds, setOriginalNodeIds] = useState<Set<string>>(new Set())
  const [originalEdgeIds, setOriginalEdgeIds] = useState<Set<string>>(new Set())

  // Layout configuration
  const [ranksep, setRanksep] = useState(200)
  const [nodesep, setNodesep] = useState(80)
  const [paddingX, setPaddingX] = useState(50)
  const [paddingY, setPaddingY] = useState(50)
  const [showConfig, setShowConfig] = useState(false)

  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  const onNodeContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, targetType: "node", targetId: nodeId })
  }, [])

  const onNodeDoubleClick = useCallback((nodeId: string) => {
    const n = nodesRef.current.find((x) => x.id === nodeId)
    if (!n) return
    
    const currentLabel = String((n.data as any)?.label ?? "")
    const displayLabel = currentLabel === "New Step" ? "" : currentLabel
    
    setEditDlg({ 
      id: nodeId, 
      label: displayLabel, 
      description: String((n.data as any)?.description ?? "") 
    })
  }, [])

  const nodeInteractionData = useMemo(
    () => ({ onContextMenu: onNodeContextMenu, onDoubleClick: onNodeDoubleClick }),
    [onNodeContextMenu, onNodeDoubleClick]
  )

  const isValidConnection = useCallback((conn: Connection) => {
    return conn.sourceHandle === "right" && conn.targetHandle === "left" && conn.source !== conn.target
  }, [])

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!isValidConnection(conn)) return
      setEdges((eds) => addEdge({ ...conn, id: crypto.randomUUID() }, eds))
      setDirty(true)
    },
    [isValidConnection, setEdges]
  )

  const onConnectStart: OnConnectStart = useCallback((_e, params) => {
    if (params.handleType === "source" && params.handleId === "right" && params.nodeId) {
      setConnectFrom({ nodeId: params.nodeId, handleId: params.handleId || undefined })
    } else {
      setConnectFrom(null)
    }
  }, [])

  const onConnectEnd = useCallback(
    (e: any) => {
      if (!connectFrom || !rfRef.current) return
      const targetIsPane = (e.target as Element).classList.contains("react-flow__pane")
      if (targetIsPane) {
        const id = crypto.randomUUID()
        const position = rfRef.current.project({ x: e.clientX, y: e.clientY })
        
        // Find the source node to inherit its parent_step_id
        const sourceNode = nodes.find(n => n.id === connectFrom.nodeId)
        const sourceParentStepId = sourceNode?.data?.parent_step_id || null
        
        const newNode: Node<ProcessNodeData> = {
          id,
          type: "process",
          position,
          data: { 
            label: "New Step", 
            description: "", 
            parent_step_id: sourceParentStepId,
            ...nodeInteractionData 
          },
        }
        setNodes((ns) => ns.concat(newNode))
        setEdges((es) => addEdge({ id: crypto.randomUUID(), source: connectFrom.nodeId, sourceHandle: "right", target: id, targetHandle: "left" }, es))
        setDirty(true)
      }
      setConnectFrom(null)
    },
    [connectFrom, nodeInteractionData, setEdges, setNodes, nodes]
  )

  const fetchData = useCallback(async () => {
    if (!selectedOrgId) return
    setLoading(true)
    try {
      const [{ data: stepRows, error: stepErr }, { data: edgeRows, error: edgeErr }] = await Promise.all([
        supabase
          .from("process_step")
          .select("id, organisation_id, name, description, metadata, parent_step_id")
          .eq("organisation_id", selectedOrgId),
        supabase
          .from("process_flow_edge")
          .select("id, organisation_id, from_step_id, to_step_id, metadata, label")
          .eq("organisation_id", selectedOrgId),
      ])

      if (stepErr) throw stepErr
      if (edgeErr) throw edgeErr

      const ns: Node<ProcessNodeData>[] = (stepRows as StepRow[]).map((r) => {
        const pos = (r.metadata?.position as { x: number; y: number } | undefined) || { x: Math.random() * 600, y: Math.random() * 400 }
        return {
          id: r.id,
          type: "process",
          position: pos,
          data: { 
            label: r.name, 
            description: r.description, 
            parent_step_id: r.parent_step_id,
            ...nodeInteractionData 
          },
        }
      })

      const es: Edge[] = (edgeRows as EdgeRow[])
        .filter((r) => r.from_step_id && r.to_step_id)
        .map((r) => ({ id: r.id, source: r.from_step_id!, target: r.to_step_id!, label: r.label ?? undefined, sourceHandle: "right", targetHandle: "left" }))

      setNodes(ns)
      setEdges(es)
      setOriginalNodeIds(new Set(ns.map((n) => n.id)))
      setOriginalEdgeIds(new Set(es.map((e) => e.id)))
      setDirty(false)
    // Fit view once after initial data load
    requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.2, duration: 300 }))
    } catch (err) {
      console.error("Failed to load process flow:", err)
    } finally {
      setLoading(false)
    }
  }, [selectedOrgId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const addNode = useCallback(() => {
    const id = crypto.randomUUID()
    const pos = rfRef.current?.project({ x: 200, y: 200 }) || { x: 200, y: 200 }
    const newNode: Node<ProcessNodeData> = { 
      id, 
      type: "process", 
      position: pos, 
      data: { 
        label: "New Step", 
        description: "", 
        parent_step_id: null,
        ...nodeInteractionData 
      } 
    }
    setNodes((ns) => ns.concat(newNode))
    setDirty(true)
  }, [nodeInteractionData])

  const layout = useCallback(async () => {
    const laidOut = await layoutWithElk(nodes, edges, { ranksep, nodesep, marginx: paddingX, marginy: paddingY, direction: "LR" })
    setNodes(laidOut)
    setDirty(true)
  }, [edges, nodes, paddingX, paddingY, ranksep, nodesep])

  const onEdgeContextMenu = useCallback((_: unknown, edge: Edge) => {
    // @ts-ignore event is actually provided first in RF v11 onsignature, but using wrapper below
  }, [])

  const handleEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, targetType: "edge", targetId: edge.id })
  }, [])

  const deleteTarget = useCallback(() => {
    if (!menu) return
    if (menu.targetType === "node") {
      const nodeId = menu.targetId
      setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId))
      setNodes((ns) => ns.filter((n) => n.id !== nodeId))
    } else {
      const edgeId = menu.targetId
      setEdges((es) => es.filter((e) => e.id !== edgeId))
    }
    setMenu(null)
    setDirty(true)
  }, [menu])

  const save = useCallback(async () => {
    if (!selectedOrgId) return
    setSaving(true)
    try {
      // Compute deletes
      const currentNodeIds = new Set(nodes.map((n) => n.id))
      const currentEdgeIds = new Set(edges.map((e) => e.id))
      const deletedNodeIds = Array.from(originalNodeIds).filter((id) => !currentNodeIds.has(id))
      const deletedEdgeIds = Array.from(originalEdgeIds).filter((id) => !currentEdgeIds.has(id))

      // Upserts - Filter out nodes that still have "New Step" placeholder
      const stepRows: StepRow[] = nodes
        .filter((n) => (n.data as any)?.label !== "New Step") // Don't save placeholder nodes
        .map((n) => ({
          id: n.id,
          organisation_id: selectedOrgId,
          name: String((n.data as any)?.label ?? ""),
          description: ((n.data as any)?.description ?? null) as string | null,
          metadata: { position: n.position },
          parent_step_id: (n.data as any)?.parent_step_id ?? null,
        }))

      // Filter valid node IDs (excluding placeholder nodes)
      const validNodeIds = new Set(
        nodes
          .filter((n) => (n.data as any)?.label !== "New Step")
          .map((n) => n.id)
      )

      const edgeRows: EdgeRow[] = edges
        .filter((e) => validNodeIds.has(e.source) && validNodeIds.has(e.target)) // Only edges between valid nodes
        .map((e) => ({
          id: e.id,
          organisation_id: selectedOrgId,
          from_step_id: e.source,
          to_step_id: e.target,
          metadata: {},
          label: (e.label as string) ?? null,
        }))

      // Persist nodes and edges
      const [{ error: stepUpsertErr }, { error: edgeUpsertErr }] = await Promise.all([
        supabase.from("process_step").upsert(stepRows),
        supabase.from("process_flow_edge").upsert(edgeRows),
      ])
      if (stepUpsertErr) throw stepUpsertErr
      if (edgeUpsertErr) throw edgeUpsertErr

      // Deletes: edges first, then nodes
      if (deletedEdgeIds.length > 0) {
        const { error } = await supabase.from("process_flow_edge").delete().eq("organisation_id", selectedOrgId).in("id", deletedEdgeIds)
        if (error) throw error
      }

      if (deletedNodeIds.length > 0) {
        // also delete orphan edges referencing deleted nodes (safety)
        await supabase.from("process_flow_edge").delete().eq("organisation_id", selectedOrgId).in("from_step_id", deletedNodeIds)
        await supabase.from("process_flow_edge").delete().eq("organisation_id", selectedOrgId).in("to_step_id", deletedNodeIds)
        const { error } = await supabase.from("process_step").delete().eq("organisation_id", selectedOrgId).in("id", deletedNodeIds)
        if (error) throw error
      }

      setOriginalNodeIds(new Set(nodes.map((n) => n.id)))
      setOriginalEdgeIds(new Set(edges.map((e) => e.id)))
      setDirty(false)
    } catch (err) {
      console.error("Failed to save:", err)
    } finally {
      setSaving(false)
    }
  }, [edges, nodes, originalEdgeIds, originalNodeIds, selectedOrgId])

  const onInit = useCallback((instance: ReactFlowInstance) => {
    rfRef.current = instance
  instance.fitView({ padding: 0.2, duration: 300 })
  }, [])

  const onPaneClick = useCallback(() => setMenu(null), [])

  // Render
  return (
    <div className="h-[calc(100dvh-64px)] flex flex-col">
      <div className="flex items-center gap-2 border-b p-2 bg-white">
        <button className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50" onClick={addNode} disabled={!selectedOrgId || loading}>
          + Add Node
        </button>
        <button className="px-3 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-50" onClick={layout} disabled={nodes.length === 0}>
          Auto Layout
        </button>
        <button className="px-3 py-1.5 rounded bg-slate-700 text-white disabled:opacity-50" onClick={() => setShowConfig((s) => !s)}>
          Config
        </button>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-slate-600">Org: {selectedOrgId ?? "(none)"}</span>
          <button className="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50" onClick={save} disabled={!dirty || saving || !selectedOrgId}>
            {saving ? "Saving..." : dirty ? "Save Changes" : "Saved"}
          </button>
        </div>
      </div>

      {showConfig ? (
        <div className="border-b bg-slate-50 p-3 flex gap-6 items-end text-sm">
          <label className="flex flex-col">
            <span className="text-slate-600">Rank separation (LR)</span>
            <input type="number" className="border rounded px-2 py-1" value={ranksep} onChange={(e) => setRanksep(Number(e.target.value) || 0)} />
          </label>
          <label className="flex flex-col">
            <span className="text-slate-600">Node separation</span>
            <input type="number" className="border rounded px-2 py-1" value={nodesep} onChange={(e) => setNodesep(Number(e.target.value) || 0)} />
          </label>
          <label className="flex flex-col">
            <span className="text-slate-600">Padding X</span>
            <input type="number" className="border rounded px-2 py-1" value={paddingX} onChange={(e) => setPaddingX(Number(e.target.value) || 0)} />
          </label>
          <label className="flex flex-col">
            <span className="text-slate-600">Padding Y</span>
            <input type="number" className="border rounded px-2 py-1" value={paddingY} onChange={(e) => setPaddingY(Number(e.target.value) || 0)} />
          </label>
          <button className="px-3 py-1.5 rounded bg-emerald-600 text-white" onClick={layout}>Apply</button>
        </div>
      ) : null}

      <div className="flex-1">
  <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onInit={onInit}
          onPaneClick={onPaneClick}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onEdgeContextMenu={(e, edge) => handleEdgeContextMenu(e as unknown as React.MouseEvent, edge)}
        >
          <Background gap={16} size={1} />
          <MiniMap pannable zoomable />
          <Controls />
        </ReactFlow>
      </div>

      {menu ? (
        <div
          className="absolute z-50 bg-white border rounded shadow-md text-sm"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="px-3 py-2 hover:bg-slate-100 w-full text-left" onClick={deleteTarget}>
            Delete {menu.targetType}
          </button>
        </div>
      ) : null}

      {editDlg ? (
        <div className="absolute inset-0 z-40 bg-black/30 flex items-center justify-center" onClick={() => setEditDlg(null)}>
          <div className="bg-white rounded shadow-lg p-4 w-[360px]" onClick={(e) => e.stopPropagation()}>
            <div className="font-medium mb-3">Edit Node</div>
            <div className="space-y-2">
              <label className="block text-sm">
                <div className="text-slate-600">Name</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={editDlg.label}
                  onChange={(e) => setEditDlg({ ...editDlg, label: e.target.value })}
                  autoFocus
                />
              </label>
              <label className="block text-sm">
                <div className="text-slate-600">Description</div>
                <textarea
                  className="border rounded px-2 py-1 w-full min-h-[80px]"
                  value={editDlg.description}
                  onChange={(e) => setEditDlg({ ...editDlg, description: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-1.5 rounded border" onClick={() => setEditDlg(null)}>
                Cancel
              </button>
              <button
                className="px-3 py-1.5 rounded bg-blue-600 text-white"
                onClick={() => {
                  // If the user leaves the label empty, keep "New Step" as placeholder
                  const finalLabel = editDlg.label.trim() || "New Step"
                  
                  setNodes((ns) =>
                    ns.map((n) => (n.id === editDlg.id ? { ...n, data: { ...(n.data as any), label: finalLabel, description: editDlg.description, ...nodeInteractionData } } : n))
                  )
                  setEditDlg(null)
                  setDirty(true)
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
