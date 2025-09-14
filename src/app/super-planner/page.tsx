import type { Metadata } from 'next'
import SuperPlannerClient from './SuperPlannerClient'

export const metadata: Metadata = {
  title: 'Super Planner',
  description: 'Visual planner using React Flow backed by process_step and process_flow_edge tables.',
}

export default function Page() {
  return <SuperPlannerClient />
}
