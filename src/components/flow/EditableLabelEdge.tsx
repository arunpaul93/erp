import React, { useCallback, useMemo, useState } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from 'reactflow'

type EdgeData = {
  label?: string
  onLabelCommit?: (id: string, value: string) => void
  onEditingChange?: (id: string, editing: boolean) => void
  onOpenContextMenu?: (id: string, x: number, y: number) => void
}

export default function EditableLabelEdge(props: EdgeProps<EdgeData>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
    selected,
    data,
    style,
  } = props

  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState<string>(data?.label ?? '')

  const [edgePath, labelX, labelY] = useMemo(() =>
    getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  , [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition])

  const startEdit = useCallback(() => {
    setDraft(data?.label ?? '')
    setIsEditing(true)
    data?.onEditingChange?.(id, true)
  }, [id, data?.label, data?.onEditingChange])

  const commit = useCallback((value: string) => {
    data?.onLabelCommit?.(id, value)
    setIsEditing(false)
    data?.onEditingChange?.(id, false)
  }, [id, data?.onLabelCommit, data?.onEditingChange])

  const cancel = useCallback(() => {
    setIsEditing(false)
    data?.onEditingChange?.(id, false)
  }, [id, data?.onEditingChange])

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ stroke: selected ? '#60a5fa' : '#94a3b8', strokeWidth: 1.5, ...style }} />
      {/* Invisible click-catcher to allow double-click on the line itself */}
      <path
        d={edgePath}
        stroke="transparent"
        strokeWidth={16}
        fill="none"
        style={{ pointerEvents: 'stroke', cursor: 'text' }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          startEdit()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          data?.onOpenContextMenu?.(id, e.clientX, e.clientY)
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            data?.onOpenContextMenu?.(id, e.clientX, e.clientY)
          }}
        >
          {isEditing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(draft)
                if (e.key === 'Escape') cancel()
              }}
              style={{
                minWidth: 96,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e5e7eb',
                fontSize: 12,
                padding: 0,
                margin: 0,
              }}
              placeholder="label"
            />
          ) : (
            <span
              style={{ color: '#e5e7eb', fontSize: 12, userSelect: 'text', cursor: 'text' }}
            >
              {data?.label ?? ''}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
