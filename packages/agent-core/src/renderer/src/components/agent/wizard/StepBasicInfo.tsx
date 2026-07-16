import React from 'react'
import { TextField, Input, Label } from '@heroui/react'
import { useWizardStore } from '../../../stores/wizardStore'

const StepBasicInfo: React.FC = () => {
  const { formData, updateFormData } = useWizardStore()

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      updateFormData({ skinData: ev.target?.result as string })
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h3 className="text-lg font-medium text-gray-800 mb-1">基本信息</h3>
        <p className="text-xs text-gray-400 mb-4">设置智能体的名称和外观</p>
      </div>

      <TextField
        value={formData.name}
        onChange={(val) => updateFormData({ name: val })}
        isRequired
        isInvalid={formData.name.trim().length === 0}
      >
        <Label>智能体名称</Label>
        <Input placeholder="输入智能体名称，如：Chili6668267" />
      </TextField>

      <TextField
        value={formData.alias}
        onChange={(val) => updateFormData({ alias: val })}
      >
        <Label>备注（可选）</Label>
        <Input placeholder="实例管理页中显示的别名，不填则使用名称" />
      </TextField>

      <div>
        <label className="text-xs text-gray-500 font-medium mb-1.5 block">皮肤 / 头像</label>
        <div className="flex items-center gap-4">
          {formData.skinData ? (
            <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
              <img src={formData.skinData} alt="皮肤预览" className="w-full h-full object-cover" />
              <button
                onClick={() => updateFormData({ skinData: undefined })}
                className="absolute top-0.5 right-0.5 w-4 h-4 bg-gray-800/60 rounded-full flex items-center justify-center text-white text-[10px] hover:bg-gray-800/80"
              >×</button>
            </div>
          ) : (
            <div className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400 text-xs bg-gray-50/50">
              无皮肤
            </div>
          )}
          <label className="cursor-pointer px-3 py-1.5 text-xs text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100 transition-colors border border-blue-200">
            上传 .png 文件
            <input type="file" accept=".png,image/png" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      </div>
    </div>
  )
}

export default StepBasicInfo
