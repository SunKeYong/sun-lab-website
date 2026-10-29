import igv from './human-igv.js';
import { inspectLocalBed } from './local-bed.js?v=20261029-bigbed';
const $ = selector => document.querySelector(selector);
const DEFAULT_SIGNAL_TRACK_HEIGHT = 50;
let browser, manifest, genes = [], tracks = [], geneLookup = new Map();
const active = new Map();
let changingTracks = false, navigating = false, localTrackSequence = 0;
const isInterval = track => track.type === 'annotation';

function notice(message = '') {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}
function setStatus(message, state = 'ready') {
  $('#load-status').textContent = message;
  $('#load-status').className = 'status ' + state;
}
function readyStatus() {
  const signals = tracks.filter(t => !isInterval(t) && active.has(t.id));
  const intervals = tracks.filter(t => isInterval(t) && active.has(t.id));
  const signalText = `${signals.length} signal track${signals.length === 1 ? '' : 's'}`;
  const bedText = intervals.length ? ` + ${intervals.length} interval track${intervals.length === 1 ? '' : 's'}` : '';
  setStatus(signalText + bedText + ' active');
  const atlasCount = signals.filter(t => !t.local).length;
  const localCount = signals.length - atlasCount;
  const summary = [];
  if (atlasCount) summary.push(`${atlasCount} cell type${atlasCount === 1 ? '' : 's'} · cluster CPM signals`);
  if (localCount) summary.push(`${localCount} local bigWig track${localCount === 1 ? '' : 's'}`);
  if (intervals.length) summary.push(`${intervals.length} local interval track${intervals.length === 1 ? '' : 's'}`);
  $('#active-summary').textContent = summary.join(' · ') || 'No data tracks selected';
}
function syncRegion() {
  if (!browser) return;
  const loci = browser.currentLoci();
  const normalize = value => String(value).replace(/([^:\s]+):([\d,.]+)-([\d,.]+)/g, (_, chr, start, end) => `${chr}:${Math.max(1, Math.floor(Number(start.replaceAll(',', ''))))}-${Math.ceil(Number(end.replaceAll(',', '')))}`);
  $('#current-region').textContent = (Array.isArray(loci) ? loci : [loci]).map(normalize).join(' ');
}
function activatePanel(name) {
  if (!['overview', 'tracks', 'genescore', 'data'].includes(name)) name = 'overview';
  document.querySelectorAll('.panel').forEach(el => el.hidden = el.id !== name + '-panel');
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === name));
  if (name === 'tracks' && browser) browser.visibilityChange();
}
document.querySelectorAll('[data-tab]').forEach(a => a.onclick = () => activatePanel(a.dataset.tab));
document.querySelector('[data-open-tracks]').onclick = () => { location.hash = 'tracks'; activatePanel('tracks'); };
window.addEventListener('hashchange', () => activatePanel(location.hash.slice(1)));
activatePanel(location.hash.slice(1) || 'overview');

