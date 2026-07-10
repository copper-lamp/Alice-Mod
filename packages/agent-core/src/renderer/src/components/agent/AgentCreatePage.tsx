import React from 'react'
import { Card } from '@heroui/react'
import AgentConfigForm from './AgentConfigForm'

const AgentCreatePage: React.FC = () => {
  return (
    <Card className="h-full w-full rounded-xl shadow-sm border border-gray-200 animate-fadeIn overflow-hidden">
      <AgentConfigForm />
    </Card>
  )
}

export default AgentCreatePage
