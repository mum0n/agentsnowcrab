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

Requires Node.js (v18+ recommended).

```powershell
cd agentsnowcrab
npm install
npm run dev            # browser dev server at http://localhost:5173
npm run electron:dev   # desktop Electron window with live Vite server
```

To open the prebuilt standalone HTML dashboard directly without running a server:

```powershell
Start-Process index.html
```

## Rebuilding

Whenever source files under `src/` are modified, rebuild both `dist/` and the self-contained `index.html` bundle:

```powershell
cd agentsnowcrab
npm install            # required once or after dependency changes
npm run build          # runs `vite build && node scripts/make_standalone.mjs`
```

`npm run build` compiles the Vite bundle into `dist/` and inlines the generated JS and CSS into `dist/index.html` and the root `index.html` so it can be opened directly via `file://` without CORS issues.

To run the unit test suite or build the packaged Electron desktop installer:

```powershell
npm test               # runs Vitest (`vitest run`)
npm run electron:build # builds Vite bundle and Electron desktop package
```

Data store: internal only. Use "Export run (JSON)" / file import to persist runs locally.

