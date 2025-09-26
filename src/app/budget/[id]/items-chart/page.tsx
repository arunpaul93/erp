"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
    Chart as ChartJS,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Tooltip,
    Legend
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Legend);

interface RawItem { id: string; date: string; amount: number; budget_income_id?: string | null; budget_expense_id?: string | null }
interface ExpenseMeta { id: string; name: string | null }
interface IncomeMeta { id: string; name: string | null }

export default function BudgetItemsChartPage() {
    const params = useParams() as { id?: string };
    const budgetId = params?.id ? String(params.id) : '';
    const [items, setItems] = useState<RawItem[]>([]);
    const [expenses, setExpenses] = useState<ExpenseMeta[]>([]);
    const [incomes, setIncomes] = useState<IncomeMeta[]>([]);
    const [equityTxns, setEquityTxns] = useState<{ id: string; date: string; amount: number }[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const chartRef = useRef<any>(null);
    const [legendOpen, setLegendOpen] = useState(true);
    const [expensesGroupOpen, setExpensesGroupOpen] = useState(true);
    const [incomesGroupOpen, setIncomesGroupOpen] = useState(true);
    const [bankGroupOpen, setBankGroupOpen] = useState(true);
    const [operationalGroupOpen, setOperationalGroupOpen] = useState(true);
    const [equityGroupOpen, setEquityGroupOpen] = useState(true);
    const [hidden, setHidden] = useState<Record<string, boolean>>({});
    const [equityMsg, setEquityMsg] = useState<string | null>(null);
    const [equityLoading, setEquityLoading] = useState(false);
    const [equityFormOpen, setEquityFormOpen] = useState(false);
    const [minInput, setMinInput] = useState('0');
    const [maxInput, setMaxInput] = useState('200');

    const toggleDataset = useCallback((label: string) => {
        const chart = chartRef.current?.canvas && chartRef.current; // react-chartjs-2 ref points to ChartJS instance
        if (!chart) return;
        const index = chart.data.datasets.findIndex((d: any) => d.label === label);
        if (index === -1) return;
        const currentlyHidden = chart.isDatasetVisible(index) === false;
        chart.setDatasetVisibility(index, currentlyHidden); // invert
        chart.update();
        setHidden(h => ({ ...h, [label]: !currentlyHidden }));
    }, []);

    const toggleGroup = useCallback((group: 'income' | 'expense' | 'equity') => {
        const chart = chartRef.current?.canvas && chartRef.current;
        if (!chart || !chart.data?.datasets) return;
        type Entry = { d: any; idx: number };
        const indices: Entry[] = chart.data.datasets
            .map((d: any, idx: number) => ({ d, idx }))
            .filter((o: Entry) => o.d.group === group && !o.d.cumulative);
        const anyVisible = indices.some((o: Entry) => chart.isDatasetVisible(o.idx));
        indices.forEach((o: Entry) => {
            chart.setDatasetVisibility(o.idx, !anyVisible);
            setHidden(h => ({ ...h, [o.d.label]: anyVisible ? true : false }));
        });
        chart.update();
    }, []);

    const toggleCumulative = useCallback((group: 'income' | 'expense') => {
        const chart = chartRef.current?.canvas && chartRef.current;
        if (!chart || !chart.data?.datasets) return;
        const idx = chart.data.datasets.findIndex((d: any) => d.group === group && d.cumulative);
        if (idx === -1) return;
        const ds = chart.data.datasets[idx];
        const isCurrentlyVisible = chart.isDatasetVisible(idx);
        chart.setDatasetVisibility(idx, !isCurrentlyVisible);
        chart.update();
        setHidden(h => ({ ...h, [ds.label]: isCurrentlyVisible }));
    }, []);

    const toggleOperational = useCallback(() => {
        const chart = chartRef.current?.canvas && chartRef.current;
        if (!chart || !chart.data?.datasets) return;
        const idx = chart.data.datasets.findIndex((d: any) => d.label === 'Operational Cash');
        if (idx === -1) return;
        const visible = chart.isDatasetVisible(idx);
        chart.setDatasetVisibility(idx, !visible);
        chart.update();
        setHidden(h => ({ ...h, ['Operational Cash']: visible }));
    }, []);

    const toggleBankNet = useCallback(() => {
        const chart = chartRef.current?.canvas && chartRef.current;
        if (!chart || !chart.data?.datasets) return;
        const idx = chart.data.datasets.findIndex((d: any) => d.label === 'Net Bank Account Balance');
        if (idx === -1) return;
        const visible = chart.isDatasetVisible(idx);
        chart.setDatasetVisibility(idx, !visible);
        chart.update();
        setHidden(h => ({ ...h, ['Net Bank Account Balance']: visible }));
    }, []);

    const toggleParentGroup = useCallback((parent: 'bank' | 'operational') => {
        const chart = chartRef.current?.canvas && chartRef.current;
        if (!chart || !chart.data?.datasets) return;
        // Determine labels included
        let labels: string[] = [];
        if (parent === 'bank') {
            labels = chart.data.datasets.filter((d: any) => ['bank', 'operational', 'income', 'expense', 'equity'].includes(d.group)).map((d: any) => d.label);
        } else if (parent === 'operational') {
            labels = chart.data.datasets.filter((d: any) => ['operational', 'income', 'expense'].includes(d.group)).map((d: any) => d.label);
        }
        // Find indices
        const indices = labels.map(l => chart.data.datasets.findIndex((d: any) => d.label === l)).filter(i => i !== -1);
        const anyVisible = indices.some(i => chart.isDatasetVisible(i));
        indices.forEach(i => chart.setDatasetVisibility(i, !anyVisible));
        chart.update();
        setHidden(h => {
            const next = { ...h };
            labels.forEach(l => { next[l] = anyVisible; });
            return next;
        });
    }, []);

    useEffect(() => {
        if (!budgetId) return;
        let cancelled = false;
        (async () => {
            setLoading(true); setError(null);
            const [itemsRes, expensesRes, incomesRes] = await Promise.all([
                supabase
                    .from('budget_items')
                    .select('id, amount, date, budget_income_id, budget_expense_id')
                    .eq('budget_id', budgetId)
                    .order('date', { ascending: true }),
                supabase
                    .from('budget_expenses')
                    .select('id, expense_name')
                    .eq('budget_id', budgetId),
                supabase
                    .from('budget_incomes')
                    .select('id, income_name')
                    .eq('budget_id', budgetId)
            ]);
            if (cancelled) return;
            if (itemsRes.error) { setError(itemsRes.error.message); setLoading(false); return; }
            if (expensesRes.error) { setError(expensesRes.error.message); setLoading(false); return; }
            if (incomesRes.error) { setError(incomesRes.error.message); setLoading(false); return; }
            setItems((itemsRes.data || []).map(r => ({
                id: String(r.id),
                date: r.date,
                amount: Number(r.amount),
                budget_income_id: r.budget_income_id,
                budget_expense_id: r.budget_expense_id
            })));
            setExpenses((expensesRes.data || []).map(e => ({ id: String(e.id), name: (e as any).expense_name })));
            setIncomes((incomesRes.data || []).map(i => ({ id: String(i.id), name: (i as any).income_name })));
            setLoading(false);
        })();
        return () => { cancelled = true };
    }, [budgetId]);

    useEffect(() => {
        if (!budgetId) return;
        let cancelled = false;
        (async () => {
            const { data, error } = await supabase
                .from('budget_equity_transactions')
                .select('id, amount, transaction_date')
                .eq('budget_id', budgetId)
                .order('transaction_date', { ascending: true });
            if (cancelled) return;
            if (error) { console.warn('Equity txns fetch error', error.message); return; }
            setEquityTxns((data || []).map(r => ({ id: String(r.id), date: (r as any).transaction_date, amount: Number((r as any).amount) })));
            console.log('Equity txns', data);
        })();
        return () => { cancelled = true };
    }, [budgetId]);

    const chartData = useMemo(() => {
        if (!items.length) return null;
        const dateSet = new Set(items.map(i => i.date));
        equityTxns.forEach(t => dateSet.add(t.date));
        const dates = Array.from(dateSet).sort();
        // Compute two extra future dates for extended grid spacing
        let extendedDates = [...dates];
        if (dates.length) {
            const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
            const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
            const last = parse(dates[dates.length - 1]);
            const plusDays = (base: Date, days: number) => new Date(base.getTime() + days * 86400000);
            // Assume daily granularity; append +1 and +2 days
            extendedDates.push(fmt(plusDays(last, 1)), fmt(plusDays(last, 2)));
        }
        // Map incomeId -> date -> total
        const incomeMatrix: Record<string, Record<string, number>> = {};
        // Map expenseId -> date -> total
        const expenseMatrix: Record<string, Record<string, number>> = {};
        items.forEach(i => {
            if (i.budget_income_id) {
                const incId = i.budget_income_id;
                if (!incomeMatrix[incId]) incomeMatrix[incId] = {};
                incomeMatrix[incId][i.date] = (incomeMatrix[incId][i.date] || 0) + i.amount;
            } else if (i.budget_expense_id) {
                const exId = i.budget_expense_id;
                if (!expenseMatrix[exId]) expenseMatrix[exId] = {};
                expenseMatrix[exId][i.date] = (expenseMatrix[exId][i.date] || 0) + i.amount;
            }
        });

        // Equity positive/negative per date
        const equityPosPerDate: Record<string, number> = {};
        const equityNegPerDate: Record<string, number> = {};
        equityTxns.forEach(t => {
            if (t.amount >= 0) equityPosPerDate[t.date] = (equityPosPerDate[t.date] || 0) + t.amount;
            else equityNegPerDate[t.date] = (equityNegPerDate[t.date] || 0) + t.amount; // negative values retained
        });

        // Extended color palette for distinctive lines
        const palette = [
            '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#0d9488', '#06b6d4', '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#9333ea', '#c026d3', '#db2777', '#e11d48', '#ea580c', '#65a30d', '#059669',
            '#0ea5e9', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#f43f5e', '#facc15', '#14b8a6', '#3b82f6', '#475569'
        ];
        let colorPtr = 0;
        const takeColor = () => {
            const c = palette[colorPtr % palette.length];
            colorPtr++;
            return c;
        };

        const incomeIds = Object.keys(incomeMatrix).sort();
        const incomeTotalsPerDate = dates.map(d => incomeIds.reduce((sum, id) => sum + (incomeMatrix[id][d] || 0), 0));
        const incomeCumulative: number[] = [];
        incomeTotalsPerDate.reduce((acc, v, idx) => { const next = acc + v; incomeCumulative[idx] = next; return next; }, 0);

        const incomeDatasets = incomeIds.map((incomeId) => {
            const series = dates.map(d => incomeMatrix[incomeId][d] || 0);
            const meta = incomes.find(i => i.id === incomeId);
            const label = meta?.name || `Income ${incomeId}`;
            const color = takeColor();
            return { label, data: series, borderColor: color, backgroundColor: color, tension: 0, pointRadius: 2, group: 'income' } as any;
        });

        const expenseIds = Object.keys(expenseMatrix).sort();
        const expenseTotalsPerDate = dates.map(d => expenseIds.reduce((sum, id) => sum + (expenseMatrix[id][d] || 0), 0));
        const expenseCumulativeRaw: number[] = [];
        expenseTotalsPerDate.reduce((acc, v, idx) => { const next = acc + v; expenseCumulativeRaw[idx] = next; return next; }, 0);
        const expenseCumulative = expenseCumulativeRaw.map(v => -v);

        const expenseDatasets = expenseIds.map((expenseId) => {
            const series = dates.map(d => -(expenseMatrix[expenseId][d] || 0));
            const meta = expenses.find(e => e.id === expenseId);
            const label = meta?.name || `Expense ${expenseId}`;
            const color = takeColor();
            return { label, data: series, borderColor: color, backgroundColor: color, tension: 0, pointRadius: 1.5, group: 'expense' } as any;
        });

        const operationalNet: number[] = incomeCumulative.map((v, i) => v + (expenseCumulative[i] || 0));

        // Equity datasets
        const equityPositiveSeries = dates.map(d => equityPosPerDate[d] || 0);
        const equityNegativeSeries = dates.map(d => equityNegPerDate[d] || 0); // already negative

        // Equity cumulative (net contributions-drawings) and bank net (operational + equity cumulative)
        const equityDailyNet = dates.map((d) => (equityPosPerDate[d] || 0) + (equityNegPerDate[d] || 0));
        const equityCumulative: number[] = [];
        equityDailyNet.reduce((acc, v, idx) => { const next = acc + v; equityCumulative[idx] = next; return next; }, 0);
        const bankNet = operationalNet.map((v, i) => v + (equityCumulative[i] || 0));

        // Pad datasets with nulls for the two extended dates (if added)
        const padCount = extendedDates.length - dates.length;
        const pad = (arr: number[]) => padCount > 0 ? [...arr, ...Array(padCount).fill(null)] : arr;

        // Assign unique colors for summary / cumulative datasets after base lists to avoid overlapping with incomes/expenses
        const bankColor = takeColor();
        const operationalColor = takeColor();
        const incomeCumColor = takeColor();
        const expenseCumColor = takeColor();
        const equityContribColor = takeColor();
        const equityDrawColor = takeColor();

        // Prepend summary datasets (ensuring their colors differ from children)
        const datasets: any[] = [
            { label: 'Net Bank Account Balance', data: pad(bankNet), borderColor: bankColor, backgroundColor: bankColor, tension: 0, pointRadius: 0, group: 'bank' },
            { label: 'Operational Cash', data: pad(operationalNet), borderColor: operationalColor, backgroundColor: operationalColor, tension: 0, pointRadius: 0, group: 'operational' },
            { label: 'Income (Cumulative)', data: pad(incomeCumulative), borderColor: incomeCumColor, backgroundColor: incomeCumColor, tension: 0, pointRadius: 0, group: 'income', cumulative: true },
            ...incomeDatasets.map(d => ({ ...d, data: pad(d.data) })),
            { label: 'Expenses (Cumulative)', data: pad(expenseCumulative), borderColor: expenseCumColor, backgroundColor: expenseCumColor, tension: 0, pointRadius: 0, group: 'expense', cumulative: true },
            ...expenseDatasets.map(d => ({ ...d, data: pad(d.data) })),
            { label: 'Equity Contributions', data: pad(equityPositiveSeries), borderColor: equityContribColor, backgroundColor: equityContribColor, tension: 0, pointRadius: 2, group: 'equity' },
            { label: 'Equity Drawings', data: pad(equityNegativeSeries), borderColor: equityDrawColor, backgroundColor: equityDrawColor, tension: 0, pointRadius: 2, group: 'equity' }
        ];

        return { labels: extendedDates, datasets };
    }, [items, expenses, incomes, equityTxns]);

    // Helper to get current dataset color for legend headers
    const getHeaderColor = (label: string, fallback: string) => {
        const ds = chartData?.datasets.find(d => (d as any).label === label) as any;
        return ds?.borderColor || fallback;
    };

    const submitEquityBuffer = useCallback(async () => {
        if (!budgetId) return;
        const min_val = Number(minInput);
        const max_val = Number(maxInput);
        if (Number.isNaN(min_val) || Number.isNaN(max_val)) { setEquityMsg('Invalid numbers'); return; }
        if (min_val > max_val) { setEquityMsg('Min cannot exceed Max'); return; }
        setEquityLoading(true); setEquityMsg(null);
        const { error, data } = await supabase.rpc('ensure_budget_equity_buffer', { p_budget_id: budgetId, p_min_balance: min_val, p_max_balance: max_val });
        if (error) setEquityMsg('Error: ' + error.message);
        else {
            setEquityMsg(`Equity buffer ensured (${Array.isArray(data) ? data.length : 0} actions)`);
            setEquityFormOpen(false);
        }
        setEquityLoading(false);
    }, [budgetId, minInput, maxInput]);

    const handleEnsureEquityBuffer = useCallback(() => {
        setMinInput('0');
        setMaxInput('200');
        setEquityFormOpen(true);
        setEquityMsg(null);
    }, []);

    return (
        <div className="h-screen flex bg-gray-950 text-gray-100">
            {/* Sidebar Legend */}
            <div className={"transition-all duration-300 border-r border-gray-800 bg-gray-900/60 backdrop-blur-sm flex flex-col " + (legendOpen ? 'w-56' : 'w-10')}>
                <button
                    onClick={() => setLegendOpen(o => !o)}
                    className="h-10 w-full flex items-center justify-center text-xs font-medium uppercase tracking-wide bg-gray-900 hover:bg-gray-800 border-b border-gray-800"
                >
                    {legendOpen ? '◀' : '▶'}
                </button>
                {legendOpen && (
                    <div className="flex-1 overflow-auto p-3 space-y-6">
                        {/* Net Bank Account Balance parent */}
                        <div>
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => setBankGroupOpen(o => !o)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBankGroupOpen(o => !o); } }}
                                className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-gray-300 mb-2 hover:text-gray-100 cursor-pointer select-none"
                            >
                                <span className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getHeaderColor('Net Bank Account Balance', '#fde047'), opacity: hidden['Net Bank Account Balance'] ? 0.35 : 1 }} />
                                    <span>Net Bank Account Balance</span>
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        title="Toggle net bank balance"
                                        onClick={(e) => { e.stopPropagation(); toggleBankNet(); }}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
                                    >Σ</button>
                                    <button
                                        type="button"
                                        title="Toggle all children"
                                        onClick={(e) => { e.stopPropagation(); toggleParentGroup('bank'); }}
                                        className="text-[10px] px-1 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
                                    >All</button>
                                    <span>{bankGroupOpen ? '−' : '+'}</span>
                                </div>
                            </div>
                            {bankGroupOpen && (
                                <div className="pl-3 border-l border-gray-800 space-y-6">
                                    {/* Operational Cash subsection */}
                                    <div>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setOperationalGroupOpen(o => !o)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOperationalGroupOpen(o => !o); } }}
                                            className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1 hover:text-gray-300 cursor-pointer select-none"
                                        >
                                            <span className="flex items-center gap-2">
                                                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getHeaderColor('Operational Cash', '#fbbf24'), opacity: hidden['Operational Cash'] ? 0.35 : 1 }} />
                                                <span>Operational Cash</span>
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    title="Toggle operational cash"
                                                    onClick={(e) => { e.stopPropagation(); toggleOperational(); }}
                                                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
                                                >Σ</button>
                                                <button
                                                    type="button"
                                                    title="Toggle all operational children"
                                                    onClick={(e) => { e.stopPropagation(); toggleParentGroup('operational'); }}
                                                    className="text-[10px] px-1 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
                                                >All</button>
                                                <span>{operationalGroupOpen ? '−' : '+'}</span>
                                            </div>
                                        </div>
                                        {operationalGroupOpen && (
                                            <div className="pl-3 border-l border-gray-800 space-y-4">
                                                {/* Income section */}
                                                <div>
                                                    <div
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => setIncomesGroupOpen(o => !o)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIncomesGroupOpen(o => !o); } }}
                                                        className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1 hover:text-gray-300 cursor-pointer select-none"
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getHeaderColor('Income (Cumulative)', '#34d399'), opacity: hidden['Income (Cumulative)'] ? 0.35 : 1 }} />
                                                            <span>Income</span>
                                                        </span>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                title="Toggle cumulative"
                                                                onClick={(e) => { e.stopPropagation(); toggleCumulative('income'); }}
                                                                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
                                                            >Σ</button>
                                                            <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroup('income'); }} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700">Toggle</button>
                                                            <span>{incomesGroupOpen ? '−' : '+'}</span>
                                                        </div>
                                                    </div>
                                                    {incomesGroupOpen && (
                                                        <ul className="space-y-1 text-sm max-h-64 overflow-auto pr-1">
                                                            {(chartData?.datasets || [])
                                                                .filter(d => (d as any).group === 'income' && !(d as any).cumulative)
                                                                .map(ds => {
                                                                    const color = ds.borderColor as string;
                                                                    const isHidden = hidden[ds.label];
                                                                    return (
                                                                        <li key={ds.label}>
                                                                            <button
                                                                                onClick={() => toggleDataset(ds.label)}
                                                                                className="w-full flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-800/70 text-left"
                                                                            >
                                                                                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }} />
                                                                                <span className={isHidden ? 'line-through opacity-60' : ''}>{ds.label}</span>
                                                                            </button>
                                                                        </li>
                                                                    );
                                                                })}
                                                        </ul>
                                                    )}
                                                </div>
                                                {/* Expenses section */}
                                                <div>
                                                    <div
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() => setExpensesGroupOpen(o => !o)}
                                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpensesGroupOpen(o => !o); } }}
                                                        className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1 hover:text-gray-300 cursor-pointer select-none"
                                                    >
                                                        <span className="flex items-center gap-2">
                                                            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getHeaderColor('Expenses (Cumulative)', '#fb7185'), opacity: hidden['Expenses (Cumulative)'] ? 0.35 : 1 }} />
                                                            <span>Expenses</span>
                                                        </span>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                title="Toggle cumulative"
                                                                onClick={(e) => { e.stopPropagation(); toggleCumulative('expense'); }}
                                                                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
                                                            >Σ</button>
                                                            <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroup('expense'); }} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700">Toggle</button>
                                                            <span>{expensesGroupOpen ? '−' : '+'}</span>
                                                        </div>
                                                    </div>
                                                    {expensesGroupOpen && (
                                                        <ul className="space-y-1 text-sm max-h-64 overflow-auto pr-1">
                                                            {(chartData?.datasets || [])
                                                                .filter(d => (d as any).group === 'expense' && !(d as any).cumulative)
                                                                .map(ds => {
                                                                    const color = ds.borderColor as string;
                                                                    const isHidden = hidden[ds.label];
                                                                    return (
                                                                        <li key={ds.label}>
                                                                            <button
                                                                                onClick={() => toggleDataset(ds.label)}
                                                                                className="w-full flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-800/70 text-left"
                                                                            >
                                                                                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }} />
                                                                                <span className={isHidden ? 'line-through opacity-60' : ''}>{ds.label}</span>
                                                                            </button>
                                                                        </li>
                                                                    );
                                                                })}
                                                        </ul>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    {/* Equity subsection */}
                                    <div>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setEquityGroupOpen(o => !o)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEquityGroupOpen(o => !o); } }}
                                            className="w-full flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1 hover:text-gray-300 cursor-pointer select-none"
                                        >
                                            <span className="flex items-center gap-2">
                                                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getHeaderColor('Equity Contributions', '#818cf8'), opacity: hidden['Equity Contributions'] ? 0.35 : 1 }} />
                                                <span>Equity</span>
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroup('equity'); }} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 border border-gray-700">Toggle</button>
                                                <span>{equityGroupOpen ? '−' : '+'}</span>
                                            </div>
                                        </div>
                                        {equityGroupOpen && (
                                            <ul className="space-y-1 text-sm max-h-40 overflow-auto pr-1">
                                                {(chartData?.datasets || [])
                                                    .filter(d => (d as any).group === 'equity')
                                                    .map(ds => {
                                                        const color = ds.borderColor as string;
                                                        const isHidden = hidden[ds.label];
                                                        return (
                                                            <li key={ds.label}>
                                                                <button
                                                                    onClick={() => toggleDataset(ds.label)}
                                                                    className="w-full flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-800/70 text-left"
                                                                >
                                                                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color, opacity: isHidden ? 0.3 : 1 }} />
                                                                    <span className={isHidden ? 'line-through opacity-60' : ''}>{ds.label}</span>
                                                                </button>
                                                            </li>
                                                        );
                                                    })}
                                            </ul>
                                        )}
                                        {/* Equity buffer action */}
                                        <div className="pt-2 space-y-2">
                                            <button
                                                type="button"
                                                disabled={equityLoading}
                                                onClick={handleEnsureEquityBuffer}
                                                className="w-full text-[10px] font-semibold uppercase tracking-wide rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1"
                                            >Ensure Equity Buffer</button>
                                            {equityFormOpen && (
                                                <div className="space-y-2 rounded border border-amber-700 bg-gray-800/70 p-2">
                                                    <div className="flex gap-2">
                                                        <div className="flex-1">
                                                            <label className="block text-[9px] uppercase tracking-wide text-gray-400 mb-0.5">Min</label>
                                                            <input
                                                                value={minInput}
                                                                onChange={e => setMinInput(e.target.value)}
                                                                type="number"
                                                                className="w-full bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-500"
                                                                placeholder="e.g. 100"
                                                            />
                                                        </div>
                                                        <div className="flex-1">
                                                            <label className="block text-[9px] uppercase tracking-wide text-gray-400 mb-0.5">Max</label>
                                                            <input
                                                                value={maxInput}
                                                                onChange={e => setMaxInput(e.target.value)}
                                                                type="number"
                                                                className="w-full bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-500"
                                                                placeholder="e.g. 250"
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-end gap-2 pt-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => { setEquityFormOpen(false); }}
                                                            className="text-[10px] px-2 py-1 rounded border border-gray-600 hover:bg-gray-700"
                                                        >Cancel</button>
                                                        <button
                                                            type="button"
                                                            disabled={equityLoading}
                                                            onClick={submitEquityBuffer}
                                                            className="text-[10px] px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50"
                                                        >{equityLoading ? 'Running...' : 'Run'}</button>
                                                    </div>
                                                </div>
                                            )}
                                            {equityMsg && <p className="text-[10px] text-gray-400 leading-snug">{equityMsg}</p>}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {/* Main content */}
            <div className="flex-1 flex flex-col p-6">
                <div className="mb-4 shrink-0">
                    <h1 className="text-lg font-semibold">Budget Items (Income vs Expense)</h1>
                    {loading && <p className="text-sm text-gray-400">Loading…</p>}
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    {!loading && !error && !items.length && <p className="text-sm text-gray-400">No items.</p>}
                </div>
                {chartData && (
                    <div className="flex-1 min-h-0 bg-gray-900 border border-gray-800 rounded p-4">
                        <div className="w-full h-full">
                            <Line
                                ref={chartRef}
                                data={chartData}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    interaction: { mode: 'index', intersect: false },
                                    plugins: {
                                        legend: { display: false },
                                        tooltip: { mode: 'index', intersect: false }
                                    },
                                    scales: {
                                        x: {
                                            ticks: { color: '#9ca3af' },
                                            grid: { color: '#1f2937' }
                                        },
                                        y: {
                                            ticks: { color: '#9ca3af' },
                                            grid: { color: '#1f2937' },
                                            afterDataLimits: (scale: any) => {
                                                const range = (scale.max - scale.min) || 1;
                                                const roughStep = range / 10;
                                                const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
                                                const mult = roughStep / pow10;
                                                let step: number;
                                                if (mult >= 5) step = 5 * pow10; else if (mult >= 2) step = 2 * pow10; else step = pow10;
                                                scale.min -= step * 2;
                                                scale.max += step * 2;
                                                // apply step for ticks (dynamic fit with padding)
                                                if (scale.options && scale.options.ticks) {
                                                    scale.options.ticks.stepSize = step;
                                                }
                                            }
                                        }
                                    }
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
