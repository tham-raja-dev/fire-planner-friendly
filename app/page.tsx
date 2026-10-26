"use client";

import Image from "next/image";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CirclePlus, Download, FileSpreadsheet, FileText, Landmark, Pencil, Share2, SlidersHorizontal, Trash2, X } from "lucide-react";
import { BASE_RATES, LIFE_EXPECTANCY, MODEL_VERSION, financesRunOutBy, projectScenario, simulationRateFrames } from "@/lib/fire-model";
import type { Outlook, RateKey, Recommendation, SimulationResult, YearPoint } from "@/lib/fire-model";
import expenditureIcon from "@/public/details-expenditure.svg";
import incomeIcon from "@/public/details-income.svg";
import investmentsIcon from "@/public/details-investments.svg";

type Details = {
  age: number; mutualFunds: number; monthlySip: number; stocks: number; fixedDeposits: number; realEstate: number;
  bankSavings: number; monthlyIncome: number; monthlyExpense: number;
};
type Dependents = { count: number; annualCostPerDependent: number; supportYears: number };
type DependantEntry = { id: number; annualCost: number; supportYears: number };
type Loan = { balance: number; emi: number; remainingYears: number };
type Scenario = { monthlyInvestment: number; monthlyIncome: number; monthlyExpense: number; incomeAnchor: number };

