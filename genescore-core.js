export const naturalCompare = (a, b) => a.localeCompare(b, 'en', {numeric:true});
export function rankRows(rows, sort = 'mean-desc', filter = '') {
  const query = filter.trim().toUpperCase();
  return rows.filter(row => row.id.toUpperCase().includes(query)).sort((a,b) => {
    const delta = sort === 'mean-asc' ? a.mean-b.mean : sort === 'fraction-desc' ? b.fraction-a.fraction : sort === 'id' ? 0 : b.mean-a.mean;
    return delta || naturalCompare(a.id,b.id);
  });
}
export function formatValue(value) {
  if (value === 0) return '0';
  return value < 0.001 ? value.toExponential(2) : Number(value.toPrecision(4)).toLocaleString('en', {maximumFractionDigits:6});
}
export function percentage(fraction) { return (fraction*100).toFixed(2) + '%'; }
export function csvFor(rows, gene) {
  const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
  return ['gene,subtype,mean_genescore,fraction_cells_with_signal,percent_cells_with_signal', ...rows.map(row => [quote(gene),quote(row.id),row.mean,row.fraction,row.fraction*100].join(','))].join('\r\n');
}
