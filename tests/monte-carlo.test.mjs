import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom", configFile: false, root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});
const model = await vite.ssrLoadModule("/lib/fire-model.ts");
after(async () => vite.close());

const details = {
  age: 34, mutualFunds: 4_000_000, monthlySip: 40_000, stocks: 500_000,
  fixedDeposits: 500_000, realEstate: 0, bankSavings: 100_000,
  monthlyIncome: 180_000, monthlyExpense: 80_000,
};
const dependents = { count: 0, annualCostPerDependent: 0, supportYears: 10 };
const loan = { balance: 0, emi: 0, remainingYears: 5 };

test("simulation is reproducible for a fixed seed", () => {
  const first = model.calculatePlan(details, dependents, loan, 42);
  const second = model.calculatePlan(details, dependents, loan, 42);
  assert.deepEqual(first, second);
});

test("each outlook exposes the realized rates used by its coherent path", () => {
  const result = model.calculatePlan(details, dependents, loan, 42);
  for (const outlook of ["cautious", "typical", "optimistic"]) {
    for (const key of ["inflation", "savings", "mutualFunds", "stocks", "fixedDeposits", "realEstate"]) {
      const summary = result.rateSummaries[outlook][key];
      assert.ok(summary.min <= summary.average);
      assert.ok(summary.average <= summary.max);
      assert.ok(summary.min >= model.SIMULATION_RATE_BOUNDS[key].min);
      assert.ok(summary.max <= model.SIMULATION_RATE_BOUNDS[key].max);
    }
    const scenarioAge = result.scenarioRetirementAges[outlook];
    if (scenarioAge !== null) {
      assert.ok(scenarioAge >= details.age);
      assert.equal(model.financesRunOutBy(result.retirementPaths[outlook], details.age).depleted, false);
    }
  }
});

test("each outlook is one coherent representative future", () => {
  const runs = Array.from({ length: 10 }, (_, index) => ({
    success: true,
    points: [
      { age: 89, corpus: index * 10, expense: 1, requestedExpense: 1 },
      { age: 90, corpus: 100 - index * 5, expense: 1, requestedExpense: 1 },
    ],
  }));
  const paths = model.representativePaths(runs);
  assert.deepEqual(paths.cautious, runs[0].points);
  assert.deepEqual(paths.typical, runs[4].points);
  assert.deepEqual(paths.optimistic, runs[9].points);
  for (const path of Object.values(paths)) assert.ok(runs.some((run) => run.points === path));
});

test("runout summary returns the first shortfall age and calendar year", () => {
  const result = model.financesRunOutBy([
    { age: 34, corpus: 10_000, expense: 10_000, requestedExpense: 10_000 },
    { age: 35, corpus: 0, expense: 2_000, requestedExpense: 12_000 },
    { age: 36, corpus: 0, expense: 0, requestedExpense: 12_000 },
  ], 34, 2026);
  assert.deepEqual(result, { age: 35, year: 2027, depleted: true });
  assert.deepEqual(model.financesRunOutBy([
    { age: 34, corpus: 10_000, expense: 10_000, requestedExpense: 10_000 },
  ], 34, 2026), { age: 34, year: 2026, depleted: false });
});

test("a reported retirement age meets the 85 percent threshold", () => {
  const result = model.calculatePlan(details, dependents, loan, 42);
  assert.notEqual(result.retirementAge, null);
  assert.ok(result.successRate >= 0.85);
});

test("each economy has its own retirement age and matching sustainable projection", () => {
  const result = model.calculatePlan(details, dependents, loan, 42);
  assert.notEqual(result.scenarioRetirementAges.cautious, result.scenarioRetirementAges.optimistic);
  for (const outlook of ["cautious", "typical", "optimistic"]) {
    const age = result.scenarioRetirementAges[outlook];
    if (age !== null) {
      assert.equal(result.retirementPaths[outlook][0].age, details.age);
      assert.equal(model.financesRunOutBy(result.retirementPaths[outlook], details.age).depleted, false);
    }
  }
});

test("zero income does not invent a future retirement age", () => {
  const result = model.calculatePlan({ ...details, monthlyIncome: 0, monthlySip: 0, mutualFunds: 100_000 }, dependents, loan, 42);
  assert.equal(result.retirementAge, null);
});

test("good economy shows its own sustainable retirement age when the overall threshold fails", () => {
  const constrained = {
    ...details, mutualFunds: 19_700_000, monthlySip: 120_000, stocks: 100_000,
    fixedDeposits: 100_000, bankSavings: 100_000, monthlyIncome: 10_000, monthlyExpense: 120_000,
  };
  const result = model.calculatePlan(constrained, dependents, loan, 731942);
  assert.equal(result.retirementAge, null);
  assert.equal(result.scenarioRetirementAges.cautious, null);
  assert.equal(result.scenarioRetirementAges.optimistic, constrained.age);
  assert.equal(model.financesRunOutBy(result.retirementPaths.optimistic, constrained.age).depleted, false);
});

test("withdrawals exhaust savings before the next asset bucket", () => {
  const buckets = { savings: 50, fixedDeposits: 40, mutualFunds: 30, stocks: 20, realEstate: 10 };
  assert.equal(model.withdrawFromBuckets(buckets, 70), 70);
  assert.deepEqual(buckets, { savings: 0, fixedDeposits: 20, mutualFunds: 30, stocks: 20, realEstate: 10 });
});

test("recommendations do not claim an impossible single-lever solution", () => {
  const result = model.recommendationsFor(details, dependents, loan, details.age, 42);
  assert.equal(result.monthlySip, null);
  assert.equal(result.monthlyIncome, null);
  assert.ok(result.requiredCurrentCorpus > 0);
});

test("current-corpus fallback is sufficient for an otherwise impossible target", () => {
  const strained = { ...details, monthlyIncome: 0, monthlySip: 0, mutualFunds: 0, stocks: 0, fixedDeposits: 0, bankSavings: 0 };
  const recommendation = model.recommendationsFor(strained, dependents, loan, strained.age, 42);
  const funded = model.calculatePlan({ ...strained, bankSavings: recommendation.requiredCurrentCorpus }, dependents, loan, 42);
  assert.equal(funded.retirementAge, strained.age);
  assert.ok(funded.successRate >= 0.85);
});
