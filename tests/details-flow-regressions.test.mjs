import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("details flow does not render the retired estimate tabs", () => {
  assert.doesNotMatch(page, /<PlannerTabs\b/);
});

test("wizard progress uses the six Figma step variants and local divider assets", () => {
  assert.match(page, /function WizardProgressStep/);
  assert.match(page, /position: WizardStepPosition/);
  assert.match(page, /state: "Active" \| "Default"/);
  assert.match(page, /wizard-progress-track/);
  for (const asset of ["step-chevron-active.svg", "step-chevron-default.svg", "step-notch-active.svg", "step-notch-default.svg"]) {
    assert.match(page, new RegExp(asset.replaceAll(".", "\\.")));
  }
  assert.match(css, /\.wizard-progress-track\s*\{[^}]*border:\s*1px solid/);
  assert.match(css, /\.wizard-progress-trigger\s*\+\s*\.wizard-progress-trigger\s*\{[^}]*margin-left:\s*-4px/);
});

test("details popover includes the complete navigation and supplied section artwork", () => {
  for (const label of ["loans", "dependencies"]) assert.match(page, new RegExp(`>${label}<`));
  for (const asset of ["details-investments.svg", "details-income.svg", "details-expenditure.svg"]) assert.match(page, new RegExp(asset.replace(".", "\\.")));
});

test("details scroller does not establish a fixed-position containing block", () => {
  const rule = css.match(/\.details-screen\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.doesNotMatch(rule, /\bcontain\s*:\s*(?:paint|layout|content|strict)/);
  assert.doesNotMatch(rule, /\btransform\s*:/);
  assert.doesNotMatch(rule, /\bfilter\s*:/);
  assert.match(css, /\.sticky-footer\s*\{[^}]*position\s*:\s*fixed/);
});

test("no-retirement results use the three economy states and runout summary", () => {
  assert.match(page, /useState<Outlook>\("cautious"\)/);
  assert.match(page, /Bad economy/);
  assert.match(page, /Average economy/);
  assert.match(page, /Good economy/);
  assert.match(page, /function EconomyTabs/);
  assert.match(page, /financesRunOutBy/);
  assert.match(page, /scenarioRetirementAges\[outlook\]/);
  assert.match(page, /Retirement age/);
  assert.match(page, /Your finances will run out by/);
  assert.match(page, /runout/);
  assert.doesNotMatch(page, /Projection scenario/);
  assert.match(page, /new ResizeObserver\(measure\)/);
  assert.match(page, /plot\.clientHeight/);
  assert.match(css, /\.loading-screen\.no-retirement-result\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.runout-chart-card\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0/);
  assert.match(css, /\.runout-plot\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0/);
  assert.match(page, /"Change age"/);
});

test("scenario sheet renders all 100 sampled futures and its complete explanation", () => {
  assert.match(page, /possiblePaths\.slice\(0, 100\)/);
  assert.match(page, /possibleExpensePaths\.slice\(0, 100\)/);
  assert.match(page, /Scenario simulations/);
  assert.match(page, /multiple historical and market scenarios/);
  assert.match(page, /simplified form of Monte Carlo simulations/);
  assert.match(page, />Know more</);
  assert.match(page, />Got it</);
  assert.doesNotMatch(css, /\.scenario-chart \.bar\.expense\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.scenario-chart \.outcome-mode \.bar\.expense\s*\{[^}]*display:\s*none/);
  assert.match(page, /scenario-rate-cards/);
});

test("calculation loading screen follows the annotated Figma behavior", () => {
  for (const copy of ["Exploring different possible futures", "Testing changes in growth and inflation", "Checking how long your money could last", "Finding a retirement age that holds up"]) assert.match(page, new RegExp(copy));
  assert.match(page, /kind: "calculate"/);
  assert.match(page, /simulationRateFrames/);
  assert.match(page, /setTargetAge\(estimatedAge \?\? details\.age\)/);
  assert.match(css, /\.loading-visual\s*\{[^}]*top:\s*16px[^}]*right:\s*16px[^}]*left:\s*16px[^}]*height:\s*524px/);
  assert.match(css, /\.loading-copy\s*\{[^}]*top:\s*556px/);
});

