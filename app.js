'use strict';
// Tauchlog: Logbuch für Tauchgänge. Alle Daten bleiben im localStorage des Geräts.
// Bewusst keine Dekompressions- oder Nullzeit-Berechnung: dafür gilt der Tauchcomputer.

const VERSION = '1.3.0';
const KEY = 'tauchlog-v1';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const fmt = (n, d = 1) => n == null ? '–' : n.toLocaleString('de-DE', { maximumFractionDigits: d });
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pd = s => { const [y, m, d] = (s || '').split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const dShort = s => { const d = pd(s); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.'; };
const dLong = s => pd(s).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const hm = min => { min = Math.round(min || 0); const h = Math.floor(min / 60); return h ? `${h} h ${min % 60} min` : `${min} min`; };

const DEFAULT_GEAR = ['Flasche gefüllt & Druck geprüft', 'Atemregler + Oktopus', 'Jacket / Wing', 'Tauchcomputer geladen', 'Anzug', 'Blei', 'Maske, Flossen, Handschuhe', 'Lampe', 'Brevet-Karte'];

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.dives)) return fix(s); } catch (e) { }
  return fix({});
}
function fix(s) {
  return {
    dives: Array.isArray(s.dives) ? s.dives : [],
    gear: Array.isArray(s.gear) ? s.gear : DEFAULT_GEAR.map(t => ({ id: uid(), text: t, done: false })),
    service: Array.isArray(s.service) ? s.service : [],
    sites: s.sites && typeof s.sites === 'object' ? s.sites : {},
    brevets: Array.isArray(s.brevets) ? s.brevets : [],
    offset: Number.isInteger(s.offset) ? s.offset : 0,
    lastBackup: s.lastBackup || null,
    name: typeof s.name === 'string' ? s.name : '',
    badges: Array.isArray(s.badges) ? s.badges : [],
    flags: s.flags && typeof s.flags === 'object' ? s.flags : {},
    rank: Number.isInteger(s.rank) ? s.rank : null
  };
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Speichern fehlgeschlagen'); }
  setTimeout(checkBadges, 350);
}

let view = 'logbuch';
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2000); }