const DEFAULTS: Details = {
  age: 34, mutualFunds: 4_000_000, monthlySip: 120_000, stocks: 120_000, fixedDeposits: 120_000, realEstate: 0,
  bankSavings: 100_000,
  monthlyIncome: 120_000, monthlyExpense: 120_000,
};
const DEFAULT_DEPENDENTS: Dependents = { count: 0, annualCostPerDependent: 0, supportYears: 10 };
const DEFAULT_LOAN: Loan = { balance: 0, emi: 0, remainingYears: 5 };
const MUTUAL_FUND_RETURN = 0.10;
const FIXED_DEPOSIT_RETURN = 0.06;
const REAL_ESTATE_RETURN = 0.08;
const NEW_SAVINGS_RETURN = 0.04;
const POST_RETIREMENT_RETURN = 0.07;
const INFLATION = 0.06;
const OUTLOOKS = ["cautious", "typical", "optimistic"] as const;
const assetPath = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
const outlookLabel = (value: Outlook) => value === "cautious" ? "Bad economy" : value === "typical" ? "Average economy" : "Good economy";
const ECONOMY_OPTIONS: { value: Outlook; label: string }[] = [
  { value: "cautious", label: "In bad economy" },
  { value: "typical", label: "In average economy" },
  { value: "optimistic", label: "In good economy" },
];
const ECONOMY_ICON_ASSETS: Record<Outlook, Record<Outlook, string>> = {
  cautious: {
    cautious: assetPath("/economy-bad-active.svg"), typical: assetPath("/economy-average-inactive-bad.svg"), optimistic: assetPath("/economy-good-inactive-bad.svg"),
  },
  typical: {
    cautious: assetPath("/economy-bad-inactive-average.svg"), typical: assetPath("/economy-average-active.svg"), optimistic: assetPath("/economy-good-inactive-average.svg"),
  },
  optimistic: {
    cautious: assetPath("/economy-bad-inactive-good.svg"), typical: assetPath("/economy-average-inactive-good.svg"), optimistic: assetPath("/economy-good-active.svg"),
  },
};
const RATE_KEYS: RateKey[] = ["mutualFunds", "stocks", "fixedDeposits", "realEstate", "savings", "inflation"];
const percentage = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%`;
const compactPercentageRange = (minimum: number, maximum: number) => minimum === maximum
  ? percentage(minimum)
  : `${percentage(minimum)}–${percentage(maximum)}`;
const LOADING_MESSAGES = [
  "Exploring different possible futures",
  "Testing changes in growth and inflation",
  "Checking how long your money could last",
  "Finding a retirement age that holds up",
] as const;
const RESULT_RATE_LABELS: Record<RateKey, string> = {
  inflation: "Inflation", mutualFunds: "MF growth", stocks: "Stock growth",
  fixedDeposits: "FD interest rate", realEstate: "Real estate growth", savings: "Savings growth",
};

const inr = (value: number, compact = true) => {
  if (compact && value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)} cr`;
  if (compact && value >= 100_000) return `₹${(value / 100_000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
};
const chartMetric = (value: number) => {
  if (value >= 10_000_000) return `${(value / 10_000_000).toFixed(2)}cr`;
  if (value >= 100_000) return `${(value / 100_000).toFixed(2)}L`;
  return Math.round(value).toLocaleString("en-IN");
};
const dependentMonthlyCost = (dependents: Dependents) => dependents.count * dependents.annualCostPerDependent / 12;
const investedTotal = (details: Details) => details.mutualFunds + details.fixedDeposits + details.realEstate + details.bankSavings;
const baselineInvestment = (details: Details, dependents: Dependents, loan: Loan) =>
  Math.max(0, details.monthlyIncome - details.monthlyExpense - dependentMonthlyCost(dependents) - loan.emi);

function monthlyInvestmentAt(details: Details, dependents: Dependents, loan: Loan, monthlyInvestment: number, elapsed: number) {
  const releasedLoanEmi = elapsed >= loan.remainingYears ? loan.emi : 0;
  const releasedDependentCost = elapsed >= dependents.supportYears ? dependentMonthlyCost(dependents) : 0;
  return (monthlyInvestment + releasedLoanEmi + releasedDependentCost) * Math.pow(1 + INFLATION, elapsed);
}

function annualRetirementCost(details: Details, dependents: Dependents, loan: Loan, monthlyExpense: number, elapsed: number) {
  const livingCosts = monthlyExpense * Math.pow(1 + INFLATION, elapsed);
  const dependentCosts = elapsed < dependents.supportYears ? dependentMonthlyCost(dependents) * Math.pow(1 + INFLATION, elapsed) : 0;
  const loanCosts = elapsed < loan.remainingYears ? loan.emi : 0;
  return (livingCosts + dependentCosts + loanCosts) * 12;
}

export function corpusAtRetirement(details: Details, dependents: Dependents, loan: Loan, retirementAge: number, monthlyInvestment: number) {
  let mutualFunds = details.mutualFunds;
  let fixedDeposits = details.fixedDeposits;
  let realEstate = details.realEstate;
  let newSavings = details.bankSavings;
  for (let age = details.age; age < retirementAge; age += 1) {
    const elapsed = age - details.age;
    mutualFunds *= 1 + MUTUAL_FUND_RETURN;
    fixedDeposits *= 1 + FIXED_DEPOSIT_RETURN;
    realEstate *= 1 + REAL_ESTATE_RETURN;
    newSavings = newSavings * (1 + NEW_SAVINGS_RETURN) + monthlyInvestmentAt(details, dependents, loan, monthlyInvestment, elapsed) * 12;
  }
  return mutualFunds + fixedDeposits + realEstate + newSavings;
}

export function corpusLastsToLifeExpectancy(details: Details, dependents: Dependents, loan: Loan, retirementAge: number, monthlyInvestment: number, monthlyExpense: number) {
  let corpus = corpusAtRetirement(details, dependents, loan, retirementAge, monthlyInvestment);
  for (let age = retirementAge; age <= LIFE_EXPECTANCY; age += 1) {
    const elapsed = age - details.age;
    corpus = corpus * (1 + POST_RETIREMENT_RETURN) - annualRetirementCost(details, dependents, loan, monthlyExpense, elapsed);
    if (corpus < 0) return false;
  }
  return true;
}

export function retirementAgeFor(details: Details, dependents: Dependents, loan: Loan, investmentOverride?: number, expenseOverride?: number) {
  const monthlyInvestment = investmentOverride ?? baselineInvestment(details, dependents, loan);
  const monthlyExpense = expenseOverride ?? details.monthlyExpense;
  if (details.monthlyIncome === 0) {
    return corpusLastsToLifeExpectancy(details, dependents, loan, details.age, monthlyInvestment, monthlyExpense) ? details.age : null;
  }
  for (let age = details.age; age < LIFE_EXPECTANCY; age += 1) {
    if (corpusLastsToLifeExpectancy(details, dependents, loan, age, monthlyInvestment, monthlyExpense)) return age;
  }
  return null;
}

function RangeField({ label, value, onChange, min, max, step = 1000, prefix = "₹", onInteract, className = "" }: {
  label: string; value: number; onChange: (value: number) => void;
  min: number; max: number; step?: number; prefix?: string; onInteract?: () => void; className?: string;
}) {
  const labelId = useId();
  const [editing, setEditing] = useState(false);
  const [hasEdited, setHasEdited] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const numberInputRef = useRef<HTMLInputElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaretRef.current === null) return;
    numberInputRef.current?.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
    pendingCaretRef.current = null;
  }, [draft, hasEdited]);
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <div className={`range-field ${className}`} onPointerDown={onInteract}>
      <span id={labelId}>{label}</span>
      <div className="number-wrap">
        {prefix && <span>{prefix}</span>}
        <input
          ref={numberInputRef}
          className="number-value"
          inputMode="numeric"
          value={editing && hasEdited ? draft : value.toLocaleString("en-IN")}
          aria-label={`${label} value`}
          onDoubleClick={() => numberInputRef.current?.select()}
          onFocus={() => { setEditing(true); setHasEdited(false); setDraft(String(value)); onInteract?.(); }}
          onBlur={() => { setEditing(false); setHasEdited(false); }}
          onChange={(event) => {
            const caret = event.target.selectionStart ?? event.target.value.length;
            const digitCaret = event.target.value.slice(0, caret).replace(/\D/g, "").length;
            const raw = event.target.value.replace(/\D/g, "");
            pendingCaretRef.current = digitCaret;
            setHasEdited(true);
            setDraft(raw);
            if (raw === "") return;
            onChange(Math.min(max, Math.max(min, Number(raw))));
          }}
        />
      </div>
      <input
        className="value-slider"
        style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        type="range" min={min} max={max} step={step} value={value}
        onFocus={onInteract}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-labelledby={labelId}
      />
    </div>
  );
}

function AgeWheel({ age, onChange }: { age: number; onChange: (age: number) => void }) {
  const wheelRef = useRef<HTMLDivElement>(null);
  const initialAge = useRef(age);
  const minimumAge = 18;
  const maximumAge = 70;
  const rowHeight = 88;
  useLayoutEffect(() => {
    if (wheelRef.current) wheelRef.current.scrollTop = (initialAge.current - minimumAge) * rowHeight;
  }, []);
  return <div
    ref={wheelRef}
    className="age-wheel"
    role="spinbutton"
    aria-label="Your age"
    aria-valuemin={minimumAge}
    aria-valuemax={maximumAge}
    aria-valuenow={age}
    tabIndex={0}
    onScroll={(event) => {
      const nextAge = Math.min(maximumAge, Math.max(minimumAge, minimumAge + Math.round(event.currentTarget.scrollTop / rowHeight)));
      if (nextAge !== age) onChange(nextAge);
    }}
    onKeyDown={(event) => {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextAge = Math.min(maximumAge, Math.max(minimumAge, age + (event.key === "ArrowUp" ? -1 : 1)));
        if (wheelRef.current) wheelRef.current.scrollTop = (nextAge - minimumAge) * rowHeight;
      }
    }}
  >
    <div className="age-wheel-fade age-wheel-fade-top" />
    <div className="age-wheel-values" aria-hidden="true">
      {Array.from({ length: maximumAge - minimumAge + 1 }, (_, index) => index + minimumAge).map((value) => <span className={`age-wheel-value ${age === value ? "selected" : ""}`} key={value}>{value}</span>)}
    </div>
    <div className="age-wheel-fade age-wheel-fade-bottom" />
  </div>;
}

const INTRO_CASH_BARS = [94,94,105,105,114,114,128,157,173,173,188,188,199,199,211,211,225,225,241,241,251,251,263,263,268,268,274,274,274,274,274,274,263,263,248,248,241,241,231,231,225,225,217,217,211,211,199,199,188,188];
const INTRO_EXPENSE_BARS = [55,55,62,62,67,67,75,75,84,84,90,90,95,95,102,102,109,109,115,115,120,120,127,127,129,129,132,132,132,132,132,132,127,127,119,119,115,115,112,112,109,109,105,105,102,102,95,95,90,90];
const INTRO_PROJECTIONS = Array.from({ length: 3 }, (_, layer) => ({
  cash: INTRO_CASH_BARS.map((height, index) => Math.round(height * (.72 + layer * .075) * (1 + Math.sin(index * .21 + layer * 1.35) * .11))),
  expenses: INTRO_EXPENSE_BARS.map((height, index) => Math.round(height * (.66 + layer * .085) * (1 + Math.cos(index * .19 + layer) * .13))),
}));
const INTRO_WAVE_DELAYS = [97, 123, 87] as const;
const introWaveDelay = (layer: number, index: number, count: number) => {
  const travelsRightToLeft = layer === 0 || layer === 2;
  const position = travelsRightToLeft ? count - 1 - index : index;
  return `${position * -INTRO_WAVE_DELAYS[layer]}ms`;
};
function IntroChart() {
  return <div className="intro-chart" aria-label="Three animated financial projections">
    {INTRO_PROJECTIONS.map((projection, layer) => <div className="intro-projection" key={layer} aria-hidden="true">
      <div className="intro-bars intro-cash">{projection.cash.map((height, index) => <i key={index} style={{ height, "--bar-wave-delay": introWaveDelay(layer, index, projection.cash.length) } as React.CSSProperties} />)}</div>
      <div className="intro-bars intro-expenses">{projection.expenses.map((height, index) => <i key={index} style={{ height, "--bar-wave-delay": introWaveDelay(layer, index, projection.expenses.length) } as React.CSSProperties} />)}</div>
    </div>)}
  </div>;
}

function blendProjection(a: YearPoint[], b: YearPoint[], amount: number): YearPoint[] {
  return a.map((point, index) => {
    const other = b[index] ?? point;
    const mix = (from: number, to: number) => from + (to - from) * amount;
    return { age: point.age, corpus: mix(point.corpus, other.corpus), expense: mix(point.expense, other.expense), requestedExpense: mix(point.requestedExpense, other.requestedExpense) };
  });
}

function scaleProjection(path: YearPoint[], corpusScale: number, expenseScale: number): YearPoint[] {
  return path.map((point) => ({
    ...point,
    corpus: point.corpus * corpusScale,
    expense: point.expense * expenseScale,
    requestedExpense: point.requestedExpense * expenseScale,
  }));
}

function ProjectionChart({ details, dependents, loan, retirementAge, scenario, selectedAge, onSelect, compact = false, teaser = false, loading = false, showStatus = true, projectionData, possiblePaths, possibleExpensePaths, showOutcomes = false, scaleDomain, resultLayout = false, runoutLayout = false }: {
  details: Details; dependents: Dependents; loan: Loan; retirementAge: number | null; scenario?: Scenario;
  selectedAge: number | null; onSelect: (age: number | null) => void; compact?: boolean; teaser?: boolean; loading?: boolean; showStatus?: boolean;
  projectionData?: YearPoint[]; possiblePaths?: number[][]; possibleExpensePaths?: number[][]; showOutcomes?: boolean;
  scaleDomain?: { maxCorpus: number; maxExpense: number };
  resultLayout?: boolean; runoutLayout?: boolean;
}) {
  const runoutPlotRef = useRef<HTMLDivElement>(null);
  const [runoutPlotHeight, setRunoutPlotHeight] = useState(461);
  useLayoutEffect(() => {
    const plot = runoutPlotRef.current;
    if (!runoutLayout || !plot) return;
    const measure = () => setRunoutPlotHeight(plot.clientHeight || 461);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(plot);
    return () => observer.disconnect();
  }, [runoutLayout]);
  const fallbackData = useMemo(() => {
    const contribution = scenario
      ? Math.max(0, scenario.monthlyInvestment + scenario.monthlyIncome - scenario.incomeAnchor)
      : baselineInvestment(details, dependents, loan);
    const monthlyExpense = scenario?.monthlyExpense ?? details.monthlyExpense;
    let mutualFunds = details.mutualFunds;
    let fixedDeposits = details.fixedDeposits;
    let realEstate = details.realEstate;
    let newSavings = details.bankSavings;
    let corpus = investedTotal(details);
    const withdrawalAge = retirementAge ?? (scenario ? Math.min(details.age + 10, LIFE_EXPECTANCY - 1) : details.age);
    return Array.from({ length: LIFE_EXPECTANCY + 1 - details.age }, (_, index) => details.age + index).map((age) => {
      const elapsed = age - details.age;
      const requestedExpense = annualRetirementCost(details, dependents, loan, monthlyExpense, elapsed);
      const displayedCorpus = corpus;
      if (age < withdrawalAge) {
        mutualFunds *= 1 + MUTUAL_FUND_RETURN;
        fixedDeposits *= 1 + FIXED_DEPOSIT_RETURN;
        realEstate *= 1 + REAL_ESTATE_RETURN;
        newSavings = newSavings * (1 + NEW_SAVINGS_RETURN) + monthlyInvestmentAt(details, dependents, loan, contribution, elapsed) * 12;
        corpus = mutualFunds + fixedDeposits + realEstate + newSavings;
        return { age, corpus: displayedCorpus, expense: requestedExpense, requestedExpense };
      } else {
        const availableCash = corpus * (1 + POST_RETIREMENT_RETURN);
        const drawableExpense = Math.min(requestedExpense, availableCash);
        corpus = Math.max(0, availableCash - drawableExpense);
        return { age, corpus: displayedCorpus, expense: drawableExpense, requestedExpense };
      }
    });
  }, [details, dependents, loan, retirementAge, scenario]);
  const data = projectionData?.length ? projectionData : fallbackData;
  const outcomeScaleValues = showOutcomes && possiblePaths?.length ? data.map((_, yearIndex) => {
    const values = possiblePaths.map((path) => Math.max(0, path[yearIndex] ?? 0)).sort((a, b) => a - b);
    return values[Math.floor((values.length - 1) * .95)] ?? 0;
  }) : [];
  const maxCorpus = scaleDomain?.maxCorpus ?? Math.max(...data.map((item) => item.corpus), ...outcomeScaleValues, 1);
  const outcomeExpenseScaleValues = showOutcomes && possibleExpensePaths?.length ? data.map((_, yearIndex) => {
    const values = possibleExpensePaths.map((path) => Math.max(0, path[yearIndex] ?? 0)).sort((a, b) => a - b);
    return values[Math.floor((values.length - 1) * .95)] ?? 0;
  }) : [];
  const maxExpense = scaleDomain?.maxExpense ?? Math.max(...data.map((item) => item.expense), ...outcomeExpenseScaleValues, 1);
  const plotHeight = compact ? 40 : loading ? 344 : teaser ? 512 : showOutcomes ? 387 : runoutLayout ? Math.max(120, runoutPlotHeight - 4) : 358;
  const pixelsPerRupee = plotHeight / (maxCorpus + maxExpense);
  const corpusAreaHeight = runoutLayout ? Math.round(plotHeight * .78) : resultLayout ? 260 : loading ? 260 : showOutcomes ? 280 : maxCorpus * pixelsPerRupee;
  const expenseAreaHeight = runoutLayout ? plotHeight - corpusAreaHeight : resultLayout ? 84 : loading ? 84 : showOutcomes ? 107 : maxExpense * pixelsPerRupee;
  const corpusPixelsPerRupee = runoutLayout ? Math.max(1, corpusAreaHeight - 24) / maxCorpus : resultLayout || loading || showOutcomes ? corpusAreaHeight / maxCorpus : pixelsPerRupee;
  const expensePixelsPerRupee = runoutLayout ? Math.max(1, expenseAreaHeight - 12) / maxExpense : resultLayout || loading || showOutcomes ? expenseAreaHeight / maxExpense : pixelsPerRupee;
  // Use one rupee-to-pixel scale on both sides of the zero line. Otherwise,
  // similar cash and expense values can look unrelated when each side is
  // independently normalized.
  const tooltipAge = selectedAge ?? (!compact && showStatus ? retirementAge : null);
  const selected = tooltipAge === null ? null : data.find((item) => item.age === tooltipAge) ?? null;
  const firstDepletedAge = data.find((item) => item.corpus <= 0)?.age;

  return (
    <div ref={runoutLayout ? runoutPlotRef : undefined} className={`projection-chart ${compact ? "compact" : ""} ${teaser ? "teaser" : ""} ${loading ? "loading-chart" : ""} ${selected ? "has-selection" : ""} ${showOutcomes ? "outcome-mode" : ""} ${runoutLayout ? "runout-plot" : ""}`}>
      {selected && !teaser && (
        <div className="chart-tooltip" role="status">
          <strong>{selected.age}y</strong>
          <span>Cash at hand: <b>{selected.corpus > 0 ? chartMetric(selected.corpus) : "0"}</b></span>
          <span>Expenses: <b>{selected.requestedExpense > selected.expense ? "more than cash" : chartMetric(selected.requestedExpense)}</b></span>
        </div>
      )}
      {!teaser && showStatus && retirementAge === null && !selected && <div className="chart-warning"><span>⚠</span> Can’t retire with current information</div>}
      <div className="bars-area corpus-area" style={{ height: `${corpusAreaHeight}px` }}>
        {data.map((item, yearIndex) => (
          <button
            key={`corpus-${item.age}`}
            className={`bar-slot ${item.age === selectedAge ? "selected" : ""} ${item.corpus <= 0 ? "depleted" : ""}`}
            onClick={(event) => { event.stopPropagation(); if (!teaser) onSelect(selectedAge === item.age ? null : item.age); }}
            tabIndex={teaser ? -1 : 0}
            aria-label={`Age ${item.age}: corpus ${inr(item.corpus)}`}
          >
            {item.age === firstDepletedAge && <span className="zero-line" />}
            {showOutcomes && possiblePaths && <span className="outcome-path-bars" aria-hidden="true">
              {possiblePaths.slice(0, 100).map((path, pathIndex) => <i key={pathIndex} style={{ height: `${Math.min(corpusAreaHeight, Math.max(0, path[yearIndex] ?? 0) * corpusPixelsPerRupee)}px` }} />)}
            </span>}
            <span className={`bar corpus ${showOutcomes ? "active-outlook" : ""}`} style={{ height: `${item.corpus <= 0 ? 0 : Math.max(2, item.corpus * corpusPixelsPerRupee)}px`, "--bar-delay": `${(item.age - details.age) * -90}ms` } as React.CSSProperties} />
          </button>
        ))}
      </div>
      <div className="bars-area expense-area" style={{ height: `${expenseAreaHeight}px` }}>
        {data.map((item, yearIndex) => (
          <button
            key={`expense-${item.age}`}
            className={`bar-slot ${item.age === selectedAge ? "selected" : ""} ${item.corpus <= 0 ? "depleted" : ""}`}
            onClick={(event) => { event.stopPropagation(); if (!teaser) onSelect(selectedAge === item.age ? null : item.age); }}
            tabIndex={teaser ? -1 : 0}
            aria-label={`Age ${item.age}: spending ${inr(item.expense)}`}
          >
            {showOutcomes && possibleExpensePaths && <span className="outcome-path-bars expense-paths" aria-hidden="true">
              {possibleExpensePaths.slice(0, 100).map((path, pathIndex) => <i key={pathIndex} style={{ height: `${Math.min(expenseAreaHeight, Math.max(0, path[yearIndex] ?? 0) * expensePixelsPerRupee)}px` }} />)}
            </span>}
            <span className={`bar expense ${retirementAge !== null && item.age >= retirementAge ? "after-retirement" : ""}`} style={{ height: `${item.expense <= 0 ? 0 : Math.max(2, item.expense * expensePixelsPerRupee)}px`, "--bar-delay": `${(item.age - details.age) * -90}ms` } as React.CSSProperties} />
          </button>
        ))}
      </div>
    </div>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        <div className="sheet-title"><h2>{title}</h2><button onClick={onClose} aria-label="Close"><X size={20} /></button></div>
        {children}
      </section>
    </div>
  );
}

function EconomyTabs({ value, onChange, onHelp }: { value: Outlook; onChange: (value: Outlook) => void; onHelp: () => void }) {
  return <div className="scenario-tabs economy-tabs" role="tablist" aria-label="Economic scenario">
    <div className="economy-choice-group">
      {ECONOMY_OPTIONS.map((option) => <button
        key={option.value}
        className={`economy-choice ${value === option.value ? "active" : ""}`}
        role="tab"
        aria-selected={value === option.value}
        aria-label={option.label}
        onClick={() => onChange(option.value)}
      >
        <Image src={ECONOMY_ICON_ASSETS[value][option.value]} width={24} height={24} alt="" />
        {value === option.value && <span>{option.label}</span>}
      </button>)}
    </div>
    <button className="economy-help" aria-label="About economy scenarios" onClick={onHelp}>
      <Image src={assetPath("/help-outline.svg")} width={24} height={24} alt="" />
    </button>
  </div>;
}

type WizardStepPosition = "Start" | "Middle" | "End";
function WizardProgressStep({ number, label, state, position }: { number: number; label: string; state: "Active" | "Default"; position: WizardStepPosition }) {
  const active = state === "Active";
  const leadingAsset = assetPath(active ? "/step-notch-active.svg" : "/step-notch-default.svg");
  const trailingAsset = assetPath(active ? "/step-chevron-active.svg" : "/step-chevron-default.svg");
  return <span className={`wizard-progress-step ${active ? "active" : "default"} ${position.toLowerCase()}`}>
    {position !== "Start" && <span className="wizard-step-divider leading" aria-hidden="true"><Image src={leadingAsset} alt="" width={4} height={28} /></span>}
    <span className={`wizard-progress-step-content ${position.toLowerCase()}`}>
      <span className="wizard-progress-step-number">{number}.</span>
      <span className="wizard-progress-step-label">{label}</span>
    </span>
    {position !== "End" && <span className="wizard-step-divider trailing" aria-hidden="true"><Image src={trailingAsset} alt="" width={4.98076} height={28.2747} /></span>}
  </span>;
}

function LoadingScreen({ details, dependents, loan, projection, finalPlan, exiting, phase, resultProjection, retirementAge, compactResultLayout = false, selectedAge, onSelect, children }: {
  details: Details; dependents: Dependents; loan: Loan; projection: SimulationResult | null; finalPlan: SimulationResult | null; exiting: boolean;
  phase: "loading" | "result"; resultProjection?: YearPoint[]; retirementAge: number | null; compactResultLayout?: boolean; selectedAge: number | null;
  onSelect: (age: number | null) => void; children?: React.ReactNode;
}) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [rateIndex, setRateIndex] = useState(0);
  const rateFrames = useMemo(() => simulationRateFrames(731942, 12), []);
  useEffect(() => {
    const messageTimer = window.setInterval(() => setMessageIndex((index) => (index + 1) % LOADING_MESSAGES.length), 1200);
    const rateTimer = window.setInterval(() => setRateIndex((index) => (index + 1) % rateFrames.length), 240);
    return () => { window.clearInterval(messageTimer); window.clearInterval(rateTimer); };
  }, [rateFrames.length]);
  const rates = rateFrames[rateIndex];
  const loadingRateKeys: RateKey[] = ["inflation", "mutualFunds", "stocks", "fixedDeposits", "realEstate", "savings"];
  const loadingPaths = useMemo(() => {
    if (!projection) return [];
    const sourcePaths = [
      projection.paths.cautious,
      blendProjection(projection.paths.cautious, projection.paths.typical, .5),
      projection.paths.typical,
      blendProjection(projection.paths.typical, projection.paths.optimistic, .5),
      projection.paths.optimistic,
    ];
    const corpusLimit = Math.max(1, ...projection.paths.cautious.map((point) => point.corpus)) * .96;
    const expenseLimit = Math.max(1, ...projection.paths.cautious.map((point) => point.expense)) * .96;
    return sourcePaths.map((path) => {
      const corpusMax = Math.max(1, ...path.map((point) => point.corpus));
      const expenseMax = Math.max(1, ...path.map((point) => point.expense));
      return scaleProjection(path, Math.min(1, corpusLimit / corpusMax), Math.min(1, expenseLimit / expenseMax));
    });
  }, [projection]);
  const settledPath = resultProjection ?? finalPlan?.paths.cautious;
  const scaleDomain = useMemo(() => {
    // The final Cautious projection owns the visual domain. Allowing a more
    // extreme loading layer to define it would flatten the result at the exact
    // moment it should become legible. Before the calculation returns, the
    // preview Cautious path is the closest stable equivalent.
    const domainPath = settledPath ?? projection?.paths.cautious ?? [];
    return {
      maxCorpus: Math.max(1, ...domainPath.map((point) => point.corpus)),
      maxExpense: Math.max(1, ...domainPath.map((point) => point.expense)),
    };
  }, [projection, settledPath]);
  const showingResult = phase === "result";
  const noRetirementResult = showingResult && compactResultLayout;
  return <div className={`loading-screen ${showingResult ? "result-screen" : ""} ${noRetirementResult ? "no-retirement-result" : ""} ${finalPlan ? "ready" : ""} ${exiting ? "exiting" : ""}`} role={showingResult ? undefined : "status"} aria-live={showingResult ? undefined : "polite"}>
    {!noRetirementResult && <div className="loading-visual" aria-hidden={showingResult ? undefined : "true"}>
      {(loadingPaths.length ? loadingPaths : [undefined, undefined, undefined, undefined, undefined]).map((path, layer) => <div className="loading-projection" key={layer} style={{ "--projection-delay": `${layer * -.44}s` } as React.CSSProperties}>
        <ProjectionChart details={details} dependents={dependents} loan={loan} retirementAge={showingResult && layer === 0 ? retirementAge : null}
          selectedAge={showingResult && layer === 0 ? selectedAge : null} onSelect={showingResult && layer === 0 ? onSelect : () => undefined}
          showStatus={showingResult && layer === 0} projectionData={(exiting || showingResult) && settledPath ? settledPath : path} scaleDomain={scaleDomain} resultLayout={showingResult || exiting} />
      </div>)}
    </div>}
    <section className="loading-copy">
      <p key={messageIndex}>{LOADING_MESSAGES[messageIndex]}</p>
      <div className="rate-grid">
        {loadingRateKeys.map((key) => <span key={key}><small>{RESULT_RATE_LABELS[key]}</small><b>{percentage(rates[key])}</b></span>)}
      </div>
    </section>
    {showingResult && children}
  </div>;
}

export default function Home() {
  const [screen, setScreen] = useState<"start" | "details" | "loading" | "result">("start");
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardDirection, setWizardDirection] = useState<"forward" | "back">("forward");
  const [details, setDetails] = useState<Details>(DEFAULTS);
  const [dependents, setDependents] = useState<Dependents>(DEFAULT_DEPENDENTS);
  const [dependantEntries, setDependantEntries] = useState<DependantEntry[]>([]);
  const [loan, setLoan] = useState<Loan>(DEFAULT_LOAN);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [selectedAge, setSelectedAge] = useState<number | null>(null);
  const [targetAge, setTargetAge] = useState<number | null>(null);
  const [sheet, setSheet] = useState<"dependents" | "loan" | "share" | "help" | "retirement" | "scenarios" | null>(null);
  const [activeDetailSection, setActiveDetailSection] = useState<"age" | "investments" | "income" | "expenditure" | null>(null);
  const [detailsScrolled, setDetailsScrolled] = useState(false);
  const [previewPlan, setPreviewPlan] = useState<SimulationResult | null>(null);
  const [calculatedPlan, setCalculatedPlan] = useState<SimulationResult | null>(null);
  const [loadingExiting, setLoadingExiting] = useState(false);
  const [outlook, setOutlook] = useState<Outlook>("cautious");
  const [editingDetails, setEditingDetails] = useState(false);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const [targetProjection, setTargetProjection] = useState<ReturnType<typeof projectScenario> | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);
  const chartCollapseGuard = useRef(false);
  const chartCollapseTimer = useRef<number | null>(null);
  const sectionNavigationRef = useRef(false);
  const sectionNavigationTimerRef = useRef<number | null>(null);
  const ageSectionRef = useRef<HTMLElement>(null);
  const investmentsSectionRef = useRef<HTMLElement>(null);
  const incomeSectionRef = useRef<HTMLElement>(null);
  const expenditureSectionRef = useRef<HTMLElement>(null);
  const calculationStartedAtRef = useRef(0);
  const calculationFinishTimerRef = useRef<number | null>(null);
  const resultRevealTimerRef = useRef<number | null>(null);
  const wizardProgressRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const activeStep = wizardProgressRef.current?.querySelector<HTMLButtonElement>("button.active");
    activeStep?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [wizardStep]);

  useEffect(() => {
    const worker = new Worker(new URL("./fire.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<
      | { kind: "plan"; plan: SimulationResult }
      | { kind: "calculate"; plan: SimulationResult }
      | { kind: "recommend"; recommendation: Recommendation; projection: ReturnType<typeof projectScenario> }
    >) => {
      if (event.data.kind === "plan") setPreviewPlan(event.data.plan);
      else if (event.data.kind === "calculate") {
        const plan = event.data.plan;
        const finish = () => {
          setCalculatedPlan(plan);
          setSelectedAge(null);
          setTargetAge(null); setEditingDetails(false);
          // First paint the five layers without their processing loop. Starting
          // the morph on the following frame lets opacity and bar-height
          // transitions use the visible loading chart as their true origin.
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            setLoadingExiting(true);
            resultRevealTimerRef.current = window.setTimeout(() => {
              setScreen("result");
              setLoadingExiting(false);
            }, 900);
          }));
        };
        const remaining = Math.max(0, 4200 - (performance.now() - calculationStartedAtRef.current));
        calculationFinishTimerRef.current = window.setTimeout(finish, remaining);
      } else {
        const rec = event.data.recommendation;
        setRecommendation(rec);
        setTargetProjection(event.data.projection);
        setRecommendationsLoading(false);
      }
    };
    return () => {
      worker.terminate();
      if (calculationFinishTimerRef.current) window.clearTimeout(calculationFinishTimerRef.current);
      if (resultRevealTimerRef.current) window.clearTimeout(resultRevealTimerRef.current);
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => workerRef.current?.postMessage({ kind: "plan", details, dependents, loan }), 80);
    return () => window.clearTimeout(timer);
  }, [details, dependents, loan]);
  useEffect(() => {
    if (sheet !== "retirement" || targetAge === null) return;
    const timer = window.setTimeout(() => workerRef.current?.postMessage({ kind: "recommend", details, dependents, loan, targetAge }), 80);
    return () => window.clearTimeout(timer);
  }, [sheet, targetAge, details, dependents, loan]);

  const estimatedAge = calculatedPlan?.retirementAge ?? null;
  const scenarioRetirementAge = calculatedPlan?.scenarioRetirementAges[outlook] ?? null;
  const browsedProjection = calculatedPlan
    ? calculatedPlan.retirementPaths[outlook]
    : undefined;
  const runout = financesRunOutBy(browsedProjection ?? [], details.age);
  const compactResultLayout = calculatedPlan !== null && (
    estimatedAge === null || Object.values(calculatedPlan.scenarioRetirementAges).some((age) => age === null)
  );
  const activeRetirementAge = targetAge ?? scenarioRetirementAge ?? details.age;
  const cannotRetire = calculatedPlan !== null && scenarioRetirementAge === null;
  const alreadyRetired = details.monthlyIncome === 0;
  const showingCurrentRetirement = alreadyRetired && targetAge === null;
  const guardChartCollapse = () => {
    chartCollapseGuard.current = true;
    if (chartCollapseTimer.current) window.clearTimeout(chartCollapseTimer.current);
    chartCollapseTimer.current = window.setTimeout(() => { chartCollapseGuard.current = false; }, 350);
  };
  const collapseChart = () => {
    if (chartExpanded) {
      guardChartCollapse();
      setChartExpanded(false);
    }
    setSelectedAge(null);
  };
  const calculateRetirementAge = () => {
    calculationStartedAtRef.current = performance.now();
    setLoadingExiting(false);
    setCalculatedPlan(null);
    setScreen("loading");
    workerRef.current?.postMessage({ kind: "calculate", details, dependents, loan });
  };
  const goToWizardStep = (step: number) => {
    const nextStep = Math.max(1, Math.min(5, step));
    setWizardDirection(nextStep >= wizardStep ? "forward" : "back");
    setWizardStep(nextStep);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const updateDependantEntries = (next: DependantEntry[]) => {
    setDependantEntries(next);
    const totalAnnualCost = next.reduce((sum, item) => sum + item.annualCost, 0);
    setDependents({
      count: next.length,
      annualCostPerDependent: next.length ? totalAnnualCost / next.length : 0,
      supportYears: next.length ? Math.max(...next.map((item) => item.supportYears)) : 10,
    });
  };
  const detailSections = [
    ["age", ageSectionRef], ["investments", investmentsSectionRef],
    ["income", incomeSectionRef], ["expenditure", expenditureSectionRef],
  ] as const;
  const scrollToDetailSection = (section: Exclude<typeof activeDetailSection, null>) => {
    const container = scrollRef.current;
    const target = detailSections.find(([name]) => name === section)?.[1].current;
    if (!target) return;
    sectionNavigationRef.current = true;
    setChartExpanded(false);
    setActiveDetailSection(section);
    if (container) {
      const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 112;
      container.scrollTo({ top, behavior: "smooth" });
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (sectionNavigationTimerRef.current) window.clearTimeout(sectionNavigationTimerRef.current);
    sectionNavigationTimerRef.current = window.setTimeout(() => { sectionNavigationRef.current = false; }, 120);
  };
  const exportCsv = () => {
    const hypotheticalDetails = details;
    const projection = targetAge === null
      ? calculatedPlan
      : { ...projectScenario(hypotheticalDetails, dependents, loan, targetAge), retirementAge: targetAge, seed: calculatedPlan?.seed ?? 731942 };
    const rows: (string | number)[][] = [
      ["section", "metric", "value"],
      ["summary", "current_age", details.age], ["summary", "retirement_age", targetAge ?? scenarioRetirementAge ?? "undetermined"],
      ["summary", "success_probability", projection?.successRate ?? 0], ["summary", "simulation_count", 1000],
      ["summary", "projection_outlook", outlook], ["summary", "simulation_seed", projection?.seed ?? 731942],
      ["summary", "model_version", MODEL_VERSION],
      ["input", "mutual_funds", hypotheticalDetails.mutualFunds], ["input", "monthly_mutual_fund_sip", hypotheticalDetails.monthlySip],
      ["input", "stocks", hypotheticalDetails.stocks], ["input", "fixed_deposits", hypotheticalDetails.fixedDeposits],
      ["input", "real_estate", hypotheticalDetails.realEstate], ["input", "bank_savings", hypotheticalDetails.bankSavings],
      ["input", "monthly_income", hypotheticalDetails.monthlyIncome], ["input", "monthly_expenditure", hypotheticalDetails.monthlyExpense],
      ["input", "dependents", dependents.count], ["input", "annual_cost_per_dependent", dependents.annualCostPerDependent],
      ["input", "dependent_support_years", dependents.supportYears], ["input", "loan_balance", loan.balance],
      ["input", "loan_emi", loan.emi], ["input", "loan_years_remaining", loan.remainingYears],
      ["alternative", "required_monthly_sip", recommendation?.monthlySip ?? "not_possible_alone"],
      ["alternative", "required_monthly_income", recommendation?.monthlyIncome ?? "not_possible_alone"],
      ["alternative", "maximum_monthly_expenditure", recommendation?.monthlyExpense ?? "not_possible_alone"],
      ["alternative", "required_current_corpus", recommendation?.requiredCurrentCorpus ?? "not_calculated"],
      ...Object.entries(BASE_RATES).map(([key, value]) => ["rate", key, value] as (string | number)[]),
      ...RATE_KEYS.flatMap((key) => {
        const summary = projection?.rateSummaries[outlook]?.[key];
        return summary ? [
          ["displayed_path_rate", `${key}_average`, summary.average],
          ["displayed_path_rate", `${key}_minimum`, summary.min],
          ["displayed_path_rate", `${key}_maximum`, summary.max],
        ] : [];
      }),
      ["projection", "age", "cash_at_hand", "requested_expenses", "funded_expenses"],
      ...((projection?.paths[outlook] ?? []).map((point) => ["projection", point.age, Math.round(point.corpus), Math.round(point.requestedExpense), Math.round(point.expense)])),
    ];
    const blob = new Blob([rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "my-fire-plan.csv"; link.click();
    URL.revokeObjectURL(link.href);
  };
  const nativeShare = async () => {
    const shareData = { title: "My FIRE plan", text: `My target retirement age is ${activeRetirementAge}.`, url: window.location.href };
    if (navigator.share) await navigator.share(shareData);
    else await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
  };

  return (
    <main className="site-shell">
      <section className="mobile-app" aria-label="FIRE retirement planner">
        {screen === "start" && (
          <div className="start-screen">
            <div className="hero-chart">
              <IntroChart />
            </div>
            <section className="start-copy">
              <h1>How long can your finances last?</h1>
              <p>See your finances run across multiple scenarios to determine how long does it last or by when can you retire</p>
              <button className="primary-button" onClick={() => { setWizardStep(1); setScreen("details"); }}>Find my retirement age</button>
            </section>
          </div>
        )}

        {screen === "details" && (
          <div className="wizard-screen" ref={scrollRef}>
            <nav ref={wizardProgressRef} className="wizard-progress" aria-label="Your progress">
              <div className="wizard-progress-track">
              {["Age", "Investments", "Monthly cash flow", "Dependants", "Loans"].map((label, index, steps) => {
                const step = index + 1;
                const position: WizardStepPosition = index === 0 ? "Start" : index === steps.length - 1 ? "End" : "Middle";
                const state = wizardStep === step ? "Active" : "Default";
                return <button key={label} style={{ "--step-layer": steps.length - index } as React.CSSProperties} className={`wizard-progress-trigger ${wizardStep === step ? "active" : wizardStep > step ? "done" : ""}`} onClick={() => goToWizardStep(step)} aria-current={wizardStep === step ? "step" : undefined} aria-label={`Step ${step}: ${label}`}>
                  <WizardProgressStep number={step} label={label} state={state} position={position} />
                </button>;
              })}
              </div>
            </nav>
            <section key={wizardStep} className={`wizard-content ${wizardStep === 1 ? "age-step" : wizardStep === 2 ? "investments-step" : wizardStep === 4 ? "dependants-step" : wizardStep === 5 ? "loan-step" : "form-icon-step"} ${wizardDirection}`}>
              {wizardStep === 1 && <>
                <div className="age-chart-glyph" aria-hidden="true"><i /><i /><i /><i /></div>
                <h1>What is your age?</h1>
                <AgeWheel age={details.age} onChange={(age) => setDetails((current) => ({ ...current, age }))} />
              </>}
              {wizardStep === 2 && <>
                <Image className="wizard-image" src={investmentsIcon} alt="" />
                <h1>Tell us about your investments</h1>
                <RangeField label="Mutual Funds" value={details.mutualFunds} min={0} max={20_000_000} step={50_000} prefix="" onChange={(value) => setDetails({ ...details, mutualFunds: value })} />
                <RangeField label="Monthly SIPs in Mutual Funds" value={details.monthlySip} min={0} max={500_000} step={5_000} prefix="" onChange={(value) => setDetails({ ...details, monthlySip: value })} />
                <RangeField label="Stocks" value={details.stocks} min={0} max={20_000_000} step={50_000} prefix="" onChange={(value) => setDetails({ ...details, stocks: value })} />
                <RangeField label="FD" value={details.fixedDeposits} min={0} max={10_000_000} step={50_000} prefix="" onChange={(value) => setDetails({ ...details, fixedDeposits: value })} />
                <RangeField label="Real Estate" value={details.realEstate} min={0} max={50_000_000} step={100_000} prefix="" onChange={(value) => setDetails({ ...details, realEstate: value })} />
                <RangeField label="Bank savings" value={details.bankSavings} min={0} max={10_000_000} step={50_000} prefix="" onChange={(value) => setDetails({ ...details, bankSavings: value })} />
              </>}
              {wizardStep === 3 && <>
                <Image className="wizard-image" src={incomeIcon} alt="" />
                <h1>Your monthly income &amp; expenditure</h1>
                <RangeField label="Income" value={details.monthlyIncome} min={0} max={500_000} step={5_000} prefix="" onChange={(value) => setDetails({ ...details, monthlyIncome: value })} />
                <RangeField label="Expenditure" value={details.monthlyExpense} min={0} max={300_000} step={5_000} prefix="" onChange={(value) => setDetails({ ...details, monthlyExpense: value })} />
                <button className="wizard-link" onClick={() => setSheet("help")}>Help figure out my expenses</button>
              </>}
              {wizardStep === 4 && <>
                <Image className="wizard-image" src={incomeIcon} alt="" />
                <h1>Add details about your dependants</h1>
                {dependantEntries.length === 0 ? <button className="dependant-empty" onClick={() => updateDependantEntries([{ id: Date.now(), annualCost: 120_000, supportYears: 10 }])}>Add dependant</button> : <>
                  {dependantEntries.map((entry, index) => <div className="dependant-card" key={entry.id}>
                    <div className="dependant-title"><b>Dependant #{index + 1}</b><button aria-label={`Remove dependant ${index + 1}`} onClick={() => updateDependantEntries(dependantEntries.filter((item) => item.id !== entry.id))}><Trash2 size={20} /></button></div>
                    <RangeField label="Annual expenditure" value={entry.annualCost} min={0} max={2_400_000} step={25_000} prefix="" onChange={(value) => updateDependantEntries(dependantEntries.map((item) => item.id === entry.id ? { ...item, annualCost: value } : item))} />
                    <RangeField className="support-years-field" label="Support needed in years" value={entry.supportYears} min={1} max={30} step={1} prefix="" onChange={(value) => updateDependantEntries(dependantEntries.map((item) => item.id === entry.id ? { ...item, supportYears: value } : item))} />
                  </div>)}
                  <button className="wizard-link" onClick={() => updateDependantEntries([...dependantEntries, { id: Date.now(), annualCost: 120_000, supportYears: 10 }])}>Add dependant</button>
                </>}
              </>}
              {wizardStep === 5 && <>
                <Landmark className="wizard-icon" size={40} />
                <h1>Add details about your loans</h1>
                {loan.balance === 0 && loan.emi === 0 ? <button className="dependant-empty" onClick={() => setLoan({ balance: 1_200_000, emi: 25_000, remainingYears: 5 })}><CirclePlus size={20} />Add loan</button> : <>
                  <div className="dependant-card">
                    <div className="dependant-title"><b>Loan #1</b><button aria-label="Remove loan" onClick={() => setLoan(DEFAULT_LOAN)}><Trash2 size={20} /></button></div>
                    <RangeField label="Outstanding balance" value={loan.balance} min={0} max={20_000_000} step={50_000} prefix="" onChange={(value) => setLoan({ ...loan, balance: value })} />
                    <RangeField label="Monthly EMI" value={loan.emi} min={0} max={300_000} step={2_500} prefix="" onChange={(value) => setLoan({ ...loan, emi: value })} />
                    <RangeField label="Years remaining" value={loan.remainingYears} min={1} max={30} step={1} prefix="" onChange={(value) => setLoan({ ...loan, remainingYears: value })} />
                  </div>
                  <button className="wizard-link" type="button">Add loan</button>
                </>}
              </>}
            </section>
            <footer className="wizard-footer">
              <button className="wizard-back" aria-label="Previous step" disabled={wizardStep === 1} onClick={() => goToWizardStep(wizardStep - 1)}><ChevronLeft size={22} /></button>
              <button className="primary-button" onClick={() => wizardStep < 5 ? goToWizardStep(wizardStep + 1) : calculateRetirementAge()}>{wizardStep < 5 ? <>Next<ChevronRight size={21} /></> : "Find my retirement age"}</button>
            </footer>
          </div>
        )}

        {false && screen === "details" && (
          <div className="details-screen" ref={scrollRef} onScroll={(event) => {
            const nextTop = event.currentTarget.scrollTop;
            if (sectionNavigationRef.current) {
              if (sectionNavigationTimerRef.current) window.clearTimeout(sectionNavigationTimerRef.current);
              sectionNavigationTimerRef.current = window.setTimeout(() => { sectionNavigationRef.current = false; }, 120);
            }
            setDetailsScrolled(nextTop > 4);
            if (nextTop > lastScrollTop.current + 3) {
              if (chartExpanded) guardChartCollapse();
              setChartExpanded(false);
              setSelectedAge(null);
            } else if (nextTop < lastScrollTop.current - 3 && nextTop <= 12 && !chartCollapseGuard.current && !sectionNavigationRef.current) {
              // Expanding the sticky chart while deep in the form changes its
              // height by 262px and makes the content jump beneath it. Restore
              // the expanded state only once the user has returned to the top.
              setChartExpanded(true);
            }
            lastScrollTop.current = nextTop;
            const activationLine = event.currentTarget.getBoundingClientRect().top + (chartExpanded ? 520 : 230);
            const visibleSection = [...detailSections].reverse().find(([, ref]) => ref.current && ref.current.getBoundingClientRect().top <= activationLine);
            if (visibleSection) setActiveDetailSection(visibleSection[0]);
          }}>
            <div
              className={`input-chart ${chartExpanded ? "expanded" : "collapsed"}`}
              onClick={() => setChartExpanded((open) => { if (open) setSelectedAge(null); return !open; })}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setChartExpanded((open) => { if (open) setSelectedAge(null); return !open; });
              }}
              role="button"
              tabIndex={0}
              aria-label={chartExpanded ? "Collapse projection chart" : "Expand projection chart"}
              aria-expanded={chartExpanded}
            >
              <ProjectionChart details={details} dependents={dependents} loan={loan} retirementAge={null} selectedAge={null} onSelect={() => undefined} compact={!chartExpanded} showStatus={false} projectionData={previewPlan?.paths.typical} />
            </div>
            <div className="input-content">
              <h1>{editingDetails ? "Edit your details" : "Enter your details"}</h1>
              <nav className={`detail-jump-nav ${detailsScrolled ? "scrolled" : ""}`} style={{ top: chartExpanded ? 375 : 89 }} aria-label="Detail sections">
                {(["age", "investments", "income", "expenditure"] as const).map((section) => <button key={section} className={activeDetailSection === section ? "active" : ""} onClick={() => scrollToDetailSection(section)}>{section}</button>)}
                <button onClick={() => setSheet("loan")}>loans</button>
                <button onClick={() => setSheet("dependents")}>dependencies</button>
              </nav>
              <section className="detail-group age-group" ref={ageSectionRef}>
                <RangeField label="Current age" value={details.age} min={20} max={60} step={1} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, age: value })} />
              </section>
              <section className="detail-group" ref={investmentsSectionRef}>
                <h2><Image src={investmentsIcon} alt="" /><span>Investments</span></h2>
                <RangeField label="Mutual Funds" value={details.mutualFunds} min={0} max={20_000_000} step={50_000} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, mutualFunds: value })} />
                <RangeField label="Monthly SIPs in MF" value={details.monthlySip} min={0} max={500_000} step={5_000} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, monthlySip: value })} />
                <RangeField label="Stocks" value={details.stocks} min={0} max={20_000_000} step={50_000} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, stocks: value })} />
                <RangeField label="FD" value={details.fixedDeposits} min={0} max={10_000_000} step={50_000} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, fixedDeposits: value })} />
                <RangeField label="Real Estate" value={details.realEstate} min={0} max={50_000_000} step={100_000} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, realEstate: value })} />
              </section>
              <section className="detail-group" ref={incomeSectionRef}>
                <h2><Image src={incomeIcon} alt="" /><span>Income</span></h2>
                <RangeField label="Monthly income" value={details.monthlyIncome} min={0} max={500_000} step={5_000} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, monthlyIncome: value })} />
                <RangeField label="Bank savings" value={details.bankSavings} min={0} max={10_000_000} step={50_000} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, bankSavings: value })} />
              </section>
              <section className="detail-group" ref={expenditureSectionRef}>
                <h2><Image src={expenditureIcon} alt="" /><span>Expenditure</span></h2>
                <RangeField label="Monthly expenditure" value={details.monthlyExpense} min={10_000} max={300_000} step={5_000} prefix="" onInteract={collapseChart} onChange={(value) => setDetails({ ...details, monthlyExpense: value })} />
              </section>
              <div className={`add-links ${dependents.count || loan.balance || loan.emi ? "has-summaries" : ""}`}>
                {dependents.count ? <button className="detail-summary-card" onClick={() => setSheet("dependents")}><span>Dependencies</span><b>{dependents.count} × {dependents.annualCostPerDependent.toLocaleString("en-IN")}</b><Pencil size={20} /></button> : <button onClick={() => setSheet("dependents")}>Add dependencies</button>}
                {loan.balance || loan.emi ? <button className="detail-summary-card" onClick={() => setSheet("loan")}><span>Loans</span><b>{loan.balance.toLocaleString("en-IN")}</b><Pencil size={20} /></button> : <button onClick={() => setSheet("loan")}>Add Loans</button>}
              </div>
            </div>
            <div className="sticky-footer"><button className="primary-button" onClick={calculateRetirementAge}>{editingDetails ? "Update my retirement age" : "Find my retirement age"}</button></div>
          </div>
        )}

        {(screen === "loading" || screen === "result") && <LoadingScreen
          details={details} dependents={dependents} loan={loan} projection={previewPlan} finalPlan={calculatedPlan} exiting={loadingExiting} phase={screen}
          retirementAge={sheet === "retirement" && targetAge !== null ? targetAge : scenarioRetirementAge} compactResultLayout={compactResultLayout} selectedAge={selectedAge} onSelect={setSelectedAge}
          resultProjection={sheet === "retirement" && targetAge !== null ? targetProjection?.paths[outlook] ?? browsedProjection : browsedProjection}
        >
          {screen === "result" && <>
            <section className={`result-content ${compactResultLayout ? "runout-result-content" : ""}`}>
              <EconomyTabs value={outlook} onChange={setOutlook} onHelp={() => setSheet("scenarios")} />
              {compactResultLayout ? <>
                <section className="runout-summary">
                  <h1>{cannotRetire ? runout.depleted ? "Your finances will run out by" : "Your finances last beyond" : "Retirement age"}</h1>
                  <div className="runout-age-row">
                    <strong>{cannotRetire ? runout.age : scenarioRetirementAge}</strong>
                    <span>{cannotRetire ? runout.depleted ? `Age ${runout.age} · ${runout.year}` : `Beyond age ${runout.age}` : `In ${outlookLabel(outlook).toLowerCase()}`}</span>
                  </div>
                  <button onClick={() => {
                    const age = scenarioRetirementAge ?? Math.min(Math.max(details.age, 35), 70);
                    setRecommendationsLoading(true); setTargetProjection(null); setTargetAge(age); setSelectedAge(age);
                    setSheet("retirement");
                  }}><Image src={assetPath("/tune.svg")} width={20} height={20} alt="" />{cannotRetire ? "Set retirement age" : "Change age"}</button>
                </section>
                <h2 className="age-breakdown-title runout-breakdown-title">Age wise breakdown of your finances</h2>
                <section className="runout-chart-card" aria-label="Age wise breakdown of your finances">
                  <div className="runout-chart-hint">Tap a bar below to view finances at that age.</div>
                  <ProjectionChart details={details} dependents={dependents} loan={loan} retirementAge={cannotRetire ? null : scenarioRetirementAge} selectedAge={selectedAge} onSelect={setSelectedAge}
                    showStatus={false} projectionData={browsedProjection} runoutLayout />
                  <div className="runout-legend" aria-label="Chart legend">
                    <span><i className="cash-key" />Cash in hand</span>
                    <span><i className="expense-key" />Expenditure</span>
                  </div>
                </section>
                <div className="runout-age-axis" aria-hidden="true"><span>30</span><span>45</span><span>60</span><span>75</span><span>90</span></div>
              </> : <>
                <section className="retirement-result">
                <h1>{showingCurrentRetirement ? "You are already retired" : "Retirement age"}</h1>
                <strong>{scenarioRetirementAge ?? details.age}</strong>
                <p>The {outlookLabel(outlook).toLowerCase()} scenario supports retirement at this age</p>
                  <button onClick={() => {
                  setRecommendationsLoading(true); setTargetProjection(null); setTargetAge(scenarioRetirementAge ?? details.age); setSelectedAge(scenarioRetirementAge ?? details.age);
                  setSheet("retirement");
                }}><SlidersHorizontal size={20} />Change age</button>
                </section>
                <h2 className="age-breakdown-title">Age wise breakdown of your finances</h2>
              </>}
            </section>
            <nav className={`bottom-nav ${cannotRetire ? "runout-bottom-nav" : ""}`} aria-label="Plan actions">
              <button className="share-main" aria-label="Edit details" onClick={() => { setEditingDetails(true); setChartExpanded(false); setScreen("details"); }}>{cannotRetire ? <Image src={assetPath("/edit.svg")} width={24} height={24} alt="" /> : "Edit details"}</button>
              <button className="export-main primary-button" onClick={exportCsv}>Export</button>
            </nav>
          </>}
        </LoadingScreen>}

        {sheet === "retirement" && targetAge !== null && <BottomSheet title={scenarioRetirementAge === null ? "Set retirement age" : "Change retirement age"} onClose={() => { setSheet(null); setTargetAge(null); setTargetProjection(null); setSelectedAge(scenarioRetirementAge ?? details.age); }}>
          <p className="calculated-age-copy">{outlookLabel(outlook).toLowerCase()} scenario</p>
          <RangeField label="I want to retire by…" value={targetAge} min={details.age} max={LIFE_EXPECTANCY - 1} step={1} prefix="" onChange={(age) => {
            setRecommendationsLoading(true); setTargetProjection(null); setTargetAge(age); setSelectedAge(age);
          }} />
          <h3 className="changes-heading">You need to bring in these changes</h3>
          <div className={`change-alternatives ${recommendationsLoading ? "loading" : ""}`}>
            {(() => {
              const suggestions = [
                recommendation?.monthlySip == null ? null : { label: "Increase monthly SIPs to", value: recommendation.monthlySip, current: details.monthlySip },
                recommendation?.monthlyExpense == null ? null : { label: "Decrease monthly expenditure to", value: recommendation.monthlyExpense, current: details.monthlyExpense },
                recommendation?.monthlyIncome == null ? null : { label: "Increase monthly salary to", value: recommendation.monthlyIncome, current: details.monthlyIncome },
              ].filter((item): item is { label: string; value: number; current: number } => item !== null);
              const currentCorpus = details.bankSavings + details.fixedDeposits + details.mutualFunds + details.stocks + details.realEstate;
              if (!suggestions.length && recommendation) suggestions.push({ label: "Increase current investments to", value: recommendation.requiredCurrentCorpus, current: currentCorpus });
              return suggestions.map((item, index) => <div className="change-suggestion" key={item.label}>
                {index > 0 && <div className="or-divider"><span>or</span><i /></div>}
                <p>{item.label}</p>
                <strong>{inr(item.value, false)} <small>current: {inr(item.current, false).replace("₹", "")}</small></strong>
              </div>);
            })()}
          </div>
          <button className="secondary-action sheet-action" onClick={exportCsv}><Download size={20} />Download plan</button>
        </BottomSheet>}

        {sheet === "scenarios" && <div className="sheet-backdrop scenario-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
          <section className="scenario-sheet" role="dialog" aria-modal="true" aria-label="Scenario simulations">
            <div className="sheet-handle" />
            <h2>Scenario simulations</h2>
            <div className="scenario-chart">
              <ProjectionChart details={details} dependents={dependents} loan={loan} retirementAge={estimatedAge} selectedAge={null} onSelect={() => undefined}
                projectionData={calculatedPlan?.paths.typical} possiblePaths={calculatedPlan?.samples}
                possibleExpensePaths={calculatedPlan?.expenseSamples} showOutcomes showStatus={false} />
            </div>
            <p>Your finance details are run through multiple historical and market scenarios to see how it survives till you turn 90</p>
            <p className="monte-carlo-copy">These scenarios are a simplified form of Monte Carlo simulations that uses a range of all rates year on year. These values are based on government data.</p>
            <div className="scenario-ranges-wrap">
              <table className="scenario-ranges" aria-label="Rate ranges by economy scenario">
                <thead><tr>
                  <th scope="col">Rate</th>
                  <th scope="col">Bad</th>
                  <th scope="col">Average</th>
                  <th scope="col">Good</th>
                </tr></thead>
                <tbody>
                  {(["inflation", "mutualFunds", "stocks", "fixedDeposits", "realEstate", "savings"] as RateKey[]).map((key) => <tr key={key}>
                    <th scope="row">{RESULT_RATE_LABELS[key]}</th>
                    {OUTLOOKS.map((scenario) => {
                      const summary = calculatedPlan?.rateSummaries[scenario][key];
                      return <td key={scenario}>{summary ? compactPercentageRange(summary.min, summary.max) : percentage(BASE_RATES[key])}</td>;
                    })}
                  </tr>)}
                </tbody>
              </table>
            </div>
            <button className="know-more" type="button">Know more</button>
            <button className="secondary-action scenario-done" onClick={() => setSheet(null)}>Got it</button>
          </section>
        </div>}

        {sheet === "dependents" && <BottomSheet title="Add dependents" onClose={() => setSheet(null)}>
          <RangeField label="Number of dependents" value={dependents.count} min={0} max={8} step={1} prefix="" onChange={(value) => setDependents({ ...dependents, count: value })} />
          <RangeField label="Annual cost per dependent" value={dependents.annualCostPerDependent} min={0} max={2_400_000} step={25_000} onChange={(value) => setDependents({ ...dependents, annualCostPerDependent: value })} />
          <RangeField label="Support for years" value={dependents.supportYears} min={1} max={30} step={1} prefix="" onChange={(value) => setDependents({ ...dependents, supportYears: value })} />
          <button className="primary-button sheet-action" onClick={() => setSheet(null)}>Save dependents</button>
        </BottomSheet>}

        {sheet === "loan" && <BottomSheet title="Add a loan" onClose={() => setSheet(null)}>
          <RangeField label="Outstanding balance" value={loan.balance} min={0} max={20_000_000} step={50_000} onChange={(value) => setLoan({ ...loan, balance: value })} />
          <RangeField label="Monthly EMI" value={loan.emi} min={0} max={300_000} step={2_500} onChange={(value) => setLoan({ ...loan, emi: value })} />
          <RangeField label="Years remaining" value={loan.remainingYears} min={1} max={30} step={1} prefix="" onChange={(value) => setLoan({ ...loan, remainingYears: value })} />
          <button className="primary-button sheet-action" onClick={() => setSheet(null)}>Save loan</button>
        </BottomSheet>}

        {sheet === "share" && <BottomSheet title="Save or share your plan" onClose={() => setSheet(null)}>
          <button className="sheet-option" onClick={exportCsv}><FileSpreadsheet size={21} /><span><b>Download spreadsheet</b><small>Editable plan and assumptions</small></span><Download size={18} /></button>
          <button className="sheet-option" onClick={() => window.print()}><FileText size={21} /><span><b>Save as PDF</b><small>Summary, chart and target plan</small></span><Download size={18} /></button>
          <button className="sheet-option" onClick={nativeShare}><Share2 size={21} /><span><b>Share from your phone</b><small>Use your device’s share menu</small></span></button>
        </BottomSheet>}

        {sheet === "help" && <BottomSheet title="What does this show?" onClose={() => setSheet(null)}>
          <div className="help-copy"><p>Green bars show your projected investible corpus. Red bars show what you may spend each year.</p><p>Enter your current finances to estimate when your investments could support your lifestyle without a salary.</p><p>This is an educational planning tool, not financial advice.</p></div>
          <button className="primary-button sheet-action" onClick={() => setSheet(null)}>Got it</button>
        </BottomSheet>}
      </section>
    </main>
  );
}