test("intro and loading use their approved projection motion language", () => {
  assert.match(page, /Array\.from\(\{ length: 3 \}/);
  assert.match(page, /Three animated financial projections/);
  assert.match(page, /When can you retire\?/);
  assert.match(page, /See your finances run across multiple scenarios to determine the best age to retire/);
  assert.doesNotMatch(page, />What’s this\?</);
  assert.match(page, /blendProjection\(projection\.paths\.cautious, projection\.paths\.typical, \.5\)/);
  assert.match(page, /blendProjection\(projection\.paths\.typical, projection\.paths\.optimistic, \.5\)/);
  assert.doesNotMatch(css, /\.intro-projection\s*\{[^}]*animation:/);
  assert.match(css, /\.intro-bars i\s*\{[^}]*animation-delay:\s*var\(--bar-wave-delay\)/);
  assert.match(css, /intro-wave-20-80[\s\S]*animation-duration:\s*5\.33s/);
  assert.match(css, /intro-wave-five[\s\S]*animation-duration:\s*8\.33s/);
  assert.match(page, /introWaveDelay\(layer, index/);
  assert.doesNotMatch(css, /calc\(var\(--bar-height\) \* var\(--wave-scale\)\)/);
  assert.match(css, /\.loading-projection\s*\{[^}]*animation:\s*loading-projection-crossfade 2\.2s/);
});

test("loading chart hands off smoothly to the final result", () => {
  assert.match(page, /setLoadingExiting\(true\)/);
  assert.match(page, /setScreen\("result"\)[\s\S]*900/);
  assert.match(page, /finalPlan=\{calculatedPlan\} exiting=\{loadingExiting\}/);
  assert.doesNotMatch(page, /loading-handoff-chart/);
  assert.match(page, /scaleDomain=\{scaleDomain\}/);
  assert.match(page, /projectionData=\{\(exiting \|\| showingResult\) && settledPath \? settledPath : path\}/);
  assert.match(page, /loading-screen \$\{showingResult \? "result-screen" : ""\}/);
  assert.match(page, /requestAnimationFrame\(\(\) => window\.requestAnimationFrame/);
  assert.match(page, /\(screen === "loading" \|\| screen === "result"\) && <LoadingScreen/);
  assert.match(css, /\.loading-screen\.exiting \.loading-visual\s*\{[^}]*top:\s*0[^}]*right:\s*0[^}]*left:\s*0[^}]*height:\s*456px/);
  assert.match(css, /\.loading-projection \.bar\s*\{[^}]*transition:\s*height \.9s/);
  assert.match(css, /\.loading-screen\.exiting \.loading-copy\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.loading-screen\.result-screen \.loading-visual\s*\{[^}]*top:\s*0[^}]*height:\s*456px/);
  assert.doesNotMatch(css, /\.projection-chart\.loading-chart\s*\{[^}]*opacity:/);
});

test("result actions preserve equal widths and a primary export CTA", () => {
  assert.match(css, /\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.result-screen \.bottom-nav \.export-main\s*\{[^}]*color:\s*#111113/);
});

test("undetermined result and retirement-age sheet follow the approved copy and alternative layout", () => {
  assert.match(page, /Your finances will run out by/);
  assert.match(page, /Set retirement age/);
  assert.match(page, /You need to bring in these changes/);
  assert.match(page, /Increase current investments to/);
  assert.match(page, /recommendation\?\.requiredCurrentCorpus/);
  assert.match(page, /className="or-divider"/);
  assert.doesNotMatch(page, /Not enough on its own/);
  assert.doesNotMatch(css, /\.change-alternatives\s*\{[^}]*background:\s*#1a1a1f/);
  assert.match(page, /targetProjection\?\.paths\[outlook\]/);
  assert.match(page, /const recoveryMode = calculatedPlan !== null && estimatedAge === null;/);
});
