# AgentSnowCrab

React/Electron port of TethysBio (snow crab IBM). Runs in any supported browser via Vite, or as a desktop Electron app. All data is stored internally (Zustand state + local JSON export/import); no external services.

## Features (mirroring TethysBio html/gui/notebook)
- **Dashboard** — population summary & telemetry invariants (catch_total vs catch_legal).
- **Simulation** — configurable IBM parameters, daily stepping, live population charts.
- **Environment** — environmental data assimilation status (internal).
- **Notebook** — Pluto-style interactive scratchpad.

## Model
- Snow-crab (*Chionoecetes opilio*) IBM: growth (Hiatt log formulation), maturity ogive, multi-hazard daily mortality, fishery harvest gate (legal males CW ≥ 95 mm), reproduction/fecundity, density feedback.
- Configs: `default` and `snowcrab` overlays in `src/config/`.

## Run

Requires Node.js (not present in this environment — install first).

```powershell
cd C:\Users\Nathalie\projects\agentsnowcrab
npm install
npm run dev          # browser dev server at http://localhost:5173
npm run electron     # desktop app
npm run build        # production build to dist/
```

Data store: internal only. Use "Export run (JSON)" / file import to persist runs locally.
