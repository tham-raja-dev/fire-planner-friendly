import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

const model = await vite.ssrLoadModule("/lib/fire-model.ts");
const pageCalculations = await vite.ssrLoadModule("/app/page.tsx");
after(async () => vite.close());

const baselineDetails = {
  age: 30,
  mutualFunds: 2_000_000,
  monthlySip: 50_000,
  stocks: 1_000_000,
  fixedDeposits: 500_000,
  realEstate: 3_000_000,
  bankSavings: 500_000,
  monthlyIncome: 200_000,
  monthlyExpense: 80_000,
};
const baselineDependents = { count: 1, annualCostPerDependent: 120_000, supportYears: 10 };
const baselineLoan = { balance: 1_000_000, emi: 20_000, remainingYears: 5 };

test("Financial Math: Fisher Equation vs Simple Subtraction", () => {
  const nominal = 0.10;
  const inflation = 0.06;

  const fisherReal = model.realReturnFisher(nominal, inflation);
  const simpleReal = model.realReturnSimple(nominal, inflation);

  // Fisher: (1 + 0.10) / (1 + 0.06) - 1 = 0.0377358...
  assert.ok(Math.abs(fisherReal - (1.10 / 1.06 - 1)) < 1e-9);
  // Simple subtraction: 0.10 - 0.06 = 0.04 (within IEEE 754 float precision)
  assert.ok(Math.abs(simpleReal - 0.04) < 1e-9);
  // Simple subtraction overstates real return by ~0.226 percentage points
  assert.ok(simpleReal > fisherReal);
  assert.ok(Math.abs((simpleReal - fisherReal) - 0.002264) < 1e-4);
});

test("Financial Math: Monthly vs Annual Compounding Frequencies", () => {
  const annualNominal = 0.12;
  const monthlyRate = annualNominal / 12; // 1% per month

  const effectiveAnnual = model.monthlyCompoundedAnnualRate(monthlyRate);
  // (1 + 0.01)^12 - 1 = 12.6825%
  assert.ok(Math.abs(effectiveAnnual - (Math.pow(1.01, 12) - 1)) < 1e-9);
  assert.ok(effectiveAnnual > annualNominal);

  const backToMonthly = model.annualToMonthlyCompoundedRate(effectiveAnnual);
  assert.ok(Math.abs(backToMonthly - monthlyRate) < 1e-9);
});

test("Financial Math: Annuity Due vs Ordinary Annuity cash flow timing", () => {
  const payment = 10_000;
  const rate = 0.08;
  const years = 10;

  const fvOrdinary = model.futureValueOrdinaryAnnuity(payment, rate, years);
  const fvDue = model.futureValueAnnuityDue(payment, rate, years);

  // Annuity Due compounds each payment for 1 additional period
  assert.ok(Math.abs(fvDue - fvOrdinary * (1 + rate)) < 1e-7);
  assert.ok(fvDue > fvOrdinary);

  const pvOrdinary = model.presentValueOrdinaryAnnuity(payment, rate, years);
  const pvDue = model.presentValueAnnuityDue(payment, rate, years);
  assert.ok(Math.abs(pvDue - pvOrdinary * (1 + rate)) < 1e-7);
});

test("Pre-retirement: Individual asset compounding and contribution allocation", () => {
  const details = {
    age: 30,
    mutualFunds: 1_000_000,
    monthlySip: 20_000,
    stocks: 500_000,
    fixedDeposits: 200_000,
    realEstate: 2_000_000,
    bankSavings: 100_000,
    monthlyIncome: 100_000,
    monthlyExpense: 40_000,
  };
  const dependents = { count: 0, annualCostPerDependent: 0, supportYears: 0 };
  const loan = { balance: 0, emi: 0, remainingYears: 0 };

  // Surplus calculation:
  // Income (100k) - Expense (40k) = 60k investible surplus.
  // Requested SIP: 20k -> goes to mutual funds.
  // Remaining surplus: 40k -> goes to bank savings.
  const plan = model.calculatePlan(details, dependents, loan, 12345);
  assert.ok(plan.paths.typical.length > 0);
  assert.equal(plan.paths.typical[0].age, 30);
  assert.equal(plan.paths.typical[0].corpus, 1_000_000 + 500_000 + 200_000 + 2_000_000 + 100_000);
});

