import {rankRows, formatValue, percentage, csvFor} from './genescore-core.js';
const $ = selector => document.querySelector(selector);
let meta, base, result, loadingMeta, requestId = 0, currentController;
const status = (message, error = false) => { $('#gs-status').textContent=message; $('#gs-status').classList.toggle('gs-error',error); };
async function json(url, signal) {
  const response = await fetch(url, {signal});
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Data connection unavailable. Please try again.');
  return data;
}
async function metadata() {
  if (meta) return meta;
  if (loadingMeta) return loadingMeta;
  loadingMeta = (async () => {
    const config = await json('human-dataset.json');
    base = new URL(config.dataBase || './', location.href);
    const value = await json(new URL('api/genescore/meta', base));
    $('#gs-dataset-count').textContent = `${value.cellTypeCount} subtypes · ${value.geneCount.toLocaleString('en')} genes`;
    $('#gs-methods-text').textContent = value.methods;
    $('#gs-coverage').textContent = `${value.cellTypeCount} subtypes · ${value.geneCount.toLocaleString('en')} genes`;
    for (const button of document.querySelectorAll('[data-score-gene]')) button.hidden = !value.genes.some(g=>g.toUpperCase()===button.dataset.scoreGene);
    meta = value; return value;
  })();
  try { return await loadingMeta; } finally { loadingMeta = null; }
}
function hideSuggestions() { $('#gs-suggestions').hidden=true; $('#gs-gene').setAttribute('aria-expanded','false'); }
function suggest() {
  const query = $('#gs-gene').value.trim().toUpperCase(), box = $('#gs-suggestions'); box.replaceChildren();
  if (!meta || !query) { hideSuggestions(); return; }
  const matches = meta.genes.filter(gene=>gene.toUpperCase().startsWith(query)).sort((a,b)=>Number(b.toUpperCase()===query)-Number(a.toUpperCase()===query)||a.localeCompare(b)).slice(0,8);
  for (const gene of matches) {
    const button=document.createElement('button'); button.type='button'; button.textContent=gene;
    button.onclick=()=>search(gene); box.append(button);
  }
  box.hidden=!matches.length; $('#gs-gene').setAttribute('aria-expanded',String(!!matches.length));
}
function visibleRows() { return rankRows(result.rows,$('#gs-sort').value,$('#gs-filter').value); }
function render() {
  if (!result) return;
  const rows = visibleRows(), tbody=$('#gs-rows'); tbody.replaceChildren();
  const maximum=Math.max(0,...result.rows.map(row=>row.mean));
  $('#gs-axis').textContent=`0 → ${formatValue(maximum)}`;
  $('#gs-result-count').textContent=`${rows.length} of ${result.rows.length} subtypes · ${$('#gs-sort').selectedOptions[0].textContent}`;
  const fragment=document.createDocumentFragment();
  rows.forEach((row,index)=>{
    const tr=document.createElement('tr');
    const rank=document.createElement('td'); rank.textContent=index+1; rank.className='gs-rank';
    const name=document.createElement('th'); name.scope='row'; name.textContent=row.id;
    const mean=document.createElement('td'); const meanWrap=document.createElement('div'); meanWrap.className='gs-bar-cell';
    const track=document.createElement('span'); track.className='gs-bar-track';
    const bar=document.createElement('i'); bar.className='gs-mean-bar'; bar.style.width=(maximum ? row.mean/maximum*100 : 0)+'%'; track.append(bar);
    const value=document.createElement('span'); value.className='gs-value'; value.textContent=formatValue(row.mean); value.title=String(row.mean);
    meanWrap.append(track,value); mean.append(meanWrap);
    const fraction=document.createElement('td'); const fracWrap=document.createElement('div'); fracWrap.className='gs-bar-cell gs-pct-cell';
    const pctTrack=document.createElement('span'); pctTrack.className='gs-pct-track'; const pctBar=document.createElement('i');pctBar.style.width=(row.fraction*100)+'%';pctTrack.append(pctBar);
    const pct=document.createElement('span');pct.className='gs-value';pct.textContent=percentage(row.fraction);pct.title=`Source fraction: ${row.fraction}`;
    fracWrap.append(pctTrack,pct);fraction.append(fracWrap);tr.append(rank,name,mean,fraction);fragment.append(tr);
  });
  tbody.append(fragment);$('#gs-no-rows').hidden=!!rows.length;
}
async function search(query) {
  const id=++requestId;
  currentController?.abort(); currentController=new AbortController(); const signal=currentController.signal;
  hideSuggestions(); $('#gs-results').hidden=true; $('#gs-submit').disabled=true;
  status('Loading GeneScores…');
  try {
    await metadata(); if (id!==requestId) return;
    const gene=query.trim(); if (!gene) throw Error('Enter a gene symbol, or choose an example.');
    const url=new URL('api/genescore',base);url.searchParams.set('gene',gene);
    const data=await json(url,signal);if(id!==requestId)return;
    result=data;$('#gs-gene').value=data.gene;$('#gs-result-gene').textContent=data.gene;
    $('#gs-filter').value='';
    const top=rankRows(data.rows)[0];$('#gs-top-id').textContent=top.id;$('#gs-top-value').textContent=`${formatValue(top.mean)} mean GeneScore · ${percentage(top.fraction)} cells with signal`;
    render();$('#gs-results').hidden=false;$('.gs-chart-scroll').scrollTop=0;
    status(`Showing ${data.gene} across all ${data.rows.length} subtypes. Values are supplied normalized ATAC GeneScores.`);
    const shared=new URL(location.href);shared.searchParams.set('scoreGene',data.gene);history.replaceState(null,'',shared);
  } catch (error) {
    if(id!==requestId||error.name==='AbortError')return;
    result=null;status(error.message || 'Unable to load GeneScores. Please try again.',true);
  } finally { if(id===requestId)$('#gs-submit').disabled=false; }
}
$('#gs-form').onsubmit=event=>{event.preventDefault();search($('#gs-gene').value);};
$('#gs-gene').oninput=suggest;
$('#gs-gene').onkeydown=event=>{if(event.key==='Escape')hideSuggestions();if(event.key==='ArrowDown'&&!$('#gs-suggestions').hidden){event.preventDefault();$('#gs-suggestions button')?.focus();}};
$('#gs-suggestions').onkeydown=event=>{
  const buttons=[...$('#gs-suggestions').children],index=buttons.indexOf(document.activeElement);
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
  if(event.key==='Escape'){hideSuggestions();$('#gs-gene').focus();}
};
document.addEventListener('click',event=>{if(!event.target.closest('.gs-input-wrap'))hideSuggestions();});
document.querySelectorAll('[data-score-gene]').forEach(button=>button.onclick=()=>search(button.dataset.scoreGene));
$('#gs-sort').onchange=render;$('#gs-filter').oninput=render;
function download(content,name,type) {
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
$('#gs-export-csv').onclick=()=>{if(result)download(csvFor(visibleRows(),result.gene),`${meta.species}-${result.gene}-genescore.csv`,'text/csv;charset=utf-8');};
$('#gs-export-svg').onclick=()=>{
  if(!result)return;
  const rows=visibleRows(),height=110+rows.length*25,svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('viewBox',`0 0 1000 ${height}`);svg.setAttribute('width','1000');svg.setAttribute('height',height);
  function el(tag,attributes,text){const node=document.createElementNS(svg.namespaceURI,tag);Object.entries(attributes).forEach(([k,v])=>node.setAttribute(k,v));if(text!==undefined)node.textContent=text;svg.append(node);}
  el('rect',{width:1000,height,fill:'white'});
  el('text',{x:30,y:30,'font-size':20,'font-family':'Arial',fill:'#23334f'},`${meta.species} · ${result.gene} · ATAC GeneScore`);
  el('text',{x:30,y:57,'font-size':12,'font-family':'Arial',fill:'#667085'},'Subtype                 Mean GeneScore (provided normalized values)                       Cells with signal (%)');
  const maximum=Math.max(0,...result.rows.map(row=>row.mean));
  rows.forEach((row,index)=>{const y=80+index*25;
    el('text',{x:30,y:y+12,'font-size':12,'font-family':'Arial',fill:'#23334f'},row.id);
    el('rect',{x:155,y,width:maximum?row.mean/maximum*500:0,height:15,fill:'#5c79ad'});
    el('text',{x:670,y:y+12,'font-size':12,'font-family':'Arial',fill:'#23334f'},formatValue(row.mean));
    el('rect',{x:785,y,width:row.fraction*125,height:15,fill:'#d77b5a'});
    el('text',{x:925,y:y+12,'font-size':12,'font-family':'Arial',fill:'#23334f'},percentage(row.fraction));
  });
  el('text',{x:30,y:height-12,'font-size':11,'font-family':'Arial',fill:'#667085'},'No additional log transformation or normalization. Percentage = supplied fraction × 100.');
  download(new XMLSerializer().serializeToString(svg),`${meta.species}-${result.gene}-genescore.svg`,'image/svg+xml');
};
$('#gs-share').onclick=async()=>{if(!result)return;const url=new URL(location.href);url.searchParams.set('scoreGene',result.gene);url.hash='genescore';try{await navigator.clipboard.writeText(url.href);status('GeneScore link copied.');}catch{status('Share this profile: '+url.href);}};
async function opened() {
  if(location.hash!=='#genescore'||result||loadingMeta)return;
  try { await metadata(); if(location.hash!=='#genescore')return;const requested=new URL(location.href).searchParams.get('scoreGene');search(requested||meta.genes.find(g=>g.toUpperCase()==='TNNT2')||meta.genes[0]); }
  catch(error){status(error.message,true);}
}
window.addEventListener('hashchange',opened);opened();
