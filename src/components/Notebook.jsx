import React, { useState } from 'react';
export default function Notebook() {
  const [code, setCode] = useState('# Interactive notebook (Pluto-style)\n# params = IBMParameters(...)\n# model = initialize_model(n_agents=2000, grid=(100,100))\n# agent_df, model_df = run_simulation(model, 365)');
  return (
    <div className="card">
      <h2>Notebook</h2>
      <textarea value={code} onChange={e=>setCode(e.target.value)} style={{width:'100%',height:'240px',fontFamily:'monospace'}} />
    </div>
  );
}