// ---------- Auswertung ----------
function sorted() { return [...S.dives].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')) || a.created - b.created); }
function numbered() { return sorted().map((d, i) => ({ ...d, no: S.offset + i + 1 })); }
function siteNames() {
  const set = new Set(Object.keys(S.sites));
  S.dives.forEach(d => d.site && set.add(d.site));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}
function buddies() { return [...new Set(S.dives.map(d => d.buddy).filter(Boolean))].sort(); }

// ---------- Icons ----------
const IC = {
  logbuch: 'M4 5h16v14H4z M8 9h8 M8 13h8',
  statistik: 'M5 19V11 M12 19V5 M19 19v-6',
  ausruestung: 'M5 12l4 4 10-10',
  plaetze: 'M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z M12 9.5a.5.5 0 100 .01'
};
const svg = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${p}"/></svg>`;

function renderTabs() {
  const t = [['logbuch', 'Logbuch'], ['statistik', 'Statistik'], ['ausruestung', 'Ausrüstung'], ['plaetze', 'Plätze']];
  $('#tabbar').innerHTML = t.map(([k, l]) => `<button data-tab="${k}" class="${k === view ? 'a' : ''}">${svg(IC[k])}${l}</button>`).join('');
}

function render() {
  renderTabs();
  if (mainMap) { mainMap.remove(); mainMap = null; }
  const m = $('#app');
  m.innerHTML = ({ logbuch: vLog, statistik: vStats, ausruestung: vGear, plaetze: vSites })[view]();
  window.scrollTo(0, 0);
  if (view === 'plaetze') initMainMap();
}

// ---------- Logbuch ----------
function vLog() {
  const list = numbered().reverse();
  const total = list.reduce((s, d) => s + (d.dur || 0), 0);
  const count = list.length + S.offset;
  let h = `<div class="top"><span class="hello">${esc(greeting())}</span><span class="topr"><button data-act="settings" aria-label="Einstellungen und Backup">Backup</button><button class="rank" data-act="ranks" aria-label="Dienstgrad">${rankSvg(RANKS[rankIdx(count)], 42)}</button></span></div>
  <h1>Logbuch</h1><div class="sub">${count} Tauchg${count === 1 ? 'ang' : 'änge'}${total ? ' · ' + hm(total) + ' unter Wasser' : ''}</div>`;
  if (!list.length) {
    h += `<div class="empty"><div class="ic">🤿</div><b>Noch keine Tauchgänge</b><br>Tippe auf <b>+</b>, um deinen ersten Tauchgang einzutragen.</div>`;
    if (!S.offset) h += `<p class="small" style="text-align:center">Du tauchst schon länger? Unter <b>Backup</b> kannst du einstellen, mit welcher Nummer dein Logbuch weiterzählt.</p>`;
  } else {
    const l = list[0];
    const ago = Math.round((pd(today()) - pd(l.date)) / 864e5);
    const when = ago === 0 ? 'heute' : ago === 1 ? 'gestern' : ago > 1 ? `vor ${ago} Tagen` : dShort(l.date);
    h += `<button class="card hero" data-dive="${l.id}"><div class="lbl">Letzter Tauchgang · ${when}</div><div class="ttl">${esc(l.site || 'Ohne Ort')}</div>
    <div class="row"><div><div class="big">${fmt(l.depth)}</div><div class="lbl">m max. Tiefe</div></div><div><div class="big">${l.dur ?? '–'}</div><div class="lbl">Minuten</div></div><div><div class="big">${l.temp != null ? fmt(l.temp) + '°' : '–'}</div><div class="lbl">Wasser</div></div></div></button>`;
    let cur = '';
    for (const d of list) {
      const dt = pd(d.date), k = dt.getFullYear() + '-' + dt.getMonth();
      if (k !== cur) { cur = k; h += `<div class="sec">${MONTHS[dt.getMonth()]}${dt.getFullYear() !== new Date().getFullYear() ? ' ' + dt.getFullYear() : ''}</div>`; }
      const meta = [dShort(d.date), d.night ? 'Nachttauchgang' : '', d.buddy ? 'Buddy: ' + d.buddy : ''].filter(Boolean).join(' · ');
      h += `<button class="card dive" data-dive="${d.id}"><div class="num">#${d.no}</div><div class="mid"><div class="t">${esc(d.site || 'Ohne Ort')}</div><div class="m">${esc(meta)}</div></div><div class="r"><b>${d.depth != null ? fmt(d.depth) + ' m' : '–'}</b><span>${d.dur != null ? d.dur + ' min' : ''}</span></div></button>`;
    }
  }
  return h + `<button class="fab" data-act="new" aria-label="Tauchgang eintragen">+</button>`;
}

// ---------- Tauchgang: Ansicht ----------
function showDive(id) {
  const d = numbered().find(x => x.id === id); if (!d) return;
  const rows = [
    ['Uhrzeit', d.time],
    ['Max. Tiefe', d.depth != null ? fmt(d.depth) + ' m' : ''],
    ['Dauer', d.dur != null ? d.dur + ' min' : ''],
    ['Wassertemperatur', d.temp != null ? fmt(d.temp) + ' °C' : ''],
    ['Sicht', d.vis != null ? fmt(d.vis) + ' m' : ''],
    ['Art', [d.kind, d.night ? 'Nacht' : ''].filter(Boolean).join(' · ')],
    ['Anzug', d.suit],
    ['Blei', d.lead != null ? fmt(d.lead) + ' kg' : ''],
    ['Flasche', [d.tank != null ? fmt(d.tank) + ' l' : '', d.gas, d.pStart != null || d.pEnd != null ? `${d.pStart ?? '?'} → ${d.pEnd ?? '?'} bar` : ''].filter(Boolean).join(' · ')],
    ['Buddy', d.buddy]
  ].filter(r => r[1]);
  sheet(`<div class="top"><button data-act="close">‹ Logbuch</button><button data-act="edit" data-id="${d.id}">Bearbeiten</button></div>
  <h2>Tauchgang #${d.no}</h2><div class="sub">${esc(d.site || 'Ohne Ort')} · ${dLong(d.date)}</div>
  ${rows.length ? `<div class="card">${rows.map(r => `<div class="field"><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('')}</div>` : ''}
  ${d.notes ? `<div class="card"><div class="small" style="margin-bottom:6px">Notizen</div><div class="note">${esc(d.notes)}</div></div>` : ''}
  <button class="btn del" data-act="del" data-id="${d.id}" style="margin-top:18px">Tauchgang löschen</button>`);
}

// ---------- Tauchgang: Formular ----------
function editDive(id, preset) {
  const d = id ? S.dives.find(x => x.id === id) : null;
  const last = sorted().slice(-1)[0] || {};
  const v = d || { date: today(), suit: last.suit || '', lead: last.lead ?? null, tank: last.tank ?? null, gas: last.gas || 'Luft', kind: last.kind || '', site: preset || '' };
  const val = k => v[k] == null ? '' : esc(String(v[k]).replace('.', k === 'date' || k === 'time' ? '.' : ','));
  const opt = (k, list) => list.map(o => `<option${(v[k] || '') === o ? ' selected' : ''}>${o}</option>`).join('');
  sheet(`<div class="top"><button data-act="close">Abbrechen</button><b>${d ? 'Bearbeiten' : 'Neuer Tauchgang'}</b><button data-act="savedive" data-id="${d ? d.id : ''}"><b>Sichern</b></button></div>
  <form id="df" autocomplete="off">
  <label class="f"><span>Tauchplatz</span><input name="site" list="dl-sites" value="${val('site')}" placeholder="z. B. Kreidesee Hemmoor"></label>
  <datalist id="dl-sites">${siteNames().map(s => `<option value="${esc(s)}">`).join('')}</datalist>
  <div class="g2"><label class="f"><span>Datum</span><input type="date" name="date" value="${val('date')}" required></label><label class="f"><span>Uhrzeit</span><input type="time" name="time" value="${val('time')}"></label></div>
  <div class="g3"><label class="f"><span>Max. Tiefe (m)</span><input name="depth" inputmode="decimal" value="${val('depth')}"></label><label class="f"><span>Dauer (min)</span><input name="dur" inputmode="numeric" value="${val('dur')}"></label><label class="f"><span>Wasser (°C)</span><input name="temp" inputmode="decimal" value="${val('temp')}"></label></div>
  <div class="g2"><label class="f"><span>Sicht (m)</span><input name="vis" inputmode="decimal" value="${val('vis')}"></label><label class="f"><span>Buddy</span><input name="buddy" list="dl-buddy" value="${val('buddy')}"></label></div>
  <datalist id="dl-buddy">${buddies().map(s => `<option value="${esc(s)}">`).join('')}</datalist>
  <div class="g2"><label class="f"><span>Art</span><select name="kind"><option value="">–</option>${opt('kind', ['Landgang', 'Bootstauchgang', 'See', 'Meer', 'Wrack', 'Höhle', 'Ausbildung'])}</select></label>
  <label class="f"><span>Anzug</span><select name="suit"><option value="">–</option>${opt('suit', ['Shorty', 'Nass 3 mm', 'Nass 5 mm', 'Nass 7 mm', 'Halbtrocken', 'Trocki'])}</select></label></div>
  <div class="g3"><label class="f"><span>Blei (kg)</span><input name="lead" inputmode="decimal" value="${val('lead')}"></label><label class="f"><span>Flasche (l)</span><input name="tank" inputmode="decimal" value="${val('tank')}"></label><label class="f"><span>Gas</span><select name="gas">${opt('gas', ['Luft', 'Nitrox 32', 'Nitrox 36', 'Nitrox (anderes)', 'Trimix'])}</select></label></div>
  <div class="g2"><label class="f"><span>Druck Anfang (bar)</span><input name="pStart" inputmode="numeric" value="${val('pStart')}"></label><label class="f"><span>Druck Ende (bar)</span><input name="pEnd" inputmode="numeric" value="${val('pEnd')}"></label></div>
  <label class="f" style="display:flex;align-items:center;gap:10px"><input type="checkbox" name="night" ${v.night ? 'checked' : ''} style="width:22px;height:22px"> Nachttauchgang</label>
  <label class="f"><span>Notizen</span><textarea name="notes" placeholder="Was hast du gesehen?">${esc(v.notes || '')}</textarea></label>
  <button type="submit" class="btn">Sichern</button>
  </form>`);
  $('#df').addEventListener('submit', e => { e.preventDefault(); saveDive(d ? d.id : ''); });
}
function saveDive(id) {
  const f = new FormData($('#df'));
  const g = k => (f.get(k) || '').toString().trim();
  const date = g('date');
  if (!date) { toast('Bitte ein Datum eintragen'); return; }
  const dv = {
    site: g('site'), date, time: g('time'), depth: num(g('depth')), dur: num(g('dur')) != null ? Math.round(num(g('dur'))) : null,
    temp: num(g('temp')), vis: num(g('vis')), buddy: g('buddy'), kind: g('kind'), suit: g('suit'), lead: num(g('lead')),
    tank: num(g('tank')), gas: g('gas'), pStart: num(g('pStart')), pEnd: num(g('pEnd')), night: f.get('night') === 'on', notes: g('notes')
  };
  if (id) { Object.assign(S.dives.find(x => x.id === id), dv); }
  else S.dives.push({ id: uid(), created: Date.now(), ...dv });
  save(); closeSheet(); view = 'logbuch'; render();
  toast(id ? 'Gespeichert' : 'Tauchgang eingetragen');
}

// ---------- Statistik ----------
function vStats() {
  const list = numbered();
  const count = list.length + S.offset;
  const total = list.reduce((s, d) => s + (d.dur || 0), 0);
  const deep = list.filter(d => d.depth != null).sort((a, b) => b.depth - a.depth)[0];
  const long = list.filter(d => d.dur != null).sort((a, b) => b.dur - a.dur)[0];
  const y = new Date().getFullYear();
  const per = Array(12).fill(0); let prev = 0;
  list.forEach(d => { const dt = pd(d.date); if (dt.getFullYear() === y) per[dt.getMonth()]++; if (dt.getFullYear() === y - 1) prev++; });
  const thisY = per.reduce((a, b) => a + b, 0), mx = Math.max(1, ...per);
  const upto = new Date().getMonth() + 1;
  const sites = {}; list.forEach(d => { if (d.site) sites[d.site] = (sites[d.site] || 0) + 1; });
  const top = Object.entries(sites).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const first = list[0];
  let h = `<h1>Statistik</h1><div class="sub">${first ? 'Seit dem ersten Tauchgang in der App am ' + pd(first.date).toLocaleDateString('de-DE') : 'Trag deinen ersten Tauchgang ein, dann füllt sich diese Seite.'}</div>
  <div class="row"><div class="card stat"><div class="v">${count}</div><div class="l">Tauchgänge</div></div><div class="card stat"><div class="v">${total >= 60 ? fmt(total / 60, 0) + ' h' : total + ' min'}</div><div class="l">unter Wasser</div></div></div>
  <div class="row"><div class="card stat"><div class="v">${deep ? fmt(deep.depth) + ' m' : '–'}</div><div class="l">tiefster${deep && deep.site ? ' · ' + esc(deep.site) : ''}</div></div><div class="card stat"><div class="v">${long ? long.dur + ' min' : '–'}</div><div class="l">längster${long && long.site ? ' · ' + esc(long.site) : ''}</div></div></div>
  <div class="card"><div style="font-weight:700">Tauchgänge ${y}</div><div class="small">${thisY} bisher${prev ? ' · ' + (thisY >= prev ? (thisY - prev) + ' mehr' : (prev - thisY) + ' weniger') + ' als ' + (y - 1) : ''}</div>
  <div class="bars">${per.slice(0, upto).map(c => `<div class="${c ? '' : 'z'}" style="height:${c ? Math.max(6, c / mx * 100) : 3}%" title="${c}"></div>`).join('')}</div>
  <div class="bl">${MONTHS.slice(0, upto).map(m => `<span>${m[0]}</span>`).join('')}</div></div>`;
  if (top.length) h += `<div class="sec">Lieblingsplätze</div><div class="card">${top.map(([n, c]) => `<div class="field"><span>${esc(n)}</span><b>${c}×</b></div>`).join('')}</div>`;
  h += `<div class="sec">Brevets</div><div>${S.brevets.map(b => `<button class="chip" data-brevet="${b.id}">${esc(b.name)}</button>`).join('')}<button class="chip add" data-act="addbrevet">+ Brevet</button></div>`;
  h += vBadges();
  return h;
}
function editBrevet(id) {
  const b = S.brevets.find(x => x.id === id) || { name: '', date: '', org: '', no: '' };
  sheet(`<div class="top"><button data-act="close">Abbrechen</button><b>Brevet</b><span style="width:60px"></span></div>
  <form id="bf"><label class="f"><span>Bezeichnung</span><input name="name" list="dl-br" value="${esc(b.name)}" placeholder="z. B. Open Water Diver" required></label>
  <datalist id="dl-br">${['Open Water Diver', 'Advanced Open Water', 'Rescue Diver', 'Divemaster', 'Nitrox', 'Trockentauchen', 'Nachttauchen', 'Wracktauchen', 'Tieftauchen', 'Erste Hilfe / EFR'].map(s => `<option value="${s}">`).join('')}</datalist>
  <div class="g2"><label class="f"><span>Verband</span><input name="org" value="${esc(b.org)}" placeholder="PADI, SSI, VDST …"></label><label class="f"><span>Datum</span><input type="date" name="date" value="${esc(b.date)}"></label></div>
  <label class="f"><span>Nummer</span><input name="no" value="${esc(b.no)}"></label>
  <button class="btn" type="submit">Sichern</button>
  ${id ? `<button type="button" class="btn del" style="margin-top:12px" data-act="delbrevet" data-id="${id}">Brevet löschen</button>` : ''}</form>`);
  $('#bf').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target); const v = { name: f.get('name').trim(), org: f.get('org').trim(), date: f.get('date'), no: f.get('no').trim() };
    if (!v.name) return;
    if (id) Object.assign(S.brevets.find(x => x.id === id), v); else S.brevets.push({ id: uid(), ...v });
    save(); closeSheet(); render();
  });
}

// ---------- Ausrüstung ----------
function vGear() {
  const done = S.gear.filter(g => g.done).length;
  const pct = S.gear.length ? done / S.gear.length * 100 : 0;
  const now = pd(today());
  const sv = [...S.service].sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  return `<h1>Ausrüstung</h1><div class="sub">Checkliste vor dem Tauchgang</div>
  <div class="card"><div style="display:flex;justify-content:space-between;font-weight:700"><span>${done === S.gear.length && done ? 'Alles gepackt' : 'Gepackt'}</span><span style="color:var(--acc)">${done} von ${S.gear.length}</span></div><div class="prog"><i style="width:${pct}%"></i></div></div>
  <div class="card" style="padding:4px 16px">${S.gear.map(g => `<div class="check ${g.done ? 'dn' : ''}"><button class="box" data-gear="${g.id}" aria-label="abhaken">${g.done ? '✓' : ''}</button><button class="tx" data-gear="${g.id}" style="text-align:left">${esc(g.text)}</button><button class="x" data-delgear="${g.id}" aria-label="entfernen">×</button></div>`).join('')}
  <form class="inline" id="gf" style="padding:8px 0 10px"><input name="t" placeholder="Eigenen Punkt hinzufügen"><button class="chip" style="margin:0" type="submit">+</button></form></div>
  ${done ? `<button class="btn sec2" data-act="resetgear">Checkliste zurücksetzen</button>` : ''}
  <div class="sec">Wartung</div>
  <div class="card" style="padding:4px 16px">${sv.length ? sv.map(s => {
    let cls = 'ok', txt = s.due ? 'bis ' + pd(s.due).toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' }) : 'ohne Datum';
    if (s.due) { const days = Math.round((pd(s.due) - now) / 864e5); if (days < 0) { cls = 'due'; txt = 'überfällig'; } else if (days <= 60) { cls = days <= 30 ? 'due' : 'soon'; txt = days < 14 ? `in ${days} Tag${days === 1 ? '' : 'en'}` : `in ${Math.round(days / 7)} Wochen`; } }
    return `<button class="field" style="width:100%;align-items:center" data-svc="${s.id}"><span style="color:var(--fg)">${esc(s.name)}</span><span class="pill ${cls}">${txt}</span></button>`;
  }).join('') : '<div class="small" style="padding:12px 0">Trag ein, wann Atemregler, Flasche (TÜV) oder Jacket zur Wartung müssen.</div>'}</div>
  <button class="link" data-act="addsvc" style="margin:0 4px">+ Wartung eintragen</button>
  <div class="warn">Tauchlog ist ein Logbuch. Für Nullzeiten, Dekompression und Tauchgangsplanung gilt immer dein Tauchcomputer.</div>`;
}
function editSvc(id) {
  const s = S.service.find(x => x.id === id) || { name: '', due: '' };
  sheet(`<div class="top"><button data-act="close">Abbrechen</button><b>Wartung</b><span style="width:60px"></span></div>
  <form id="sf"><label class="f"><span>Was?</span><input name="name" list="dl-svc" value="${esc(s.name)}" placeholder="z. B. Atemregler-Revision" required></label>
  <datalist id="dl-svc">${['Atemregler-Revision', 'Flasche TÜV', 'Flasche Sichtprüfung', 'Jacket-Check', 'Tauchcomputer Batterie', 'Trockenanzug Manschetten'].map(x => `<option value="${x}">`).join('')}</datalist>
  <label class="f"><span>Fällig am</span><input type="date" name="due" value="${esc(s.due)}"></label>
  <button class="btn" type="submit">Sichern</button>
  ${id ? `<button type="button" class="btn del" style="margin-top:12px" data-act="delsvc" data-id="${id}">Löschen</button>` : ''}</form>`);
  $('#sf').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target); const v = { name: f.get('name').trim(), due: f.get('due') };
    if (!v.name) return;
    if (id) Object.assign(S.service.find(x => x.id === id), v); else S.service.push({ id: uid(), ...v });
    save(); closeSheet(); render();
  });
}

// ---------- Plätze ----------
const LVL = { A: 'Anfänger', F: 'Fortgeschritten', E: 'Erfahrene' };
const BUILTIN = {}; (typeof SITES !== 'undefined' ? SITES : []).forEach(s => BUILTIN[s.n] = s);
let siteFilter = 'alle', siteQuery = '', mainMap = null;

function allSites() {
  const list = numbered();
  const names = new Set([...Object.keys(BUILTIN), ...siteNames()]);
  return [...names].map(n => {
    const b = BUILTIN[n] || {}, o = S.sites[n] || {};
    const ds = list.filter(d => d.site === n);
    return {
      name: n, country: o.country || b.c || '', lat: o.lat ?? b.la ?? null, lng: o.lng ?? b.lo ?? null,
      depth: o.maxd ?? b.d ?? null, level: b.l || '', type: b.t || '', season: b.s || '', info: b.i || '',
      builtin: !!BUILTIN[n], own: !BUILTIN[n], count: ds.length, deepest: Math.max(0, ...ds.map(d => d.depth || 0)), last: ds.slice(-1)[0]
    };
  });
}
function siteColor(s) { return s.count ? '#6fe3a8' : s.own ? '#ffb347' : '#3fe0e0'; }

function vSites() {
  const all = allSites();
  const mine = all.filter(s => s.own || s.count).length;
  return `<h1>Plätze</h1><div class="sub">${Object.keys(BUILTIN).length} bekannte Tauchplätze weltweit · ${mine} von dir</div>
  <div class="card map-card"><div id="map" class="map"></div>
  <div class="legend"><span><i style="background:#3fe0e0"></i>Bekannt</span><span><i style="background:#6fe3a8"></i>Getaucht</span><span><i style="background:#ffb347"></i>Eigener Platz</span></div></div>
  <div class="seg">${[['alle', 'Alle'], ['meine', 'Meine'], ['de', 'Deutschland']].map(([k, l]) => `<button data-sf="${k}" class="${siteFilter === k ? 'a' : ''}">${l}</button>`).join('')}</div>
  <input id="sq" type="search" placeholder="Platz oder Land suchen" value="${esc(siteQuery)}" style="margin-bottom:12px">
  <div id="slist">${siteList(all)}</div>
  <button class="btn sec2" data-act="addsite" style="margin-top:6px">+ Eigenen Platz anlegen</button>
  <p class="small" style="margin:14px 4px 0">Die Positionen zeigen die ungefähre Lage. Infos und Tiefen sind Richtwerte, vor Ort gelten die Angaben der Tauchbasis.</p>`;
}
function filterSites(all) {
  const q = siteQuery.trim().toLowerCase();
  return all.filter(s => (siteFilter === 'alle' || (siteFilter === 'meine' ? (s.own || s.count) : s.country.startsWith('Deutschland')))
    && (!q || (s.name + ' ' + s.country + ' ' + s.type).toLowerCase().includes(q)))
    .sort((a, b) => (b.count - a.count) || (b.own - a.own) || a.name.localeCompare(b.name, 'de'));
}
function siteList(all) {
  const f = filterSites(all);
  if (!f.length) return `<div class="empty" style="padding:24px">${siteFilter === 'meine' && !siteQuery ? 'Noch keine eigenen Plätze. Sie erscheinen, sobald du Tauchgänge einträgst.' : 'Nichts gefunden.'}</div>`;
  return f.map(s => `<button class="card dive" data-site="${esc(s.name)}"><div class="num" style="color:${siteColor(s)};background:${siteColor(s)}22">${svg(IC.plaetze).replace('<svg', '<svg width="22" height="22"')}</div><div class="mid"><div class="t">${esc(s.name)}</div><div class="m">${esc(s.count ? s.count + '× getaucht · ' + (s.country || 'eigener Platz') : [s.country || 'Eigener Platz', s.type].filter(Boolean).join(' · '))}</div></div><div class="r"><b>${s.depth ? fmt(s.depth, 0) + ' m' : ''}</b><span>${s.level ? LVL[s.level] : ''}</span></div></button>`).join('');
}
function hasMap() { return typeof L !== 'undefined'; }
function tiles(map) {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
}
function initMainMap() {
  if (mainMap) { mainMap.remove(); mainMap = null; }
  const el = document.getElementById('map'); if (!el) return;
  if (!hasMap()) { el.innerHTML = '<div class="empty" style="padding:30px">Die Karte braucht eine Internetverbindung.</div>'; return; }
  mainMap = L.map(el, { worldCopyJump: true, zoomControl: false, attributionControl: true }).setView([30, 15], 1);
  L.control.zoom({ position: 'topright' }).addTo(mainMap);
  tiles(mainMap);
  const pts = [];
  filterSites(allSites()).forEach(s => {
    if (s.lat == null || s.lng == null) return;
    pts.push([s.lat, s.lng]);
    L.circleMarker([s.lat, s.lng], { radius: 7, color: '#04121f', weight: 2, fillColor: siteColor(s), fillOpacity: 1 }).addTo(mainMap)
      .bindPopup(`<b>${esc(s.name)}</b><br><span style="color:#567">${esc(s.country)}</span><br><button class="pop-btn" data-site="${esc(s.name)}">Details ansehen</button>`);
  });
  if (pts.length && siteFilter !== 'alle') mainMap.fitBounds(pts, { padding: [30, 30], maxZoom: 9 });
}
function refreshSites() { $('#slist').innerHTML = siteList(allSites()); initMainMap(); }

function showSite(name) {
  if (mainMap) mainMap.closePopup();
  const isNew = name == null;
  const n = name || '';
  const all = allSites();
  const s = all.find(x => x.name === n) || { name: '', lat: null, lng: null };
  const o = S.sites[n] || {};
  const ds = numbered().filter(d => d.site === n).reverse();
  const facts = [['Land', s.country], ['Art', s.type], ['Level', s.level ? LVL[s.level] : ''], ['Typische max. Tiefe', s.builtin && s.depth ? fmt(s.depth, 0) + ' m' : ''], ['Beste Zeit', s.season], ['Getaucht', ds.length ? ds.length + '× · max. ' + fmt(Math.max(0, ...ds.map(d => d.depth || 0))) + ' m' : '']].filter(r => r[1]);
  sheet(`<div class="top"><button data-act="close">‹ Plätze</button>${!isNew ? `<button data-act="divehere" data-name="${esc(n)}">+ Tauchgang</button>` : '<span></span>'}</div>
  ${isNew ? '<h2>Neuer Platz</h2><div class="sub">Tippe auf die Karte, um die Position zu setzen.</div>' : `<h2>${esc(n)}</h2><div class="sub">${esc(s.country || 'Eigener Platz')}</div>`}
  <div class="card map-card"><div id="smap" class="map small-map"></div>${s.own || isNew ? `<div class="legend" style="justify-content:space-between"><span id="pos">${s.lat != null ? 'Position gesetzt' : 'Noch keine Position, tippe auf die Karte'}</span><button class="link" data-act="here" style="font-size:13px">Mein Standort</button></div>` : ''}</div>
  ${s.info ? `<div class="card note">${esc(s.info)}</div>` : ''}
  ${facts.length ? `<div class="card">${facts.map(r => `<div class="field"><span>${r[0]}</span><b>${esc(r[1])}</b></div>`).join('')}</div>` : ''}
  <div class="sec">Meine Notizen</div>
  <form id="pf">${isNew ? `<label class="f"><span>Name</span><input name="name" required placeholder="z. B. Baggersee Nord"></label><label class="f"><span>Land / Region</span><input name="country" placeholder="z. B. Deutschland, Niedersachsen"></label>` : ''}
  <div class="g2"><label class="f"><span>Max. Tiefe am Platz (m)</span><input name="maxd" inputmode="decimal" value="${o.maxd != null ? fmt(o.maxd) : ''}"></label><label class="f"><span>Eintritt</span><input name="fee" value="${esc(o.fee || '')}" placeholder="z. B. 15 €"></label></div>
  <label class="f"><span>Notizen (Einstieg, Parken, Füllstation …)</span><textarea name="note">${esc(o.note || '')}</textarea></label>
  <button class="btn" type="submit">Sichern</button></form>
  ${ds.length ? `<div class="sec">Meine Tauchgänge hier</div>` + ds.map(d => `<button class="card dive" data-dive="${d.id}"><div class="num">#${d.no}</div><div class="mid"><div class="t">${dLong(d.date)}</div><div class="m">${esc(d.buddy ? 'Buddy: ' + d.buddy : '')}</div></div><div class="r"><b>${d.depth != null ? fmt(d.depth) + ' m' : ''}</b><span>${d.dur != null ? d.dur + ' min' : ''}</span></div></button>`).join('') : ''}
  ${!isNew && s.own && S.sites[n] && !ds.length ? `<button class="btn del" data-act="delsite" data-name="${esc(n)}" style="margin-top:12px">Platz löschen</button>` : ''}`);
  let pos = s.lat != null ? { lat: s.lat, lng: s.lng } : null;
  const el = document.getElementById('smap');
  if (!hasMap()) el.innerHTML = '<div class="empty" style="padding:20px">Die Karte braucht eine Internetverbindung.</div>';
  else {
    const m = L.map(el, { zoomControl: false, attributionControl: true }).setView(pos ? [pos.lat, pos.lng] : [51.2, 10.4], pos ? (s.builtin ? 9 : 12) : 5);
    tiles(m);
    let mk = pos ? L.circleMarker([pos.lat, pos.lng], { radius: 9, color: '#04121f', weight: 2, fillColor: siteColor(s.name ? s : { own: true, count: 0 }), fillOpacity: 1 }).addTo(m) : null;
    const setPos = (lat, lng, zoom) => {
      pos = { lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
      if (mk) mk.setLatLng([lat, lng]); else mk = L.circleMarker([lat, lng], { radius: 9, color: '#04121f', weight: 2, fillColor: '#ffb347', fillOpacity: 1 }).addTo(m);
      if (zoom) m.setView([lat, lng], zoom);
      const p = document.getElementById('pos'); if (p) p.textContent = 'Position gesetzt';
    };
    if (s.own || isNew) {
      m.on('click', e => setPos(e.latlng.lat, e.latlng.lng));
      el._here = () => {
        if (!navigator.geolocation) { toast('Standort nicht verfügbar'); return; }
        navigator.geolocation.getCurrentPosition(p => setPos(p.coords.latitude, p.coords.longitude, 14), () => toast('Standort nicht erlaubt'), { enableHighAccuracy: true, timeout: 10000 });
      };
    }
    setTimeout(() => m.invalidateSize(), 250);
  }
  $('#pf').addEventListener('submit', e => {
    e.preventDefault(); const f = new FormData(e.target);
    const key = isNew ? f.get('name').trim() : n; if (!key) return;
    if (isNew && (BUILTIN[key] || S.sites[key])) { toast('Diesen Platz gibt es schon'); return; }
    const prev = S.sites[key] || {};
    const v = { ...prev, note: f.get('note').trim(), maxd: num(f.get('maxd')), fee: f.get('fee').trim() };
    if (isNew) v.country = f.get('country').trim();
    if (s.own || isNew) { v.lat = pos ? pos.lat : null; v.lng = pos ? pos.lng : null; }
    S.sites[key] = v;
    save(); closeSheet(); render(); toast('Gespeichert');
  });
}
// ---------- Einstellungen / Backup ----------
function showSettings() {
  sheet(`<div class="top"><button data-act="close">Fertig</button><span></span></div>
  <h2>Backup & Einstellungen</h2><div class="sub">Deine Daten liegen nur auf diesem Handy. Sichere sie ab und zu als Datei.</div>
  <div class="card"><div style="font-weight:700;margin-bottom:4px">Backup</div><div class="small" style="margin-bottom:12px">${S.lastBackup ? 'Letztes Backup: ' + new Date(S.lastBackup).toLocaleDateString('de-DE') : 'Noch kein Backup gemacht.'}</div>
  <button class="btn" data-act="export">Backup speichern</button>
  <label class="btn sec2" style="margin-top:10px">Backup laden<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
  <div class="card"><div style="font-weight:700;margin-bottom:8px">Dein Name</div><form class="inline" id="nf"><input name="n" maxlength="30" value="${esc(S.name)}"><button class="chip" style="margin:0" type="submit">Sichern</button></form></div>
  <div class="card"><div style="font-weight:700;margin-bottom:4px">Bisherige Tauchgänge</div><div class="small" style="margin-bottom:10px">Wie viele Tauchgänge hattest du schon vor dieser App? Danach richtet sich die Nummerierung.</div>
  <form class="inline" id="of"><input name="o" inputmode="numeric" value="${S.offset}"><button class="chip" style="margin:0" type="submit">Sichern</button></form></div>
  <p class="small" style="text-align:center;margin-top:20px">Tauchlog ${VERSION}<br>Kein Ersatz für Tauchcomputer oder Tauchtabellen.</p>`);
  $('#imp').addEventListener('change', importFile);
  $('#nf').addEventListener('submit', e => { e.preventDefault(); const v = new FormData(e.target).get('n').trim(); if (v) { S.name = v; save(); toast('Gespeichert'); render(); } });
  $('#of').addEventListener('submit', e => { e.preventDefault(); const v = parseInt(new FormData(e.target).get('o'), 10); S.offset = isFinite(v) && v >= 0 ? v : 0; save(); toast('Gespeichert'); render(); });
}
function exportData() {
  S.lastBackup = Date.now(); save();
  const blob = new Blob([JSON.stringify({ app: 'tauchlog', version: VERSION, exported: new Date().toISOString(), data: S }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tauchlog-backup-${today()}.json`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Backup gespeichert'); showSettings();
}
function importFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const j = JSON.parse(r.result); const d = j && j.app === 'tauchlog' ? j.data : null;
      if (!d || !Array.isArray(d.dives)) throw 0;
      // Zusammenführen statt überschreiben: nichts Bestehendes geht verloren
      const ids = new Set(S.dives.map(x => x.id)); let n = 0;
      d.dives.forEach(x => { if (x && x.id && !ids.has(x.id)) { S.dives.push(x); n++; } });
      const bid = new Set(S.brevets.map(x => x.id)); (d.brevets || []).forEach(x => x && !bid.has(x.id) && S.brevets.push(x));
      const sid = new Set(S.service.map(x => x.id)); (d.service || []).forEach(x => x && !sid.has(x.id) && S.service.push(x));
      Object.entries(d.sites || {}).forEach(([k, v]) => { if (!S.sites[k]) S.sites[k] = v; });
      if (!S.offset && d.offset) S.offset = d.offset;
      save(); closeSheet(); render(); toast(`${n} Tauchg${n === 1 ? 'ang' : 'änge'} geladen`);
    } catch (err) { toast('Das ist keine Tauchlog-Datei'); }
  };
  r.readAsText(file);
}

