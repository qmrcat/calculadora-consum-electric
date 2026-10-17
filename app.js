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
  let futureDays = W.nextDays(today).map(day=>({day,state:'loading'})), futureHours = 1;
  function watts() {const i=$('watts');return i.value.trim()!=='' && i.validity.valid && Number.isFinite(i.valueAsNumber)?i.valueAsNumber:null;}
  function manualPrice(period) {const i=$(`manual-${period}`);return i.value.trim()!=='' && i.validity.valid && Number.isFinite(i.valueAsNumber)?i.valueAsNumber:null;}
  if (Number.isFinite(prefs.watts) && prefs.watts>=0 && prefs.watts<=1000000) $('watts').value=prefs.watts;
  for(const period of Object.keys(labels)) if(Number.isFinite(prefs.prices?.[period])) $(`manual-${period}`).value=prefs.prices[period];
  for(const [field,key] of [['bill-total','total'],['bill-taxes','taxes'],['bill-fixed','fixedDaily']]) if(Number.isFinite(prefs.bill?.[key])) $(field).value=prefs.bill[key];
  if(prefs.theme==='light') document.documentElement.classList.add('light');
  function savePrefs() {storage.set('watt-prefs-v1',{watts:watts(),prices:Object.fromEntries(Object.keys(labels).map(p=>[p,manualPrice(p)])),theme:document.documentElement.classList.contains('light')?'light':'dark',bill:{total:billValue('bill-total'),taxes:billValue('bill-taxes'),fixedDaily:billValue('bill-fixed')}});}
  function billValue(id) { const input=$(id);return input.value.trim()!=='' && input.validity.valid && Number.isFinite(input.valueAsNumber)?input.valueAsNumber:null; }
  function billModel() { return W.billModel(billValue('bill-total'),billValue('bill-taxes'),billValue('bill-fixed')); }
  function finalText(power,price,hours=1) {
    const amount=W.finalCost(power,price,hours,billModel());return Number.isFinite(amount)?nf(amount):'—';
  }
  function renderBillSettings() {
    const model=billModel();
    $('bill-error').textContent=model?'':'Introdueix un total superior a 0 €, uns impostos iguals o superiors a 0 € i inferiors al total, i un cost fix diari vàlid.';
    $('bill-rate').textContent=model?`Impostos efectius: ${nf(model.taxRate*100,2)} %`:'Referència no vàlida';
    $('bill-formula').textContent=model?`Final estimat = cost sense impostos × ${nf(model.factor,6)}${model.fixedDaily>0?` + ${nf(model.fixedDaily,4)} €/dia × hores ÷ 24`:''}.`:'Els costos sense impostos continuen disponibles; els finals queden sense calcular.';
  }
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
  async function getFuture(baseDay) {
    const days=W.nextDays(baseDay);
    const params=new URLSearchParams({start_date:`${baseDay}T00:00`,end_date:`${days.at(-1)}T23:59`,time_trunc:'hour'});
    let entries;
    try {
      const json=await fetchJSON(`https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real?${params}`);
      entries=W.futureRedata(json,days).map(entry=>({...entry,source:'REData',fetchedAt:Date.now(),cached:false}));
    } catch { entries=days.map(day=>({day,state:'error'})); }
    // Segona font oficial per a demà; els dies següents es consulten conjuntament a REData.
    if(entries[0].state!=='published') {
      try {
        const json=await fetchJSON(`https://api.esios.ree.es/archives/70/download_json?date=${days[0]}`);
        if(!Array.isArray(json.PVPC)) throw new Error('Resposta ESIOS no reconeguda.');
        const hasDay=json.PVPC.some(v=>v.Dia===days[0].split('-').reverse().join('/'));
        if(hasDay) {
          try { entries[0]={day:days[0],state:'published',rows:W.parseEsios(json,days[0]),source:'ESIOS',fetchedAt:Date.now(),cached:false}; }
          catch { entries[0]={day:days[0],state:'invalid'}; }
        } else if(entries[0].state!=='invalid') entries[0]={day:days[0],state:'pending'};
      } catch { /* Conserva l'estat obtingut de REData. */ }
    }
    return entries.map(entry=>{
      if(entry.state==='published') {
        storage.set(`watt-day-${entry.day}`,entry);
        return entry;
      }
      const cache=storage.get(`watt-day-${entry.day}`);
      if(cache?.day===entry.day && Number.isFinite(cache.fetchedAt)) {
        try { return {...cache,state:'published',rows:W.validate(cache.rows,entry.day),cached:true}; } catch {}
      }
      return entry;
    });
  }
  async function load() {
    if(busy)return;
    busy=true;lastAttempt=Date.now();
    const newDay=W.parts().day;
    if(newDay!==today){today=newDay;refDay=W.referenceDay(today);daily=null;comparison=null;selected=null;futureDays=W.nextDays(today).map(day=>({day,state:'loading'}));}
    $('refresh').disabled=true;$('refresh').textContent='↻ Consultant…';
    $('status').textContent='Consultant els preus oficials…';
    const requests=refDay===today?[getDay(today)]:[getDay(today),getDay(refDay)];
    const futureIndex=requests.length;
    requests.push(getFuture(today));
    const results=await Promise.allSettled(requests);
    futureDays=results[futureIndex].status==='fulfilled'?results[futureIndex].value:W.nextDays(today).map(day=>({day,state:'error'}));
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
    renderBillSettings();
    for(const hours of [1,8,24]) $('current-final-'+hours).textContent=finalText(power,price,hours);
    $('current-cost').textContent=power!==null && Number.isFinite(price)?nf(W.cost(power,price)):'—';
    for(const hours of [8,24]) $('current-cost-'+hours).textContent=power!==null && Number.isFinite(price)?nf(W.cost(power,price,hours)):'—';
    $('current-price').textContent=Number.isFinite(price)?`${nf(price,5)} €/kWh · ${mode==='manual'?'contracte':'PVPC sense impostos'}`:mode==='manual'?'Introdueix el preu d’aquest període':'Preu actual no disponible';
    $('current-slot').textContent=mode==='auto' && row?slotLabel(row):`${String(p.hour).padStart(2,'0')}:00–${String(p.hour+1).padStart(2,'0')}:00 h`;
    $('result-caption').textContent=mode==='manual'?'Al preu del teu període actual':'Al preu de la franja actual';
    $('comparison-note').textContent=mode==='manual'?'Preus d’energia introduïts per tu, sense impostos. El consum en kWh és igual en els tres períodes.':!comparison?'Comparació no disponible fins a obtenir totes les hores del dia de referència.':refDay===today?`Mitjanes PVPC d’avui, ${dateLabel(refDay)}. El preu canvia cada hora; el consum en kWh és el mateix.`:`Avui és tot vall. Comparem les mitjanes dels tres períodes de l’últim dia laborable: ${dateLabel(refDay)}.`;
    const averages=comparison?W.means(comparison.rows):{};
    for(const period of Object.keys(labels)) {
      const value=mode==='manual'?manualPrice(period):averages[period];
      const available=Number.isFinite(value);
      for(const hours of [1,8,24]) $(`final-${period}-${hours}`).textContent=finalText(power,value,hours);
      $(`cost-${period}`).textContent=available && power!==null?nf(W.cost(power,value)):'—';
      for(const hours of [8,24]) $(`cost-${period}-${hours}`).textContent=available && power!==null?nf(W.cost(power,value,hours)):'—';
      $(`price-${period}`).textContent=available?`${nf(value,5)} €/kWh${mode==='auto'?' · mitjana':''}`:mode==='manual'?'Introdueix un preu vàlid':'Sense dades';
      const count=comparison?.rows.filter(r=>r.period===period).length??0;
      $(`detail-${period}`).textContent=mode==='manual'?'Preu del contracte · sense impostos':comparison?`${count} hores · ${dateLabel(refDay)}`:'Sense dades del dia de referència';
    }
    document.querySelectorAll('[data-watts]').forEach(b=>b.classList.toggle('selected',power!==null && Number(b.dataset.watts)===power));
    renderStatus();renderChart(power,now.getTime());renderFuture(power);
  }
  function renderFuture(power) {
    const body=$('future-table');body.replaceChildren();
    const days=W.nextDays(W.parts().day);
    const entries=days.map(day=>futureDays.find(entry=>entry.day===day)??{day,state:'loading'});
    $('future-caption').textContent=`Cost estimat de ${futureHours} ${futureHours===1?'hora':'hores'} per període: cost sense impostos i final estimat amb la factura de referència. Preu base en €/kWh.`;
    $('future-note').textContent=mode==='manual'?'Càlcul per als pròxims cinc dies amb els preus que has introduït, suposant que el teu contracte els manté.':'Red Eléctrica publica cada dia els preus de l’endemà. Encara no es coneixen els preus reals dels cinc dies sencers; els que falten queden pendents.';
    const states={loading:'Consultant…',pending:'Pendent de publicació',error:'No s’ha pogut consultar',invalid:'Dades incompletes o no vàlides'};
    for(const entry of entries) {
      const tr=document.createElement('tr');
      const dayCell=document.createElement('th');dayCell.scope='row';
      dayCell.textContent=new Intl.DateTimeFormat('ca-ES',{timeZone:W.TZ,weekday:'short',day:'numeric',month:'short'}).format(new Date(`${entry.day}T12:00:00Z`));
      const status=document.createElement('td');status.className='future-state';
      status.textContent=mode==='manual'?'Contracte · preu constant':entry.state==='published'?(entry.cached?'Publicat · còpia local':'Publicat'):states[entry.state];
      if(mode==='auto' && entry.state==='published')status.title=`${entry.source} · consulta del ${dateLabel(W.parts(new Date(entry.fetchedAt)).day)} a les ${timeLabel(entry.fetchedAt)} h`;
      tr.append(dayCell,status);
      const averages=entry.state==='published'?W.means(entry.rows):{};
      for(const period of Object.keys(labels)) {
        const td=document.createElement('td');
        if(W.allValley(entry.day) && period!=='vall') {td.textContent='No s’aplica';td.className='muted';}
        else {
          const price=mode==='manual'?manualPrice(period):averages[period];
          if(!Number.isFinite(price)) {td.textContent=mode==='manual'?'Falta el preu':entry.state==='pending'?'Pendent':entry.state==='loading'?'Consultant…':'Sense dades';td.className='muted';}
          else {
            const pair=document.createElement('div');pair.className='future-cost-pair';
            const base=document.createElement('div'),final=document.createElement('div');final.className='final-amount';
            const baseLabel=document.createElement('small');baseLabel.textContent='Sense impostos';
            const finalLabel=document.createElement('small');finalLabel.textContent='Final estimat';
            const amount=document.createElement('strong');amount.textContent=power!==null?`${nf(W.cost(power,price,futureHours))} €`:'—';
            const total=document.createElement('strong');total.textContent=`${finalText(power,price,futureHours)} €`;
            base.append(baseLabel,amount);final.append(finalLabel,total);pair.append(base,final);
            const reference=document.createElement('small');reference.textContent=`${nf(price,5)} €/kWh${mode==='auto'?' · mitjana':''}`;
            td.append(pair,reference);
          }
        }
        tr.append(td);
      }
      body.append(tr);
    }
    const published=entries.filter(e=>e.state==='published').length;
    const errors=entries.filter(e=>e.state==='error' || e.state==='invalid').length;
    $('future-status').textContent=mode==='manual'?'Imports calculats amb el teu contracte, sense predicció del PVPC.':entries.some(e=>e.state==='loading')?'Consultant la disponibilitat dels preus…':`${published} de 5 dies amb preus publicats.${errors?' Hi ha dies que no s’han pogut consultar o validar; prem «Actualitza» per tornar-ho a provar.':' Els dies pendents s’ompliran quan l’API en publiqui els preus.'}${entries.some(e=>e.cached)?' Alguns imports provenen d’una còpia local validada.':''}`;
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
      const text=`${slotLabel(row)} · ${labels[row.period]} · ${available?`${nf(row.price,5)} €/kWh`:'sense preu'} · ${result} € sense impostos · ${finalText(power,row.price)} € final estimat per 1 h`;
      const button=document.createElement('button');button.type='button';button.className=`bar-item ${row.period}`;
      button.classList.toggle('current',now>=row.start && now<row.end);button.classList.toggle('chosen',selected===row.start);
      button.title=text;button.setAttribute('aria-label',text);button.setAttribute('aria-pressed',String(selected===row.start));
      const track=document.createElement('span');track.className='bar-track';
      const fill=document.createElement('span');fill.className='bar-fill';fill.style.setProperty('--height',`${available?Math.max(2,Math.abs(row.price)/max*100):2}%`);if(!available)fill.style.opacity='.15';
      const hour=document.createElement('span');hour.className='bar-hour';hour.textContent=String(row.hour).padStart(2,'0');track.append(fill);button.append(track,hour);
      button.addEventListener('click',()=>{selected=row.start;document.querySelectorAll('.bar-item').forEach(b=>{b.classList.remove('chosen');b.setAttribute('aria-pressed','false');});button.classList.add('chosen');button.setAttribute('aria-pressed','true');$('chart-selection').textContent=text;});
      container.append(button);
      const tr=document.createElement('tr');for(const value of [slotLabel(row),labels[row.period],available?nf(row.price,5):'—',result,finalText(power,row.price)]){const td=document.createElement('td');td.textContent=value;tr.append(td);} $('hours-table').append(tr);
    }
    const current=rows.find(r=>r.start===selected)??W.current(rows,now);
    $('chart-selection').textContent=current?`${slotLabel(current)} · ${labels[current.period]} · ${Number.isFinite(current.price)&&power!==null?`${nf(W.cost(power,current.price))} € sense impostos · ${finalText(power,current.price)} € final estimat per 1 h`:'sense preu o potència vàlida'}`:'Selecciona una hora.';
    const future=valid.filter(r=>r.end>now);
    const best=future.length?future.reduce((a,b)=>a.price<=b.price?a:b):null;
    $('best-hour').textContent=best?`Franja més barata de les que queden: ${slotLabel(best)}`:'No hi ha més preus disponibles avui.';
    $('chart-help').textContent=mode==='manual'?'Les barres representen el cost sense impostos segons el contracte. El detall mostra també el final estimat d’1 hora.':'PVPC d’avui. Les barres representen el cost sense impostos d’1 hora; el detall inclou el final estimat. L’alçada representa el valor absolut i el signe es mostra al detall.';
  }
  function setMode(next) {
    mode=next;$('auto-mode').classList.toggle('active',next==='auto');$('manual-mode').classList.toggle('active',next==='manual');
    $('auto-mode').setAttribute('aria-pressed',String(next==='auto'));$('manual-mode').setAttribute('aria-pressed',String(next==='manual'));
    $('manual-help').hidden=next!=='manual';document.querySelectorAll('.manual-field').forEach(el=>el.hidden=next!=='manual');render();
  }
  document.querySelectorAll('[data-future-hours]').forEach(button=>button.addEventListener('click',()=>{futureHours=Number(button.dataset.futureHours);document.querySelectorAll('[data-future-hours]').forEach(b=>{const active=Number(b.dataset.futureHours)===futureHours;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});renderFuture(watts());}));
  for(const id of ['bill-total','bill-taxes','bill-fixed']) $(id).addEventListener('input',()=>{savePrefs();render();});
  $('bill-reset').addEventListener('click',()=>{$('bill-total').value='112.05';$('bill-taxes').value='23.15';$('bill-fixed').value='0';savePrefs();render();});
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
