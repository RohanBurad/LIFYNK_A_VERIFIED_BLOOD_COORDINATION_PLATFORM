// ═══════════════════════════════════════════════════════
//  bloodbank.js  —  Lifynk Blood Bank Dashboard (module)
//  Changes: B1 B2 B3 B4 B7 B8
// ═══════════════════════════════════════════════════════

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDoc, getDocs,
  serverTimestamp, updateDoc, doc, onSnapshot, query, where, orderBy, limit, addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyC-HnJq3DU9wc3DpvSGQM3OWfxwUwThPT8",
  authDomain:        "lifynk.firebaseapp.com",
  projectId:         "lifynk",
  storageBucket:     "lifynk.firebasestorage.app",
  messagingSenderId: "658656685385",
  appId:             "1:658656685385:web:1a02d664f685a7049a7e98",
  measurementId:     "G-NW2L14SB01"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// Expose on window for inline HTML handlers
window.db              = db;
window.addDoc          = addDoc;
window.collection      = collection;
window.serverTimestamp = serverTimestamp;
window.updateDoc       = updateDoc;
window.doc             = doc;

// ── Notification sound (B2) ──────────────────────────────
function _playNotifSound() {
  try {
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.connect(g);g.connect(ctx.destination);
    o.frequency.value=880;
    g.gain.setValueAtTime(0.15,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.35);
    o.start();o.stop(ctx.currentTime+0.35);
  }catch(e){}
}

// ── Save report to Firestore ─────────────────────────────
window._saveReportToFirestore = async (report) => {
  const docRef = await addDoc(collection(db,'medicalReports'),{...report,createdAt:serverTimestamp()});
  console.log('Report saved:',docRef.id);
  return docRef.id;
};

// ── Accept/Reject appointment ────────────────────────────
window.acceptAppointment = async (appointmentId, btnEl) => {
  if(btnEl){btnEl.disabled=true;btnEl.textContent='Confirming…';}
  try{
    await updateDoc(doc(db,'appointments',appointmentId),{status:'confirmed',confirmedAt:serverTimestamp()});
    if(window.showToast) window.showToast('✅ Appointment confirmed — donor notified');
  }catch(err){
    console.error(err);
    if(window.showToast) window.showToast('❌ Failed to confirm. Check connection.');
    if(btnEl){btnEl.disabled=false;btnEl.textContent='Accept';}
  }
};
window.rejectAppointment = async (appointmentId, btnEl) => {
  if(btnEl){btnEl.disabled=true;btnEl.textContent='Rejecting…';}
  try{
    await updateDoc(doc(db,'appointments',appointmentId),{status:'cancelled',cancelledAt:serverTimestamp()});
    if(window.showToast) window.showToast('🚫 Appointment rejected');
  }catch(err){
    console.error(err);
    if(window.showToast) window.showToast('❌ Failed to reject. Check connection.');
    if(btnEl){btnEl.disabled=false;btnEl.textContent='Reject';}
  }
};

// ── Inventory listener ───────────────────────────────────
const BG_ORDER_M=['A+','A−','B+','B−','O+','O−','AB+','AB−'];
function listenInventory(uid){
  const q=query(collection(db,'inventory'),where('centreId','==',uid));
  onSnapshot(q,snap=>{
    const batches=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.collectedAt?.toMillis?.()|| 0)-(a.collectedAt?.toMillis?.()|| 0));
    const stockMap={};BG_ORDER_M.forEach(bg=>stockMap[bg]=0);
    batches.forEach(b=>{ if(stockMap[b.bloodGroup]!==undefined) stockMap[b.bloodGroup]+=Number(b.units)||0; });
    if(window._buildHeatmap){window._buildHeatmap('heatmapGrid',stockMap);window._buildHeatmap('heatmapGridFull',stockMap);}
    if(window._renderStockLedger) window._renderStockLedger(batches);
    if(window._updateOverviewStats) window._updateOverviewStats(stockMap);
  });
}

// ── Appointments listener ────────────────────────────────
window._listenAppointments = (uid) => {
  const q=query(collection(db,'appointments'),where('centreId','==',uid),where('status','in',['pending','confirmed','completed']));
  onSnapshot(q,snap=>{
    console.log('📋 Snapshot fired — docs:',snap.docs.length);
    const all=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()|| 0)-(a.createdAt?.toMillis?.()|| 0));
    const verifications=all.filter(a=>a.type==='test');
    const donations    =all.filter(a=>a.type==='donation');
    const tryRender=()=>{ if(window.renderAppointments) window.renderAppointments(verifications); if(window.renderDonationRequests) window.renderDonationRequests(donations); };
    if(window.renderDonationRequests) tryRender(); else setTimeout(tryRender,800);
  });
};

// ── Verified donor pool listener ─────────────────────────
window._listenVerifiedDonors = () => {
  const q=query(collection(db,'donors'),where('verificationStatus','==','verified'));
  onSnapshot(q,snap=>{
    const tb=document.getElementById('donorBody'); if(!tb) return;
    if(snap.empty){tb.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)"><i class="fa-solid fa-users" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>No verified donors yet</td></tr>`;return;}
    tb.innerHTML=snap.docs.map(d=>{
      const data=d.data(),name=data.name||'—',init=name.split(' ').map(w=>w[0]).join('').slice(0,2),bg=data.bloodGroup||'—',eligible=data.eligible!==false;
      return `<tr><td style="font-size:12px;font-weight:700;color:var(--text-muted)">${data.lifynkId||d.id.slice(0,8)}</td><td><div style="display:flex;align-items:center;gap:10px"><div style="width:30px;height:30px;border-radius:50%;background:var(--primary);color:white;font-size:11px;font-weight:800;display:grid;place-items:center;flex-shrink:0">${init}</div><span style="font-weight:700">${name}</span></div></td><td><span style="font-size:14px;font-weight:900;color:var(--danger)">${bg}</span></td><td>${data.age||'—'}</td><td style="color:var(--text-muted);font-size:12px">${data.lastDonation||'—'}</td><td style="font-weight:700">${data.totalDonations||0}</td><td><span class="chip ${eligible?'chip-ok':'chip-danger'}">${eligible?'Yes':'No'}</span></td><td><button class="btn-primary" style="font-size:11px;padding:4px 10px;border-radius:7px;background:var(--purple);box-shadow:0 2px 6px rgba(139,92,246,.18)" onclick="openFinaliseModal('${name}','${data.phone||''}','${bg}','${data.lastDonation||''}')"><i class="fa-solid fa-flask-vial" style="margin-right:4px"></i>Finalise Report</button></td></tr>`;
    }).join('');
  });
};

// ── B2: Mark single notification read ────────────────────
window.markBBNotifRead = async (uid, notifId) => {
  try { await updateDoc(doc(db,'notifications',uid,'items',notifId),{read:true}); } catch(e){}
};

