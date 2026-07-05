import React from 'react'
import AgentConfigForm from './AgentConfigForm'

const AgentCreatePage: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden -m-4">
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        <AgentConfigForm />
      </div>
    </div>
  )
}

export default AgentCreatePage