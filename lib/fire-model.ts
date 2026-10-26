export const LIFE_EXPECTANCY = 90;
export const SIMULATION_COUNT = 1000;
export const SUCCESS_THRESHOLD = 0.85;
export const MODEL_VERSION = "2026-10-mc-v4";

export type Details = {
  age: number; mutualFunds: number; monthlySip: number; stocks: number;
  fixedDeposits: number; realEstate: number; bankSavings: number;
  monthlyIncome: number; monthlyExpense: number;
};
export type Dependents = { count: number; annualCostPerDependent: number; supportYears: number };
export type Loan = { balance: number; emi: number; remainingYears: number };
export type Outlook = "cautious" | "typical" | "optimistic";
export type YearPoint = { age: number; corpus: number; expense: number; requestedExpense: number };
export type RateKey = "inflation" | "savings" | "mutualFunds" | "stocks" | "fixedDeposits" | "realEstate";
export type RateSummary = Record<RateKey, { average: number; min: number; max: number }>;
export type Recommendation = {
  monthlySip: number | null; monthlyIncome: number | null; monthlyExpense: number | null;
  requiredCurrentCorpus: number;
};
export type SimulationResult = {
  retirementAge: number | null; successRate: number;
  paths: Record<Outlook, YearPoint[]>; rateSummaries: Record<Outlook, RateSummary>;
  scenarioRetirementAges: Record<Outlook, number | null>; retirementPaths: Record<Outlook, YearPoint[]>;
  samples: number[][]; expenseSamples: number[][]; sampleRateSummaries: RateSummary[]; seed: number;
};

export const BASE_RATES = {
  inflation: 0.06, savings: 0.04, mutualFunds: 0.10,
  stocks: 0.10, fixedDeposits: 0.06, realEstate: 0.08,
} as const;
export const SIMULATION_RATE_BOUNDS: Record<RateKey, { min: number; max: number }> = {
  inflation: { min: 0.01, max: 0.12 }, savings: { min: 0, max: 0.08 },
  mutualFunds: { min: -0.42, max: 0.45 }, stocks: { min: -0.52, max: 0.55 },
  fixedDeposits: { min: 0.02, max: 0.10 }, realEstate: { min: -0.18, max: 0.30 },
};

type Shocks = { inflation: number; savings: number; mutualFunds: number; stocks: number; fixedDeposits: number; realEstate: number };
type Buckets = { savings: number; fixedDeposits: number; mutualFunds: number; stocks: number; realEstate: number };

function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
function normal(random: () => number) {
  const a = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * random());
}
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function scenarioMatrix(seed: number, count = SIMULATION_COUNT): Shocks[][] {
  const random = mulberry32(seed);
  return Array.from({ length: count }, () =>
    Array.from({ length: LIFE_EXPECTANCY - 19 }, () => {
      const market = normal(random);
      const inflationShock = normal(random);
      return {
        inflation: clamp(BASE_RATES.inflation + inflationShock * 0.018, SIMULATION_RATE_BOUNDS.inflation.min, SIMULATION_RATE_BOUNDS.inflation.max),
        savings: clamp(BASE_RATES.savings + normal(random) * 0.006, SIMULATION_RATE_BOUNDS.savings.min, SIMULATION_RATE_BOUNDS.savings.max),
        mutualFunds: clamp(BASE_RATES.mutualFunds + market * 0.12 + normal(random) * 0.08, SIMULATION_RATE_BOUNDS.mutualFunds.min, SIMULATION_RATE_BOUNDS.mutualFunds.max),
        stocks: clamp(BASE_RATES.stocks + market * 0.15 + normal(random) * 0.11, SIMULATION_RATE_BOUNDS.stocks.min, SIMULATION_RATE_BOUNDS.stocks.max),
        fixedDeposits: clamp(BASE_RATES.fixedDeposits + normal(random) * 0.009, SIMULATION_RATE_BOUNDS.fixedDeposits.min, SIMULATION_RATE_BOUNDS.fixedDeposits.max),
        realEstate: clamp(BASE_RATES.realEstate + market * 0.04 + normal(random) * 0.075, SIMULATION_RATE_BOUNDS.realEstate.min, SIMULATION_RATE_BOUNDS.realEstate.max),
      };
    }),
  );
}