// ── B6: Save profile from dropdown panel ─────────────────
window.toggleProfilePanel = () => {
  const panel  = document.getElementById('hpdProfilePanel');
  const chevron= document.querySelector('#profileToggleBtn .fa-chevron-down');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (!isOpen) {
    panel.style.display='';
    if(chevron) chevron.style.transform='rotate(180deg)';
    const d=window._bbData||{};
    const ni=document.getElementById('hpdNameInput');  if(ni)  ni.value=d.name ||d.bbname||'';
    const ei=document.getElementById('hpdEmailInput'); if(ei)  ei.value=d.email||'';
    const pi=document.getElementById('hpdPhoneInput'); if(pi)  pi.value=d.phone||'';
    const ci=document.getElementById('hpdCityInput');  if(ci)  ci.value=d.city ||'';
  } else {
    panel.style.display='none';
    if(chevron) chevron.style.transform='';
  }
};
window.saveHpdProfile = async () => {
  const user=auth.currentUser; if(!user){if(window.showToast) window.showToast('❌ Not logged in');return;}
  const name =document.getElementById('hpdNameInput')?.value.trim()||'';
  const email=document.getElementById('hpdEmailInput')?.value.trim()||'';
  const phone=document.getElementById('hpdPhoneInput')?.value.trim()||'';
  const city =document.getElementById('hpdCityInput')?.value.trim()||'';
  try {
    await updateDoc(doc(db,'bloodbanks',user.uid),{name,email,phone,city});
    window._bbData={...window._bbData,name,email,phone,city};
    const hn=document.getElementById('hdpName');       if(hn) hn.textContent=name;
    const sn=document.getElementById('sidebarName');   if(sn) sn.textContent=name;
    const gt=document.getElementById('greetingTitle'); if(gt) gt.textContent=`Hello, ${name} 👋`;
    if(window.showToast) window.showToast('✅ Profile saved');
    document.getElementById('hpdProfilePanel').style.display='none';
    const ch=document.querySelector('#profileToggleBtn .fa-chevron-down'); if(ch) ch.style.transform='';
  }catch(e){ if(window.showToast) window.showToast('❌ Failed to save: '+e.message); }
};

// ════════════════════════════════════════════════════════════
//  AUTH STATE — B8 auth guard + profile load + all listeners
// ════════════════════════════════════════════════════════════
let _bbPrevNotifCount  = 0;
let _authRedirectTimer = null; // debounce token-refresh gaps

