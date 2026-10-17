/* Funcions pures compartides amb les proves. Cap dependència. */
(() => {
  'use strict';
  const TZ = 'Europe/Madrid';
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  const fixedHolidays = new Set(['01-01','01-06','05-01','08-15','10-12','11-01','12-06','12-08','12-25']);
  function parts(date = new Date()) {
    const p = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
    return { day:`${p.year}-${p.month}-${p.day}`, hour:Number(p.hour), minute:Number(p.minute) };
  }
  function allValley(day) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    return weekday === 0 || weekday === 6 || fixedHolidays.has(day.slice(5));
  }
  function period(day, hour) {
    if (allValley(day) || hour < 8) return 'vall';
    return (hour >= 10 && hour < 14) || (hour >= 18 && hour < 22) ? 'punta' : 'pla';
  }
  function shiftDay(day, n) {
    const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10);
  }
  function referenceDay(day) { while(allValley(day)) day = shiftDay(day,-1); return day; }
  function midnight(day) {
    let t = Date.parse(`${day}T00:00:00Z`);
    // Iteració d'offset per obtenir mitjanit peninsular, independent del fus del dispositiu.
    for(let i=0;i<3;i++) {
      const p = parts(new Date(t));
      const shown = Date.parse(`${p.day}T${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}:00Z`);
      t += Date.parse(`${day}T00:00:00Z`) - shown;
    }
    return t;
  }
  function validate(rows, day) {
    const start = midnight(day), end = midnight(shiftDay(day,1));
    const expected = (end-start)/3600000;
    if(!Array.isArray(rows) || rows.length !== expected) throw new Error('El dia no té totes les hores publicades.');
    rows = [...rows].sort((a,b)=>a.start-b.start);
    rows.forEach((row,i) => {
      if(!Number.isFinite(row.price) || row.start !== start+i*3600000 || parts(new Date(row.start)).day !== day) throw new Error('Dades horàries no vàlides.');
    });
    return rows.map(row => { const p=parts(new Date(row.start)); return {...row,end:row.start+3600000,hour:p.hour,period:period(day,p.hour)}; });
  }
  function parseRedata(json, day) {
    const series = json.included?.find(s=>String(s.id)==='1001' || s.type==='PVPC');
    if(!series) throw new Error('La resposta no conté PVPC.');
    const rows = series.attributes.values.map(v=>({start:Date.parse(v.datetime), price:typeof v.value==='number'?v.value/1000:NaN})).filter(r=>Number.isFinite(r.start) && parts(new Date(r.start)).day===day);
    return validate(rows,day);
  }
  function parseEsios(json, day) {
    const expectedDay = day.split('-').reverse().join('/');
    const raw = json.PVPC?.filter(v=>v.Dia===expectedDay);
    if(!raw?.length) throw new Error('ESIOS no conté el dia sol·licitat.');
    const start = midnight(day);
    const rows = raw.map((r,i)=> {
      const hour = Number(String(r.Hora).match(/^\d{1,2}/)?.[0]);
      const actual = parts(new Date(start+i*3600000)).hour;
      if(hour !== actual) throw new Error('Ordre horari ESIOS no reconegut.');
      const price = typeof r.PCB==='string' && r.PCB.trim()!=='' ? Number(r.PCB.replace(',','.'))/1000 : NaN;
      return {start:start+i*3600000,price};
    });
    return validate(rows,day);
  }
  function means(rows) { return Object.fromEntries(['punta','pla','vall'].map(p=>{const r=rows.filter(v=>v.period===p);return [p,r.length?r.reduce((s,v)=>s+v.price,0)/r.length:null];})); }
  function current(rows, now=Date.now()) {return rows.find(r=>now>=r.start && now<r.end)??null;}
  function nextDays(day) { return Array.from({length:5},(_,i)=>shiftDay(day,i+1)); }
  function futureRedata(json, days) {
    if(!Array.isArray(json.included)) throw new Error('Resposta de preus no reconeguda.');
    const series=json.included.find(s=>String(s.id)==='1001' || s.type==='PVPC');
    const values=series?.attributes?.values ?? [];
    if(!Array.isArray(values)) throw new Error('Sèrie PVPC no reconeguda.');
    return days.map(day=>{
      const hasData=values.some(v=>Number.isFinite(Date.parse(v.datetime)) && parts(new Date(v.datetime)).day===day);
      if(!hasData) return {day,state:'pending'};
      try { return {day,state:'published',rows:parseRedata(json,day)}; }
      catch { return {day,state:'invalid'}; }
    });
  }
  function billModel(total, taxes, fixedDaily=0) {
    if(![total,taxes,fixedDaily].every(Number.isFinite) || total<=0 || taxes<0 || taxes>=total || fixedDaily<0) return null;
    return {factor:total/(total-taxes),taxRate:taxes/(total-taxes),fixedDaily};
  }
  function finalCost(watts, price, hours, model) {
    if(!model || ![watts,price,hours,model.factor,model.fixedDaily].every(Number.isFinite) || watts<0 || hours<0) return null;
    const amount=cost(watts,price,hours)*model.factor+model.fixedDaily*hours/24;
    return Number.isFinite(amount)?amount:null;
  }
  function cost(watts, price, hours=1) { return watts/1000*hours*price; }
  globalThis.Watt = Object.freeze({TZ,parts,allValley,period,shiftDay,referenceDay,midnight,validate,parseRedata,parseEsios,means,current,cost,nextDays,futureRedata,billModel,finalCost});
})();
