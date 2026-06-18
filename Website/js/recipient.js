// ═══════════════════════════════════════════════════════════
//  recipient.js  —  Lifynk Recipient Dashboard
//  ES Module · All logic extracted from recipient-dashboard.html
// ═══════════════════════════════════════════════════════════

/* ── THEME ──────────────────────────────────────────────────── */
const html = document.documentElement;
const themeBtn = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('raktsetuTheme') || 'light';
html.setAttribute('data-theme', savedTheme);
themeBtn.innerHTML = savedTheme === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
themeBtn.addEventListener('click', () => {
  const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  localStorage.setItem('raktsetuTheme', next);
  themeBtn.innerHTML = next === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
});

/* ── COUNTER ────────────────────────────────────────────────── */
function animCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let cur = 0;
  const step = Math.ceil(target / 40);
  const tick = () => { cur = Math.min(cur + step, target); el.textContent = cur; if (cur < target) setTimeout(tick, 30); };
  setTimeout(tick, 300);
}
animCount('kpiTotal', 5); animCount('kpiFulfilled', 4); animCount('kpiActive', 1);

/* ── SPARKLINES ─────────────────────────────────────────────── */
function drawSparkline(id, data, color) {
  const svg = document.getElementById(id);
  if (!svg) return;
  const w = 100, h = 36, min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v,i) => { const x=(i/(data.length-1))*w; const y=h-((v-min)/(max-min||1))*(h-6)-3; return `${x},${y}`; }).join(' ');
  svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}22" stroke="none"/>`;
}
drawSparkline('sp1',[1,2,2,3,4,4,5],'#0d9488');
drawSparkline('sp2',[1,1,2,2,3,3,4],'#22c55e');
drawSparkline('sp3',[0,0,1,0,0,1,1],'#f59e0b');

/* ── HISTORY DATA ───────────────────────────────────────────── */
const historyData = [
  {id:'RS-2026-0317',bg:'B+', units:2,hospital:'Apollo, Satellite',date:'17 Mar 2026',urgency:'High',    status:'active',    donor:'Manish Patel'},
  {id:'RS-2026-0201',bg:'B+', units:1,hospital:'CIMS, SG Road',    date:'01 Feb 2026',urgency:'Normal',  status:'fulfilled', donor:'Kavya Reddy'},
  {id:'RS-2025-1105',bg:'B+', units:2,hospital:'Sterling Hospital', date:'05 Nov 2025',urgency:'High',   status:'fulfilled', donor:'Arun Kumar'},
  {id:'RS-2025-0820',bg:'AB+',units:1,hospital:'Civil Hospital',    date:'20 Aug 2025',urgency:'Critical',status:'fulfilled',donor:'Dev Patel'},
  {id:'RS-2025-0312',bg:'B+', units:1,hospital:'SAL Hospital',      date:'12 Mar 2025',urgency:'Normal', status:'fulfilled', donor:'Sunita Joshi'},
];
const statusConf = {
  active:   {label:'In Progress',color:'var(--warn)',   dot:'#f59e0b'},
  fulfilled:{label:'Fulfilled',  color:'var(--ok)',     dot:'#22c55e'},
  pending:  {label:'Pending',    color:'var(--danger)', dot:'#e11d48'},
};
function renderHistory(tbodyId) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.innerHTML = historyData.map(r => {
    const s  = statusConf[r.status];
    const uc = r.urgency==='Critical'?'chip-danger':r.urgency==='High'?'chip-warn':'chip-ok';
    return `<tr>
      <td style="font-weight:700;color:var(--primary);font-size:12px">${r.id}</td>
      <td><span style="font-size:15px;font-weight:900;color:var(--danger)">${r.bg}</span></td>
      <td style="font-weight:700">${r.units}u</td>
      <td>${r.hospital}</td>
      <td style="color:var(--text-muted);font-size:12px">${r.date}</td>
      <td><span class="chip ${uc}">${r.urgency}</span></td>
      <td><span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600"><span style="width:7px;height:7px;border-radius:50%;background:${s.dot};display:inline-block"></span>${s.label}</span></td>
      <td style="font-weight:600">${r.donor}</td>
    </tr>`;
  }).join('');
}
renderHistory('historyBodyOv');
renderHistory('historyBodyFull');