export function simulationRateFrames(seed = 731942, count = 12): Record<RateKey, number>[] {
  return scenarioMatrix(seed, 1)[0].slice(0, count);
}

const dependentMonthlyCost = (dependents: Dependents) => dependents.count * dependents.annualCostPerDependent / 12;
const total = (b: Buckets) => b.savings + b.fixedDeposits + b.mutualFunds + b.stocks + b.realEstate;
function grow(b: Buckets, rates: Shocks) {
  b.savings *= 1 + rates.savings;
  b.fixedDeposits *= 1 + rates.fixedDeposits;
  b.mutualFunds *= 1 + rates.mutualFunds;
  b.stocks *= 1 + rates.stocks;
  b.realEstate *= 1 + rates.realEstate;
}
export function withdrawFromBuckets(b: Buckets, amount: number) {
  let remaining = amount;
  for (const key of ["savings", "fixedDeposits", "mutualFunds", "stocks", "realEstate"] as const) {
    const used = Math.min(b[key], remaining);
    b[key] -= used;
    remaining -= used;
  }
  return amount - remaining;
}

function runPath(details: Details, dependents: Dependents, loan: Loan, retirementAge: number, shocks: Shocks[]): { points: YearPoint[]; success: boolean } {
  const buckets: Buckets = {
    savings: details.bankSavings, fixedDeposits: details.fixedDeposits,
    mutualFunds: details.mutualFunds, stocks: details.stocks, realEstate: details.realEstate,
  };
  let expenseMultiplier = 1;
  const points: YearPoint[] = [];
  let success = true;
  for (let age = details.age; age <= LIFE_EXPECTANCY; age += 1) {
    const elapsed = age - details.age;
    const rates = shocks[age - 20];
    const dependentCost = elapsed < dependents.supportYears ? dependentMonthlyCost(dependents) * expenseMultiplier : 0;
    const loanCost = elapsed < loan.remainingYears ? loan.emi : 0;
    const requestedExpense = (details.monthlyExpense * expenseMultiplier + dependentCost + loanCost) * 12;
    const displayedCorpus = total(buckets);
    let paidExpense = requestedExpense;
    if (age < retirementAge) {
      grow(buckets, rates);
      const income = details.monthlyIncome * expenseMultiplier;
      const availableAfterCosts = income - details.monthlyExpense * expenseMultiplier - dependentCost - loanCost;
      if (availableAfterCosts < 0) withdrawFromBuckets(buckets, Math.abs(availableAfterCosts) * 12);
      const affordableSip = Math.min(details.monthlySip * expenseMultiplier, Math.max(0, availableAfterCosts));
      buckets.mutualFunds += affordableSip * 12;
      buckets.savings += Math.max(0, availableAfterCosts - affordableSip) * 12;
    } else {
      grow(buckets, rates);
      paidExpense = withdrawFromBuckets(buckets, requestedExpense);
      if (paidExpense + 0.01 < requestedExpense) success = false;
    }
    points.push({ age, corpus: displayedCorpus, expense: paidExpense, requestedExpense });
    expenseMultiplier *= 1 + rates.inflation;
  }
  return { points, success };
}

function successAt(details: Details, dependents: Dependents, loan: Loan, retirementAge: number, matrix: Shocks[][]) {
  let successes = 0;
  for (const shocks of matrix) if (runPath(details, dependents, loan, retirementAge, shocks).success) successes += 1;
  return successes / matrix.length;
}

function earliestSustainableAge(details: Details, dependents: Dependents, loan: Loan, shocks: Shocks[]): number | null {
  const candidates = details.monthlyIncome === 0 ? [details.age] : Array.from({ length: LIFE_EXPECTANCY - details.age }, (_, index) => details.age + index);
  return candidates.find((age) => runPath(details, dependents, loan, age, shocks).success) ?? null;
}

