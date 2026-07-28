import React from 'react'
import { Button, TextField, Input, Label } from '@heroui/react'

interface BasicInfoSectionProps {
  name: string
  skinData?: string
  onChange: (name: string, skinData?: string) => void
}

const BasicInfoSection: React.FC<BasicInfoSectionProps> = ({ name, skinData, onChange }) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      onChange(name, dataUrl)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-4">
      <TextField value={name} onChange={(val) => onChange(val, skinData)} fullWidth>
        <Label>智能体名称</Label>
        <Input placeholder="输入智能体名称" />
      </TextField>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted">皮肤 / 头像</label>
        <div className="flex items-center gap-4">
          {skinData ? (
            <div className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
              <img src={skinData} alt="皮肤预览" className="h-full w-full object-cover" />
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label="移除头像"
                onPress={() => onChange(name, undefined)}
                className="absolute right-0.5 top-0.5 h-5 min-w-5 bg-foreground/60 text-background"
              >
                ×
              </Button>
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface-secondary/50 text-xs text-muted">
              无皮肤
            </div>
          )}
          <Button size="sm" variant="secondary" onPress={() => fileInputRef.current?.click()}>
            上传 .png 文件
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,image/png"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </div>
    </div>
  )
}

export default BasicInfoSection
