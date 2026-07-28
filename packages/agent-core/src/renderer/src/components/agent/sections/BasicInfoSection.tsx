import React from 'react'
import { Button, TextField, Input, Label } from '@heroui/react'

interface BasicInfoSectionProps {
  name: string
  skinData?: string
  onChange: (name: string, skinData?: string) => void
}

const BasicInfoSection: React.FC<BasicInfoSectionProps> = ({ name, skinData, onChange }) => {
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
        <label className="text-xs text-gray-500 font-medium mb-1.5 block">皮肤 / 头像</label>
        <div className="flex items-center gap-4">
          {skinData ? (
            <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
              <img src={skinData} alt="皮肤预览" className="w-full h-full object-cover" />
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label="移除头像"
                onPress={() => onChange(name, undefined)}
                className="absolute right-0.5 top-0.5 min-w-5 h-5 bg-foreground/60 text-background"
              >
                ×
              </Button>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs bg-gray-50/50">
              无皮肤
            </div>
          )}
          <label className="cursor-pointer px-3 py-1.5 text-xs text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors border border-blue-200">
            上传 .png 文件
            <input
              type="file"
              accept=".png,image/png"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </div>
  )
}

export default BasicInfoSection
