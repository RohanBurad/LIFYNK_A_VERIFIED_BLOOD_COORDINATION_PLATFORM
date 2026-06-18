// ═══════════════════════════════════════════════════════════
//  ngo.js  —  Lifynk NGO Dashboard
//  ES Module · All logic extracted from ngo-dashboard.html
// ═══════════════════════════════════════════════════════════
import { auth, db } from './firebase.js';
import {
  collection, query, where, orderBy, limit,
  getDocs, getDoc, doc, onSnapshot, addDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
    if (!user) { window.location.href = '../auth/login.html'; return; }
  // ── Fetch user profile from Firestore ──────────────────
  (async () => {
    try {
      const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const _db  = getFirestore();
      const snap = await getDoc(doc(_db, 'ngos', user.uid));
      if (snap.exists()) {
        const d    = snap.data();
        const name = d.name || d.organisationName || 'NGO';
        const city = d.city || d.address || '';
        const roleLabel = d.organisationType || d.role || 'NGO';
        const av = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1D9E75&color=fff&size=80`;
        const sn = document.getElementById('sidebarName');   if(sn) sn.textContent = name;
        const sr = document.getElementById('sidebarRole');   if(sr) sr.textContent = city ? roleLabel + ' · ' + city : roleLabel;
        const sa = document.getElementById('sidebarAvatar'); if(sa) sa.src = av;
        const ha = document.getElementById('headerAvatar');  if(ha) ha.src = av;
        const hs = document.getElementById('headerSubtitle');if(hs) hs.textContent = city ? name + ', ' + city : name;
        const gt = document.getElementById('greetingTitle'); if(gt) gt.textContent = 'Hello, ' + name + ' 👋';
      }
    } catch(e) { console.warn('Profile fetch:', e); }
  })();
});


/**
 * Real-time listener for all appointments sent to this NGO.
 * Updates the table the instant a donor books or cancels.
 */
const apptQuery = query(
  collection(db, 'appointments'),
  orderBy('createdAt', 'desc')
);

onSnapshot(apptQuery, snap => {
  const remote = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (remote.length) {
    window._allAppointments = remote;
    window._apptLoaded      = true;
    // Only re-render if the appointments section is currently visible
    const sec = document.getElementById('sec-appointments');
    if (sec && sec.style.display !== 'none') {
      window.renderAppointments(remote);
    }
    // Update pending badge in nav regardless
    const pending = remote.filter(a => a.status === 'pending').length;
    const badge   = document.getElementById('apptNavBadge');
    if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
  }
});

/** Update appointment status (confirm / reschedule / cancel) */
window._updateApptInFirestore = async (id, updates) => {
  await updateDoc(doc(db, 'appointments', id), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
};

/* ── THEME ──────────────────────────────────────────────────── */
const html = document.documentElement;
const themeBtn = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('LifynkTheme') || 'light';
html.setAttribute('data-theme', savedTheme);
themeBtn.innerHTML = savedTheme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
themeBtn.addEventListener('click', () => {
const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
html.setAttribute('data-theme', next);
localStorage.setItem('LifynkTheme', next);
themeBtn.innerHTML = next === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
});

/* ── COUNTERS ───────────────────────────────────────────────── */
function animCount(id, target) {
const el = document.getElementById(id);
if (!el) return;
const step = (target / 1000) * 16; let cur = 0;
const tick = () => { cur = Math.min(cur + step, target); el.textContent = Math.round(cur); if (cur < target) requestAnimationFrame(tick); };
tick();
}
setTimeout(() => { animCount('kpiCamps',7); animCount('kpiVerified',128); animCount('kpiPending',8); animCount('kpiUnits',266); }, 300);
document.querySelectorAll('[data-count]').forEach(el => {
const t = parseInt(el.dataset.count); let c = 0;
const s = Math.ceil(t/40);
const tick = () => { c = Math.min(c+s,t); el.textContent = c.toLocaleString(); if(c<t) setTimeout(tick,30); };
setTimeout(tick,400);
});

/* ── SPARKLINES ─────────────────────────────────────────────── */
function drawSparkline(id, data, color) {
const svg = document.getElementById(id); if (!svg) return;
const w=100,h=36,min=Math.min(...data),max=Math.max(...data);
const pts = data.map((v,i)=>{ const x=(i/(data.length-1))*w; const y=h-((v-min)/(max-min||1))*(h-6)-3; return `${x},${y}`; }).join(' ');
svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}22" stroke="none"/>`;
}
drawSparkline('sp1',[3,4,4,5,5,6,7],'#0d9488');
drawSparkline('sp2',[80,90,100,108,115,122,128],'#22c55e');
drawSparkline('sp3',[5,7,9,8,10,9,8],'#f59e0b');
drawSparkline('sp4',[180,200,215,230,245,256,266],'#e11d48');

/* ── PENDING VERIFICATIONS ──────────────────────────────────── */
const pending = [
{name:'Priya Sharma', role:'Donor',     bg:'A+',  submitted:'2 hrs ago',  init:'PS', c:'#0d9488'},
{name:'Ravi Mehta',   role:'Donor',     bg:'O+',  submitted:'5 hrs ago',  init:'RM', c:'#8b5cf6'},
{name:'Sneha Patel',  role:'Recipient', bg:'B−',  submitted:'1 day ago',  init:'SP', c:'#f59e0b'},
{name:'Akash Singh',  role:'Donor',     bg:'AB+', submitted:'1 day ago',  init:'AS', c:'#e11d48'},
{name:'Pooja Verma',  role:'Donor',     bg:'O−',  submitted:'2 days ago', init:'PV', c:'#10b981'},
{name:'Mohit Jain',   role:'Recipient', bg:'A−',  submitted:'2 days ago', init:'MJ', c:'#f97316'},
{name:'Kavya Reddy',  role:'Donor',     bg:'B+',  submitted:'3 days ago', init:'KR', c:'#0d9488'},
{name:'Aryan Gupta',  role:'Donor',     bg:'AB−', submitted:'3 days ago', init:'AG', c:'#8b5cf6'},
];

function renderVerifyRows(tbodyId, showDocs) {
const tbody = document.getElementById(tbodyId); if (!tbody) return;
tbody.innerHTML = pending.map(p => {
  const rc = p.role === 'Donor' ? 'chip-teal' : 'chip-orange';
  const docCol = showDocs ? `<td><button class="btn-ghost" style="font-size:11px;padding:4px 10px;border-radius:7px"><i class="fa-solid fa-file"></i> View</button></td>` : '';
  return `<tr>
    <td><div style="display:flex;align-items:center;gap:10px"><div class="v-avatar" style="background:${p.c}">${p.init}</div><div><div style="font-weight:700;color:var(--text-primary)">${p.name}</div>${showDocs?`<div style="font-size:11px;color:var(--text-muted)">${p.submitted}</div>`:''}</div></div></td>
    ${showDocs ? `<td style="font-weight:800;color:var(--danger)">${p.bg}</td>` : ''}
    <td><span class="chip ${rc}">${p.role}</span></td>
    ${!showDocs ? `<td style="color:var(--text-muted);font-size:12px">${p.submitted}</td>` : ''}
    ${docCol}
    <td><div style="display:flex;gap:6px">
      <button class="btn-primary" style="font-size:11px;padding:4px 10px;border-radius:7px" onclick="this.closest('tr').style.opacity='.4';this.closest('tr').style.pointerEvents='none';showToast('✅ ${p.name} approved!')"><i class="fa-solid fa-check"></i> Approve</button>
      <button class="btn-ghost" style="font-size:11px;padding:4px 10px;border-radius:7px;border-color:var(--danger);color:var(--danger)"><i class="fa-solid fa-xmark"></i></button>
    </div></td>
  </tr>`;
}).join('');
}
renderVerifyRows('verifyBodyOv', false);
renderVerifyRows('verifyBodyFull', true);

/* ── FORECAST BARS ──────────────────────────────────────────── */
const forecast = [
{bg:'O−', demand:92, color:'#e11d48'},
{bg:'B−', demand:78, color:'#f59e0b'},
{bg:'AB−',demand:65, color:'#8b5cf6'},
{bg:'O+', demand:55, color:'#0d9488'},
{bg:'A+', demand:40, color:'#10b981'},
{bg:'B+', demand:30, color:'#0d9488'},
];

function renderForecast(id) {
const el = document.getElementById(id); if (!el) return;
el.innerHTML = forecast.map(f => `
  <div class="forecast-row">
    <div class="forecast-label">${f.bg}</div>
    <div class="forecast-bar-wrap"><div class="forecast-bar" style="width:0%;background:${f.color}" data-width="${f.demand}%"></div></div>
    <div class="forecast-val">${f.demand}</div>
  </div>`).join('');
setTimeout(() => el.querySelectorAll('.forecast-bar[data-width]').forEach(b => { b.style.width = b.getAttribute('data-width'); }), 500);
}
renderForecast('forecastBarsOv');
renderForecast('forecastBarsFull');

/* ── PRIORITY ACTIONS ───────────────────────────────────────── */
const priorities = [
{icon:'fa-triangle-exclamation', c:'var(--danger)', bg:'var(--danger-dim)', title:'O− critically low citywide', body:'3 hospitals below 5 units. Schedule focused camp within 5 days.'},
{icon:'fa-calendar-plus',        c:'var(--warn)',   bg:'var(--warn-dim)',   title:'B− demand spike predicted', body:'Surat hospitals signal 40% increase next week.'},
{icon:'fa-users',                c:'var(--primary)',bg:'var(--primary-soft)',title:'312 donors eligible this week', body:'Send nudge to re-engage eligible donors near Apollo.'},
];
const pa = document.getElementById('priorityActions');
if (pa) pa.innerHTML = priorities.map(p => `
<div style="background:${p.bg};border:1px solid ${p.c}33;border-radius:10px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
  <i class="fa-solid ${p.icon}" style="color:${p.c};margin-top:2px;flex-shrink:0"></i>
  <div><div style="font-size:13px;font-weight:700;color:var(--text-primary)">${p.title}</div><div style="font-size:12px;color:var(--text-muted);margin-top:3px">${p.body}</div></div>
</div>`).join('');

/* ── RETENTION ──────────────────────────────────────────────── */
const retention = [
{name:'Suresh Patel',   bg:'O+', last:'45 days ago', risk:'High',   c:'#e11d48', ic:'#0d9488'},
{name:'Priya Mehta',    bg:'A+', last:'52 days ago', risk:'High',   c:'#e11d48', ic:'#8b5cf6'},
{name:'Rohit Sharma',   bg:'B+', last:'38 days ago', risk:'Medium', c:'#f59e0b', ic:'#f59e0b'},
{name:'Anjali Singh',   bg:'O−', last:'30 days ago', risk:'Medium', c:'#f59e0b', ic:'#10b981'},
{name:'Kiran Patel',    bg:'AB+',last:'22 days ago', risk:'Low',    c:'#22c55e', ic:'#0d9488'},
];
const rl = document.getElementById('retentionList');
if (rl) rl.innerHTML = retention.map(r => {
const init = r.name.split(' ').map(w=>w[0]).join('');
return `<div class="ret-item">
  <div class="ret-av" style="background:${r.ic}22;color:${r.ic}">${init}</div>
  <div class="ret-info"><div class="ret-name">${r.name}</div><div class="ret-meta"><span style="color:var(--danger);font-weight:800">${r.bg}</span> · Last donated ${r.last}</div></div>
  <span class="chip ${r.risk==='High'?'chip-danger':r.risk==='Medium'?'chip-warn':'chip-ok'}">${r.risk} Risk</span>
  <button class="btn-ghost" style="font-size:11px;padding:5px 10px;border-radius:7px;margin-left:8px" onclick="showToast('📣 Nudge sent to ${r.name}')">Nudge</button>
</div>`;
}).join('');

/* ── NUDGE CAMPAIGNS ────────────────────────────────────────── */
const nudges = [
{title:'O− Emergency Alert',      sent:245, opened:68, responded:22, channel:'WhatsApp', date:'21 Mar 2026', c:'var(--danger)'},
{title:'Camp Reminder — Red Cross',sent:890, opened:74, responded:38, channel:'SMS',      date:'18 Mar 2026', c:'var(--primary)'},
{title:'Eligibility Unlock Notify',sent:312, opened:61, responded:29, channel:'Push',     date:'15 Mar 2026', c:'var(--purple)'},
{title:'Retention Nudge — 60d Inact',sent:187, opened:55, responded:18, channel:'WhatsApp',date:'10 Mar 2026',c:'var(--warn)'},
];
const nl = document.getElementById('nudgeList');
if (nl) nl.innerHTML = nudges.map(n => `
<div class="nudge-item">
  <div class="nudge-icon" style="background:${n.c}22;color:${n.c}"><i class="fa-solid fa-bell"></i></div>
  <div style="flex:1">
    <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${n.title}</div>
    <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px">${n.channel} · ${n.date} · ${n.sent} sent</div>
  </div>
  <div style="display:flex;gap:16px;flex-shrink:0">
    <div style="text-align:center"><div style="font-size:14px;font-weight:800;color:var(--ok)">${n.opened}%</div><div style="font-size:10px;color:var(--text-muted)">Open</div></div>
    <div style="text-align:center"><div style="font-size:14px;font-weight:800;color:var(--primary)">${n.responded}%</div><div style="font-size:10px;color:var(--text-muted)">Response</div></div>
  </div>
</div>`).join('');

/* ── HOTSPOT MAP ────────────────────────────────────────────── */
let hotMap = null;
function initHotspotMap(id, height) {
const el = document.getElementById(id); if (!el || el._mapInit) return;
el._mapInit = true;
const map = L.map(id, { zoomControl:true, scrollWheelZoom:false }).setView([23.0225,72.5714],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
const cOpts = (col) => ({radius:8,fillColor:col,color:'#fff',weight:2,opacity:1,fillOpacity:.85});
[[23.034,72.565],[23.021,72.580],[23.045,72.555],[23.010,72.598],[23.056,72.572],[23.028,72.541],[23.038,72.589],[23.015,72.562]].forEach(p=>L.circleMarker(p,cOpts('#0d9488')).addTo(map).bindPopup('Donor'));
[[23.027,72.570],[23.041,72.558],[23.019,72.582]].forEach(p=>L.circleMarker(p,cOpts('#e11d48')).addTo(map).bindPopup('Hospital'));
[[23.033,72.574],[23.047,72.561]].forEach(p=>L.circleMarker(p,cOpts('#f59e0b')).addTo(map).bindPopup('Camp'));
if (id === 'hotspotMap') hotMap = map;
return map;
}
setTimeout(() => initHotspotMap('hotspotMap',260), 300);

/* ── SCHEDULED CAMPS DATA ───────────────────────────────────── */
let scheduledCamps = [
{name:'Red Cross Blood Drive', date:'22', month:'Mar', location:'Silver Oak University, Ahmedabad', radius:10, bloodGroups:['All'], contact:'+91 98765 43210'},
{name:'City Civil NGO Camp',   date:'05', month:'Apr', location:'Law Garden, Ahmedabad',           radius:8,  bloodGroups:['O+','O−','B−'], contact:'+91 87654 32109'},
];
const pastCamps = [
{name:'Winter Blood Drive',    date:'12', month:'Jan', location:'Navrangpura, Ahmedabad', units:84, donors:84},
{name:'NGO Mahotsav Camp',     date:'28', month:'Nov', location:'CIMS Hospital, Ahmedabad', units:62, donors:62},
{name:'Diwali Donation Drive', date:'20', month:'Oct', location:'Satellite Road, Ahmedabad', units:110, donors:110},
];

function renderCampList(upcomingId, emptyId) {
const list = document.getElementById(upcomingId); if (!list) return;
const empty = document.getElementById(emptyId);
if (!scheduledCamps.length) { list.innerHTML=''; if(empty) empty.style.display='block'; return; }
if (empty) empty.style.display='none';
list.innerHTML = scheduledCamps.map(c => `
  <div class="camp-item">
    <div class="camp-date-box"><div class="day">${c.date}</div><div class="month">${c.month}</div></div>
    <div class="camp-item-info">
      <div class="camp-item-name">${c.name}</div>
      <div class="camp-item-meta"><i class="fa-solid fa-location-dot" style="color:var(--primary);font-size:10px;margin-right:4px"></i>${c.location}</div>
      <div class="camp-item-meta" style="margin-top:3px">${c.bloodGroups.map(bg=>`<span class="chip chip-danger" style="font-size:10px;padding:2px 7px;margin-right:3px">${bg}</span>`).join('')}</div>
    </div>
    <div class="camp-item-radius"><i class="fa-solid fa-tower-broadcast" style="font-size:10px;margin-right:3px"></i>${c.radius} km</div>
  </div>`).join('');
document.querySelectorAll('#campCountChip,#campCountFull').forEach(el => { if(el) el.textContent = `${scheduledCamps.length} upcoming`; });
}
renderCampList('campListOv');
renderCampList('campListFull','emptyCamps');

const pcl = document.getElementById('pastCampList');
if (pcl) pcl.innerHTML = pastCamps.map(c => `
<div class="camp-item" style="opacity:.75">
  <div class="camp-date-box" style="background:var(--text-muted)"><div class="day">${c.date}</div><div class="month">${c.month}</div></div>
  <div class="camp-item-info"><div class="camp-item-name">${c.name}</div><div class="camp-item-meta"><i class="fa-solid fa-location-dot" style="font-size:10px;margin-right:4px;color:var(--text-muted)"></i>${c.location}</div></div>
  <div style="text-align:right;flex-shrink:0"><div style="font-size:14px;font-weight:800;color:var(--primary)">${c.units}u</div><div style="font-size:10px;color:var(--text-muted)">collected</div></div>
</div>`).join('');

/* ── CAMP MODAL ─────────────────────────────────────────────── */
let campMap = null, campMarker = null, campLatLng = null;
let selectedBGs = new Set();

function openCampModal() {
document.getElementById('campModalOverlay').classList.add('open');
document.body.style.overflow = 'hidden';
setTimeout(() => {
  if (campMap) { campMap.invalidateSize(); return; }
  campMap = L.map('campMap').setView([23.0225,72.5714],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(campMap);
  campMap.on('click', async (e) => {
    campLatLng = e.latlng;
    if (campMarker) campMap.removeLayer(campMarker);
    const pinIcon = L.divIcon({className:'',html:`<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:#e11d48;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)"></div>`,iconSize:[28,28],iconAnchor:[14,28]});
    campMarker = L.marker(campLatLng,{icon:pinIcon}).addTo(campMap);
    document.getElementById('mapPickerWrap').classList.add('selected');
    const addrEl = document.getElementById('selectedAddress');
    const addrTxt = document.getElementById('addressText');
    addrEl.style.display = 'flex'; addrTxt.textContent = 'Fetching address…';
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${campLatLng.lat}&lon=${campLatLng.lng}&format=json`,{headers:{'Accept-Language':'en'}});
      const data = await res.json();
      addrTxt.textContent = data.display_name || `${campLatLng.lat.toFixed(5)}, ${campLatLng.lng.toFixed(5)}`;
      campMarker.bindPopup(addrTxt.textContent).openPopup();
    } catch { addrTxt.textContent = `${campLatLng.lat.toFixed(5)}, ${campLatLng.lng.toFixed(5)}`; }
  });
}, 200);
}

function closeCampModal(e) {
if (e && e.target !== document.getElementById('campModalOverlay')) return;
document.getElementById('campModalOverlay').classList.remove('open');
document.body.style.overflow = '';
}

document.querySelectorAll('.bg-btn').forEach(btn => {
btn.addEventListener('click', () => {
  const bg = btn.dataset.bg;
  if (bg === 'All') { const allSel = btn.classList.contains('selected'); document.querySelectorAll('.bg-btn').forEach(b => { allSel?b.classList.remove('selected'):b.classList.add('selected'); }); allSel?selectedBGs.clear():['A+','A−','B+','B−','AB+','AB−','O+','O−','All'].forEach(g=>selectedBGs.add(g)); }
  else { btn.classList.toggle('selected'); selectedBGs.has(bg)?selectedBGs.delete(bg):selectedBGs.add(bg); }
});
});

function updateRadius(val) { document.getElementById('radiusVal').textContent=val; document.getElementById('radiusValNote').textContent=val+' km'; }

async function submitCamp() {
const name = document.getElementById('campName').value.trim();
const date = document.getElementById('campDate').value;
const contact = document.getElementById('campContact').value.trim();
const radius = parseInt(document.getElementById('radiusSlider').value);
if (!name) return showToast('⚠️ Camp name is required', true);
if (!date) return showToast('⚠️ Date is required', true);
if (!contact) return showToast('⚠️ Contact is required', true);
if (!campLatLng) return showToast('📍 Please pick a location on the map', true);
const bgs = selectedBGs.size ? [...selectedBGs].filter(g=>g!=='All') : ['All Groups'];
const btn = document.getElementById('submitCampBtn');
btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…'; btn.disabled = true;
await new Promise(r=>setTimeout(r,900));
const dateObj = new Date(date);
scheduledCamps.unshift({ name, date:dateObj.getDate().toString().padStart(2,'0'), month:dateObj.toLocaleString('default',{month:'short'}), location:document.getElementById('addressText').textContent.split(',').slice(0,3).join(', '), radius, bloodGroups:bgs.slice(0,3), contact });
renderCampList('campListOv'); renderCampList('campListFull','emptyCamps');
if (hotMap) L.circleMarker([campLatLng.lat,campLatLng.lng],{radius:8,fillColor:'#f59e0b',color:'#fff',weight:2,fillOpacity:.9}).addTo(hotMap).bindPopup(name);
closeCampModal(); showToast(`🎉 "${name}" scheduled! Notifying users within ${radius} km`);
document.getElementById('campName').value=''; document.getElementById('campDate').value=''; document.getElementById('campContact').value='';
document.querySelectorAll('.bg-btn').forEach(b=>b.classList.remove('selected')); selectedBGs.clear();
if (campMarker) { campMap.removeLayer(campMarker); campMarker=null; } campLatLng=null;
document.getElementById('mapPickerWrap').classList.remove('selected'); document.getElementById('selectedAddress').style.display='none';
btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Schedule & Notify'; btn.disabled=false;
}

/* ── NAV ROUTING ────────────────────────────────────────────── */
const sections = ['overview','camps','verify','map','forecast','nudge','appointments','profile','settings'];
window.switchSection = (sec) => {
document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
document.querySelector(`[data-section="${sec}"]`)?.classList.add('active');
sections.forEach(s => { const el=document.getElementById('sec-'+s); if(el) el.style.display=s===sec?'':'none'; });
if (sec === 'map') setTimeout(() => initHotspotMap('hotspotMapFull',500), 100);
if (sec === 'appointments') loadAppointments();
};
document.querySelectorAll('.nav-item').forEach(item => {
item.addEventListener('click', e => { e.preventDefault(); const sec=item.dataset.section; if(sec) switchSection(sec); });
});

/* ── NUDGE MODAL ────────────────────────────────────────────── */
window.openNudgeModal = () => document.getElementById('nudgeModalOverlay').classList.add('open');

/* ══════════════════════════════════════════════════════════════
  APPOINTMENTS — reads from Firestore, NGO manages them
══════════════════════════════════════════════════════════════ */
let _allAppointments = [];
let _apptLoaded      = false;

// Demo seed so the table isn't empty before Firebase connects
const _demoAppts = [
{id:'d1', donorName:'Arjun Mehta',  donorBloodGroup:'O+',  type:'donation', donationType:'Whole Blood', centreName:'Red Cross Society', date:'2026-03-25', timeSlot:'10:00 AM', notes:'',                           status:'pending'},
{id:'d2', donorName:'Priya Sharma', donorBloodGroup:'A+',  type:'test',     donationType:'',             centreName:'Red Cross Society', date:'2026-03-25', timeSlot:'09:30 AM', notes:'First time donor',             status:'pending'},
{id:'d3', donorName:'Kavya Reddy',  donorBloodGroup:'B+',  type:'donation', donationType:'Platelets',    centreName:'Red Cross Society', date:'2026-03-26', timeSlot:'11:00 AM', notes:'',                           status:'confirmed'},
{id:'d4', donorName:'Rohit Desai',  donorBloodGroup:'AB+', type:'donation', donationType:'Whole Blood',  centreName:'Red Cross Society', date:'2026-04-05', timeSlot:'02:00 PM', notes:'Hemophilia patient relative', status:'pending'},
{id:'d5', donorName:'Sonal Shah',   donorBloodGroup:'O−',  type:'test',     donationType:'',             centreName:'City Civil NGO',    date:'2026-04-05', timeSlot:'09:00 AM', notes:'',                           status:'confirmed'},
];

function loadAppointments() {
if (_apptLoaded) { renderAppointments(_allAppointments); return; }
// Show demo data immediately; Firebase will override when it connects
_allAppointments = [..._demoAppts];
renderAppointments(_allAppointments);
}

function renderAppointments(appts) {
const loading  = document.getElementById('apptLoading');
const tableWrap= document.getElementById('apptTableWrap');
const empty    = document.getElementById('apptEmpty');
const tbody    = document.getElementById('apptTableBody');
if (!tbody) return;

// Apply filters
const statusF = document.getElementById('apptFilterStatus')?.value || 'all';
const typeF   = document.getElementById('apptFilterType')?.value   || 'all';
const filtered = appts.filter(a =>
  (statusF === 'all' || a.status === statusF) &&
  (typeF   === 'all' || a.type   === typeF)
);

// KPI counts
const total     = appts.length;
const pending   = appts.filter(a=>a.status==='pending').length;
const confirmed = appts.filter(a=>a.status==='confirmed').length;
const donations = appts.filter(a=>a.type==='donation').length;
['apptKpiTotal','apptKpiPending','apptKpiConfirmed','apptKpiDonation'].forEach((id,i) => {
  const el = document.getElementById(id);
  if (el) el.textContent = [total,pending,confirmed,donations][i];
});

// Nav badge
const badge = document.getElementById('apptNavBadge');
if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }

if (loading)   loading.style.display   = 'none';
if (!filtered.length) {
  if (tableWrap) tableWrap.style.display = 'none';
  if (empty)     empty.style.display     = '';
  return;
}
if (empty)     empty.style.display     = 'none';
if (tableWrap) tableWrap.style.display = '';

const statusConf = {
  pending:     {label:'Pending',     chip:'chip-warn',   dot:'#f59e0b'},
  confirmed:   {label:'Confirmed',   chip:'chip-ok',     dot:'#22c55e'},
  rescheduled: {label:'Rescheduled', chip:'chip-orange', dot:'#f97316'},
  cancelled:   {label:'Cancelled',   chip:'',            dot:'#94a3b8'},
};

tbody.innerHTML = filtered.map(a => {
  const sc   = statusConf[a.status] || statusConf.pending;
  const init = a.donorName.split(' ').map(w=>w[0]).join('').slice(0,2);
  const typeLabel = a.type === 'donation'
    ? `🩸 ${a.donationType || 'Whole Blood'}`
    : '🧪 Verification Test';
  return `<tr id="row-${a.id}">
    <td>
      <div style="display:flex;align-items:center;gap:10px">
        <div class="v-avatar">${init}</div>
        <div>
          <div style="font-weight:700;color:var(--text-primary)">${a.donorName}</div>
          <div style="font-size:11px;color:var(--text-muted)">${a.donorPhone||''}</div>
        </div>
      </div>
    </td>
    <td style="font-size:13px">${typeLabel}</td>
    <td>
      <div style="font-weight:700;color:var(--text-primary)">${a.date}</div>
      <div style="font-size:11px;color:var(--text-muted)">${a.timeSlot}</div>
    </td>
    <td>${a.centreName||'—'}</td>
    <td><span style="font-size:15px;font-weight:900;color:var(--danger)">${a.donorBloodGroup}</span></td>
    <td style="font-size:12px;color:var(--text-muted);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.notes||'—'}</td>
    <td><span class="chip ${sc.chip}" style="font-size:11px"><span style="width:7px;height:7px;border-radius:50%;background:${sc.dot};display:inline-block;margin-right:4px"></span>${sc.label}</span></td>
    <td>
      <div style="display:flex;gap:5px">
        ${a.status === 'pending' ? `
          <button class="btn-primary" style="font-size:11px;padding:4px 10px;border-radius:7px"
            onclick="updateApptStatus('${a.id}','confirmed')">
            <i class="fa-solid fa-check"></i> Confirm
          </button>
          <button class="btn-ghost" style="font-size:11px;padding:4px 10px;border-radius:7px"
            onclick="openRescheduleModal('${a.id}')">
            <i class="fa-solid fa-clock-rotate-left"></i>
          </button>
          <button class="btn-ghost" style="font-size:11px;padding:4px 10px;border-radius:7px;border-color:var(--danger);color:var(--danger)"
            onclick="updateApptStatus('${a.id}','cancelled')">
            <i class="fa-solid fa-xmark"></i>
          </button>` : a.status === 'confirmed' ? `
          <button class="btn-ghost" style="font-size:11px;padding:4px 10px;border-radius:7px"
            onclick="openRescheduleModal('${a.id}')">
            <i class="fa-solid fa-clock-rotate-left"></i> Reschedule
          </button>` : '—'}
      </div>
    </td>
  </tr>`;
}).join('');
}

window.filterAppointments = () => renderAppointments(_allAppointments);

window.updateApptStatus = async (id, status) => {
// Update local
const appt = _allAppointments.find(a => a.id === id);
if (!appt) return;
appt.status = status;
renderAppointments(_allAppointments);

// Update in Firestore
if (window._updateApptInFirestore) {
  await window._updateApptInFirestore(id, { status });
}
showToast(
  status === 'confirmed'  ? `✅ Appointment confirmed for ${appt.donorName}` :
  status === 'cancelled'  ? `🚫 Appointment cancelled`                       :
  `📅 Appointment rescheduled`
);
};

window.openRescheduleModal = (id) => {
const appt = _allAppointments.find(a => a.id === id);
if (!appt) return;
const newDate = prompt(`Reschedule for ${appt.donorName}\nEnter new date (YYYY-MM-DD):`, appt.date);
if (!newDate) return;
const newTime = prompt('Enter new time slot (e.g. 10:30 AM):', appt.timeSlot);
if (!newTime) return;
appt.date     = newDate;
appt.timeSlot = newTime;
appt.status   = 'rescheduled';
renderAppointments(_allAppointments);
if (window._updateApptInFirestore) {
  window._updateApptInFirestore(id, { date: newDate, timeSlot: newTime, status: 'rescheduled' });
}
showToast(`📅 Rescheduled ${appt.donorName} to ${newDate} · ${newTime}`);
};

/* ── TOAST ──────────────────────────────────────────────────── */
function showToast(msg, isError=false) {
const t=document.getElementById('toast'); t.style.background=isError?'var(--danger)':'var(--primary)';
document.getElementById('toastMsg').textContent=msg; t.classList.add('show');
setTimeout(()=>t.classList.remove('show'),3500);
}

/* ── 3D TILT ────────────────────────────────────────────────── */
document.querySelectorAll('.ngo-card').forEach(card => {
card.addEventListener('mousemove', e => { const r=card.getBoundingClientRect(); card.style.transform=`perspective(800px) rotateX(${((e.clientY-r.top-r.height/2)/(r.height/2))*-3}deg) rotateY(${((e.clientX-r.left-r.width/2)/(r.width/2))*3}deg) translateY(-4px)`; });
card.addEventListener('mouseleave', () => { card.style.transition='transform 0.5s ease'; card.style.transform=''; });
card.addEventListener('mouseenter', () => { card.style.transition='none'; });
});


document.addEventListener('DOMContentLoaded', () => {
// ── Teleport dropdown to body (fixes overflow clipping) ────
const avatarWrap = document.getElementById('headerAvatarWrap');
const dropdown   = document.getElementById('headerDropdown');
if (avatarWrap && dropdown) {
  document.body.appendChild(dropdown);
  function positionDropdown() {
    const rect = avatarWrap.getBoundingClientRect();
    dropdown.style.top   = (rect.bottom + 8) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.style.left  = 'auto';
  }
  avatarWrap.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!dropdown.classList.contains('open')) positionDropdown();
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
  });
}

// ── Logout ─────────────────────────────────────────────────
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    if(dropdown) dropdown.classList.remove('open');
    if(typeof signOut !== 'undefined') { signOut(window._auth || window.auth); }
    window.location.href = '../auth/login.html';
  });
}

// ── Cache instant display ───────────────────────────────────
const _cached = JSON.parse(localStorage.getItem('lifynkNGOUser') || '{}');
if (_cached.name) {
  const _av = _cached.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(_cached.name)}&background=0d9488&color=fff&size=80`;
  const _ha = document.getElementById('headerAvatar');
  if (_ha) { _ha.src = _av; _ha.style.display = ''; }
  const _hap = document.getElementById('headerAvatarPlaceholder');
  if (_hap) _hap.style.display = 'none';
  const _hda = document.getElementById('hdpAvatar');
  if (_hda) _hda.src = _av;
  const _hn = document.getElementById('hdpName');
  if (_hn) _hn.textContent = _cached.name;
  const _sa = document.getElementById('sidebarAvatar');
  if (_sa) _sa.src = _av;
}
});

// ── Profile Photo Upload → Cloudinary → Firestore ──────────
window.uploadProfilePhoto = async (input) => {
const file = input.files[0]; if (!file) return;
if (typeof showToast === 'function') showToast('📤 Uploading photo...');
try {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', 'lifynk');
  formData.append('folder', 'profile_photos');
  const res  = await fetch('https://api.cloudinary.com/v1_1/duxukomd3/image/upload', { method:'POST', body: formData });
  const data = await res.json();
  if (!data.secure_url) throw new Error('Upload failed');
  const url = data.secure_url;
  // Save to Firestore
  const { getFirestore, doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');const user = auth.currentUser;
  if (user) {
    await updateDoc(doc(db, 'hospitals', user.uid), { photoUrl: url });
    // Update cache
    try {
      const c = JSON.parse(localStorage.getItem('lifynkNGOUser') || '{}');
      c.photoUrl = url;
      localStorage.setItem('lifynkNGOUser', JSON.stringify(c));
    } catch(e) {}
  }
  // Update all 3 avatar spots
  ['headerAvatar','hdpAvatar','sidebarAvatar','profileAvatar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.src = url; if(id==='headerAvatar') el.style.display=''; }
  });
  const hap = document.getElementById('headerAvatarPlaceholder');
  if (hap) hap.style.display = 'none';
  if (typeof showToast === 'function') showToast('✅ Profile photo updated!');
} catch(e) {
  if (typeof showToast === 'function') showToast('❌ Upload failed: ' + e.message);
}
input.value = '';
};

// ════════════════════════════════════════════════════════════
//  BROADCAST LISTENER — NGO
// ════════════════════════════════════════════════════════════
(function _initNgoBroadcastListener() {
  const ROLE = 'ngo';
  let _init  = true;

  onAuthStateChanged(auth, async user => {
    if (!user) return;
    const uid = user.uid;

    const bq = query(
      collection(db, 'broadcasts'),
      where('targets', 'array-contains', ROLE),
      orderBy('sentAt', 'desc'),
      limit(20)
    );

    onSnapshot(bq, snap => {
      if (_init) { _init = false; return; }
      snap.docChanges().filter(c => c.type === 'added').forEach(async change => {
        const b = change.doc.data();
        await addDoc(collection(db, 'notifications', uid, 'items'), {
          type: 'broadcast', priority: b.priority || 'normal',
          title: `📢 ${b.title || 'Announcement'}`, body: b.message || '',
          read: false, createdAt: serverTimestamp(),
        }).catch(() => {});
      });
    });
  });
})();