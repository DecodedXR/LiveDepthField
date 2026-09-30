# Live Depth Field

**Live: [decodedxr.github.io/LiveDepthField](https://decodedxr.github.io/LiveDepthField/)**

Turn a webcam feed or a photo into an explorable 3D point cloud - styled like
Gaussian splats - entirely in the browser. Vanilla JS + Three.js + Vite, with
on-device depth (Depth Anything V2 Small via transformers.js) added in later
milestones. No backend, no accounts.

## How to use

1. Open **[decodedxr.github.io/LiveDepthField](https://decodedxr.github.io/LiveDepthField/)** (desktop Chrome/Edge works best).
2. Allow camera access for a live feed, or pick a photo with the file button.
3. Drag to orbit the point cloud, scroll to zoom.

## Run locally

```bash
npm install
npx playwright install chromium   # once, for the smoke test
npm run dev                       # http://localhost:5173
npm run build                     # production bundle -> dist/
npm test                          # build + headless WebGL smoke test
```

## Where things are

- **[STATUS.md](./STATUS.md)** - the milestone task queue (what's next).
- **[CLAUDE.md](./CLAUDE.md)** - project brief, constraints, and working rules.
- `src/main.js` - the Three.js render/camera scaffold.

Built one milestone at a time; see STATUS.md for the current state.
