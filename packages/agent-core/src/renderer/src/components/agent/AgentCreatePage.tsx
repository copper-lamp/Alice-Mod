import React from 'react'
import { Card } from '@heroui/react'
import AgentConfigForm from './AgentConfigForm'

const AgentCreatePage: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Card className="flex-1 flex flex-col overflow-hidden rounded-none border-0 shadow-none">
        <Card.Content className="flex-1 flex flex-col p-8">
          <AgentConfigForm />
        </Card.Content>
      </Card>
    </div>
  )
}

export default AgentCreatePage