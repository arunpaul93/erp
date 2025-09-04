"use server"

import { useRouter } from 'next/navigation'

export default function EmployeeOrganisationRecord({ params }: { params: { employee_organisation_id: string } }) {
  const id = params.employee_organisation_id

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Employee Organisation</h1>
        <p className="text-sm text-gray-300">Record id: {id}</p>
        <div className="mt-4 p-4 bg-gray-900/60 border border-gray-800 rounded">This is a placeholder detail page for <strong>{id}</strong>.</div>
      </div>
    </div>
  )
}
