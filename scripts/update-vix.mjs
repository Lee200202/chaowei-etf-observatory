import { readFile, writeFile } from 'node:fs/promises';

const source = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv';
const path = new URL('../pages-data/vix.json', import.meta.url);
const response = await fetch(source, { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw Error('Cboe VIX HTTP ' + response.status);
const csv = await response.text();
const days = csv.split(/\r?\n/).slice(1).flatMap(line => {
  const [date, , , , close] = line.trim().split(',');
  const match = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const value = Number(close);
  return match && Number.isFinite(value) && value > 0
    ? [{ date: match[3] + '-' + match[1] + '-' + match[2], value }] : [];
}).sort((a, b) => a.date.localeCompare(b.date)).slice(-2700);
if (days.length < 1250 || new Set(days.map(day => day.date)).size !== days.length) {
  throw Error('Cboe VIX CSV 資料不足或日期重複');
}
const previous = await readFile(path, 'utf8').then(JSON.parse, error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
const latest = days.at(-1).date;
if (previous?.latest > latest) throw Error('Cboe VIX 歷史版本較舊');
if (JSON.stringify(previous?.days) !== JSON.stringify(days)) {
  await writeFile(path, JSON.stringify({ source, latest, frequency: 'daily', days }) + '\n');
}
console.log('Cboe VIX:', days.length, '筆，截至', latest);
