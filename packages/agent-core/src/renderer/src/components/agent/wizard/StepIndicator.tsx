import React from 'react'

interface StepIndicatorProps {
  steps: readonly string[]
  currentStep: number
  completedSteps: number[]
  onStepClick: (step: number) => void
}

const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, currentStep, completedSteps, onStepClick }) => {
  return (
    <div className="shrink-0 px-6 py-4 border-b border-gray-100 bg-white">
      <div className="flex items-center justify-center gap-0 max-w-xl mx-auto">
        {steps.map((label, index) => {
          const isCompleted = completedSteps.includes(index)
          const isActive = index === currentStep
          const isClickable = isCompleted || index < currentStep

          return (
            <React.Fragment key={index}>
              <button
                onClick={() => isClickable && onStepClick(index)}
                disabled={!isClickable}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                  ${isActive ? 'bg-blue-50 text-blue-600 border border-blue-200' : ''}
                  ${isCompleted ? 'text-green-600' : ''}
                  ${!isClickable ? 'text-gray-400 cursor-not-allowed' : 'cursor-pointer hover:text-gray-600'}
                `}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${isActive ? 'bg-blue-500 text-white' : ''}
                  ${isCompleted ? 'bg-green-500 text-white' : ''}
                  ${!isActive && !isCompleted ? 'bg-gray-200 text-gray-500' : ''}
                `}>
                  {isCompleted ? '✓' : index + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </button>

              {index < steps.length - 1 && (
                <div className={`flex-1 h-px mx-1 ${completedSteps.includes(index) ? 'bg-green-300' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

export default StepIndicator
