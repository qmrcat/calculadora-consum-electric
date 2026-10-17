(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const W = globalThis.Watt;
  const labels = {punta:'Punta',pla:'Pla',vall:'Vall'};
  const nf = (n,d=4) => new Intl.NumberFormat('ca-ES',{minimumFractionDigits:d,maximumFractionDigits:d}).format(n);
  const dateLabel = day => new Intl.DateTimeFormat('ca-ES',{day:'numeric',month:'long',year:'numeric',timeZone:W.TZ}).format(new Date(`${day}T12:00:00Z`));
  const timeLabel = t => new Intl.DateTimeFormat('ca-ES',{timeZone:W.TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t));
  function slotLabel(row) {
    const start = timeLabel(row.start), end = timeLabel(row.end);
    // L'offset diferencia les dues hores repetides al canvi de tardor.
    const zone = new Intl.DateTimeFormat('ca-ES',{timeZone:W.TZ,timeZoneName:'shortOffset'}).formatToParts(new Date(row.start)).find(p=>p.type==='timeZoneName')?.value;
    return `${start}–${end === '00:00' ? '24:00' : end} h (${zone})`;
  }
  const storage = {
    get(key) {try{return JSON.parse(localStorage.getItem(key));}catch{return null;}},
    set(key,value) {try{localStorage.setItem(key,JSON.stringify(value));}catch{/* El mode privat pot impedir desar dades. */}}
  };
  const prefs = storage.get('watt-prefs-v1') ?? {};
  let mode = 'auto';
  let today = W.parts().day, refDay = W.referenceDay(today);
  let daily = null, comparison = null, busy = false, selected = null, lastAttempt = 0;
  let lastTickKey = '';
  function watts() {const i=$('watts');return i.value.trim()!=='' && i.validity.valid && Number.isFinite(i.valueAsNumber)?i.valueAsNumber:null;}
  function manualPrice(period) {const i=$(`manual-${period}`);return i.value.trim()!=='' && i.validity.valid && Number.isFinite(i.valueAsNumber)?i.valueAsNumber:null;}
  if (Number.isFinite(prefs.watts) && prefs.watts>=0 && prefs.watts<=1000000) $('watts').value=prefs.watts;
  for(const period of Object.keys(labels)) if(Number.isFinite(prefs.prices?.[period])) $(`manual-${period}`).value=prefs.prices[period];
  if(prefs.theme==='light') document.documentElement.classList.add('light');
  function savePrefs() {storage.set('watt-prefs-v1',{watts:watts(),prices:Object.fromEntries(Object.keys(labels).map(p=>[p,manualPrice(p)])),theme:document.documentElement.classList.contains('light')?'light':'dark'});}
  async function fetchJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),12000);
    try {const response=await fetch(url,{signal:controller.signal,credentials:'omit',headers:{Accept:'application/json'}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return await response.json();} finally {clearTimeout(timer);}
  }
  async function getDay(day) {
    const params = new URLSearchParams({start_date:`${day}T00:00`,end_date:`${day}T23:59`,time_trunc:'hour'});
    const sources = [
      {url:`https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?${params}`,parse:W.parseRedata,name:'REData'},
      {url:`https://api.esios.ree.es/archives/70/download_json?date=${day}`,parse:W.parseEsios,name:'ESIOS'}
    ];
    for(const source of sources) {
      try {
        const rows=source.parse(await fetchJSON(source.url),day);
        const value={rows,day,source:source.name,fetchedAt:Date.now(),cached:false};
        storage.set(`watt-day-${day}`,value);
        // Conserva només els dies recents d'aquesta aplicació.
        try {for(const k of Object.keys(localStorage)) if(k.startsWith('watt-day-') && k.slice(9)<W.shiftDay(today,-10)) localStorage.removeItem(k);}catch{}
        return value;
      } catch { /* Prova la següent font oficial. */ }
    }
    const cache = storage.get(`watt-day-${day}`);
    if(cache?.day===day && Number.isFinite(cache.fetchedAt)) {
      try{return {...cache,rows:W.validate(cache.rows,day),cached:true};}catch{}
    }
    throw new Error(`No s'han pogut consultar els preus del ${dateLabel(day)}.`);
  }
  async function load() {
    if(busy)return;
    busy=true;lastAttempt=Date.now();
    const newDay=W.parts().day;
    if(newDay!==today){today=newDay;refDay=W.referenceDay(today);daily=null;comparison=null;selected=null;}
    $('refresh').disabled=true;$('refresh').textContent='↻ Consultant…';
    $('status').textContent='Consultant els preus oficials…';
    const requests=refDay===today?[getDay(today)]:[getDay(today),getDay(refDay)];
    const results=await Promise.allSettled(requests);
    daily=results[0].status==='fulfilled'?results[0].value:null;
    comparison=refDay===today?daily:(results[1].status==='fulfilled'?results[1].value:null);
    busy=false;$('refresh').disabled=false;$('refresh').textContent='↻ Actualitza';
    render();
  }
  function renderStatus() {
    if(busy)return;
    const messages=[];
    if(mode==='manual') messages.push('Càlcul amb els preus del teu contracte.');
    if(!daily)messages.push('No s’ha pogut obtenir el PVPC d’avui. Comprova la connexió i prem «Actualitza» o introdueix els preus del contracte.');
    else if(daily.cached)messages.push(`Avís: API no disponible. Dades desades del ${dateLabel(today)}, consultades a les ${timeLabel(daily.fetchedAt)} h.`);
    else messages.push(`API oficial ${daily.source} · ${dateLabel(today)} · consultada a les ${timeLabel(daily.fetchedAt)} h.`);
    if(!comparison && refDay!==today)messages.push('La comparació de períodes no està disponible.');
    if(comparison?.cached && comparison!==daily)messages.push(`Comparació amb dades desades del ${dateLabel(refDay)}.`);
    $('status').textContent=messages.join(' ');
  }
  function render() {
    const now = new Date(), p=W.parts(now), power=watts();
    const activePeriod=W.period(p.day,p.hour);
    const row=daily?.day===p.day?W.current(daily.rows,now.getTime()):null;
    const price=mode==='manual'?manualPrice(activePeriod):row?.price;
    $('clock').textContent=new Intl.DateTimeFormat('ca-ES',{timeZone:W.TZ,weekday:'long',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
    $('input-error').textContent=power===null?'Introdueix una potència entre 0 i 1.000.000 W.':'';
    $('energy').textContent=power===null?'—':`${nf(power/1000,3)} kWh`;
    $('current-period').textContent=labels[activePeriod];
    $('current-cost').textContent=power!==null && Number.isFinite(price)?nf(W.cost(power,price)):'—';
    for(const hours of [8,24]) $('current-cost-'+hours).textContent=power!==null && Number.isFinite(price)?nf(W.cost(power,price,hours)):'—';
    $('current-price').textContent=Number.isFinite(price)?`${nf(price,5)} €/kWh · ${mode==='manual'?'contracte':'PVPC sense impostos'}`:mode==='manual'?'Introdueix el preu d’aquest període':'Preu actual no disponible';
    $('current-slot').textContent=mode==='auto' && row?slotLabel(row):`${String(p.hour).padStart(2,'0')}:00–${String(p.hour+1).padStart(2,'0')}:00 h`;
    $('result-caption').textContent=mode==='manual'?'Una hora al preu del teu període actual':'Una hora al preu de la franja actual';
    $('comparison-note').textContent=mode==='manual'?'Preus d’energia introduïts per tu, sense impostos. El consum en kWh és igual en els tres períodes.':!comparison?'Comparació no disponible fins a obtenir totes les hores del dia de referència.':refDay===today?`Mitjanes PVPC d’avui, ${dateLabel(refDay)}. El preu canvia cada hora; el consum en kWh és el mateix.`:`Avui és tot vall. Comparem les mitjanes dels tres períodes de l’últim dia laborable: ${dateLabel(refDay)}.`;
    const averages=comparison?W.means(comparison.rows):{};
    for(const period of Object.keys(labels)) {
      const value=mode==='manual'?manualPrice(period):averages[period];
      const available=Number.isFinite(value);
      $(`cost-${period}`).textContent=available && power!==null?nf(W.cost(power,value)):'—';
      for(const hours of [8,24]) $(`cost-${period}-${hours}`).textContent=available && power!==null?nf(W.cost(power,value,hours)):'—';
      $(`price-${period}`).textContent=available?`${nf(value,5)} €/kWh${mode==='auto'?' · mitjana':''}`:mode==='manual'?'Introdueix un preu vàlid':'Sense dades';
      const count=comparison?.rows.filter(r=>r.period===period).length??0;
      $(`detail-${period}`).textContent=mode==='manual'?'Preu del contracte · sense impostos':comparison?`${count} hores · ${dateLabel(refDay)}`:'Sense dades del dia de referència';
    }
    document.querySelectorAll('[data-watts]').forEach(b=>b.classList.toggle('selected',power!==null && Number(b.dataset.watts)===power));
    renderStatus();renderChart(power,now.getTime());
  }
  function renderChart(power,now) {
    const container=$('chart');container.replaceChildren();$('hours-table').replaceChildren();
    $('chart-date').textContent=`${dateLabel(today)} · Europe/Madrid`;
    if(!daily){const p=document.createElement('p');p.className='muted chart-empty';p.textContent='Sense preus horaris d’avui.';container.append(p);$('chart-selection').textContent='Prem «Actualitza» per tornar-ho a provar.';$('best-hour').textContent='—';return;}
    const rows=daily.rows.map(row=>({...row,price:mode==='manual'?manualPrice(row.period):row.price}));
    const valid=rows.filter(row=>Number.isFinite(row.price));
    const max=Math.max(.00001,...valid.map(r=>Math.abs(r.price)));
    for(const row of rows) {
      const available=Number.isFinite(row.price), result=available && power!==null?nf(W.cost(power,row.price)):'—';
      const text=`${slotLabel(row)} · ${labels[row.period]} · ${available?`${nf(row.price,5)} €/kWh`:'sense preu'} · ${result} € per 1 h`;
      const button=document.createElement('button');button.type='button';button.className=`bar-item ${row.period}`;
      button.classList.toggle('current',now>=row.start && now<row.end);button.classList.toggle('chosen',selected===row.start);
      button.title=text;button.setAttribute('aria-label',text);button.setAttribute('aria-pressed',String(selected===row.start));
      const track=document.createElement('span');track.className='bar-track';
      const fill=document.createElement('span');fill.className='bar-fill';fill.style.setProperty('--height',`${available?Math.max(2,Math.abs(row.price)/max*100):2}%`);if(!available)fill.style.opacity='.15';
      const hour=document.createElement('span');hour.className='bar-hour';hour.textContent=String(row.hour).padStart(2,'0');track.append(fill);button.append(track,hour);
      button.addEventListener('click',()=>{selected=row.start;document.querySelectorAll('.bar-item').forEach(b=>{b.classList.remove('chosen');b.setAttribute('aria-pressed','false');});button.classList.add('chosen');button.setAttribute('aria-pressed','true');$('chart-selection').textContent=text;});
      container.append(button);
      const tr=document.createElement('tr');for(const value of [slotLabel(row),labels[row.period],available?nf(row.price,5):'—',result]){const td=document.createElement('td');td.textContent=value;tr.append(td);} $('hours-table').append(tr);
    }
    const current=rows.find(r=>r.start===selected)??W.current(rows,now);
    $('chart-selection').textContent=current?`${slotLabel(current)} · ${labels[current.period]} · ${Number.isFinite(current.price)&&power!==null?`${nf(W.cost(power,current.price))} € per 1 h`:'sense preu o potència vàlida'}`:'Selecciona una hora.';
    const future=valid.filter(r=>r.end>now);
    const best=future.length?future.reduce((a,b)=>a.price<=b.price?a:b):null;
    $('best-hour').textContent=best?`Franja més barata de les que queden: ${slotLabel(best)}`:'No hi ha més preus disponibles avui.';
    $('chart-help').textContent=mode==='manual'?'Cost horari segons els preus del teu contracte. Toca una barra per veure el detall.':'PVPC d’avui. Toca una barra per veure el cost d’una hora d’ús a aquell preu. L’alçada representa el valor absolut; el signe es mostra al detall.';
  }
  function setMode(next) {
    mode=next;$('auto-mode').classList.toggle('active',next==='auto');$('manual-mode').classList.toggle('active',next==='manual');
    $('auto-mode').setAttribute('aria-pressed',String(next==='auto'));$('manual-mode').setAttribute('aria-pressed',String(next==='manual'));
    $('manual-help').hidden=next!=='manual';document.querySelectorAll('.manual-field').forEach(el=>el.hidden=next!=='manual');render();
  }
  $('watts').addEventListener('input',()=>{savePrefs();render();});
  document.querySelectorAll('[data-watts]').forEach(b=>b.addEventListener('click',()=>{$('watts').value=b.dataset.watts;savePrefs();render();}));
  for(const p of Object.keys(labels))$(`manual-${p}`).addEventListener('input',()=>{savePrefs();render();});
  $('theme').addEventListener('click',()=>{document.documentElement.classList.toggle('light');savePrefs();});
  $('auto-mode').addEventListener('click',()=>setMode('auto'));$('manual-mode').addEventListener('click',()=>setMode('manual'));
  $('refresh').addEventListener('click',load);
  function tick() {
    const p=W.parts(),key=`${p.day}-${p.hour}`;
    if(key!==lastTickKey){lastTickKey=key;render();}
    else $('clock').textContent=new Intl.DateTimeFormat('ca-ES',{timeZone:W.TZ,weekday:'long',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
    if(p.day!==today || Date.now()-lastAttempt>15*60000)load();
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
  window.addEventListener('online',load);
  render();load();setInterval(tick,30000);
})();
