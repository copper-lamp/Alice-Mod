import React from 'react'
import AgentCreateWizard from './AgentCreateWizard'

const AgentCreatePage: React.FC = () => {
  return (
    <div className="h-full w-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 animate-fadeIn overflow-hidden">
      <AgentCreateWizard />
    </div>
  )
}

export default AgentCreatePage