/* ── DONORS ─────────────────────────────────────────────────── */
const donors = [
  {name:'Manish Patel', bg:'B+', km:'1.2',badge:'Platinum',bc:'#8b5cf6',verified:true, last:'Jan 2026'},
  {name:'Kavya Reddy',  bg:'B+', km:'2.8',badge:'Gold',    bc:'#f59e0b',verified:true, last:'Dec 2025'},
  {name:'Arun Kumar',   bg:'B+', km:'3.4',badge:'Silver',  bc:'#94a3b8',verified:true, last:'Nov 2025'},
  {name:'Sunita Joshi', bg:'B−', km:'4.1',badge:'Gold',    bc:'#f59e0b',verified:true, last:'Feb 2026'},
  {name:'Dev Patel',    bg:'AB+',km:'4.9',badge:'Silver',  bc:'#94a3b8',verified:false,last:'Oct 2025'},
];
function renderDonors(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = donors.map(d => {
    const init = d.name.split(' ').map(w=>w[0]).join('').slice(0,2);
    const vBadge = d.verified
      ? `<span class="donor-verified verified"><i class="fa-solid fa-shield-check" style="font-size:9px"></i>NGO Verified</span>`
      : `<span class="donor-verified unverified"><i class="fa-solid fa-clock" style="font-size:9px"></i>Pending</span>`;
    return `<div class="donor-card">
      <div class="donor-av">${init}</div>
      <div style="flex:1"><div class="donor-name">${d.name} ${vBadge}</div><div class="donor-meta"><span style="color:var(--danger);font-weight:800">${d.bg}</span> · ${d.km} km · <span style="color:${d.bc};font-weight:700">${d.badge}</span> · Last ${d.last}</div></div>
      <button class="btn-primary" style="font-size:11px;padding:6px 12px;flex-shrink:0"><i class="fa-solid fa-phone"></i> Contact</button>
    </div>`;
  }).join('');
}
renderDonors('donorListOv');
renderDonors('donorListFull');

/* ── CAMPS FULL ─────────────────────────────────────────────── */
const camps = [
  {day:'22',mon:'Mar',color:'var(--primary)',name:'Red Cross Blood Drive',loc:'Silver Oak University · 1.2 km',groups:['B+','B−','All Groups'],btn:'Register',primary:true},
  {day:'05',mon:'Apr',color:'var(--purple)',name:'City Civil NGO Camp',loc:'Law Garden · 3.8 km',groups:['O−','B−'],btn:'Remind',primary:false},
  {day:'12',mon:'Apr',color:'var(--orange)',name:'SBT Mega Blood Camp',loc:'CIMS Hospital · 5.1 km',groups:['All Groups'],btn:'Remind',primary:false},
  {day:'20',mon:'Apr',color:'var(--primary)',name:'Apollo Hospital Drive',loc:'Apollo Hospital, Satellite · 6.8 km',groups:['All Groups'],btn:'Remind',primary:false},
];
const cf = document.getElementById('campsFull');
if (cf) cf.innerHTML = camps.map(c => `
  <div class="r-card" style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
    <div style="width:52px;height:52px;border-radius:10px;background:${c.color};display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">
      <div style="font-size:18px;font-weight:800;color:#fff;line-height:1">${c.day}</div>
      <div style="font-size:9px;color:rgba(255,255,255,.8);font-weight:700;text-transform:uppercase">${c.mon}</div>
    </div>
    <div style="flex:1"><div style="font-size:14px;font-weight:700;color:var(--text-primary)">${c.name}</div><div style="font-size:12px;color:var(--text-muted);margin-top:3px"><i class="fa-solid fa-location-dot" style="color:var(--primary);font-size:10px;margin-right:4px"></i>${c.loc}</div><div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">${c.groups.map(g=>`<span class="chip chip-teal" style="font-size:10px;padding:2px 7px">${g}</span>`).join('')}</div></div>
    <button class="${c.primary?'btn-primary':'btn-ghost'}" style="font-size:12px;padding:8px 14px;flex-shrink:0" onclick="showToast('✅ ${c.btn === 'Register' ? 'Registered!' : 'Reminder set!'}')">${c.btn}</button>
  </div>`).join('');

