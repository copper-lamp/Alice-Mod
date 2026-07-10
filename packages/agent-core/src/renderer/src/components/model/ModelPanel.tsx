import React, { useEffect, useState } from 'react'
import { Card, Button, Spinner } from '@heroui/react'
import { useModelStore } from '../../stores/modelStore'
import ModelList from './ModelList'
import ModelAddForm from './ModelAddForm'

/** 模型配置容器 */
const ModelPanel: React.FC = () => {
  const { models, loading, fetchModels } = useModelStore()
  const [showAddForm, setShowAddForm] = useState(false)

  useEffect(() => {
    fetchModels()
  }, [])

  const handleAddSuccess = () => {
    setShowAddForm(false)
    fetchModels()
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden animate-fadeIn">
      <Card className="flex-1 flex flex-col overflow-hidden rounded-xl shadow-sm border border-gray-200">
        <Card.Header>
          <div className="flex items-center justify-between w-full">
            <Card.Title>模型管理</Card.Title>
            {!showAddForm && (
              <Button size="sm" onPress={() => setShowAddForm(true)}>
                添加模型
              </Button>
            )}
          </div>
        </Card.Header>

        <Card.Content className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner />
              <span className="ml-2 text-sm text-gray-400">加载中...</span>
            </div>
          ) : showAddForm ? (
            <ModelAddForm onSuccess={handleAddSuccess} onCancel={() => setShowAddForm(false)} />
          ) : (
            <ModelList models={models} />
          )}
        </Card.Content>

        {showAddForm && (
          <Card.Footer className="flex justify-end">
            <Button variant="secondary" size="sm" onPress={() => setShowAddForm(false)}>
              取消
            </Button>
          </Card.Footer>
        )}
      </Card>
    </div>
  )
}

export default ModelPanel