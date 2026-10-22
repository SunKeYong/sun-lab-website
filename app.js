const siteBase = new URL('.', document.currentScript.src);
const $ = selector => document.querySelector(selector);
let papers=[],filter='all';function renderPapers(){const q=$('#search').value.toLowerCase();const list=papers.filter(p=>(filter==='all'||(filter==='earlier'?Number(p.year)<2022:p.year===filter))&&p.raw.toLowerCase().includes(q));$('#papers').replaceChildren();list.forEach(p=>{const a=document.createElement('a');a.className='paper';a.href=p.url;a.target='_blank';a.rel='noopener';const year=document.createElement('span');year.className='year';year.textContent=p.year;const div=document.createElement('div');const journal=document.createElement('small');journal.textContent=p.journal;const title=document.createElement('h3');title.textContent=p.title;const authors=document.createElement('p');authors.textContent=p.authors;div.append(journal,title,authors);const arrow=document.createElement('span');arrow.className='arrow';arrow.textContent='↗';a.append(year,div,arrow);$('#papers').append(a)});if(!list.length){const e=document.createElement('p');e.textContent='No matching publications.';$('#papers').append(e)}}if($('#papers')){fetch(new URL('publications.json', siteBase)).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>{papers=data.map((raw,i)=>{const m=raw.match(/\((20\d\d)[ab]?\)\.\s*(.*)/),s=m?m[2]:raw,split=s.match(/^(.*?)\.\s*((?:Nature|Communications|Cell|Science|Briefings|The Journal|Scientific).*)$/);const title=split?split[1]:s;return{raw,year:m?m[1]:'',title,journal:split?split[2]:'',authors:m?raw.slice(0,raw.indexOf(m[0])):'',url:i===0?'https://www.nature.com/articles/s41556-024-01435-6':i===2?'https://www.nature.com/articles/s41467-022-32627-z':'https://scholar.google.com/scholar?q='+encodeURIComponent(title)}});renderPapers()}).catch(()=>{$('#papers').textContent='Please view the publication list on Google Scholar.'});document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderPapers()});$('#search').oninput=renderPapers}

function textElement(tag, text, className = '') {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  return el;
}
if ($('#resource-list') || $('#research-list')) {
  fetch(new URL('site.json', siteBase)).then(r => {
    if (!r.ok) throw new Error('Content unavailable');
    return r.json();
  }).then(site => {
    if ($('#resource-list')) {
      let selection = 'all';
      function renderResources() {
        const box = $('#resource-list');
        box.replaceChildren();
        site.resources.filter(r => selection === 'all' || r.category === selection).forEach(r => {
          const card = document.createElement('article');
          card.className = 'resource-card';
          const art = document.createElement('div');
          art.className = 'resource-image ' + r.category;
          art.setAttribute('aria-hidden', 'true');
          const orb = document.createElement('div');
          orb.className = 'orb';
          art.append(orb);
          const body = document.createElement('div');
          body.className = 'resource-body';
          const status = textElement('span', r.status === 'published' ? 'AVAILABLE' : 'IN PREPARATION', 'status');
          const heading = textElement('h3', r.title);
          const species = textElement('p', r.species, 'species');
          const description = textElement('p', r.description);
          const link = textElement('a', r.externalUrl ? 'Open atlas ↗' : 'View project page ↗', 'text-link');
          link.href = r.externalUrl || new URL('resources-'+r.id+'.html', siteBase).href;
          link.target = '_blank';
          link.rel = 'noopener';
          link.setAttribute('aria-label', (r.externalUrl ? 'Open atlas' : 'View project page') + ' — ' + r.title + ' (opens in new tab)');
          body.append(status, heading, species, description, link);
          card.append(art, body);
          box.append(card);
        });
      }
      renderResources();
      document.querySelectorAll('[data-resource]').forEach(button => {
        button.onclick = () => {
          selection = button.dataset.resource;
          document.querySelectorAll('[data-resource]').forEach(b => b.classList.toggle('active', b === button));
          renderResources();
        };
      });
    }
    if ($('#research-list') && site.research.length) {
      const box = $('#research-list');
      box.replaceChildren();
      site.research.forEach(r => {
        const article = document.createElement('article');
        article.className = 'empty';
        article.append(textElement('h3', r.title), textElement('p', r.description || ''));
        box.append(article);
      });
    }
  }).catch(() => {
    if ($('#resource-list')) $('#resource-list').textContent = 'Resources could not be loaded. Please try again.';
  });
}

const canvas=$('#atlas');if(canvas){const ctx=canvas.getContext('2d');let seed=12;function rand(){seed=(seed*16807)%2147483647;return(seed-1)/2147483646}function draw(){seed=12;const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);const clusters=[[.24,.34,.12,.09,'#637da5'],[.42,.25,.1,.08,'#97aac8'],[.61,.33,.13,.09,'#bd9aa8'],[.68,.53,.11,.12,'#d88b71'],[.48,.59,.12,.08,'#7c80ad'],[.3,.65,.1,.1,'#819abb'],[.54,.78,.09,.06,'#c9a68b'],[.78,.74,.07,.05,'#acb1cc']];clusters.forEach(([x,y,sx,sy,color])=>{for(let i=0;i<620;i++){const a=rand()*Math.PI*2,r=Math.sqrt(-2*Math.log(Math.max(rand(),.001)))*.43,px=w*(x+Math.cos(a)*r*sx),py=h*(y+Math.sin(a)*r*sy);ctx.globalAlpha=.4+rand()*.5;ctx.fillStyle=color;ctx.beginPath();ctx.arc(px,py,.7+rand()*1.3,0,Math.PI*2);ctx.fill()}});ctx.globalAlpha=.55;ctx.strokeStyle='#7685a1';ctx.lineWidth=.7;[[.16,.29,.09,.19,'CELL IDENTITY'],[.74,.5,.83,.43,'SINGLE CELLS']].forEach(([x,y,x2,y2,t])=>{ctx.beginPath();ctx.moveTo(w*x,h*y);ctx.lineTo(w*x2,h*y2);ctx.stroke();ctx.fillStyle='#3b4d69';ctx.font='8px Arial';ctx.fillText(t,w*x2-18,h*y2+14)})}new ResizeObserver(draw).observe(canvas)}