/* ── NAV ROUTING ────────────────────────────────────────────── */
const sections = ['overview','active','history','donors','camps','profile','settings'];
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const sec = item.dataset.section;
    if (!sec) return;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    sections.forEach(s => { const el = document.getElementById('sec-'+s); if(el) el.style.display = s===sec?'':'none'; });
  });
});

/* ── MODAL ──────────────────────────────────────────────────── */
function openRequestModal() { document.getElementById('requestModalOverlay').classList.add('open'); }
function closeRequestModal(e) { if (!e || e.target === document.getElementById('requestModalOverlay')) document.getElementById('requestModalOverlay').classList.remove('open'); }

function submitRequest() {
  const p = document.getElementById('reqPatient').value.trim();
  const bg = document.getElementById('reqBloodGroup').value;
  const u = document.getElementById('reqUnits').value;
  const urg = document.getElementById('reqUrgency').value;
  const h = document.getElementById('reqHospital').value.trim();
  const ph = document.getElementById('reqPhone').value.trim();
  if (!p || !bg || !u || !urg || !h || !ph) { showToast('⚠️ Please fill all required fields', true); return; }
  const btn = document.getElementById('submitReqBtn');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…'; btn.disabled = true;
  setTimeout(() => {
    closeRequestModal();
    showToast('🩸 Request submitted! NGO will review shortly.');
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Request'; btn.disabled = false;
  }, 1200);
}

/* ── TOAST ──────────────────────────────────────────────────── */
function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.style.background = isError ? 'var(--danger)' : 'var(--primary)';
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}