function renderTracks() {
  const box = $('#track-list');
  box.replaceChildren();
  const query = $('#cell-search').value.toLowerCase();
  const shown = tracks.filter(t => !isInterval(t) && `${t.id} ${t.name} ${t.group}`.toLowerCase().includes(query));
  for (const group of new Set(shown.map(t => t.group || 'Other'))) {
    const heading = document.createElement('p');
    heading.className = 'track-group'; heading.textContent = group; box.append(heading);
    for (const t of shown.filter(t => (t.group || 'Other') === group)) {
      const label = document.createElement('label');
      label.className = 'track-item' + (active.has(t.id) ? '' : ' off');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.checked = active.has(t.id);
      input.disabled = !browser || changingTracks;
      input.setAttribute('aria-label', t.name + ' signal track');
      input.onchange = () => changeTracks(async () => {
        if (input.checked) await addTrack(t); else removeTrack(t);
      });
      const info = document.createElement('span'); info.className = 'track-info';
      const name = document.createElement('strong');
      const color = document.createElement('i'); color.className = 'track-color'; color.style.background = t.color;
      name.append(color, document.createTextNode(t.name));
      const detail = document.createElement('small');
      detail.textContent = `${t.id} · ${t.local ? 'Session file' : 'bigWig · '+manifest.assembly}`;
      info.append(name, detail); label.append(input, info); box.append(label);
    }
  }
  if (!shown.length) { const p = document.createElement('p'); p.textContent = 'No matching cell types.'; box.append(p); }
  const atlasCount = tracks.filter(t => !t.local).length;
  $('#catalog-count').textContent = atlasCount;
  $('#connected-count').textContent = atlasCount;
  for (const id of ['select-all', 'clear-all', 'scale-mode', 'apply-scale', 'local-files', 'local-bed-files', 'add-local-bigwig', 'add-local-bed']) $('#' + id).disabled = !browser || changingTracks;
  renderIntervalTracks();
}
function renderIntervalTracks() {
  const box = $('#local-bed-list'); box.replaceChildren();
  const intervals = tracks.filter(isInterval);
  $('#local-bed-section').hidden = !intervals.length;
  for (const t of intervals) {
    const row = document.createElement('div'); row.className = 'local-bed-item';
    const label = document.createElement('label'); label.className = 'track-item' + (active.has(t.id) ? '' : ' off');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = active.has(t.id); checkbox.disabled = changingTracks;
    checkbox.setAttribute('aria-label', t.name + ' interval track');
    checkbox.onchange = () => changeTracks(async () => { if (checkbox.checked) await addTrack(t); else removeTrack(t); });
    const info = document.createElement('span'); info.className = 'track-info';
    const name = document.createElement('strong'); const color = document.createElement('i'); color.className = 'track-color'; color.style.background = t.color;
    name.append(color, document.createTextNode(t.name));
    const detail = document.createElement('small'); detail.textContent = `${t.format === 'bigbed' ? 'bigBed' : t.format === 'bed' ? 'BED' : t.format} · ${t.intervalCount.toLocaleString()} intervals · ${manifest.assembly}`;
    info.append(name, detail); label.append(checkbox, info);
    const actions = document.createElement('div'); actions.className = 'local-bed-actions';
    const go = document.createElement('button'); go.type = 'button'; go.textContent = 'Go to first interval'; go.disabled = changingTracks;
    go.onclick = () => navigate(t.firstLocus);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.disabled = changingTracks;
    remove.setAttribute('aria-label', 'Remove ' + t.name + ' interval track');
    remove.onclick = () => changeTracks(async () => { removeTrack(t); tracks = tracks.filter(track => track.id !== t.id); });
    actions.append(go, remove); row.append(label, actions); box.append(row);
  }
}
function trackConfig(t) {
  const { filename, group, normalization, defaultVisible, local, bytes, intervalCount, firstLocus, ...config } = t;
  config.name = isInterval(t) ? t.name : `${t.id} · ${t.name}`;
  config.removable = false;
  if (isInterval(t)) {
    if (t.format === 'bigbed') config.color = feature => feature.color || t.color;
    return config;
  }
  config.min = 0;
  config.height = DEFAULT_SIGNAL_TRACK_HEIGHT;
  const mode = $('#scale-mode').value;
  config.autoscale = mode !== 'fixed';
  if (mode === 'shared') config.autoscaleGroup = manifest.resourceId+'-visible-signals';
  if (mode === 'fixed') config.max = Number($('#scale-max').value);
  return config;
}
async function addTrack(t) {
  if (active.has(t.id)) return;
  const [loaded] = await browser.loadTrackList([trackConfig(t)]);
  if (!loaded) throw new Error('The track could not be created: ' + t.name);
  active.set(t.id, loaded);
}
function removeTrack(t) {
  if (!active.has(t.id)) return;
  browser.removeTrack(active.get(t.id)); active.delete(t.id);
}
async function changeTracks(action) {
  if (!browser || changingTracks) return;
  changingTracks = true; renderTracks(); setStatus('Updating tracks…', 'loading');
  try { const message = await action(); await browser.updateViews(); notice(typeof message === 'string' ? message : ''); readyStatus(); }
  catch (error) { console.error(error); notice('Unable to update tracks. ' + error.message); setStatus('Track loading failed', 'error'); }
  finally { changingTracks = false; renderTracks(); }
}
$('#cell-search').oninput = renderTracks;
$('#select-all').onclick = () => changeTracks(async () => { const q=$('#cell-search').value.toLowerCase(); for (const t of tracks.filter(t=>!isInterval(t) && `${t.id} ${t.name} ${t.group}`.toLowerCase().includes(q))) await addTrack(t); });
$('#clear-all').onclick = () => changeTracks(async () => { for (const t of tracks.filter(t => !isInterval(t))) removeTrack(t); });