// ---------- Sheets ----------
function sheet(html) { $('#layer').innerHTML = `<div class="sheet"><div class="in">${html}</div></div>`; }
function closeSheet() { $('#layer').innerHTML = ''; }

// ---------- Klicks ----------
let armed = null;
document.addEventListener('click', e => {
  const t = e.target.closest('button,[data-dive],[data-site]'); if (!t) return;
  const ds = t.dataset;
  if (ds.tab) { view = ds.tab; closeSheet(); render(); return; }
  if (ds.dive) { showDive(ds.dive); return; }
  if (ds.site) { showSite(ds.site); return; }
  if (ds.gear) { const g = S.gear.find(x => x.id === ds.gear); g.done = !g.done; if (S.gear.length && S.gear.every(x => x.done)) S.flags.gear = 1; save(); render(); return; }
  if (ds.delgear) { S.gear = S.gear.filter(x => x.id !== ds.delgear); save(); render(); return; }
  if (ds.sf) { siteFilter = ds.sf; render(); return; }
  if (ds.badge) { const b = badgeList().find(x => x.id === ds.badge); if (b) toast(b.got ? b.txt : b.txt + ' · ' + b.prog); return; }
  if (ds.svc) { editSvc(ds.svc); return; }
  if (ds.brevet) { editBrevet(ds.brevet); return; }
  const a = ds.act; if (!a) return;
  // Löschen braucht zweimal Tippen
  const confirm2 = label => { if (armed === t) { armed = null; return true; } armed = t; t.textContent = label; return false; };
  switch (a) {
    case 'new': editDive(); break;
    case 'ranks': showRanks(); break;
    case 'closecel': { const c = t.closest('.celebrate'); if (c) c.remove(); const nx = celQ.shift(); if (nx) document.body.appendChild(nx); } break;
    case 'edit': editDive(ds.id); break;
    case 'close': closeSheet(); break;
    case 'savedive': saveDive(ds.id); break;
    case 'del': if (confirm2('Wirklich löschen? Nochmal tippen')) { S.dives = S.dives.filter(x => x.id !== ds.id); save(); closeSheet(); render(); toast('Gelöscht'); } break;
    case 'settings': showSettings(); break;
    case 'export': exportData(); break;
    case 'addbrevet': editBrevet(); break;
    case 'delbrevet': if (confirm2('Wirklich löschen? Nochmal tippen')) { S.brevets = S.brevets.filter(x => x.id !== ds.id); save(); closeSheet(); render(); } break;
    case 'addsvc': editSvc(); break;
    case 'delsvc': if (confirm2('Wirklich löschen? Nochmal tippen')) { S.service = S.service.filter(x => x.id !== ds.id); save(); closeSheet(); render(); } break;
    case 'resetgear': S.gear.forEach(g => g.done = false); save(); render(); toast('Checkliste zurückgesetzt'); break;
    case 'addsite': showSite(null); break;
    case 'divehere': editDive(null, ds.name); break;
    case 'here': { const el = document.getElementById('smap'); if (el && el._here) el._here(); } break;
    case 'delsite': if (confirm2('Wirklich löschen? Nochmal tippen')) { delete S.sites[ds.name]; save(); closeSheet(); render(); } break;
  }
});
let sqT;
document.addEventListener('input', e => {
  if (e.target.id === 'sq') { siteQuery = e.target.value; clearTimeout(sqT); sqT = setTimeout(refreshSites, 200); }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'gf') { e.preventDefault(); const v = new FormData(e.target).get('t').trim(); if (v) { S.gear.push({ id: uid(), text: v, done: false }); save(); render(); } }
});