/* ── 3D TILT ────────────────────────────────────────────────── */
document.querySelectorAll('.r-card,.request-hero').forEach(card => {
  card.addEventListener('mousemove', e => { const r=card.getBoundingClientRect(); card.style.transform=`perspective(800px) rotateX(${((e.clientY-r.top-r.height/2)/(r.height/2))*-3}deg) rotateY(${((e.clientX-r.left-r.width/2)/(r.width/2))*3}deg) translateY(-4px)`; });
  card.addEventListener('mouseleave', () => { card.style.transition='transform 0.5s ease'; card.style.transform=''; });
  card.addEventListener('mouseenter', () => { card.style.transition='none'; });
});


  import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
  import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
  const _app  = initializeApp({ apiKey:"AIzaSyC-HnJq3DU9wc3DpvSGQM3OWfxwUwThPT8",authDomain:"lifynk.firebaseapp.com",projectId:"lifynk",storageBucket:"lifynk.firebasestorage.app",messagingSenderId:"658656685385",appId:"1:658656685385:web:1a02d664f685a7049a7e98" });
  const _db   = getFirestore(_app);
  const _auth = getAuth(_app);
  let _authResolved = false;
  onAuthStateChanged(_auth, async (user) => {
    if (!user) {
      if (_authResolved) { window.location.href = '../login.html'; }
      else { setTimeout(() => { if (!_auth.currentUser) window.location.href = '../login.html'; }, 2000); }
      return;
    }
    _authResolved = true;
    try {
      const snap = await getDoc(doc(_db, 'recipients', user.uid));
      if (snap.exists()) {
        const d    = snap.data();
        const name = d.name || user.email?.split('@')[0] || 'Recipient';
        const city = d.city || '';
        const bg   = d.bloodGroup || '';
        const av   = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e11d48&color=fff&size=80`;
        const sn = document.getElementById('sidebarName');   if(sn) sn.textContent = name;
        const sr = document.getElementById('sidebarRole');   if(sr) sr.textContent = bg ? bg + (city ? ' · ' + city : '') : city;
        const sa = document.getElementById('sidebarAvatar'); if(sa) sa.src = av;
        const ha = document.getElementById('headerAvatar');  if(ha) ha.src = av;
        const hs = document.getElementById('headerSubtitle');if(hs) hs.textContent = city ? name + ', ' + city : name;
      }
    } catch(e) { console.warn('Profile fetch:', e); }
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
      window.location.href = '../login.html';
    });
  }

  // ── Cache instant display ───────────────────────────────────
  const _cached = JSON.parse(localStorage.getItem('lifynkRecipientUser') || '{}');
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
    formData.append('upload_preset', 'lifynk_profiles');
    formData.append('folder', 'profile_photos');
    const res  = await fetch('https://api.cloudinary.com/v1_1/duxukomd3/image/upload', { method:'POST', body: formData });
    const data = await res.json();
    if (!data.secure_url) throw new Error('Upload failed');
    const url = data.secure_url;
    // Save to Firestore
    const user = _auth.currentUser;
    if (user) {
      await updateDoc(doc(_db, 'recipients', user.uid), { photoUrl: url });
      // Update cache
      try {
        const c = JSON.parse(localStorage.getItem('lifynkRecipientUser') || '{}');
        c.photoUrl = url;
        localStorage.setItem('lifynkRecipientUser', JSON.stringify(c));
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
//  RECIPIENT NOTIFICATIONS — Real-time + Sound
//  Triggers: nearby camps, blood banks, verified donors,
//            request accepted, org-pushed notifications
// ════════════════════════════════════════════════════════════

// ── Audio context (satisfies browser autoplay policy) ────────
let _rAudioCtx = null;
document.addEventListener('click', () => {
  if (!_rAudioCtx) _rAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_rAudioCtx.state === 'suspended') _rAudioCtx.resume();
}, { once: false });

function _playRecipientNotifSound() {
  try {
    if (!_rAudioCtx) _rAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_rAudioCtx.state === 'suspended') _rAudioCtx.resume();
    // Two-tone pleasant ping (higher pitch than donor's)
    const freqs = [1046, 1318]; // C6 → E6
    freqs.forEach((freq, i) => {
      const o = _rAudioCtx.createOscillator();
      const g = _rAudioCtx.createGain();
      o.connect(g); g.connect(_rAudioCtx.destination);
      o.type = 'sine';
      o.frequency.value = freq;
      const start = _rAudioCtx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.14, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.38);
      o.start(start); o.stop(start + 0.4);
    });
  } catch(e) {}
}

// ── Notification panel toggle ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const btn   = document.getElementById('recipientNotifBtn');
  const panel = document.getElementById('recipientNotifPanel');
  if (!btn || !panel) return;

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    panel.style.top   = (rect.bottom + 8) + 'px';
    panel.style.right = (window.innerWidth - rect.right) + 'px';
    panel.style.left  = 'auto';
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', e => {
    if (!panel.contains(e.target) && e.target !== btn) panel.style.display = 'none';
  });
});

// ── Core: render notification panel ──────────────────────────
let _rPrevNotifCount = 0;

function _renderRecipientNotifs(docs) {
  const list = document.getElementById('recipientNotifList');
  if (!list) return;
  if (!docs.length) {
    list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">
      <i class="fa-solid fa-bell-slash" style="display:block;margin-bottom:8px;font-size:22px;opacity:.4"></i>No new notifications</div>`;
    return;
  }
  const iconMap = {
    camp:     { icon: 'fa-tent',           color: '#f59e0b' },
    bloodbank:{ icon: 'fa-flask-vial',     color: '#3b82f6' },
    donor:    { icon: 'fa-droplet',        color: '#e11d48' },
    request:  { icon: 'fa-hand-holding-medical', color: '#0d9488' },
    general:  { icon: 'fa-bell',           color: '#8b5cf6' },
  };
  list.innerHTML = docs.map(d => {
    const n    = d.data ? d.data() : d;
    const id   = d.id || '';
    const type = n.type || 'general';
    const cfg  = iconMap[type] || iconMap.general;
    return `<div onclick="window.markRecipientNotifRead('${id}')"
      style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border-subtle);cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
      <div style="width:34px;height:34px;border-radius:9px;background:${cfg.color}22;color:${cfg.color};display:grid;place-items:center;flex-shrink:0;font-size:14px">
        <i class="fa-solid ${cfg.icon}"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:700;color:var(--text-primary);line-height:1.3">${n.title || 'Notification'}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;line-height:1.4">${n.body || ''}</div>
        ${n.city ? `<div style="font-size:11px;color:var(--primary);margin-top:3px;font-weight:600"><i class="fa-solid fa-location-dot" style="margin-right:3px"></i>${n.city}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ── Listen: Firestore notifications/{uid}/items (push notifs) ─
function _startRecipientNotifListener(uid) {
  // Import needed functions from already-initialized firebase instance
  const { collection, query, where, onSnapshot, updateDoc, doc, getDocs,
          addDoc, serverTimestamp } = window._firestoreSDK || {};

  // Fallback: use dynamic import since recipient.js re-initialises firebase
  Promise.all([
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
  ]).then(([fs]) => {
    const { collection, query, where, onSnapshot, updateDoc, doc,
            getDocs, addDoc, serverTimestamp } = fs;

    // ── 1. Real-time push notifications (admin / org-sent) ──
    const notifQ = query(
      collection(_db, 'notifications', uid, 'items'),
      where('read', '==', false)
    );
    onSnapshot(notifQ, snap => {
      const count = snap.size;
      const badge = document.getElementById('recipientNotifCount');
      const dot   = document.getElementById('recipientNotifDot');
      if (badge) { badge.textContent = count; badge.style.display = count ? 'inline-block' : 'none'; }
      if (dot)   dot.style.display = count ? '' : 'none';
      if (count > _rPrevNotifCount) _playRecipientNotifSound();
      _rPrevNotifCount = count;
      _renderRecipientNotifs(snap.docs);
    });

    // ── 2. Auto-generate contextual notifications on login ──
    _generateContextualNotifs(uid, { collection, query, where, getDocs, addDoc, serverTimestamp });
  });
}

// ── Generate smart contextual notifications ───────────────────
async function _generateContextualNotifs(uid, { collection, query, where, getDocs, addDoc, serverTimestamp }) {
  try {
    const recipSnap = await getDocs(query(collection(_db, 'recipients'), where('__name__', '==', uid)));
    if (recipSnap.empty) return;
    const recip = recipSnap.docs[0].data();
    const city  = (recip.city || '').toLowerCase().split(',')[0].trim();
    const bg    = recip.bloodGroup || '';

    // Check what notifications we already sent today (avoid duplicates)
    const todayKey = new Date().toISOString().split('T')[0];
    const sentKey  = `recipNotifsSent_${uid}_${todayKey}`;
    if (localStorage.getItem(sentKey)) return; // already generated today
    localStorage.setItem(sentKey, '1');

    const notifsToAdd = [];

    // ── Nearby verified donors matching blood group ──────────
    if (bg) {
      const compatible = {
        'O+':['O+','O-'],'O-':['O-'],'A+':['A+','A-','O+','O-'],'A-':['A-','O-'],
        'B+':['B+','B-','O+','O-'],'B-':['B-','O-'],
        'AB+':['A+','A-','B+','B-','O+','O-','AB+','AB-'],'AB-':['A-','B-','O-','AB-']
      };
      const compatibleGroups = compatible[bg] || [bg];
      for (const g of compatibleGroups.slice(0, 2)) {
        const donorsSnap = await getDocs(
          query(collection(_db, 'donors'),
            where('bloodGroup', '==', g),
            where('city', '>=', city.charAt(0).toUpperCase()),
          )
        ).catch(() => ({ docs: [] }));
        const nearby = donorsSnap.docs.filter(d => {
          const dc = (d.data().city || '').toLowerCase();
          return dc.includes(city) || city.includes(dc.split(',')[0].trim());
        });
        if (nearby.length > 0) {
          notifsToAdd.push({
            type: 'donor',
            title: `${nearby.length} verified ${g} donor${nearby.length > 1 ? 's' : ''} near you`,
            body: `Compatible donors available in ${recip.city || 'your city'}. Tap to view.`,
            city: recip.city || '',
            read: false,
            createdAt: serverTimestamp(),
          });
          break; // one donor notification is enough
        }
      }
    }

    // ── Nearby blood banks ───────────────────────────────────
    const bbSnap = await getDocs(
      query(collection(_db, 'bloodbanks'), where('status', '==', 'approved'))
    ).catch(() => ({ docs: [] }));
    const nearbyBBs = bbSnap.docs.filter(d => {
      const bc = (d.data().city || '').toLowerCase();
      return bc.includes(city) || city.includes(bc.split(',')[0].trim());
    });
    if (nearbyBBs.length > 0) {
      notifsToAdd.push({
        type: 'bloodbank',
        title: `${nearbyBBs.length} blood bank${nearbyBBs.length > 1 ? 's' : ''} registered near you`,
        body: nearbyBBs.slice(0, 2).map(d => d.data().bbname || d.data().name || 'Blood Bank').join(', ') + (nearbyBBs.length > 2 ? ' & more' : ''),
        city: recip.city || '',
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    // ── Upcoming camps in city ───────────────────────────────
    const campSnap = await getDocs(
      query(collection(_db, 'camps'), where('status', '==', 'active'))
    ).catch(() => ({ docs: [] }));
    const nearbyCamps = campSnap.docs.filter(d => {
      const cc = (d.data().city || d.data().location || '').toLowerCase();
      return cc.includes(city) || city.includes(cc.split(',')[0].trim());
    });
    if (nearbyCamps.length > 0) {
      const camp = nearbyCamps[0].data();
      const campDate = camp.campDate || camp.date ? new Date(camp.campDate || camp.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'soon';
      notifsToAdd.push({
        type: 'camp',
        title: `Blood camp near you on ${campDate}`,
        body: `${camp.campName || camp.name || 'Blood Drive'} at ${camp.location || camp.city || recip.city}`,
        city: recip.city || '',
        read: false,
        createdAt: serverTimestamp(),
      });
    }

    // ── Write all to Firestore ───────────────────────────────
    for (const n of notifsToAdd) {
      await addDoc(collection(_db, 'notifications', uid, 'items'), n);
    }
  } catch(e) {
    console.warn('Contextual notif generation error:', e);
  }
}

// ── Mark single notif read ────────────────────────────────────
window.markRecipientNotifRead = async (notifId) => {
  if (!notifId || !_auth?.currentUser) return;
  try {
    const { updateDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    await updateDoc(doc(_db, 'notifications', _auth.currentUser.uid, 'items', notifId), { read: true });
  } catch(e) {}
};

// ── Mark all read ─────────────────────────────────────────────
window.markAllRecipientNotifsRead = async () => {
  if (!_auth?.currentUser) return;
  try {
    const { collection, query, where, getDocs, updateDoc } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDocs(query(
      collection(_db, 'notifications', _auth.currentUser.uid, 'items'),
      where('read', '==', false)
    ));
    snap.forEach(d => updateDoc(d.ref, { read: true }));
    document.getElementById('recipientNotifPanel').style.display = 'none';
  } catch(e) {}
};

// ── Hook into existing onAuthStateChanged ─────────────────────
// We patch the existing auth listener to also start notifications
const _origOnAuth = window.__recipientAuthCb;
onAuthStateChanged(_auth, user => {
  if (user) _startRecipientNotifListener(user.uid);
});

// ════════════════════════════════════════════════════════════
//  BROADCAST LISTENER — Recipient
// ════════════════════════════════════════════════════════════
(function _initRecipientBroadcastListener() {
  const ROLE = 'recipient';
  let _init  = true;

  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js").then(({ onAuthStateChanged }) => {
    onAuthStateChanged(_auth, async user => {
      if (!user) return;
      const uid = user.uid;
      const { collection, query, where, onSnapshot, addDoc,
              serverTimestamp, orderBy, limit } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

      const bq = query(
        collection(_db, 'broadcasts'),
        where('targets', 'array-contains', ROLE),
        orderBy('sentAt', 'desc'),
        limit(20)
      );

      onSnapshot(bq, snap => {
        if (_init) { _init = false; return; }
        snap.docChanges().filter(c => c.type === 'added').forEach(async change => {
          const b = change.doc.data();
          await addDoc(collection(_db, 'notifications', uid, 'items'), {
            type: 'broadcast', priority: b.priority || 'normal',
            title: `📢 ${b.title || 'Announcement'}`, body: b.message || '',
            read: false, createdAt: serverTimestamp(),
          }).catch(() => {});
        });
      });
    });
  });
})();