const percentileIndex: Record<Outlook, number> = { cautious: 0, typical: 0.50, optimistic: 1 };
function rankedRunIndices(runs: ReturnType<typeof runPath>[]) {
  return runs.map((run, index) => {
    const shortfall = run.points.find((point) => point.expense + 0.01 < point.requestedExpense);
    return {
      run,
      index,
      depletionAge: shortfall?.age ?? LIFE_EXPECTANCY + 1,
      lifetimeCorpus: run.points.reduce((sum, point) => sum + point.corpus, 0),
      terminalCorpus: run.points.at(-1)?.corpus ?? 0,
    };
  }).sort((a, b) =>
    a.depletionAge - b.depletionAge
    || a.lifetimeCorpus - b.lifetimeCorpus
    || a.terminalCorpus - b.terminalCorpus
    || a.index - b.index,
  ).map(({ index }) => index);
}
function representativeRunIndices(runs: ReturnType<typeof runPath>[]): Record<Outlook, number> {
  const ranked = rankedRunIndices(runs);
  return { cautious: ranked[Math.floor((ranked.length - 1) * percentileIndex.cautious)], typical: ranked[Math.floor((ranked.length - 1) * percentileIndex.typical)], optimistic: ranked[Math.floor((ranked.length - 1) * percentileIndex.optimistic)] };
}
export function representativePaths(runs: ReturnType<typeof runPath>[]): Record<Outlook, YearPoint[]> {
  const indices = representativeRunIndices(runs);
  const build = (outlook: Outlook) => runs[indices[outlook]].points;
  return { cautious: build("cautious"), typical: build("typical"), optimistic: build("optimistic") };
}

export function financesRunOutBy(path: YearPoint[], currentAge: number, currentYear = new Date().getFullYear()) {
  const underfundedPoint = path.find((point) => point.expense + 0.01 < point.requestedExpense);
  const age = underfundedPoint?.age ?? path.at(-1)?.age ?? currentAge;
  return { age, year: currentYear + age - currentAge, depleted: underfundedPoint !== undefined };
}

function representativeRateSummaries(runs: ReturnType<typeof runPath>[], matrix: Shocks[][]): Record<Outlook, RateSummary> {
  const indices = representativeRunIndices(runs);
  const summarize = (outlook: Outlook) => {
    const runIndex = indices[outlook];
    const yearlyRates = runs[runIndex].points.map((point) => matrix[runIndex][point.age - 20]);
    return Object.fromEntries((Object.keys(BASE_RATES) as RateKey[]).map((key) => {
      const values = yearlyRates.map((rates) => rates[key]);
      return [key, { average: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values), max: Math.max(...values) }];
    })) as RateSummary;
  };
  return { cautious: summarize("cautious"), typical: summarize("typical"), optimistic: summarize("optimistic") };
}

function rateSummaryForRun(run: ReturnType<typeof runPath>, shocks: Shocks[]): RateSummary {
  const yearlyRates = run.points.map((point) => shocks[point.age - 20]);
  return Object.fromEntries((Object.keys(BASE_RATES) as RateKey[]).map((key) => {
    const values = yearlyRates.map((rates) => rates[key]);
    return [key, { average: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values), max: Math.max(...values) }];
  })) as RateSummary;
}