const celQ = [];
function celebrate(el) { if (document.querySelector('.celebrate')) celQ.push(el); else document.body.appendChild(el); }
// ---------- Dienstgrade (Schulterklappen) ----------
const RANKS = [
  { min: 0, n: 'Anwärter', ins: [] },
  { min: 1, n: 'Taucher', ins: ['v1'] },
  { min: 10, n: 'Obertaucher', ins: ['v2'] },
  { min: 25, n: 'Haupttaucher', ins: ['v3'] },
  { min: 50, n: 'Tauchmeister', ins: ['s1'] },
  { min: 100, n: 'Obertauchmeister', ins: ['s2'] },
  { min: 200, n: 'Tauchkapitän', ins: ['s3'] },
  { min: 350, n: 'Kommandant der Tiefe', ins: ['a'], gold: 1 },
  { min: 500, n: 'Admiral der Tiefe', ins: ['a', 's2'], gold: 1 }
];
function rankIdx(c) { let i = 0; RANKS.forEach((r, k) => { if (c >= r.min) i = k; }); return i; }
function rankSvg(r, h = 40) {
  const G = '#e8b84a', bg = r.gold ? '#1a3550' : '#0d2a44';
  const star = (x, y, s) => { let p = ''; for (let k = 0; k < 10; k++) { const a = Math.PI / 5 * k - Math.PI / 2, rr = k % 2 ? s * .45 : s; p += (k ? 'L' : 'M') + (x + rr * Math.cos(a)).toFixed(1) + ' ' + (y + rr * Math.sin(a)).toFixed(1); } return `<path d="${p}Z" fill="${G}"/>`; };
  const chev = (y) => `<path d="M9 ${y} L20 ${y + 7} L31 ${y}" fill="none" stroke="${G}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  let g = '';
  r.ins.forEach(t => {
    if (t[0] === 'v') { const n = +t[1]; for (let i = 0; i < n; i++) g += chev(44 - i * 8); }
    if (t[0] === 's') { const n = +t[1], ys = r.ins[0] === 'a' ? [44, 51.5] : n === 1 ? [40] : n === 2 ? [34, 48] : [28, 40, 52]; ys.forEach(y => g += star(20, y, r.ins[0] === 'a' ? 3.8 : n === 1 ? 7 : 5.6)); }
    if (t === 'a') g += `<g fill="none" stroke="${G}" stroke-width="2.6" stroke-linecap="round"><circle cx="20" cy="${r.ins.length > 1 ? 21 : 28}" r="3"/><path d="M20 ${r.ins.length > 1 ? 24 : 31}v${r.ins.length > 1 ? 14 : 20} M13 ${r.ins.length > 1 ? 28 : 35}h14 M11 ${r.ins.length > 1 ? 33 : 43}q9 ${r.ins.length > 1 ? 9 : 10} 18 0"/></g>`;
  });
  return `<svg viewBox="0 0 40 64" height="${h}" width="${h * 40 / 64}" aria-hidden="true"><rect x="2" y="2" width="36" height="60" rx="9" fill="${bg}" stroke="${G}" stroke-width="${r.gold ? 3 : 2}"/><circle cx="20" cy="11" r="3.2" fill="${G}"/>${r.gold ? `<path d="M6 57h28" stroke="${G}" stroke-width="2"/>` : ''}${g}</svg>`;
}
function showRanks() {
  const c = S.dives.length + S.offset, i = rankIdx(c), r = RANKS[i], nx = RANKS[i + 1];
  sheet(`<div class="top"><button data-act="close">‹ Zurück</button><span></span></div>
  <div style="text-align:center;margin:6px 0 18px"><div class="rank-big">${rankSvg(r, 120)}</div><h2 style="margin-top:12px">${r.n}</h2>
  <div class="sub">${c} Tauchg${c === 1 ? 'ang' : 'änge'}${nx ? ` · noch ${nx.min - c} bis ${nx.n}` : ' · höchster Dienstgrad erreicht'}</div>
  ${nx ? `<div class="prog" style="max-width:260px;margin:0 auto"><i style="width:${Math.round((c - r.min) / (nx.min - r.min) * 100)}%"></i></div>` : ''}</div>
  <div class="sec">Alle Dienstgrade</div>
  <div class="card" style="padding:4px 16px">${RANKS.map((x, k) => `<div class="field" style="align-items:center;${k > i ? 'opacity:.45' : ''}"><span style="display:flex;align-items:center;gap:12px;color:var(--fg)">${rankSvg(x, 38)}<span><b>${x.n}</b>${k === i ? ' <span class="pill ok">aktuell</span>' : ''}</span></span><b>${x.min ? 'ab ' + x.min : 'Start'}</b></div>`).join('')}</div>
  <p class="small" style="text-align:center;margin-top:12px">Jeder eingetragene Tauchgang zählt. Bisherige Tauchgänge vor der App stellst du unter Backup ein.</p>`);
}
function checkRank() {
  if (!S.name) return;
  const i = rankIdx(S.dives.length + S.offset);
  if (S.rank == null) { S.rank = i; return; }
  if (i <= S.rank) { S.rank = Math.min(S.rank, i); return; }
  S.rank = i;
  const r = RANKS[i];
  const el = document.createElement('div'); el.className = 'celebrate';
  el.innerHTML = `<div class="cbox"><div class="ce">${rankSvg(r, 110)}</div><div class="small" style="text-transform:uppercase;letter-spacing:1px;font-weight:700;color:var(--acc)">Beförderung!</div>
  <h2 style="margin:6px 0">${r.n}</h2><div class="sub">Glückwunsch, ${esc(S.name)}! Du hast ${r.min} Tauchg${r.min === 1 ? 'ang' : 'änge'} erreicht.</div><button class="btn" data-act="closecel">Weiter</button></div>`;
  celebrate(el);
}

// ---------- Name & Abzeichen ----------
function welcome() {
  sheet(`<div style="text-align:center;padding-top:9vh">
  <img src="icons/icon-192.png" alt="" width="96" height="96" style="border-radius:22px;box-shadow:0 10px 30px rgba(18,120,196,.45)">
  <h1 style="margin-top:22px">Willkommen bei Tauchlog</h1>
  <div class="sub" style="max-width:320px;margin:0 auto 26px">Dein Logbuch für jeden Tauchgang. Wie heißt du?</div></div>
  <form id="wf"><label class="f"><span>Dein Name</span><input name="n" autocomplete="given-name" placeholder="z. B. Luka" maxlength="30" required></label>
  <button class="btn" type="submit">Los geht’s</button></form>
  <p class="small" style="text-align:center;margin-top:16px">Dein Name und alle Daten bleiben nur auf diesem Handy.</p>`);
  $('#wf').addEventListener('submit', e => {
    e.preventDefault(); const n = new FormData(e.target).get('n').trim(); if (!n) return;
    S.name = n; save(); closeSheet(); render(); toast(`Hallo ${n}!`);
  });
}
function greeting() {
  const h = new Date().getHours();
  return (h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend') + (S.name ? ', ' + S.name : '');
}

const country = n => { const b = BUILTIN[n]; const c = (b ? b.c : (S.sites[n] || {}).country) || ''; return c.split(',')[0].trim(); };
function badgeList() {
  const ds = S.dives, cnt = ds.length + S.offset;
  const maxD = Math.max(0, ...ds.map(d => d.depth || 0));
  const mins = ds.reduce((s, d) => s + (d.dur || 0), 0);
  const sites = new Set(ds.map(d => d.site).filter(Boolean)).size;
  const lands = new Set(ds.map(d => d.site && country(d.site)).filter(Boolean)).size;
  const buds = new Set(ds.map(d => (d.buddy || '').trim().toLowerCase()).filter(Boolean)).size;
  const perDay = {}; ds.forEach(d => perDay[d.date] = (perDay[d.date] || 0) + 1);
  const maxDay = Math.max(0, ...Object.values(perDay));
  const any = f => ds.some(f) ? 1 : 0;
  const B = (id, k, n, txt, val, goal, unit = '') => ({ id, k, n, txt, got: val >= goal, p: Math.min(1, val / goal), prog: `${unit === 'h' ? Math.floor(val) : val} / ${goal}${unit ? ' ' + unit : ''}` });
  return [
    B('first', '1', 'Erster Tauchgang', 'Deinen ersten Tauchgang eingetragen', cnt, 1),
    B('d10', '10', '10 Tauchgänge', '10 Tauchgänge im Logbuch', cnt, 10),
    B('d25', '25', '25 Tauchgänge', '25 Tauchgänge im Logbuch', cnt, 25),
    B('d50', '50', '50 Tauchgänge', '50 Tauchgänge im Logbuch', cnt, 50),
    B('d100', '100', '100 Tauchgänge', '100 Tauchgänge, du bist ein alter Hase', cnt, 100),
    B('d250', '250', '250 Tauchgänge', '250 Tauchgänge, Respekt!', cnt, 250),
    B('h10', '10h', '10 Stunden', '10 Stunden unter Wasser', mins / 60, 10, 'h'),
    B('h50', '50h', '50 Stunden', '50 Stunden unter Wasser', mins / 60, 50, 'h'),
    B('m10', '10m', '10 Meter', 'Einen Tauchgang auf 10 m eingetragen', maxD, 10, 'm'),
    B('m18', '18m', '18 Meter', 'Einen Tauchgang auf 18 m eingetragen. Tiefer nur mit passendem Brevet.', maxD, 18, 'm'),
    B('long', '60′', 'Ausdauer', 'Ein Tauchgang mit 60 Minuten oder mehr', Math.max(0, ...ds.map(d => d.dur || 0)), 60, 'min'),
    B('night', 'N', 'Nachteule', 'Deinen ersten Nachttauchgang eingetragen', any(d => d.night), 1),
    B('wreck', 'W', 'Wrackforscher', 'Einen Wracktauchgang eingetragen', any(d => d.kind === 'Wrack' || (BUILTIN[d.site] && BUILTIN[d.site].t === 'Wrack')), 1),
    B('cold', '8°', 'Eisbär', 'Bei 8 °C oder kälter getaucht', any(d => d.temp != null && d.temp <= 8), 1),
    B('warm', '26°', 'Tropentaucher', 'Bei 26 °C oder wärmer getaucht', any(d => d.temp != null && d.temp >= 26), 1),
    B('s5', '5P', 'Entdecker', 'An 5 verschiedenen Plätzen getaucht', sites, 5),
    B('s15', '15P', 'Weltenbummler', 'An 15 verschiedenen Plätzen getaucht', sites, 15),
    B('l3', '3L', '3 Länder', 'In 3 Ländern getaucht', lands, 3),
    B('buddy', '5B', 'Teamplayer', 'Mit 5 verschiedenen Buddys getaucht', buds, 5),
    B('day3', '3×', 'Tauchtag', '3 Tauchgänge an einem Tag', maxDay, 3),
    B('brevet', 'BR', 'Ausgebildet', 'Dein erstes Brevet eingetragen', S.brevets.length, 1),
    B('ready', '✓', 'Gut vorbereitet', 'Die Ausrüstungs-Checkliste komplett abgehakt', S.flags.gear ? 1 : 0, 1),
    B('backup', 'BK', 'Sicher ist sicher', 'Dein erstes Backup gespeichert', S.lastBackup ? 1 : 0, 1)
  ];
}
function medalSvg(k, got, h = 46) {
  const G = got ? '#e8b84a' : '#3a5368', bg = got ? '#0d2a44' : 'rgba(255,255,255,.04)', fs = k.length > 2 ? 13 : 16;
  return `<svg viewBox="0 0 48 48" width="${h}" height="${h}" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="${bg}" stroke="${G}" stroke-width="2.5"/><circle cx="24" cy="24" r="16.5" fill="none" stroke="${G}" stroke-width="1" stroke-dasharray="2 2.2" opacity=".8"/><text x="24" y="24" dy=".36em" text-anchor="middle" font-family="-apple-system,Inter,Arial,sans-serif" font-weight="800" font-size="${fs}" fill="${G}">${k}</text></svg>`;
}
function vBadges() {
  const l = badgeList(), got = l.filter(b => b.got).length;
  return `<div class="sec">Abzeichen · ${got} von ${l.length}</div><div class="badges">${l.map(b => `<button class="badge ${b.got ? 'got' : ''}" data-badge="${b.id}">${medalSvg(b.k, b.got)}<span class="bn">${b.n}</span>${b.got ? '' : `<span class="bp"><i style="width:${Math.round(b.p * 100)}%"></i></span>`}</button>`).join('')}</div>`;
}
function checkBadges() {
  if (!S.name) return;
  checkRank();
  const fresh = badgeList().filter(b => b.got && !S.badges.includes(b.id));
  if (!fresh.length) return;
  fresh.forEach(b => S.badges.push(b.id));
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { }
  const el = document.createElement('div'); el.className = 'celebrate';
  el.innerHTML = `<div class="cbox"><div class="ce">${fresh.slice(0, 4).map(b => medalSvg(b.k, true, 64)).join(' ')}</div><div class="small" style="text-transform:uppercase;letter-spacing:1px;font-weight:700;color:var(--acc)">${fresh.length > 1 ? 'Neue Abzeichen' : 'Neues Abzeichen'}!</div>
  <h2 style="margin:6px 0">${fresh.map(b => b.n).join(', ')}</h2><div class="sub">${fresh.length === 1 ? fresh[0].txt : 'Gut gemacht, ' + esc(S.name) + '.'}</div><button class="btn" data-act="closecel">Weiter</button></div>`;
  celebrate(el);
}

render();
if (!S.name) welcome(); else setTimeout(checkBadges, 600);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
