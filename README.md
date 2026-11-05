# FIRE Planner

A visual retirement-planning web app that projects assets and annual expenses through age 90.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

To send local events to the production GA4 property, start the app with:

```bash
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-KXLYTBYXZW npm run dev
```

## Checks

```bash
npm run lint
node --test tests/fire-calculations.test.mjs
npm run build
```

The financial-model decisions are documented in [CALCULATION_ASSUMPTIONS.md](./CALCULATION_ASSUMPTIONS.md).

## Deployment

Pushes to `main` are exported and deployed to GitHub Pages by `.github/workflows/deploy-pages.yml`.
