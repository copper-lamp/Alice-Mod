import React from 'react'

interface ToggleProps {
  selected: boolean
  onChange: (value: boolean) => void
  label?: string
  disabled?: boolean
}

/**
 * 自定义 Toggle 开关组件。
 * 使用原生 <button> + CSS 实现，避免 HeroUI Switch 在某些场景下的布局/渲染问题。
 * 固定尺寸 w-9 h-5，rounded-full pill 形状，滑动圆点。
 */
const Toggle: React.FC<ToggleProps> = ({ selected, onChange, label, disabled }) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={selected}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!selected)}
      className={`
        relative inline-flex shrink-0 w-9 h-5 items-center rounded-full
        transition-colors duration-200 ease-in-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1
        ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
        ${selected ? 'bg-blue-500' : 'bg-gray-300'}
      `}
    >
      <span
        className={`
          absolute top-1/2 -translate-y-1/2
          inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm
          transition-all duration-200 ease-in-out
          ${selected ? 'left-[18px]' : 'left-[2px]'}
        `}
      />
    </button>
  )
}

export default Toggle