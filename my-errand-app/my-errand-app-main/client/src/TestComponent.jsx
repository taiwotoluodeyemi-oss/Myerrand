import React from 'react'

function TestComponent() {
  console.log('🧪 TestComponent is rendering!')
  
  return (
    <div style={{
      padding: '2rem',
      textAlign: 'center',
      backgroundColor: '#f0f8ff',
      border: '2px solid #3498db',
      margin: '2rem',
      borderRadius: '8px'
    }}>
      <h1 style={{ color: '#2c3e50', marginBottom: '1rem' }}>
        🎉 React is Working!
      </h1>
      <p style={{ color: '#555', fontSize: '1.2rem' }}>
        If you can see this, React is successfully rendering components.
      </p>
      <button 
        onClick={() => alert('Button clicked! React events are working too!')}
        style={{
          padding: '10px 20px',
          backgroundColor: '#3498db',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '1rem',
          marginTop: '1rem'
        }}
      >
        Click Me to Test Events
      </button>
    </div>
  )
}

export default TestComponent