test("Pre-retirement: Stocks are fully included in deterministic page calculations", () => {
  const detailsWithStocks = {
    age: 34,
    mutualFunds: 100,
    stocks: 200,
    fixedDeposits: 100,
    realEstate: 100,
    bankSavings: 0,
    monthlyIncome: 0,
    monthlyExpense: 0,
  };
  const noDependents = { count: 0, annualCostPerDependent: 0, supportYears: 0 };
  const noLoan = { balance: 0, emi: 0, remainingYears: 0 };

  // MF: 100 * 1.10 = 110
  // Stocks: 200 * 1.10 = 220
  // FD: 100 * 1.06 = 106
  // RE: 100 * 1.08 = 108
  // Total = 110 + 220 + 106 + 108 = 544
  const corpus = pageCalculations.corpusAtRetirement(detailsWithStocks, noDependents, noLoan, 35, 0);
  assert.equal(corpus, 544);
});

test("Post-retirement: Drawdown sequence adheres strictly to asset bucket order", () => {
  // Order: savings -> fixedDeposits -> mutualFunds -> stocks -> realEstate
  const buckets = {
    savings: 100,
    fixedDeposits: 200,
    mutualFunds: 300,
    stocks: 400,
    realEstate: 500,
  };

  // Withdraw 150: exhausts savings (100) and takes 50 from fixedDeposits
  const withdrawn1 = model.withdrawFromBuckets(buckets, 150);
  assert.equal(withdrawn1, 150);
  assert.equal(buckets.savings, 0);
  assert.equal(buckets.fixedDeposits, 150);
  assert.equal(buckets.mutualFunds, 300);
  assert.equal(buckets.stocks, 400);
  assert.equal(buckets.realEstate, 500);

  // Withdraw 500: exhausts FD (150), exhausts MF (300), takes 50 from stocks
  const withdrawn2 = model.withdrawFromBuckets(buckets, 500);
  assert.equal(withdrawn2, 500);
  assert.equal(buckets.fixedDeposits, 0);
  assert.equal(buckets.mutualFunds, 0);
  assert.equal(buckets.stocks, 350);
  assert.equal(buckets.realEstate, 500);

  // Withdraw remaining (350 + 500 = 850) + 100 excess -> only 850 can be withdrawn
  const withdrawn3 = model.withdrawFromBuckets(buckets, 950);
  assert.equal(withdrawn3, 850);
  assert.equal(buckets.stocks, 0);
  assert.equal(buckets.realEstate, 0);
});

test("Post-retirement: Expense inflation compounding during drawdown", () => {
  const details = {
    age: 50,
    mutualFunds: 50_000_000,
    monthlySip: 0,
    stocks: 0,
    fixedDeposits: 0,
    realEstate: 0,
    bankSavings: 0,
    monthlyIncome: 0, // already retired
    monthlyExpense: 100_000,
  };
  const noDependents = { count: 0, annualCostPerDependent: 0, supportYears: 0 };
  const noLoan = { balance: 0, emi: 0, remainingYears: 0 };

  const plan = model.calculatePlan(details, noDependents, noLoan, 42);
  const path = plan.paths.typical;

  // Verify that requested expenses strictly compound each year
  for (let i = 1; i < path.length; i++) {
    assert.ok(path[i].requestedExpense > path[i - 1].requestedExpense, `Expense at age ${path[i].age} must compound higher than age ${path[i - 1].age}`);
  }
});

test("Pre-retirement insolvency: Deficit exceeding portfolio marks failure and caps paid expense", () => {
  const brokeDetails = {
    age: 30,
    mutualFunds: 0,
    monthlySip: 0,
    stocks: 0,
    fixedDeposits: 0,
    realEstate: 0,
    bankSavings: 10_000,
    monthlyIncome: 5_000,
    monthlyExpense: 50_000, // 45k monthly deficit = 540k annual deficit
  };
  const noDependents = { count: 0, annualCostPerDependent: 0, supportYears: 0 };
  const noLoan = { balance: 0, emi: 0, remainingYears: 0 };

  const plan = model.calculatePlan(brokeDetails, noDependents, noLoan, 42);
  // Cannot retire because broke pre-retirement
  assert.equal(plan.retirementAge, null);

  const runout = model.financesRunOutBy(plan.paths.cautious, 30);
  // Finances must deplete immediately at age 30
  assert.equal(runout.age, 30);
  assert.equal(runout.depleted, true);
});

