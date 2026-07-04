import React from 'react'

const App: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: '#1a1a2e',
        color: '#e0e0e0'
      }}
    >
      <h1 style={{ fontSize: '2.5rem', margin: 0 }}>McAgent - Agent Core</h1>
      <p style={{ fontSize: '1rem', marginTop: '0.5rem', color: '#888' }}>
        Electron + React 桌面客户端
      </p>
    </div>
  )
}

export default App
