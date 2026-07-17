import React, { useState } from 'react'
import { TextField, Label, Input, Select, ListBox, Button, Spinner } from '@heroui/react'
import { useQQBotStore } from '../../../stores/qqBotStore'
import type { ManualConnectionParams, TestResult } from '../../../stores/qqBotStore'

export const ManualConfig: React.FC = () => {
  const testConnection = useQQBotStore(s => s.testConnection)
  const addAccount = useQQBotStore(s => s.addAccount)
  const cancelAddAccount = useQQBotStore(s => s.cancelAddAccount)

  const [nickname, setNickname] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState('3001')
  const [protocol, setProtocol] = useState('ws')
  const [token, setToken] = useState('')
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    const result = await testConnection({
      host,
      port: parseInt(port, 10),
      protocol: protocol as 'ws' | 'wss',
      token: token || undefined,
    } as ManualConnectionParams)
    setTestResult(result)
    setTesting(false)
  }

  const handleSave = async () => {
    setSaving(true)
    const success = await addAccount({
      connectionType: 'manual',
      deploymentMode: 'docker',
      manual: {
        host,
        port: parseInt(port, 10),
        protocol: protocol as 'ws' | 'wss',
        token: token || undefined,
      },
      authorization: { defaultPermission: 1, cooldownSeconds: 3, allowPrivate: true },
      bridges: [],
    })
    setSaving(false)
    if (success) cancelAddAccount()
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <TextField value={nickname} onChange={setNickname}>
        <Label>昵称</Label>
        <Input placeholder="可选，方便识别" />
      </TextField>

      <div className="grid grid-cols-2 gap-3">
        <TextField value={host} onChange={setHost}>
          <Label>主机</Label>
          <Input placeholder="127.0.0.1" />
        </TextField>
        <TextField value={port} onChange={setPort}>
          <Label>端口</Label>
          <Input placeholder="3001" type="number" />
        </TextField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select
          selectedKey={protocol}
          onSelectionChange={(key) => { if (key) setProtocol(key.toString()) }}
        >
          <Label>协议</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="ws" textValue="ws (ws://)">ws (ws://)</ListBox.Item>
              <ListBox.Item id="wss" textValue="wss (wss://)">wss (wss://)</ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
        <TextField value={token} onChange={setToken}>
          <Label>Token</Label>
          <Input placeholder="选填" type="password" />
        </TextField>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="secondary"
          size="sm"
          onPress={handleTestConnection}
          isPending={testing}
        >
          {testing ? '测试中...' : '测试连接'}
        </Button>
        <Button
          size="sm"
          onPress={handleSave}
          isPending={saving}
        >
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>

      {testResult && (
        <div className={`text-sm flex items-center gap-1.5 ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
          {testResult.success ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>连接成功 (延迟 {testResult.latency}ms)</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <span>{testResult.error || '连接失败'}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