function locusForGene(g) {
  return `${g.chr}:${Math.max(1, g.start - 10000)}-${Math.min(manifest.chromosomes[g.chr], g.end + 10000)}`;
}
function resolveQuery(query) {
  const input = query.trim();
  const matches = geneLookup.get(input.toUpperCase());
  if (matches?.length === 1) return locusForGene(matches[0]);
  if (matches?.length > 1) { showSuggestions(input, matches); throw Error('This gene maps to multiple annotation entries. Choose a specific locus from the suggestions.'); }
  const m = input.replaceAll(',', '').match(/^([^:\s]+):(\d+)-(\d+)$/);
  if (m) {
    const chr = Object.keys(manifest.chromosomes).find(c => c.toLowerCase() === m[1].toLowerCase());
    const start = Number(m[2]), end = Number(m[3]);
    if (!chr) throw Error('This sequence is not present in the '+manifest.assembly+' reference.');
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end <= start || end > manifest.chromosomes[chr]) throw Error('Coordinates must be within this reference sequence, with start smaller than end.');
    return `${chr}:${start}-${end}`;
  }
  throw Error('Gene not found. Use a gene from the '+manifest.assembly+' annotation, or valid genomic coordinates.');
}
async function navigate(query, selectedGene) {
  if (!browser || navigating || changingTracks) return;
  try {
    const locus = selectedGene ? locusForGene(selectedGene) : resolveQuery(query);
    navigating = true; $('#go').disabled = true; setStatus('Loading region…', 'loading');
    await browser.search(locus);
    $('#locus-input').value = selectedGene ? selectedGene.name : query;
    hideSuggestions(); notice(); syncRegion(); readyStatus();
  } catch (error) { notice(error.message || 'This region could not be loaded.'); setStatus('Check search', 'error'); }
  finally { navigating = false; $('#go').disabled = !browser; }
}
function hideSuggestions() { $('#gene-suggestions').hidden = true; $('#locus-input').setAttribute('aria-expanded', 'false'); }
function showSuggestions(query, exactMatches) {
  const q = query.trim().toUpperCase(), box = $('#gene-suggestions'); box.replaceChildren();
  if (!q || q.length < 2 || q.includes(':')) { hideSuggestions(); return; }
  const matches = exactMatches || genes.filter(g => g.name.toUpperCase().startsWith(q) || g.id.toUpperCase().startsWith(q)).sort((a,b) => Number(b.name.toUpperCase() === q || b.id.toUpperCase() === q) - Number(a.name.toUpperCase() === q || a.id.toUpperCase() === q)).slice(0,8);
  for (const g of matches.slice(0,8)) {
    const button = document.createElement('button'); button.type = 'button';
    const name = document.createElement('strong'); name.textContent = g.name;
    const detail = document.createElement('small'); detail.textContent = `${g.id} · ${g.chr}:${g.start.toLocaleString()}–${g.end.toLocaleString()}`;
    button.append(name, detail); button.onclick = () => navigate(g.name, g); box.append(button);
  }
  box.hidden = !matches.length; $('#locus-input').setAttribute('aria-expanded', String(!!matches.length));
}
$('#locus-form').onsubmit = e => { e.preventDefault(); navigate($('#locus-input').value); };
document.querySelectorAll('[data-gene]').forEach(b => b.onclick = () => navigate(b.dataset.gene));
$('#locus-input').oninput = () => showSuggestions($('#locus-input').value);
$('#locus-input').onkeydown = e => { if (e.key === 'Escape') hideSuggestions(); if (e.key === 'ArrowDown' && !$('#gene-suggestions').hidden) { e.preventDefault(); $('#gene-suggestions button')?.focus(); } };
document.addEventListener('click', e => { if (!e.target.closest('.locus-form')) hideSuggestions(); });
function scaleDescription() {
  const mode = $('#scale-mode').value;
  $('#scale-max').hidden = mode !== 'fixed'; $('#apply-scale').hidden = mode !== 'fixed';
  $('#scale-description').textContent = mode === 'shared' ? 'Shared auto: visible signal tracks use the same y-axis range.' : mode === 'independent' ? 'Independent auto: each signal track has its own y-axis range. Compare axis labels before interpreting heights.' : 'Fixed maximum: all visible signal tracks use the same range, from zero to your chosen maximum.';
}
async function applyScale() {
  const max = Number($('#scale-max').value);
  if ($('#scale-mode').value === 'fixed' && (!Number.isFinite(max) || max <= 0)) { notice('The fixed maximum must be greater than zero.'); return; }
  await changeTracks(async () => {
    const mode = $('#scale-mode').value;
    for (const t of tracks.filter(t => !isInterval(t) && active.has(t.id))) {
      const loaded = active.get(t.id);
      loaded.autoscaleGroup = mode === 'shared' ? manifest.resourceId+'-visible-signals' : undefined;
      loaded.autoscale = mode !== 'fixed';
      if (mode === 'fixed') loaded.dataRange = {min:0, max};
    }
  });
}
$('#scale-mode').onchange = () => { scaleDescription(); applyScale(); };
$('#apply-scale').onclick = applyScale;
function download(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  $('#svg-download')?.remove();
  const a = document.createElement('a'); a.id = 'svg-download'; a.href = url; a.download = filename; a.textContent = 'Download SVG ↓'; a.className = 'svg-download';
  $('.browser-tools > div').append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300000);
}
$('#export-svg').onclick = () => {
  if (!browser) return;
  try { const svg = browser.toSVG(); if (typeof svg !== 'string' || !svg.includes('<svg')) throw Error('Invalid SVG output'); download(svg, manifest.resourceId+'-'+manifest.assembly+'-tracks.svg', 'image/svg+xml'); }
  catch (error) { notice('The view could not be exported: ' + error.message); }
};
$('#share-locus').onclick = async () => {
  if (!browser) return;
  syncRegion(); const url = new URL(location.href);
  url.searchParams.set('locus', $('#current-region').textContent);
  url.searchParams.set('tracks', tracks.filter(t => active.has(t.id) && !t.local).map(t => t.id).join(','));
  url.searchParams.set('scale', $('#scale-mode').value);
  if ($('#scale-mode').value === 'fixed') url.searchParams.set('max', $('#scale-max').value); else url.searchParams.delete('max');
  url.hash = 'tracks';
  try { await navigator.clipboard.writeText(url.href); $('#share-locus').textContent = 'Copied ✓'; setTimeout(() => $('#share-locus').textContent = 'Copy link ↗', 2000); }
  catch { notice('Current view: ' + url.href); }
};
$('#add-local-bigwig').onclick = () => $('#local-files').click();
$('#add-local-bed').onclick = () => $('#local-bed-files').click();
async function importLocalFiles(event, kind) {
  const files = [...event.target.files];
  if (!files.length) return;
  await changeTracks(async () => {
    let added = 0;
    const failures = [];
    for (const file of files) {
      try {
        setStatus(`Reading ${file.name}…`, 'loading');
        let t;
        const id = 'LOCAL-' + (++localTrackSequence);
        if (kind === 'bed') {
          const details = await inspectLocalBed(file, manifest.chromosomes, manifest.assembly);
          t = {id, ...details, url:file, group:'Local intervals', local:true, type:'annotation', ...(details.format === 'bigbed' ? {} : {indexed:false}),
            color:['#b5673d','#6f60a8','#397b73','#a34d78'][(localTrackSequence - 1) % 4],
            height:60, minHeight:30, maxHeight:200, autoHeight:false, displayMode:'EXPANDED', expandedRowHeight:18, maxRows:100, order:tracks.length + 1};
        } else {
          if (!/\.(bw|bigwig)$/i.test(file.name)) throw Error('Choose a .bw or .bigWig file aligned to '+manifest.assembly+'.');
          t = {id, name:file.name.replace(/\.(bw|bigwig)$/i,''), url:file, group:'Added this session', local:true, type:'wig', format:'bigwig', color:'#8d80b1', height:DEFAULT_SIGNAL_TRACK_HEIGHT, order:tracks.length + 1};
        }
        await addTrack(t); tracks.push(t); added++;
      } catch (error) { failures.push(error.message.startsWith(file.name) ? error.message : `${file.name}: ${error.message}`); }
    }
    const message = `${added} local ${kind === 'bed' ? 'interval' : 'bigWig'} track${added === 1 ? '' : 's'} added.`;
    if (!added && failures.length) throw Error(failures.join(' '));
    return message + (failures.length ? ' Could not add: ' + failures.join(' ') : '');
  });
  event.target.value = '';
}
$('#local-files').onchange = event => importLocalFiles(event, 'bigwig');
$('#local-bed-files').onchange = event => importLocalFiles(event, 'bed');
async function getJSON(url) { const r = await fetch(url, {cache:'no-cache'}); if (!r.ok) throw Error('Data connection unavailable (' + r.status + ').'); return r.json(); }
// Keep transcript identifiers in feature details; simplify only the drawn labels.
function simplifyReferenceGeneLabels() {
  const annotation = browser.trackViews.find(view => view.track.id === 'atlas-reference-genes')?.track;
  if (!annotation || typeof annotation.render !== 'function') throw Error('The reference gene annotation could not be configured.');
  const nativeRender = annotation.render;
  annotation.config.labelField = 'atlasGeneSymbol';
  annotation.render = function(feature, ...args) {
    if (!Object.hasOwn(feature, 'atlasGeneSymbol')) {
      Object.defineProperty(feature, 'atlasGeneSymbol', {
        value:String(feature.name || '').split('|', 1)[0], enumerable:false, configurable:true
      });
    }
    return nativeRender.call(this, feature, ...args);
  };
  annotation.repaintViews();
}
async function init() {
  $('#go').disabled = true;
  try {
    manifest = await getJSON('tree-shrew-dataset.json');
    const index = await getJSON(manifest.geneIndex);
    genes = (Array.isArray(index)?index:Object.values(index)).map(g=>({...g,id:g.id||g.name}));
    for (const g of genes) for (const key of new Set([g.name.toUpperCase(), g.id.toUpperCase()])) {
      if (!geneLookup.has(key)) geneLookup.set(key, []); geneLookup.get(key).push(g);
    }
    $('#gene-count').textContent = `${genes.length.toLocaleString()} annotated gene entries · ${manifest.assembly}`;
    tracks = manifest.tracks; renderTracks();
    const status = await getJSON(new URL('api/status', new URL(manifest.dataBase, location.href)));
    if (!status.ready) throw Error('Some atlas data are unavailable. Please try again later or contact the maintainer.');
    const params = new URL(location.href).searchParams;
    let locus = manifest.initialLocus;
    if (params.has('locus')) { try { locus = resolveQuery(params.get('locus')); } catch { notice('The shared region was invalid; showing the default cardiac locus.'); } }
    if (['shared','independent','fixed'].includes(params.get('scale'))) $('#scale-mode').value = params.get('scale');
    const max = Number(params.get('max'));
    if (Number.isFinite(max) && max > 0) $('#scale-max').value = max;
    scaleDescription();
    $('#browser-loading').remove();
    browser = await igv.createBrowser($('#igv-container'), {
      reference:manifest.reference, loadDefaultGenomes:false, genomeList:[], locus,
      showNavigation:true, showIdeogram:false, showSVGButton:false, showRuler:true, showAllChromosomes:false, showCenterGuide:true,
      search:{url:new URL('api/search', new URL(manifest.dataBase, location.href)).href + '?name=$FEATURE$', chromosomeField:'chr', startField:'start', endField:'end', coords:1},
      tracks:[{...manifest.annotation, id:'atlas-reference-genes'}]
    });
    simplifyReferenceGeneLabels();
    browser.on('locuschange', syncRegion); syncRegion(); $('#locus-input').value = params.get('locus') || manifest.initialLocus;
    const selected = params.has('tracks') ? params.get('tracks').split(',') : tracks.filter(t => t.defaultVisible).map(t => t.id);
    await changeTracks(async () => { for (const t of tracks.filter(t => selected.includes(t.id))) await addTrack(t); });
    $('#go').disabled = false; renderTracks(); activatePanel(location.hash.slice(1) || 'overview');
  } catch (error) {
    console.error(error); setStatus('Connection unavailable', 'error'); notice(error.message || String(error));
    const loading = $('#browser-loading');
    if (loading) { loading.replaceChildren(); const h = document.createElement('h3'); h.textContent = 'Data connection unavailable'; const p = document.createElement('p'); p.textContent = 'Please try again later or contact the resource maintainer.'; loading.append(h,p); }
  }
}
init();