export function calculatePlan(details: Details, dependents: Dependents, loan: Loan, seed = 731942): SimulationResult {
  const matrix = scenarioMatrix(seed);
  let retirementAge: number | null = null;
  let successRate = 0;
  const candidates = details.monthlyIncome === 0 ? [details.age] : Array.from({ length: LIFE_EXPECTANCY - details.age }, (_, i) => details.age + i);
  for (const age of candidates) {
    const rate = successAt(details, dependents, loan, age, matrix);
    if (rate >= SUCCESS_THRESHOLD) { retirementAge = age; successRate = rate; break; }
  }
  const chartAge = retirementAge ?? details.age;
  const runs = matrix.map((shocks) => runPath(details, dependents, loan, chartAge, shocks));
  if (retirementAge === null) successRate = runs.filter((run) => run.success).length / runs.length;
  const ranked = rankedRunIndices(runs);
  const representativeIndices = representativeRunIndices(runs);
  const scenarioRetirementAges = Object.fromEntries((Object.keys(representativeIndices) as Outlook[]).map((outlook) => [
    outlook,
    earliestSustainableAge(details, dependents, loan, matrix[representativeIndices[outlook]]),
  ])) as Record<Outlook, number | null>;
  const retirementPaths = Object.fromEntries((Object.keys(representativeIndices) as Outlook[]).map((outlook) => {
    const runIndex = representativeIndices[outlook];
    const age = scenarioRetirementAges[outlook] ?? details.age;
    return [outlook, runPath(details, dependents, loan, age, matrix[runIndex]).points];
  })) as Record<Outlook, YearPoint[]>;
  const sampledIndices = Array.from({ length: 100 }, (_, index) => ranked[Math.round(index * (ranked.length - 1) / 99)]);
  const sampledRuns = sampledIndices.map((index) => runs[index]);
  return {
    retirementAge, successRate, paths: representativePaths(runs), rateSummaries: representativeRateSummaries(runs, matrix),
    scenarioRetirementAges, retirementPaths, seed,
    samples: sampledRuns.map((run) => run.points.map((point) => point.corpus)),
    expenseSamples: sampledRuns.map((run) => run.points.map((point) => point.expense)),
    sampleRateSummaries: sampledIndices.map((index) => rateSummaryForRun(runs[index], matrix[index])),
  };
}

export function recommendationsFor(details: Details, dependents: Dependents, loan: Loan, targetAge: number, seed = 731942): Recommendation {
  const matrix = scenarioMatrix(seed);
  const passes = (candidate: Details) => successAt(candidate, dependents, loan, targetAge, matrix) >= SUCCESS_THRESHOLD;
  const searchMinimum = (key: "monthlySip" | "monthlyIncome", high: number) => {
    if (!passes({ ...details, [key]: high })) return null;
    let low = 0;
    for (let i = 0; i < 22; i += 1) {
      const middle = (low + high) / 2;
      if (passes({ ...details, [key]: middle })) high = middle; else low = middle;
    }
    return Math.ceil(high / 500) * 500;
  };
  let lowExpense = 0;
  let highExpense = details.monthlyExpense;
  for (let i = 0; i < 22; i += 1) {
    const middle = (lowExpense + highExpense) / 2;
    if (passes({ ...details, monthlyExpense: middle })) lowExpense = middle; else highExpense = middle;
  }
  const currentCorpus = details.bankSavings + details.fixedDeposits + details.mutualFunds + details.stocks + details.realEstate;
  let requiredSavings = details.bankSavings;
  if (!passes(details)) {
    let low = details.bankSavings;
    let high = Math.max(details.bankSavings, 100_000);
    while (!passes({ ...details, bankSavings: high }) && high < 1_000_000_000_000) high *= 2;
    for (let i = 0; i < 32; i += 1) {
      const middle = (low + high) / 2;
      if (passes({ ...details, bankSavings: middle })) high = middle; else low = middle;
    }
    requiredSavings = high;
  }
  return {
    monthlySip: searchMinimum("monthlySip", Math.max(details.monthlySip, details.monthlyIncome)),
    monthlyIncome: searchMinimum("monthlyIncome", 2_000_000),
    monthlyExpense: passes({ ...details, monthlyExpense: 0 }) ? Math.floor(lowExpense / 500) * 500 : null,
    requiredCurrentCorpus: Math.ceil((currentCorpus + requiredSavings - details.bankSavings) / 10_000) * 10_000,
  };
}

export function projectScenario(details: Details, dependents: Dependents, loan: Loan, retirementAge: number, seed = 731942) {
  const matrix = scenarioMatrix(seed);
  const runs = matrix.map((shocks) => runPath(details, dependents, loan, retirementAge, shocks));
  return {
    successRate: runs.filter((run) => run.success).length / runs.length,
    paths: representativePaths(runs),
    rateSummaries: representativeRateSummaries(runs, matrix),
  };
}
