import React from 'react'

interface StatusLabelProps {
  text: string | null
}

export const StatusLabel: React.FC<StatusLabelProps> = ({ text }) => {
  if (!text) return null

  // Multiple agents can run simultaneously — AgentStateManager joins
  // their per-agent labels with '\n'. Render each line as its own pill
  // so the user can see them stacked.
  const lines = text.split('\n').filter((s) => s.trim().length > 0)
  if (lines.length === 0) return null

  return (
    <div
      className="flex flex-col items-center justify-center mb-1 px-2"
      style={{ pointerEvents: 'none', gap: 2 }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className="text-xs font-medium text-white rounded-full px-3 py-1 whitespace-nowrap"
          style={{
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            maxWidth: '200px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            letterSpacing: '0.01em'
          }}
        >
          {line}
        </div>
      ))}
    </div>
  )
}
