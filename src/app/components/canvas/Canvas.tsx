"use client";

import CanvasInner from './CanvasInner';
export type { Node, Edge } from 'reactflow';

type Props = React.ComponentProps<typeof CanvasInner>;

export default function Canvas(props: Props) {
    // Parent controls the container size; here we provide a full-size block
    return (
        <div style={{ width: '100%', height: '100%' }}>
            <CanvasInner {...props} />
        </div>
    );
}