onAuthStateChanged(auth, user => {
  if (!user) {
    // Wait 3 s before redirecting — guards against brief Firebase token-refresh
    // gaps that would otherwise kick a logged-in user back to login.html
    _authRedirectTimer = setTimeout(() => {
      window.location.href = '../login.html';
    }, 3000);
    return;
  }
  clearTimeout(_authRedirectTimer); // user resolved fine — cancel any pending redirect
  window._currentBBUser = user;
  window._bbDocId       = user.uid;

  // Start real-time listeners
  window._listenAppointments(user.uid);
  listenInventory(user.uid);
  window._listenVerifiedDonors();
  window._listenRequestsToday(user.uid);
  window._listenDonorStats();

  // Fetch profile from bloodbanks collection
  (async () => {
    try {
      const snap = await getDoc(doc(db,'bloodbanks',user.uid));
      if (snap.exists()) {
        const d    = snap.data();
        window._bbData = d;
        const name = d.name || d.organisationName || d.bbname || 'Blood Bank';
        const city = d.city || d.address || '';
        const av   = d.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1D9E75&color=fff&size=80`;
        const sn=document.getElementById('sidebarName');   if(sn) sn.textContent=name;
        const sr=document.getElementById('sidebarRole');   if(sr) sr.textContent=city?'Blood Bank · '+city:'Blood Bank';
        const ha=document.getElementById('headerAvatar');  if(ha){ha.src=av;ha.style.display='';}
        const hap=document.getElementById('headerAvatarPlaceholder'); if(hap) hap.style.display='none';
        const hda=document.getElementById('hdpAvatar');   if(hda) hda.src=av;
        const hn=document.getElementById('hdpName');       if(hn) hn.textContent=name;
        const gt=document.getElementById('greetingTitle'); if(gt) gt.textContent='Hello, '+name+' 👋'; // B8
        const ds=document.getElementById('dateStr');       if(ds) ds.textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+' · '+name+(city?', '+city:'');
        try { localStorage.setItem('lifynkUser',JSON.stringify({name,photoUrl:d.photoUrl||''})); } catch(e) {}
      }
    } catch(e) { console.warn('Profile fetch:',e); }
  })();

  // B2: Notification listener
  const notifQ = query(
    collection(db,'notifications',user.uid,'items'),
    where('read','==',false)
  );
  onSnapshot(notifQ, snap => {
    const count=snap.size;
    const badge=document.getElementById('notifCountBadge');
    if(badge){badge.textContent=count;badge.style.display=count?'':'none';}
    if(count>_bbPrevNotifCount) _playNotifSound();
    _bbPrevNotifCount=count;
    const notifList=document.getElementById('notifList');
    if(!notifList) return;
    if(snap.empty){
      notifList.innerHTML=`<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px"><i class="fa-solid fa-bell-slash" style="display:block;margin-bottom:8px;font-size:22px;opacity:.4"></i>No new notifications</div>`;
    }else{
      notifList.innerHTML=snap.docs.map(d=>{
        const n=d.data();
        return `<div onclick="markBBNotifRead('${user.uid}','${d.id}')" style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border-subtle);cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''"><i class="fa-solid fa-bell" style="color:var(--primary);margin-top:2px;flex-shrink:0;font-size:13px"></i><div><div style="font-size:12px;font-weight:700;color:var(--text-primary)">${n.title||'Notification'}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${n.body||''}</div></div></div>`;
      }).join('');
    }
  });
});

// ── Attachment helpers ───────────────────────────────────
window._attachedFile = null;
window.handleAttachFile = (input) => {
  const file=input.files[0]; if(!file) return;
  if(file.size>5*1024*1024){if(window.showToast)window.showToast('File too large — max 5 MB');input.value='';return;}
  window._attachedFile=file;
  const isPDF=file.type==='application/pdf';
  const icon=document.getElementById('attachIcon'); if(icon){icon.className=isPDF?'fa-solid fa-file-pdf':'fa-solid fa-file-image';icon.style.color=isPDF?'var(--danger)':'var(--blue)';}
  const fn=document.getElementById('attachFileName'); if(fn) fn.textContent=file.name;
  const fs=document.getElementById('attachFileSize'); if(fs) fs.textContent=(file.size/1024).toFixed(1)+' KB';
  const prev=document.getElementById('attachPreview'); if(prev) prev.style.display='flex';
  const dz=document.getElementById('attachDropZone'); if(dz){dz.style.borderColor='var(--primary)';dz.style.background='var(--primary-soft)';}
};
window.clearAttachment = () => {
  window._attachedFile=null;
  const inp=document.getElementById('fAttachFile'); if(inp) inp.value='';
  const prev=document.getElementById('attachPreview'); if(prev) prev.style.display='none';
  const dz=document.getElementById('attachDropZone'); if(dz){dz.style.borderColor='';dz.style.background='';}
};

// ════════════════════════════════════════════════════════════
//  INVENTORY RENDER HELPERS (parse-time, not in DOMContentLoaded)
// ════════════════════════════════════════════════════════════
const BG_MAX   = {'A+':80,'A−':40,'B+':80,'B−':40,'O+':100,'O−':50,'AB+':40,'AB−':30};
const BG_ORDER = ['A+','A−','B+','B−','O+','O−','AB+','AB−'];
function _hmCellClass(u){ return u===0?'empty':u<6?'low':u<20?'warn':'ok'; }

window._buildHeatmap = function(id, stockMap) {
  const el=document.getElementById(id); if(!el) return;
  el.innerHTML=BG_ORDER.map(bg=>{
    const units=stockMap[bg]||0,max=BG_MAX[bg],cls=_hmCellClass(units),pct=Math.min(Math.round((units/max)*100),100);
    return `<div class="hm-cell ${cls}"><div class="hm-bg">${bg}</div><div class="hm-units">${units}</div><div class="hm-label">units</div><div class="hm-bar-wrap"><div class="hm-bar" style="width:${pct}%"></div></div></div>`;
  }).join('');
};

window._renderStockLedger = function(batches) {
  const sb=document.getElementById('stockBody'); if(!sb) return;
  if(!batches.length){sb.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)"><i class="fa-solid fa-box-open" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>No stock batches yet — add one above</td></tr>`;return;}
  sb.innerHTML=batches.map(s=>{
    const sc=s.status==='Active'?'chip-ok':s.status==='Expiring'?'chip-warn':'chip-danger';
    const collected=s.collectedAt?.toDate?s.collectedAt.toDate().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
    const expiry=s.expiry?new Date(s.expiry).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
    return `<tr><td style="font-weight:700;font-size:12px;color:var(--text-muted)">${s.batchId||s.id}</td><td><span style="font-size:15px;font-weight:900;color:var(--danger)">${s.bloodGroup}</span></td><td style="font-weight:700">${s.units}u</td><td>${collected}</td><td>${expiry}</td><td><span class="chip ${sc}">${s.status}</span></td><td><button class="btn-ghost" style="font-size:11px;padding:4px 10px;border-radius:7px" onclick="openUpdateModal('inventory')">Edit</button></td></tr>`;
  }).join('');
};

window._updateOverviewStats = function(stockMap) {
  const total        = Object.values(stockMap).reduce((a,b)=>a+b,0);
  const lowGroups    = Object.entries(stockMap).filter(([,u])=>u>0&&u<6);
  const emptyGroups  = Object.entries(stockMap).filter(([,u])=>u===0);
  const alertGroups  = [...emptyGroups,...lowGroups];

  // ── Card 1: Total Units ───────────────────────────────────
  const totalEl = document.querySelector('[data-stat="totalUnits"]');
  if (totalEl) totalEl.textContent = total.toLocaleString('en-IN');
  const trendEl = document.querySelector('[data-stat="totalUnitsTrend"]');
  if (trendEl) {
    trendEl.innerHTML = total > 0
      ? `<i class="fa-solid fa-arrow-trend-up"></i> ${total} units in stock`
      : `<i class="fa-solid fa-triangle-exclamation"></i> No stock recorded`;
    trendEl.className = `stat-trend ${total > 0 ? 'up' : 'down'}`;
  }

  // ── Card 2: Low Stock Groups ──────────────────────────────
  const lowCountEl = document.querySelector('[data-stat="lowStockCount"]');
  if (lowCountEl) lowCountEl.textContent = alertGroups.length;
  const lowGroupsEl = document.querySelector('[data-stat="lowStockGroups"]');
  if (lowGroupsEl) {
    lowGroupsEl.textContent = alertGroups.length === 0
      ? 'All groups above threshold'
      : alertGroups.map(([bg])=>bg).join(', ') + ' below threshold';
  }
  const lowTrendEl = document.querySelector('[data-stat="lowStockTrend"]');
  if (lowTrendEl) {
    const now = new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    lowTrendEl.innerHTML = alertGroups.length > 0
      ? `<i class="fa-solid fa-arrow-trend-down"></i> Alert since ${now}`
      : `<i class="fa-solid fa-circle-check"></i> All groups stocked`;
    lowTrendEl.className = `stat-trend ${alertGroups.length > 0 ? 'down' : 'up'}`;
  }

  // ── Topbar alert badge ────────────────────────────────────
  const alertEl = document.querySelector('.topbar-alert');
  if (alertEl) alertEl.innerHTML = `<div class="blink-dot"></div> ${alertGroups.length} Low Stock Alert${alertGroups.length!==1?'s':''}`;
};

// ── Overview: Requests Today listener ────────────────────
window._listenRequestsToday = (uid) => {
  const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const q = query(
    collection(db,'appointments'),
    where('centreId','==',uid),
    where('date','==',todayStr)
  );
  onSnapshot(q, snap => {
    const all       = snap.docs.map(d=>d.data());
    const total     = all.length;
    const fulfilled = all.filter(a=>a.status==='completed').length;
    const pending   = all.filter(a=>a.status==='pending'||a.status==='confirmed').length;
    const pct       = total > 0 ? Math.round((fulfilled/total)*100) : 0;

    const valEl = document.querySelector('[data-stat="requestsToday"]');
    if (valEl) valEl.textContent = total;
    const subEl = document.querySelector('[data-stat="requestsSub"]');
    if (subEl) subEl.textContent = total === 0
      ? 'No requests today'
      : `${fulfilled} fulfilled · ${pending} pending`;
    const trendEl = document.querySelector('[data-stat="requestsTrend"]');
    if (trendEl) {
      trendEl.innerHTML = total > 0
        ? `<i class="fa-solid fa-arrow-trend-up"></i> ${pct}% fulfillment rate`
        : `<i class="fa-solid fa-minus"></i> No data yet`;
      trendEl.className = `stat-trend ${pct >= 70 ? 'up' : 'down'}`;
    }
  });
};

// ── Overview: Registered Donors listener ─────────────────
window._listenDonorStats = () => {
  // All donors
  onSnapshot(collection(db,'donors'), snapAll => {
    const total = snapAll.size;
    const valEl = document.querySelector('[data-stat="totalDonors"]');
    if (valEl) valEl.textContent = total.toLocaleString('en-IN');

    // Eligible this month
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const eligible   = snapAll.docs.filter(d => {
      const dd = d.data();
      return dd.eligible !== false && (!dd.nextEligibleDate || dd.nextEligibleDate <= now.toISOString().split('T')[0]);
    }).length;
    const subEl = document.querySelector('[data-stat="eligibleDonors"]');
    if (subEl) subEl.textContent = `${eligible.toLocaleString('en-IN')} eligible this month`;

    // New this week
    const weekAgo = new Date(now - 7*24*60*60*1000);
    const newThisWeek = snapAll.docs.filter(d => {
      const ca = d.data().createdAt?.toDate?.();
      return ca && ca >= weekAgo;
    }).length;
    const trendEl = document.querySelector('[data-stat="donorsTrend"]');
    if (trendEl) {
      trendEl.innerHTML = newThisWeek > 0
        ? `<i class="fa-solid fa-arrow-trend-up"></i> +${newThisWeek} new this week`
        : `<i class="fa-solid fa-minus"></i> No new donors this week`;
      trendEl.className = `stat-trend ${newThisWeek > 0 ? 'up' : ''}`;
    }
  });
};

// ── Toast ─────────────────────────────────────────────────

window.showToast = (msg) => {
  const t = document.getElementById('toast');
  if (!t) return; // safety guard
  t.innerHTML = msg;
  t.style.transform = 'translateY(0)';
  t.style.opacity = '1';
  setTimeout(() => {
    t.style.transform = 'translateY(80px)';
    t.style.opacity = '0';
  }, 3000);
};

// ════════════════════════════════════════════════════════════
//  DOM-CONTENT-LOADED
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // Show empty heatmap immediately
  window._buildHeatmap('heatmapGrid',{});
  window._buildHeatmap('heatmapGridFull',{});

  // ── B3: Audit trail — empty state (real entries added dynamically) ──
  const auditEl = document.getElementById('auditList');
  if (auditEl) {
    auditEl.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px">
      <i class="fa-solid fa-list-check" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>
      No activity yet — stock additions and report finalisations will appear here
    </div>`;
  }

  // ── B4: File list — empty state ───────────────────────────
  const fileListEl = document.getElementById('fileList');
  if (fileListEl) {
    fileListEl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
      <i class="fa-solid fa-folder-open" style="font-size:36px;display:block;margin-bottom:12px;opacity:.4"></i>
      <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:4px">No documents uploaded yet</div>
      <div>Upload reports using the Upload tab above</div>
    </div>`;
  }
  // Keep filter functions as no-ops since no data yet
  window.filterByType = (btn, type) => {
    document.querySelectorAll('#tab-view .stab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
  };
  window.filterFiles = () => {};

  // ── B2: Notification panel toggle ────────────────────────
  const notifBtn   = document.getElementById('bbNotifBtn');
  const notifPanel = document.getElementById('notifPanel');
  if (notifBtn && notifPanel) {
    notifBtn.addEventListener('click', e => {
      e.stopPropagation();
      const rect = notifBtn.getBoundingClientRect();
      notifPanel.style.top   = (rect.bottom + 8) + 'px';
      notifPanel.style.right = (window.innerWidth - rect.right) + 'px';
      notifPanel.style.display = notifPanel.style.display === 'none' ? '' : 'none';
    });
    document.addEventListener('click', e => {
      if (!notifPanel.contains(e.target) && e.target !== notifBtn) notifPanel.style.display = 'none';
    });
  }

  // ── Header dropdown (teleport to body) ───────────────────
  const avatarWrap = document.getElementById('headerAvatarWrap');
  const dropdown   = document.getElementById('headerDropdown');
  if (avatarWrap && dropdown) {
    document.body.appendChild(dropdown);
    function positionDropdown(){const r=avatarWrap.getBoundingClientRect();dropdown.style.top=(r.bottom+8)+'px';dropdown.style.right=(window.innerWidth-r.right)+'px';dropdown.style.left='auto';}
    avatarWrap.addEventListener('click',e=>{e.stopPropagation();if(!dropdown.classList.contains('open'))positionDropdown();dropdown.classList.toggle('open');});
    document.addEventListener('click',e=>{if(!dropdown.contains(e.target))dropdown.classList.remove('open');});
  }

  
  // ── Logout ────────────────────────────────────────────────
  const sidebarLogout = document.getElementById('sidebarLogoutBtn');
  const logoutBtn     = document.getElementById('logoutBtn');
  if (sidebarLogout) sidebarLogout.addEventListener('click', () => {
    document.getElementById('logoutConfirmOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  });
  if (logoutBtn) logoutBtn.addEventListener('click', () => {
    document.getElementById('headerDropdown').classList.remove('open');
    document.getElementById('logoutConfirmOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  });
  window.closeLogoutModal = () => {
    document.getElementById('logoutConfirmOverlay').classList.remove('open');
    document.body.style.overflow = '';
  };
  window.confirmLogout = () => { window.location.href = '../auth/login.html'; };


  // ── Instant cache display (before Firebase resolves) ─────
  const _cached = JSON.parse(localStorage.getItem('lifynkUser') || '{}');
  if (_cached.name) {
    const av  = _cached.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(_cached.name)}&background=0d9488&color=fff&size=80`;
    const _ha = document.getElementById('headerAvatar');
    if(_ha){_ha.src=av;_ha.style.display='';}
    const _hap = document.getElementById('headerAvatarPlaceholder'); if(_hap) _hap.style.display='none';
    const _hda = document.getElementById('hdpAvatar');   if(_hda) _hda.src=av;
    const _hn  = document.getElementById('hdpName');     if(_hn)  _hn.textContent=_cached.name;
    const _sa  = document.getElementById('sidebarAvatar'); if(_sa) _sa.src=av;
  }

  // ── Profile photo upload ──────────────────────────────────
  window.uploadProfilePhoto = async (input) => {
    const file=input.files[0]; if(!file) return;
    if(window.showToast) window.showToast('📤 Uploading photo...');
    try{
      const fd=new FormData(); fd.append('file',file); fd.append('upload_preset','lifynk'); fd.append('folder','profile_photos');
      const res=await fetch('https://api.cloudinary.com/v1_1/duxukomd3/image/upload',{method:'POST',body:fd});
      const data=await res.json(); if(!data.secure_url) throw new Error('Upload failed');
      const url=data.secure_url;
      const user=window._currentBBUser;
      if(user) await updateDoc(doc(db,'bloodbanks',user.uid),{photoUrl:url});
      try{const c=JSON.parse(localStorage.getItem('lifynkUser')||'{}');c.photoUrl=url;localStorage.setItem('lifynkUser',JSON.stringify(c));}catch(e){}
      ['headerAvatar','hdpAvatar','sidebarAvatar'].forEach(id=>{const el=document.getElementById(id);if(el){el.src=url;if(id==='headerAvatar')el.style.display='';}});
      const hap=document.getElementById('headerAvatarPlaceholder'); if(hap) hap.style.display='none';
      if(window.showToast) window.showToast('✅ Profile photo updated!');
    }catch(e){ if(window.showToast) window.showToast('❌ Upload failed: '+e.message); }
    input.value='';
  };

  // ── Modal forms (inventory, donor, etc.) ─────────────────
  const modalForms = {
    inventory:{title:'Add Blood Stock',html:`<div class="form-row"><div class="form-field"><label>Blood Group</label><select id="stockBG"><option value="">Select</option><option>A+</option><option>A−</option><option>B+</option><option>B−</option><option>O+</option><option>O−</option><option>AB+</option><option>AB−</option></select></div><div class="form-field"><label>Units</label><input type="number" id="stockUnits" placeholder="e.g. 20" min="1"/></div></div><div class="form-row"><div class="form-field"><label>Batch ID</label><input type="text" id="stockBatchId" placeholder="BK-2026-XXX"/></div><div class="form-field"><label>Expiry Date</label><input type="date" id="stockExpiry"/></div></div><div class="form-field" style="margin-bottom:12px"><label>Notes</label><textarea id="stockNotes" placeholder="Any collection details, source, etc."></textarea></div>`},
    donor:{title:'Update Donor Record',html:`<div class="form-row"><div class="form-field"><label>Full Name</label><input type="text" placeholder="Donor name"/></div><div class="form-field"><label>Blood Group</label><select><option>A+</option><option>A−</option><option>B+</option><option>B−</option><option>O+</option><option>O−</option><option>AB+</option><option>AB−</option></select></div></div><div class="form-row"><div class="form-field"><label>Age</label><input type="number" placeholder="e.g. 28"/></div><div class="form-field"><label>Contact</label><input type="tel" placeholder="+91 XXXXX XXXXX"/></div></div><div class="form-row"><div class="form-field"><label>Last Donation</label><input type="date"/></div><div class="form-field"><label>Eligible to Donate</label><select><option>Yes</option><option>No</option></select></div></div>`},
    lab:{title:'Update Lab Results',html:`<div class="form-row"><div class="form-field"><label>Batch ID</label><input type="text" placeholder="BK-2026-XXX"/></div><div class="form-field"><label>Test Date</label><input type="date"/></div></div><div class="form-row"><div class="form-field"><label>HIV Status</label><select><option>Negative</option><option>Positive</option></select></div><div class="form-field"><label>Hepatitis B</label><select><option>Negative</option><option>Positive</option></select></div></div>`},
    expiry:{title:'Update Expiry Dates',html:`<div class="form-row"><div class="form-field"><label>Blood Group</label><select id="stockBG"><option value="">Select</option><option>A+</option><option>A−</option><option>B+</option><option>B−</option><option>O+</option><option>O−</option><option>AB+</option><option>AB−</option></select></div><div class="form-field"><label>New Expiry Date</label><input type="date" id="stockExpiry"/></div></div>`},
    compliance:{title:'Update Compliance Record',html:`<div class="form-row"><div class="form-field"><label>Document Type</label><select><option>License Renewal</option><option>Inspection Report</option><option>NABH Certification</option><option>CPCB Compliance</option></select></div><div class="form-field"><label>Valid Until</label><input type="date"/></div></div><div class="form-field" style="margin-bottom:12px"><label>Notes</label><textarea placeholder="Compliance remarks…"></textarea></div>`},
    batch:{title:'Update Batch Information',html:`<div class="form-row"><div class="form-field"><label>Batch ID</label><input type="text" placeholder="BK-2026-XXX"/></div><div class="form-field"><label>Blood Group</label><select><option>A+</option><option>A−</option><option>B+</option><option>B−</option><option>O+</option><option>O−</option><option>AB+</option><option>AB−</option></select></div></div><div class="form-row"><div class="form-field"><label>Units in Batch</label><input type="number" placeholder="e.g. 20"/></div><div class="form-field"><label>Storage Location</label><input type="text" placeholder="e.g. Fridge A, Shelf 2"/></div></div><div class="form-field" style="margin-bottom:12px"><label>Batch Notes</label><textarea placeholder="Source, camp details, remarks…"></textarea></div>`}
  };

  window.openUpdateModal = (type) => {
    const f=modalForms[type]||modalForms['inventory'];
    document.getElementById('modalTitle').textContent=f.title;
    document.getElementById('modalBody').innerHTML=f.html;
    document.getElementById('modalOverlay').classList.add('open');
  };
  window.closeModal = (e) => { if(!e||e.target===document.getElementById('modalOverlay')) document.getElementById('modalOverlay').classList.remove('open'); };

  window.submitModal = async () => {
    const bg=document.getElementById('stockBG')?.value;
    const units=document.getElementById('stockUnits')?.value;
    if(bg&&units){
      const user=window._currentBBUser; if(!user){if(window.showToast) window.showToast('❌ Not logged in');return;}
      const batchId=document.getElementById('stockBatchId')?.value||'BK-'+new Date().getFullYear()+'-'+Math.floor(Math.random()*900+100);
      const expiry =document.getElementById('stockExpiry')?.value||'';
      const notes  =document.getElementById('stockNotes')?.value||'';
      let status='Active';
      if(expiry){const dl=(new Date(expiry)-new Date())/(1000*60*60*24);if(dl<0)status='Expired';else if(dl<7)status='Expiring';}
      const btn=document.querySelector('#modalOverlay .btn-primary');
      if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';}
      try{
        await window.addDoc(window.collection(window.db,'inventory'),{centreId:window._bbDocId||user.uid,bloodGroup:bg,units:Number(units),batchId,expiry,notes,status,collectedAt:window.serverTimestamp()});
        const auditEl=document.getElementById('auditList');
        if(auditEl) auditEl.insertAdjacentHTML('afterbegin',`<div class="audit-entry"><div class="audit-icon" style="background:var(--primary-soft);color:var(--primary)"><i class="fa-solid fa-circle-plus"></i></div><div><div class="audit-text"><strong>Stock Added</strong> — ${units}u ${bg} received. Batch ${batchId} logged.</div><div class="audit-time">Just now</div></div></div>`);
        if(window.showToast) window.showToast(`✅ ${units}u ${bg} added — Batch ${batchId}`);
        document.getElementById('modalOverlay').classList.remove('open');
      }catch(err){console.error(err);if(window.showToast) window.showToast('❌ Failed to save. Check connection.');}
      finally{if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check"></i> Save Record';}}
    }else{
      if(window.showToast) window.showToast('✅ Record saved successfully');
      document.getElementById('modalOverlay').classList.remove('open');
    }
  };

  // ── Finalise report modal ─────────────────────────────────
  window.openFinaliseModal = async (name, phone, bg, appointmentId) => {
    window._currentFinaliseApptId=appointmentId;
    document.getElementById('finaliseTitle').textContent=name+' — Lab Report';
    document.getElementById('finaliseSubtitle').textContent=`Donor · Blood Group: ${bg}`;
    document.getElementById('finalisePhone').textContent=phone;
    const bgParts=bg.match(/^(A|B|AB|O)([+−-])?$/);
    if(bgParts){const abo=document.getElementById('fABO');const rh=document.getElementById('fRh');if(abo)abo.value=bgParts[1]||'';if(rh)rh.value=bgParts[2]==='−'||bgParts[2]==='-'?'Negative':'Positive';}
    const bgSel=document.getElementById('fBloodGroup'); if(bgSel) bgSel.value=bg;
    const dateEl=document.getElementById('fDonationDate'); if(dateEl) dateEl.value=new Date().toISOString().split('T')[0];
    ['fHIV','fHepB','fHepC','fSyphilis','fMalaria','fNAT','fAntibody'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    ['fHemoglobin','fPCV'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const techEl=document.getElementById('fTechName');if(techEl)techEl.value='';
    const notesEl=document.getElementById('fNotes');if(notesEl)notesEl.value='';
    const nextDateEl=document.getElementById('fNextEligibleDate');if(nextDateEl)nextDateEl.value='';
    const deferralEl=document.getElementById('fTemporaryDeferral');if(deferralEl)deferralEl.checked=false;

    // ── Reset Section 6 (Donor Pool) ────────────────────────
    const poolCb=document.getElementById('fAddToPool'); if(poolCb) poolCb.checked=false;
    const poolSec=document.getElementById('donorPoolSection'); if(poolSec) poolSec.style.display='none';
    const poolToggleWrap=document.getElementById('addToPoolToggleWrap');
    if(poolToggleWrap){poolToggleWrap.style.borderColor='';poolToggleWrap.style.background='';}
    const poolBGSel=document.getElementById('fPoolBloodGroup'); if(poolBGSel) poolBGSel.value='';
    const poolDateEl=document.getElementById('fPoolVerifiedDate'); if(poolDateEl) poolDateEl.value=new Date().toISOString().split('T')[0];
    const poolNextEl=document.getElementById('fPoolNextDate'); if(poolNextEl) poolNextEl.value='';
    const poolEligEl=document.getElementById('fPoolEligible'); if(poolEligEl) poolEligEl.value='true';
    const poolNotesEl=document.getElementById('fPoolNotes'); if(poolNotesEl) poolNotesEl.value='';
    const notifyDon=document.getElementById('fNotifyDonation'); if(notifyDon) notifyDon.checked=true;
    const notifyElig=document.getElementById('fNotifyEligibility'); if(notifyElig) notifyElig.checked=true;
    // Auto-fill donor banner
    const initials=name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()||'?';
    const poolAvatar=document.getElementById('poolDonorAvatar'); if(poolAvatar) poolAvatar.textContent=initials;
    const poolNameEl=document.getElementById('poolDonorName'); if(poolNameEl) poolNameEl.textContent=name;
    const poolBGEl=document.getElementById('poolDonorBG'); if(poolBGEl) poolBGEl.textContent=bg||'—';
    const poolPhoneEl=document.getElementById('poolDonorPhone'); if(poolPhoneEl) poolPhoneEl.textContent=phone||'—';
    const poolVerifiedEl=document.getElementById('poolVerifiedDate'); if(poolVerifiedEl) poolVerifiedEl.textContent=new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});

    window._currentFinalisePhone=phone; window._currentFinaliseName=name;
    if(window._currentFinaliseApptId){
      try{const apptSnap=await getDoc(doc(db,'appointments',window._currentFinaliseApptId));window._currentFinaliseUid=apptSnap.exists()?(apptSnap.data().donorUid||''):'';} catch(e){window._currentFinaliseUid='';}
    }
    document.getElementById('finaliseModalOverlay').classList.add('open');
    document.body.style.overflow='hidden';
  };
  window.closeFinaliseModal = (e) => {
    if(e&&e.target.id!=='finaliseModalOverlay') return;
    document.getElementById('finaliseModalOverlay').classList.remove('open');
    document.body.style.overflow='';
  };

  window.submitFinaliseReport = async () => {
    const required={fABO:'ABO Group',fRh:'Rh Typing',fBloodGroup:'Blood Group Confirmed',fHIV:'HIV 1 & 2',fHepB:'Hepatitis B (HBsAg)',fHepC:'Hepatitis C (Anti-HCV)',fSyphilis:'Syphilis (VDRL/RPR)',fMalaria:'Malaria',fHemoglobin:'Hemoglobin (Hb)',fFinalisedBy:'Authorised By'};
    for(const[id,label]of Object.entries(required)){const el=document.getElementById(id);if(!el||!el.value.trim()){el.style.borderColor='var(--danger)';el.style.animation='shake .3s';setTimeout(()=>{el.style.borderColor='';el.style.animation='';},1500);if(window.showToast) window.showToast(`⚠️ ${label} is required`);return;}}
    const btn=document.getElementById('finaliseSubmitBtn');
    btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Sending…';btn.disabled=true;
    const report={donorPhone:window._currentFinalisePhone,donorName:window._currentFinaliseName,donorUid:window._currentFinaliseUid||'',aboGroup:document.getElementById('fABO').value,rhTyping:document.getElementById('fRh').value,bloodGroup:document.getElementById('fBloodGroup').value||(document.getElementById('fABO').value+(document.getElementById('fRh').value==='Positive'?'+':'−')),hiv:document.getElementById('fHIV').value,hepatitisB:document.getElementById('fHepB').value,hepatitisC:document.getElementById('fHepC').value,syphilis:document.getElementById('fSyphilis').value,malaria:document.getElementById('fMalaria').value,nat:document.getElementById('fNAT').value||'Not Done',hemoglobin:parseFloat(document.getElementById('fHemoglobin').value),pcv:document.getElementById('fPCV').value?parseFloat(document.getElementById('fPCV').value):null,antibodyScreening:document.getElementById('fAntibody').value||'Not Done',donationDate:document.getElementById('fDonationDate').value,bloodBank:document.getElementById('fBankName').value,labTechnician:document.getElementById('fTechName').value,finalisedBy:document.getElementById('fFinalisedBy').value,notes:document.getElementById('fNotes').value,nextEligibleDate:document.getElementById('fNextEligibleDate').value||null,temporaryDeferral:document.getElementById('fTemporaryDeferral').checked||false,attachedFileName:window._attachedFile?window._attachedFile.name:null,hasAttachment:!!window._attachedFile,status:'finalised'};
    const ttiClear=[report.hiv,report.hepatitisB,report.hepatitisC,report.syphilis,report.malaria].every(r=>r==='Non-Reactive'||r==='Negative');
    report.allClear=ttiClear&&(report.nat==='Non-Reactive'||report.nat==='Not Done');
    try{
      if(window._saveReportToFirestore) await window._saveReportToFirestore(report);
      else await new Promise(r=>setTimeout(r,900));

      // ── Section 6: Add to Verified Donor Pool ────────────
      const addToPool = document.getElementById('fAddToPool')?.checked;
      if (addToPool) {
        const poolBG         = document.getElementById('fPoolBloodGroup')?.value || report.bloodGroup;
        const poolVerDate    = document.getElementById('fPoolVerifiedDate')?.value || new Date().toISOString().split('T')[0];
        const poolNextDate   = document.getElementById('fPoolNextDate')?.value || report.nextEligibleDate || null;
        const poolEligible   = document.getElementById('fPoolEligible')?.value !== 'false';
        const poolNotes      = document.getElementById('fPoolNotes')?.value || '';
        const notifyDonation = document.getElementById('fNotifyDonation')?.checked ?? true;
        const notifyEligibility = document.getElementById('fNotifyEligibility')?.checked ?? true;
        const centreId       = window._bbDocId || window._currentBBUser?.uid || '';
        const centreName     = window._bbData?.name || window._bbData?.organisationName || 'Blood Bank';

        // Find existing donor doc by phone or uid, then update/create
        const donorPayload = {
          name:               report.donorName,
          phone:              report.donorPhone,
          bloodGroup:         poolBG,
          verificationStatus: 'verified',
          verifiedDate:       poolVerDate,
          verifiedBy:         centreId,
          verifiedByCentre:   centreName,
          eligible:           poolEligible,
          nextEligibleDate:   poolNextDate,
          poolNotes:          poolNotes,
          notifyOnDonationCall: notifyDonation,
          notifyOnEligibility:  notifyEligibility,
          latestReportId:     null, // filled below
          updatedAt:          serverTimestamp(),
        };

        try {
          let donorDocId = report.donorUid || null;
          // If no UID, try to find by phone
          if (!donorDocId) {
            const phoneQ = query(collection(db,'donors'), where('phone','==', report.donorPhone));
            const phoneSnap = await getDocs(phoneQ);
            if (!phoneSnap.empty) donorDocId = phoneSnap.docs[0].id;
          }
          if (donorDocId) {
            await updateDoc(doc(db,'donors', donorDocId), donorPayload);
          } else {
            const newDonor = await addDoc(collection(db,'donors'), { ...donorPayload, createdAt: serverTimestamp() });
            donorDocId = newDonor.id;
          }

          // Send a notification to donor if they have a uid
          if (notifyDonation && report.donorUid) {
            await addDoc(collection(db,'notifications', report.donorUid, 'items'), {
              title: `✅ You've been added to the Verified Donor Pool`,
              body:  `${centreName} has verified your blood group (${poolBG}) and added you to their donor pool. They may contact you when your blood is needed.`,
              type:  'pool_added',
              read:  false,
              centreId,
              createdAt: serverTimestamp(),
            });
          }

          const auditEl=document.getElementById('auditList');
          if(auditEl) auditEl.insertAdjacentHTML('afterbegin',`<div class="audit-entry"><div class="audit-icon" style="background:var(--primary-soft);color:var(--primary)"><i class="fa-solid fa-user-check"></i></div><div><div class="audit-text"><strong>Added to Verified Pool</strong> — ${report.donorName} (${poolBG}) · Eligible: ${poolEligible?'Yes':'No'}${poolNextDate?' · Next eligible: '+poolNextDate:''}</div><div class="audit-time">Just now</div></div></div>`);

        } catch(poolErr) {
          console.error('Pool save error:', poolErr);
          if(window.showToast) window.showToast('⚠️ Report sent but pool update failed: ' + poolErr.message);
        }
      }
      const auditEl=document.getElementById('auditList');
      if(auditEl) auditEl.insertAdjacentHTML('afterbegin',`<div class="audit-entry"><div class="audit-icon" style="background:rgba(139,92,246,.12);color:var(--purple)"><i class="fa-solid fa-flask-vial"></i></div><div><div class="audit-text"><strong>Lab Report Finalised &amp; Sent</strong> — ${report.donorName} (${report.bloodGroup}) &nbsp;·&nbsp; HIV: ${report.hiv} &nbsp;·&nbsp; Hep-B: ${report.hepatitisB} &nbsp;·&nbsp; Hb: ${report.hemoglobin} g/dL &nbsp;·&nbsp; Authorised by ${report.finalisedBy}</div><div class="audit-time">Just now · Pushed to donor's Medical Resume</div></div></div>`);
      if(window._currentFinaliseApptId){try{await updateDoc(doc(db,'appointments',window._currentFinaliseApptId),{status:'completed',completedAt:serverTimestamp()});}catch(e){console.warn('Could not mark appointment completed:',e);}}
      document.getElementById('finaliseModalOverlay').classList.remove('open');
      document.body.style.overflow='';
      const addedToPool = document.getElementById('fAddToPool')?.checked;
      if(window.showToast) window.showToast(
        addedToPool
          ? `✅ Report sent & ${report.donorName} added to Verified Donor Pool`
          : `✅ Full report sent to ${report.donorName}'s Medical Resume`
      );
    }catch(err){console.error(err);if(window.showToast) window.showToast('❌ Failed to send. Check connection.');}
    finally{btn.innerHTML='<i class="fa-solid fa-paper-plane"></i> Finalise &amp; Send to Donor';btn.disabled=false;}
  };

  // ── Toggle Section 6 donor pool panel ───────────────────
  window.toggleDonorPoolSection = () => {
    const cb      = document.getElementById('fAddToPool');
    const section = document.getElementById('donorPoolSection');
    const wrap    = document.getElementById('addToPoolToggleWrap');
    if (!cb || !section) return;
    // Toggle checkbox if called from wrapper click (not directly from checkbox)
    const isChecked = cb.checked;
    section.style.display = isChecked ? '' : 'none';
    if (wrap) {
      wrap.style.borderColor = isChecked ? 'var(--primary)' : '';
      wrap.style.background  = isChecked ? 'rgba(29,158,117,.06)' : '';
    }
    // Sync next eligible date from report field
    if (isChecked) {
      const reportNextDate = document.getElementById('fNextEligibleDate')?.value;
      const poolNextEl     = document.getElementById('fPoolNextDate');
      if (poolNextEl && reportNextDate && !poolNextEl.value) poolNextEl.value = reportNextDate;
      const poolBGSel = document.getElementById('fPoolBloodGroup');
      const reportBG  = document.getElementById('fBloodGroup')?.value;
      if (poolBGSel && reportBG && !poolBGSel.value) poolBGSel.value = reportBG;
    }
  };

  // ── Render appointment/verification tables ────────────────
  window.renderAppointments = function(appointments) {
    const tbody=document.getElementById('apptTableBody'),badge=document.getElementById('apptNavBadge');
    if(!tbody) return;
    const pendingCount=appointments.filter(a=>a.status==='pending').length;
    if(badge){badge.textContent=pendingCount;badge.style.display=pendingCount?'':'none';}
    if(!appointments.length){tbody.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)"><i class="fa-solid fa-calendar-xmark" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>No appointments yet</td></tr>`;return;}
    const statusChip={pending:'chip-warn',confirmed:'chip-ok',cancelled:'chip-danger'};
    tbody.innerHTML=appointments.map(a=>`<tr><td style="padding:12px"><div style="font-weight:700;color:var(--text-primary)">${a.donorName||'—'}</div><div style="font-size:11px;color:var(--text-muted)">${a.donorPhone||''}</div></td><td style="padding:12px;font-weight:800;color:var(--danger)">${a.donorBloodGroup||'—'}</td><td style="padding:12px">${a.type==='donation'?'🩸 Donation':'🧪 Screening'}</td><td style="padding:12px"><div style="font-weight:700">${a.date||'—'}</div><div style="font-size:11px;color:var(--text-muted)">${a.timeSlot||''}</div></td><td style="padding:12px"><span class="chip ${statusChip[a.status]||'chip-warn'}">${a.status}</span></td><td style="padding:12px;font-size:12px;color:var(--text-muted)">${a.notes||'—'}</td><td style="padding:12px"><div style="display:flex;gap:6px">${a.status==='pending'?`<button class="btn-primary" style="font-size:11px;padding:4px 12px;border-radius:7px" onclick="acceptAppointment('${a.id}',this)"><i class="fa-solid fa-check"></i> Accept</button><button class="btn-ghost" style="font-size:11px;padding:4px 10px;border-radius:7px;border-color:var(--danger);color:var(--danger)" onclick="rejectAppointment('${a.id}',this)"><i class="fa-solid fa-xmark"></i></button>`:a.status==='confirmed'?`<button class="btn-primary" style="font-size:11px;padding:4px 12px;border-radius:7px" onclick="openFinaliseModal('${a.donorName}','${a.donorPhone}','${a.donorBloodGroup}','${a.id}')"><i class="fa-solid fa-file-medical"></i> Finalise</button>`:'—'}</div></td></tr>`).join('');
  };

  window.renderDonationRequests = function(donations) {
    const tbody=document.getElementById('requestBody'); if(!tbody) return;
    const badge=document.getElementById('requestNavBadge');
    const pendingCount=donations.filter(d=>d.status==='pending').length;
    if(badge){badge.textContent=pendingCount;badge.style.display=pendingCount?'':'none';}
    if(!donations.length){tbody.innerHTML=`<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)"><i class="fa-solid fa-droplet" style="font-size:24px;display:block;margin-bottom:8px;opacity:.4"></i>No donation requests yet</td></tr>`;return;}
    const urgencyColor={pending:'chip-warn',confirmed:'chip-ok',cancelled:'chip-danger',completed:'chip-ok'};
    tbody.innerHTML=donations.map(d=>`<tr><td style="font-size:12px;font-weight:700;color:var(--text-muted)">${d.id.slice(0,8).toUpperCase()}</td><td style="font-weight:600"><div>${d.donorName||'—'}</div><div style="font-size:11px;color:var(--text-muted)">${d.donorPhone||''}</div></td><td><span style="font-size:15px;font-weight:900;color:var(--danger)">${d.donorBloodGroup||'—'}</span></td><td style="font-weight:700">${d.donationType||'Whole Blood'}</td><td><span class="chip chip-warn" style="font-size:11px">${d.date||'—'} · ${d.timeSlot||''}</span></td><td><span class="chip ${urgencyColor[d.status]||'chip-warn'}">${d.status}</span></td><td style="color:var(--text-muted);font-size:12px">${d.notes||'—'}</td><td><div style="display:flex;gap:6px">${d.status==='pending'?`<button class="btn-primary" style="font-size:11px;padding:4px 12px;border-radius:7px" onclick="acceptAppointment('${d.id}',this)"><i class="fa-solid fa-check"></i> Accept</button><button class="btn-ghost" style="font-size:11px;padding:4px 10px;border-radius:7px;border-color:var(--danger);color:var(--danger)" onclick="rejectAppointment('${d.id}',this)"><i class="fa-solid fa-xmark"></i></button>`:d.status==='confirmed'?`<button class="btn-primary" style="font-size:11px;padding:4px 12px;border-radius:7px" onclick="openFinaliseModal('${d.donorName}','${d.donorPhone}','${d.donorBloodGroup}','${d.id}')"><i class="fa-solid fa-file-medical"></i> Finalise</button>`:'—'}</div></td></tr>`).join('');
  };

  // ── Storage tabs ──────────────────────────────────────────
  window.switchTab = (btn, tab) => {
    document.querySelectorAll('.storage-tabs .stab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ['upload','view','update','export'].forEach(t=>{ const el=document.getElementById('tab-'+t); if(el) el.style.display=t===tab?'':'none'; });
  };

  // ── Upload / Export stubs ─────────────────────────────────
  window.selectUploadType = (el, label) => {
    document.querySelectorAll('.upload-type-btn').forEach(b=>b.classList.remove('selected'));
    el.classList.add('selected');
    const ul=document.getElementById('uploadTypeLabel'); if(ul) ul.textContent=`Uploading: ${label} · PDF, Excel or Word · Max 50 MB`;
  };
  window.handleFileSelect = (e) => {
    const wrap=document.getElementById('uploadedFiles');
    wrap.innerHTML=Array.from(e.target.files).map(f=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;margin-bottom:8px"><i class="fa-solid fa-file" style="color:var(--primary)"></i><span style="font-size:13px;font-weight:600;flex:1">${f.name}</span><span style="font-size:11px;color:var(--text-muted)">${(f.size/1024/1024).toFixed(2)} MB</span></div>`).join('');
  };
  window.simulateUpload = () => { if(window.showToast) window.showToast('✅ Files uploaded successfully'); };
  window.simulateExport = (name) => { if(window.showToast) window.showToast(`⬇️ Generating ${name}…`); };
  const uploadZone=document.getElementById('uploadZone');
  if(uploadZone){
    uploadZone.addEventListener('dragover',e=>{e.preventDefault();uploadZone.classList.add('drag-over');});
    uploadZone.addEventListener('dragleave',()=>uploadZone.classList.remove('drag-over'));
    uploadZone.addEventListener('drop',e=>{e.preventDefault();uploadZone.classList.remove('drag-over');if(window.showToast) window.showToast('✅ File dropped!');});
  }
  const attachDz=document.getElementById('attachDropZone');
  if(attachDz){
    attachDz.addEventListener('dragover',e=>{e.preventDefault();attachDz.style.borderColor='var(--primary)';attachDz.style.background='var(--primary-soft)';});
    attachDz.addEventListener('dragleave',()=>{if(!window._attachedFile){attachDz.style.borderColor='';attachDz.style.background='';}});
    attachDz.addEventListener('drop',e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file){const dt=new DataTransfer();dt.items.add(file);document.getElementById('fAttachFile').files=dt.files;window.handleAttachFile(document.getElementById('fAttachFile'));}});
  }

  // ── Nav routing (B5 B9: no profile/storage in sections) ──
  const sections=['overview','inventory','requests','donors','appointments','settings'];
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',e=>{
      e.preventDefault(); const sec=item.dataset.section; if(!sec) return;
      document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
      sections.forEach(s=>{ const el=document.getElementById('sec-'+s); if(el) el.style.display=s===sec?'':'none'; });
    });
  });

  // ── Theme toggle ──────────────────────────────────────────
  const themeBtn=document.getElementById('themeToggle');
  if(themeBtn) themeBtn.addEventListener('click',()=>{
    const isDark=document.documentElement.getAttribute('data-theme')==='dark';
    document.documentElement.setAttribute('data-theme',isDark?'light':'dark');
    themeBtn.innerHTML=isDark?'<i class="fa-solid fa-moon"></i>':'<i class="fa-solid fa-sun"></i>';
  });


  // ── 3D Tilt ───────────────────────────────────────────────
  document.querySelectorAll('.cmd-card').forEach(card=>{
    card.addEventListener('mousemove',e=>{const r=card.getBoundingClientRect();card.style.transform=`perspective(800px) rotateX(${((e.clientY-r.top-r.height/2)/(r.height/2))*-3}deg) rotateY(${((e.clientX-r.left-r.width/2)/(r.width/2))*3}deg) translateY(-4px)`;});
    card.addEventListener('mouseleave',()=>{card.style.transition='transform 0.5s ease';card.style.transform='';});
    card.addEventListener('mouseenter',()=>{card.style.transition='none';});
  });

}); // end DOMContentLoaded
// ════════════════════════════════════════════════════════════
//  BROADCAST LISTENER — Blood Bank
// ════════════════════════════════════════════════════════════
(function _initBBBroadcastListener() {
  const ROLE = 'bloodbank';
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