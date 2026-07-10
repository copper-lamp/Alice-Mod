import React from 'react'
import AgentConfigForm from './AgentConfigForm'

const AgentCreatePage: React.FC = () => {
  return (
    <div className="h-full w-full flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 animate-fadeIn overflow-hidden">
      <AgentConfigForm />
    </div>
  )
}

export default AgentCreatePage