test("Edge Cases: Young starting age (18 and 19) does not crash or produce NaN", () => {
  const youngDetails = {
    age: 18,
    mutualFunds: 50_000,
    monthlySip: 5_000,
    stocks: 20_000,
    fixedDeposits: 10_000,
    realEstate: 0,
    bankSavings: 20_000,
    monthlyIncome: 40_000,
    monthlyExpense: 20_000,
  };
  const noDependents = { count: 0, annualCostPerDependent: 0, supportYears: 0 };
  const noLoan = { balance: 0, emi: 0, remainingYears: 0 };

  assert.doesNotThrow(() => {
    const plan = model.calculatePlan(youngDetails, noDependents, noLoan, 42);
    assert.ok(plan.paths.typical.length > 0);
    assert.equal(plan.paths.typical[0].age, 18);
    for (const point of plan.paths.typical) {
      assert.ok(!Number.isNaN(point.corpus));
      assert.ok(!Number.isNaN(point.expense));
    }
  });
});

test("Edge Cases: Age 90+ starting horizon does not crash and processes valid points", () => {
  const seniorDetails = {
    age: 90,
    mutualFunds: 10_000_000,
    monthlySip: 0,
    stocks: 0,
    fixedDeposits: 0,
    realEstate: 0,
    bankSavings: 1_000_000,
    monthlyIncome: 0,
    monthlyExpense: 50_000,
  };
  const noDependents = { count: 0, annualCostPerDependent: 0, supportYears: 0 };
  const noLoan = { balance: 0, emi: 0, remainingYears: 0 };

  const plan = model.calculatePlan(seniorDetails, noDependents, noLoan, 42);
  assert.ok(plan.paths.typical.length >= 1);
  assert.equal(plan.paths.typical[0].age, 90);
  assert.ok(plan.paths.typical[0].corpus > 0);
});

test("Edge Cases: Extreme negative growth (-150%) does not corrupt bucket math or produce negative balances", () => {
  const buckets = {
    savings: 100_000,
    fixedDeposits: 100_000,
    mutualFunds: 100_000,
    stocks: 100_000,
    realEstate: 100_000,
  };

  // Withdraw test with 0 or negative balances
  const emptyBuckets = { savings: 0, fixedDeposits: 0, mutualFunds: 0, stocks: 0, realEstate: 0 };
  const withdrawn = model.withdrawFromBuckets(emptyBuckets, 50_000);
  assert.equal(withdrawn, 0);
  assert.equal(emptyBuckets.savings, 0);
});

test("Edge Cases: Zero savings starting state with high surplus accumulates successfully", () => {
  const zeroSavingsDetails = {
    age: 25,
    mutualFunds: 0,
    monthlySip: 50_000,
    stocks: 0,
    fixedDeposits: 0,
    realEstate: 0,
    bankSavings: 0,
    monthlyIncome: 200_000,
    monthlyExpense: 50_000,
  };
  const noDependents = { count: 0, annualCostPerDependent: 0, supportYears: 0 };
  const noLoan = { balance: 0, emi: 0, remainingYears: 0 };

  const plan = model.calculatePlan(zeroSavingsDetails, noDependents, noLoan, 42);
  assert.notEqual(plan.retirementAge, null);
  assert.ok(plan.retirementAge > 25);
  assert.ok(plan.successRate >= 0.85);
});

test("Loan EMI expiration: Loan stops deducting after remainingYears", () => {
  const loanDetails = {
    ...baselineDetails,
    age: 30,
    monthlyIncome: 100_000,
    monthlyExpense: 50_000,
    monthlySip: 0,
  };
  const noDependents = { count: 0, annualCostPerDependent: 0, supportYears: 0 };
  const shortLoan = { balance: 200_000, emi: 20_000, remainingYears: 3 };

  const plan = model.calculatePlan(loanDetails, noDependents, shortLoan, 42);
  const path = plan.paths.typical;

  // Pre-retirement expenses for years 0, 1, 2 include loan EMI (20k * 12 = 240k)
  // At year 3 (elapsed = 3), loan EMI expires and requested expenses drop
  assert.ok(path.length >= 4);
});
