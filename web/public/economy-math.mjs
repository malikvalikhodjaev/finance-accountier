const fail = message => { const error = new Error(message); error.status = 400; throw error; };
export const economyRoles = { earned: 'Заработок', variable: 'Прямые переменные затраты', work: 'Рабочие постоянные расходы', living: 'Личные расходы', investment: 'Инвестиции и активы', other: 'Прочие доходы', financing: 'Займы и финансирование', exclude: 'Исключить из модели' };
const amountKeys = ['revenueMinor', 'workMinor', 'livingMinor', 'investmentMinor', 'goalMinor'];
export function validatePlan(input) {
  if (!input || typeof input !== 'object' || !/^[A-Z]{3}$/.test(input.currency || '')) fail('Выбери валюту модели.');
  const result = { currency: input.currency };
  for (const key of amountKeys) {
    const value = input[key] ?? null;
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 100000000000000)) fail('Некорректная сумма месячной модели.');
    result[key] = value;
  }
  const rate = input.variableBps ?? null;
  if (rate !== null && (!Number.isInteger(rate) || rate < 0 || rate > 10000)) fail('Доля прямых затрат: от 0 до 100%.');
  result.variableBps = rate;
  return result;
}
export function calculatePlan(input) {
  const plan = validatePlan(input), required = [...amountKeys, 'variableBps'];
  if (required.some(key => plan[key] === null)) return { complete: false, missing: required.filter(key => plan[key] === null) };
  const revenue = BigInt(plan.revenueMinor), rate = BigInt(plan.variableBps), work = BigInt(plan.workMinor), living = BigInt(plan.livingMinor), investment = BigInt(plan.investmentMinor), goal = BigInt(plan.goalMinor);
  const variable = (revenue * rate + 5000n) / 10000n, throughput = revenue - variable, operating = throughput - work, personal = operating - living, available = personal - investment;
  const denominator = 10000n - rate, requiredRevenue = denominator ? ((work + living + investment + goal) * 10000n + denominator - 1n) / denominator : null;
  return { complete: true, variableMinor: String(variable), throughputMinor: String(throughput), operatingMinor: String(operating), personalMinor: String(personal), availableMinor: String(available), goalGapMinor: String(available - goal), requiredRevenueMinor: requiredRevenue === null ? null : String(requiredRevenue) };
}
