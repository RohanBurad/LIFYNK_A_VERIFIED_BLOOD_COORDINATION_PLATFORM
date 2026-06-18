// ═══════════════════════════════════════════════════════
//  donor.js  —  Lifynk Donor Dashboard  (module)
//  Combines: Firebase module + DOMContentLoaded logic
//  Changes: D1 D2 D4 D5 D6 D7
// ═══════════════════════════════════════════════════════

import { auth, db } from './firebase.js';
import {
  collection, query, where, orderBy,
  getDocs, getDoc, doc, onSnapshot, addDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Module-level donor data (stays in sync with window) ──
let _donorData = {};

// ── Expose for inline HTML handlers ──────────────────────
window.db              = db;
window.auth            = auth;
window.getDoc          = getDoc;
window.doc             = doc;
window.updateDoc       = updateDoc;
window._donorData      = _donorData;

// ── Notification sound (D2) ──────────────────────────────
// Shared AudioContext — created once on first user interaction to satisfy browser autoplay policy
let _audioCtx = null;
document.addEventListener('click', () => {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
}, { once: false });

function _playNotifSound() {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') { _audioCtx.resume(); }
    const o = _audioCtx.createOscillator(), g = _audioCtx.createGain();
    o.connect(g); g.connect(_audioCtx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.35);
    o.start(); o.stop(_audioCtx.currentTime + 0.35);
  } catch(e) {}
}

// ── Haversine distance helper ─────────────────────────────
function _haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Geocode via Nominatim ─────────────────────────────────
async function _geocode(address) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
                             { headers:{ 'Accept-Language':'en' } });
    const data = await res.json();
    if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch(_) {}
  return null;
}

// ── Get browser GPS position ──────────────────────────────
function _getDonorPosition() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve(null), { timeout: 6000 }
    );
  });
}

// ── Load nearest blood bank centres for appointment modal ─
window._loadCentres = async () => {
  const select = document.getElementById('apptCentre');
  if (!select) return;
  select.innerHTML = `<option value="">📍 Detecting your location…</option>`;
  select.disabled  = true;
  try {
    const donorPos = await _getDonorPosition();
    const bbSnap   = await getDocs(query(collection(db, 'bloodbanks')));
    const rawBanks = bbSnap.docs.map(d => ({
      id: d.id, name: d.data().bbname || d.data().name || 'Blood Bank',
      city: d.data().city || '', lat: d.data().lat || null, lng: d.data().lng || null, type:'BloodBank'
    }));
    let banksWithDist = rawBanks;
    if (donorPos) {
      for (const bb of rawBanks) {
        if (bb.lat && bb.lng) continue;
        if (!bb.city) continue;
        const coords = await _geocode(bb.city);
        if (coords) { bb.lat = coords.lat; bb.lng = coords.lng; }
        await new Promise(r => setTimeout(r, 1100));
      }
      banksWithDist = rawBanks
        .map(bb => ({ ...bb, distKm: (bb.lat && bb.lng) ? _haversine(donorPos.lat, donorPos.lng, bb.lat, bb.lng) : Infinity }))
        .sort((a,b) => a.distKm - b.distKm).slice(0, 10);
    } else {
      banksWithDist = rawBanks.sort((a,b) => a.name.localeCompare(b.name)).slice(0, 10)
                              .map(bb => ({ ...bb, distKm: null }));
    }
    select.innerHTML = `<option value="">Select nearby centre</option>`;
    if (!banksWithDist.length) { select.innerHTML = `<option value="">No registered centres found</option>`; select.disabled=false; return; }
    const group = document.createElement('optgroup');
    group.label = donorPos ? `🏥 Top ${banksWithDist.length} Nearest Blood Banks` : '🏥 Registered Blood Banks';
    banksWithDist.forEach(bb => {
      const opt       = document.createElement('option');
      opt.value       = bb.id;
      opt.dataset.type = 'BloodBank';
      const dl = (bb.distKm != null && bb.distKm !== Infinity)
        ? ` · ${bb.distKm < 1 ? (bb.distKm*1000).toFixed(0)+' m' : bb.distKm.toFixed(1)+' km'}`
        : '';
      opt.textContent = `${bb.name}${dl} — ${bb.city}`;
      group.appendChild(opt);
    });
    select.appendChild(group);
  } catch(err) {
    console.error('Could not load centres:', err);
    select.innerHTML = `<option value="">Could not load centres — try again</option>`;
  } finally { select.disabled = false; }
};

// ── Save appointment to Firestore ─────────────────────────
window._saveAppointment = async (appointment) => {
  const docRef = await addDoc(collection(db, 'appointments'), {
    ...appointment, createdAt: serverTimestamp()
  });
  return docRef.id;
};

// ── Fetch finalised medical reports ──────────────────────
window._fetchMedicalReports = async (phone) => {
  const uid = window._currentUser?.uid || '';
  const q   = uid
    ? query(collection(db, 'medicalReports'), where('donorUid','==',uid), where('status','==','finalised'))
    : query(collection(db, 'medicalReports'), where('donorPhone','==',phone), where('status','==','finalised'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
};

// ── Real-time medical reports listener ───────────────────
window._listenMedicalReports = (phone, callback) => {
  const uid = window._currentUser?.uid || '';
  const q   = uid
    ? query(collection(db, 'medicalReports'), where('donorUid','==',uid), where('status','==','finalised'))
    : query(collection(db, 'medicalReports'), where('donorPhone','==',phone), where('status','==','finalised'));
  return onSnapshot(q, snap => {
    const reports = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    callback(reports);
  });
};

// ── PDF download — fixed alignment using table rows ──────
window.downloadReportPDF = (id, date) => {
    const reports = window._lastRenderedReports || [];
    const r = reports.find(x => x.id === id) || reports[0];
    if (!r) { showToast('⚠️ Report data not found'); return; }
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, ML = 14, MR = 196, CW = MR - ML;
    let y = 0;

    // ── Header bar ────────────────────────────────────────
    pdf.setFillColor(13, 148, 136);
    pdf.rect(0, 0, W, 30, 'F');
    pdf.setTextColor(255,255,255);
    pdf.setFontSize(16); pdf.setFont('helvetica','bold');
    pdf.text('Lifynk — Medical Lab Report', ML, 12);
    pdf.setFontSize(8); pdf.setFont('helvetica','normal');
    pdf.text(`${r.bloodBank || 'Blood Bank'} · Finalised by: ${r.finalisedBy || '—'}`, ML, 20);
    pdf.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, MR, 20, {align:'right'});
    y = 38;

    // ── Helper: section title bar ─────────────────────────
    const sectionBar = (title, rgb) => {
      pdf.setFillColor(...rgb);
      pdf.roundedRect(ML, y, CW, 8, 1, 1, 'F');
      pdf.setTextColor(255,255,255);
      pdf.setFontSize(8); pdf.setFont('helvetica','bold');
      pdf.text(title, ML + 3, y + 5.5);
      y += 12;
      pdf.setTextColor(30,41,59);
    };

    // ── Helper: 2-column key-value row ────────────────────
    const kv = (label, value, x, rowY, colW) => {
      pdf.setFontSize(8); pdf.setFont('helvetica','bold');
      pdf.setTextColor(100,116,139);
      pdf.text(label, x, rowY);
      pdf.setFont('helvetica','normal');
      pdf.setTextColor(15,23,42);
      const val = String(value || '—');
      pdf.text(val, x + colW * 0.42, rowY);
    };

    // ── Helper: table row pair ────────────────────────────
    const rowPair = (l1, v1, l2, v2) => {
      const half = CW / 2;
      kv(l1, v1, ML,          y, half);
      kv(l2, v2, ML + half,   y, half);
      y += 6.5;
    };

    // ── Helper: TTI chip row ──────────────────────────────
    const ttiRow = (items) => {
      const colW = CW / 3;
      items.forEach((item, i) => {
        const x = ML + (i % 3) * colW;
        const ok = item.v === 'Non-Reactive' || item.v === 'Negative' || item.v === 'Not Done' || !item.v;
        pdf.setFillColor(ok ? 240 : 254, ok ? 253 : 226, ok ? 244 : 226);
        pdf.roundedRect(x + 1, y - 4, colW - 3, 7, 1, 1, 'F');
        pdf.setTextColor(ok ? 5 : 153, ok ? 150 : 27, ok ? 105 : 40);
        pdf.setFontSize(7.5); pdf.setFont('helvetica','bold');
        pdf.text(`${ok ? '✓' : '✗'} ${item.l}: ${item.v || 'Not Done'}`, x + 3, y + 0.5);
        if (i % 3 === 2) y += 9;
      });
      y += 9;
    };

    // ─── SECTION 1: Donor Info ────────────────────────────
    sectionBar('DONOR INFORMATION', [13,148,136]);
    rowPair('Name',        r.donorName || '—',   'Blood Group', r.bloodGroup || '—');
    rowPair('Phone',       r.donorPhone || '—',  'Lifynk ID',   r.donorLifynkId || '—');
    rowPair('Donation Date', r.donationDate || '—', 'Donation Type', r.donationType || 'Whole Blood');
    y += 4;

    // ─── SECTION 2: Blood Grouping ────────────────────────
    sectionBar('SECTION 1 — BLOOD GROUPING', [59,130,246]);
    rowPair('ABO Group', r.aboGroup || '—',  'Rh Typing',   r.rhTyping || '—');
    rowPair('Confirmed Blood Group', r.bloodGroup || '—', 'Antibody Screening', r.antibodyScreening || 'Not Done');
    y += 4;

    // ─── SECTION 3: TTI Screening ─────────────────────────
    sectionBar('SECTION 2 — TTI SCREENING', [139,92,246]);
    ttiRow([
      {l:'HIV 1&2',    v:r.hiv},
      {l:'Hepatitis B',v:r.hepatitisB},
      {l:'Hepatitis C',v:r.hepatitisC},
      {l:'Syphilis',   v:r.syphilis},
      {l:'Malaria',    v:r.malaria},
      {l:'NAT',        v:r.nat||'Not Done'},
    ]);
    y += 2;

    // ─── SECTION 4: Hematology ────────────────────────────
    sectionBar('SECTION 3 — HEMATOLOGY', [249,115,22]);
    rowPair('Hemoglobin', r.hemoglobin ? `${r.hemoglobin} g/dL` : '—', 'PCV / HCT', r.pcv ? `${r.pcv}%` : '—');
    rowPair('Lab Technician', r.labTechnician || '—', 'Authorised By', r.finalisedBy || '—');
    y += 4;

    // ─── SECTION 5: Eligibility ───────────────────────────
    sectionBar('SECTION 4 — ELIGIBILITY & REMARKS', [225,29,72]);
    const eligible = r.donationEligible;
    const eligText = eligible==='yes'?'✓ Eligible to Donate': eligible==='no'?'✗ Not Eligible — Consult Doctor': 'Pending Review';
    const eligRgb  = eligible==='yes'?[5,150,105]: eligible==='no'?[153,27,27]:[100,116,139];
    pdf.setFontSize(9); pdf.setFont('helvetica','bold');
    pdf.setTextColor(...eligRgb);
    pdf.text(eligText, ML, y); y += 7;
    if (r.nextEligibleDate) {
      pdf.setFontSize(8); pdf.setFont('helvetica','normal'); pdf.setTextColor(100,116,139);
      pdf.text(`Next eligible donation date: ${new Date(r.nextEligibleDate).toLocaleDateString('en-IN')}`, ML, y); y += 7;
    }
    if (r.temporaryDeferral) {
      pdf.setFontSize(8); pdf.setFont('helvetica','normal'); pdf.setTextColor(180,83,9);
      pdf.text(`Temporary Deferral: ${r.temporaryDeferral}`, ML, y); y += 7;
    }
    if (r.notes) {
      pdf.setFontSize(8); pdf.setFont('helvetica','italic'); pdf.setTextColor(100,116,139);
      const lines = pdf.splitTextToSize(`Notes: ${r.notes}`, CW);
      pdf.text(lines, ML, y); y += lines.length * 5 + 4;
    }

    // ─── Footer ───────────────────────────────────────────
    pdf.setDrawColor(226,232,240); pdf.line(ML, y+2, MR, y+2); y += 8;
    pdf.setFontSize(7.5); pdf.setFont('helvetica','normal'); pdf.setTextColor(148,163,184);
    pdf.text('Generated by Lifynk · lifynk.firebaseapp.com · This is a digitally authorised system-generated report.', ML, y);

    pdf.save(`LifynkReport_${r.donorName||'Donor'}_${r.donationDate||date}.pdf`);
    showToast('✅ PDF downloaded');
};

// ── D4: Load completed donations from Firestore ──────────
async function loadDonationsFromFirestore(uid) {
  const histBody = document.getElementById('historyBody');
  const donBody  = document.getElementById('donationsBody');
  const loadHtml = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</td></tr>`;
  if (histBody) histBody.innerHTML = loadHtml;
  if (donBody)  donBody.innerHTML  = loadHtml;
  try {
    const q    = query(collection(db,'appointments'), where('donorUid','==',uid), where('status','==','completed'));
    const snap = await getDocs(q);
    const donations = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      .sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    // Update KPI cards
    const totalEl  = document.getElementById('totalDonations');
    const livesEl  = document.getElementById('livesSaved');
    const pointsEl = document.getElementById('impactPoints');
    if (totalEl)  totalEl.textContent  = donations.length;
    if (livesEl)  livesEl.textContent  = donations.length;
    if (pointsEl) pointsEl.textContent = (donations.length * 5).toLocaleString();

    if (!donations.length) {
      const emp = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)"><i class="fa-solid fa-heart" style="display:block;font-size:24px;margin-bottom:8px;opacity:.4"></i>No completed donations yet</td></tr>`;
      if (histBody) histBody.innerHTML = emp;
      if (donBody)  donBody.innerHTML  = emp;
      return;
    }
    const cls = { 'Whole Blood':'hb-whole','Platelets':'hb-platelets','Plasma':'hb-plasma' };
    const rows = donations.map(d => {
      const date = d.date || (d.createdAt?.toDate ? d.createdAt.toDate().toLocaleDateString('en-IN') : '—');
      const type = d.donationType || 'Whole Blood';
      return `<tr>
        <td>${date}</td>
        <td><span class="history-badge ${cls[type]||'hb-whole'}">${type}</span></td>
        <td>${d.centreName || '—'}</td>
        <td style="font-weight:700">1u</td>
        <td>${d.centreName || '—'}</td>
        <td style="font-weight:700;color:var(--primary)">+5</td>
        <td><span class="chip chip-ok"><i class="fa-solid fa-check"></i> Completed</span></td>
      </tr>`;
    }).join('');
    if (histBody) histBody.innerHTML = rows;
    if (donBody)  donBody.innerHTML  = rows;
  } catch(err) {
    console.error('Donations load error:', err);
    const e = `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">Could not load donations</td></tr>`;
    if (histBody) histBody.innerHTML = e;
    if (donBody)  donBody.innerHTML  = e;
  }
}

// ── D5: Load leaderboard from Firestore donors collection ─
async function loadLeaderboard(currentUid) {
  const lb = document.getElementById('leaderboard');
  if (!lb) return;
  lb.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>';
  try {
    const q    = query(collection(db, 'donors'), orderBy('totalDonations', 'desc'));
    const snap = await getDocs(q);
    if (snap.empty) {
      lb.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px"><i class="fa-solid fa-trophy" style="display:block;font-size:28px;margin-bottom:8px;opacity:.4"></i>No donors on the leaderboard yet</div>';
      return;
    }
    lb.innerHTML = snap.docs.slice(0,10).map((d, i) => {
      const l    = d.data();
      const rank = i + 1;
      const isYou = d.id === currentUid;
      const pts  = ((l.totalDonations || 0) * 5).toLocaleString();
      const medal = rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : '#' + rank;
      const init  = (l.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2);
      return `<div style="display:flex;align-items:center;gap:14px;padding:12px;border-radius:12px;${isYou?'background:var(--primary-soft);border:1px solid rgba(13,148,136,.2)':'border:1px solid var(--border-subtle)'};margin-bottom:8px">
        <span style="width:28px;font-size:14px;font-weight:800;color:${rank<=3?'var(--warn)':'var(--text-muted)'}">${medal}</span>
        <div style="width:34px;height:34px;border-radius:50%;background:var(--primary);color:white;font-size:11px;font-weight:800;display:grid;place-items:center;flex-shrink:0">${init}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${l.name||'Anonymous'} ${isYou?'<span class="chip chip-teal" style="font-size:10px">You</span>':''}</div>
          <div style="font-size:11px;color:var(--text-muted)"><span style="color:var(--danger);font-weight:800">${l.bloodGroup||'?'}</span></div>
        </div>
        <span style="font-size:14px;font-weight:800;color:var(--primary)">${pts} pts</span>
      </div>`;
    }).join('');
  } catch(err) {
    console.error('Leaderboard error:', err);
    lb.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">Could not load leaderboard</div>';
  }
}

// ════════════════════════════════════════════════════════════
//  AUTH STATE — D7 auth guard + D2 notifications + D4 + D5
// ════════════════════════════════════════════════════════════
let _prevNotifCount = 0;

onAuthStateChanged(auth, user => {
  // D7 — Auth guard: redirect to login if no session
  if (!user) { window.location.href = '../auth/login.html'; return; }

  window._currentUser = user;
  const uid = user.uid; // ← was missing, caused re-login bug

  // ── Listen for appointment status updates (D6) ───────────
  const apptQ = query(collection(db,'appointments'), where('donorUid','==',user.uid));
  onSnapshot(apptQ, snap => {
    const remote = snap.docs.map(d => ({ id:d.id, ...d.data() }))
      .sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    window._myAppointments = remote;
    if (window.renderMyAppointments) window.renderMyAppointments();
  });

  // ── Real-time medical reports ─────────────────────────────
  window._listenMedicalReports(window._donorData?.phone || user.phoneNumber || '', reports => {
    window._renderMedicalReports(reports, true);
  });

  // ── D4: load donations once (real-time via onSnapshot) ──────
  const donQ = query(collection(db,'appointments'), where('donorUid','==',uid), where('status','==','completed'));
  onSnapshot(donQ, snap => {
    const donations = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.createdAt?.toMillis?.()??0)-(a.createdAt?.toMillis?.()??0));
    const total  = donations.length;
    const points = total * 5;

    // KPI cards
    const totalEl  = document.getElementById('totalDonations');
    const livesEl  = document.getElementById('livesSaved');
    const pointsEls= document.querySelectorAll('#impactPoints');
    if (totalEl)  totalEl.textContent  = total;
    if (livesEl)  livesEl.textContent  = total;
    pointsEls.forEach(el => el.textContent = points.toLocaleString());

    // My Donations card (same value)
    const donCardEl = document.getElementById('myDonationsCount');
    if (donCardEl) donCardEl.textContent = total;

    // Impact Score card — 3 tiers: Bronze(0-99), Silver(100-199), Gold(200+)
    // Each tier = 100 points
    const tierThresholds = [{name:'Bronze',min:0,max:99,color:'#cd7f32',gradient:'linear-gradient(135deg,#92400e,#cd7f32)'},{name:'Silver',min:100,max:199,color:'#94a3b8',gradient:'linear-gradient(135deg,#475569,#94a3b8)'},{name:'Gold',min:200,max:Infinity,color:'#f59e0b',gradient:'linear-gradient(135deg,#92400e,#fbbf24)'}];
    const tier = tierThresholds.find(t=>points>=t.min&&points<=t.max) || tierThresholds[0];
    const nextTier = tierThresholds[tierThresholds.indexOf(tier)+1];
    const tierPts  = points - tier.min;
    const tierRange= Math.min(tier.max,999) - tier.min + 1;
    const pct      = Math.min(Math.round((tierPts/100)*100),100);

    const tierBadgeEl = document.getElementById('impactTierBadge');
    if (tierBadgeEl) {
      tierBadgeEl.textContent = `${tier.name} Tier`;
      tierBadgeEl.style.background = tier.gradient;
      tierBadgeEl.style.color = tier.name==='Silver'?'#1e293b':'#fff';
    }
    const scoreBarEl = document.getElementById('impactScoreBar');
    if (scoreBarEl) scoreBarEl.style.width = pct + '%';
    const scoreMinEl = document.getElementById('impactScoreMin');
    const scoreMaxEl = document.getElementById('impactScoreMax');
    if (scoreMinEl) scoreMinEl.textContent = tier.min;
    if (scoreMaxEl) scoreMaxEl.textContent = nextTier ? nextTier.min : tier.min + 100;
    const tierProgressEl = document.getElementById('tierProgressLabel');
    if (tierProgressEl) tierProgressEl.textContent = nextTier ? `${pct}% to ${nextTier.name}` : 'Max Tier Reached';

    // Render donations table (real-time)
    const histBody = document.getElementById('historyBody');
    const donBody  = document.getElementById('donationsBody');
    if (!donations.length) {
      const emp = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text-muted)"><i class="fa-solid fa-heart" style="display:block;font-size:24px;margin-bottom:8px;opacity:.4"></i>No completed donations yet</td></tr>`;
      if (histBody) histBody.innerHTML = emp;
      if (donBody)  donBody.innerHTML  = emp;
      return;
    }
    const cls = {'Whole Blood':'hb-whole','Platelets':'hb-platelets','Plasma':'hb-plasma'};
    const rows = donations.map(d => {
      const date = d.date||(d.createdAt?.toDate?d.createdAt.toDate().toLocaleDateString('en-IN'):'—');
      const type = d.donationType||'Whole Blood';
      return `<tr>
        <td>${date}</td>
        <td><span class="history-badge ${cls[type]||'hb-whole'}">${type}</span></td>
        <td>${d.centreName||'—'}</td>
        <td style="font-weight:700">1u</td>
        <td>${d.centreName||'—'}</td>
        <td style="font-weight:700;color:var(--primary)">+5</td>
        <td><span class="chip chip-ok"><i class="fa-solid fa-check"></i> Completed</span></td>
      </tr>`;
    }).join('');
    if (histBody) histBody.innerHTML = rows;
    if (donBody)  donBody.innerHTML  = rows;
  });

  // ── D5: load leaderboard ──────────────────────────────────
  loadLeaderboard(user.uid);

  // ── D2: Notification listener ─────────────────────────────
  const notifQ = query(
    collection(db, 'notifications', user.uid, 'items'),
    where('read','==', false)
  );
  onSnapshot(notifQ, snap => {
    const count = snap.size;
    const badge = document.getElementById('notifCount');
    if (badge) { badge.textContent = count; badge.style.display = count ? '' : 'none'; }
    if (count > _prevNotifCount) _playNotifSound();
    _prevNotifCount = count;

    const notifList = document.getElementById('notifList');
    if (!notifList) return;
    if (snap.empty) {
      notifList.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">
        <i class="fa-solid fa-bell-slash" style="display:block;margin-bottom:8px;font-size:22px;opacity:.4"></i>No new notifications</div>`;
    } else {
      notifList.innerHTML = snap.docs.map(d => {
        const n = d.data();
        return `<div onclick="markDonorNotifRead('${d.id}')" style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border-subtle);cursor:pointer;transition:background .15s" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
          <i class="fa-solid fa-bell" style="color:var(--primary);margin-top:2px;flex-shrink:0;font-size:13px"></i>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--text-primary)">${n.title||'Notification'}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${n.body||''}</div>
          </div>
        </div>`;
      }).join('');
    }
  });
});

// ── D2: Mark single notification read ────────────────────
window.markDonorNotifRead = async (notifId) => {
  const user = auth.currentUser;
  if (!user) return;
  try { await updateDoc(doc(db,'notifications',user.uid,'items',notifId), { read:true }); } catch(e) {}
};

// ── D2: Mark ALL notifications read (bell header btn) ────
window.markAllNotifsRead = async () => {
  const user = auth.currentUser;
  if (!user) return;
  const snap = await getDocs(query(collection(db,'notifications',user.uid,'items'), where('read','==',false)));
  snap.forEach(d => updateDoc(d.ref, { read:true }));
  const panel = document.getElementById('notifPanel');
  if (panel) panel.style.display = 'none';
};

// ════════════════════════════════════════════════════════════
//  _renderMedicalReports — builds Medical Resume UI
// ════════════════════════════════════════════════════════════
window._renderMedicalReports = (reports, isLive = false) => {
  window._lastRenderedReports = reports;
  const loading    = document.getElementById('reportsLoading');
  const list       = document.getElementById('reportsList');
  const empty      = document.getElementById('reportsEmpty');
  const countChip  = document.getElementById('reportCountChip');
  const latestWrap = document.getElementById('latestReportWrap');
  const notifBadge = document.getElementById('medResumeNotif');
  if (!list) return;

  if (loading) loading.style.display = 'none';
  if (!reports || reports.length === 0) {
    list.style.display = 'none';
    if (empty)     empty.style.display = '';
    if (countChip) { countChip.textContent = '0 reports'; countChip.className = 'chip chip-warn'; }
    if (latestWrap) latestWrap.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  list.style.display = '';
  if (countChip) { countChip.textContent = `${reports.length} report${reports.length>1?'s':''}`; countChip.className='chip chip-ok'; }
  if (isLive && notifBadge) { notifBadge.style.display='inline-flex'; setTimeout(()=>{ notifBadge.style.display='none'; },6000); }

  const latest = reports[0];
  const hbEl = document.getElementById('latestHb');
  const bgEl = document.getElementById('latestBg');
  if (hbEl && latest.hemoglobin) hbEl.textContent = latest.hemoglobin;
  if (bgEl && latest.bloodGroup)  bgEl.textContent = latest.bloodGroup;

  const isOkTTI = v => v==='Non-Reactive'||v==='Negative'||v==='Not Done'||!v;
  const allClearTTI = ['hiv','hepatitisB','hepatitisC','syphilis','malaria','nat','antibodyScreening'].every(k=>isOkTTI(latest[k]));
  const badgeEl = document.getElementById('eligibilityBadge');
  if (badgeEl) {
    if (latest.temporaryDeferral) {
      badgeEl.innerHTML='<i class="fa-solid fa-hourglass-half"></i> Temporary Deferral';
      badgeEl.style.cssText='font-size:12px;padding:6px 14px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);color:#f59e0b';
    } else if (allClearTTI) {
      badgeEl.innerHTML='<i class="fa-solid fa-circle-check"></i> Approved & Eligible';
      badgeEl.style.cssText='font-size:12px;padding:6px 14px;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);color:#4ade80';
    } else {
      badgeEl.innerHTML='<i class="fa-solid fa-circle-xmark"></i> Not Eligible';
      badgeEl.style.cssText='font-size:12px;padding:6px 14px;background:rgba(225,29,72,0.15);border:1px solid rgba(225,29,72,0.3);color:#f87171';
    }
  }
  const nextDateEl = document.getElementById('nextEligibleDate');
  if (nextDateEl && latest.nextEligibleDate) {
    const nd = new Date(latest.nextEligibleDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
    nextDateEl.textContent = `Next eligible: ${nd}`; nextDateEl.style.display='';
  }
  // Update Next Eligible d-card
  const nextCardVal = document.getElementById('nextEligibleCardVal');
  const nextCardSub = document.getElementById('nextEligibleCardSub');
  if (nextCardVal && latest.nextEligibleDate) {
    const daysLeft = Math.max(0, Math.ceil((new Date(latest.nextEligibleDate) - new Date()) / 86400000));
    nextCardVal.innerHTML = `${daysLeft}<span style="font-size:16px;font-weight:600;color:var(--text-muted)">d</span>`;
    if (nextCardSub) nextCardSub.textContent = `Eligible: ${new Date(latest.nextEligibleDate).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}`;
  } else if (nextCardVal) {
    nextCardVal.innerHTML = `<span style="font-size:16px;font-weight:600;color:var(--text-muted)">—</span>`;
    if (nextCardSub) nextCardSub.textContent = 'No report yet';
  }
  const chips = document.getElementById('latestScreeningChips');
  if (chips) {
    const tests=[{label:'HIV 1&2',val:latest.hiv},{label:'Hep-B',val:latest.hepatitisB},{label:'Hep-C',val:latest.hepatitisC},{label:'Syphilis',val:latest.syphilis},{label:'Malaria',val:latest.malaria},{label:'NAT',val:(latest.nat&&latest.nat!=='Not Done')?latest.nat:null},{label:'Antibody',val:(latest.antibodyScreening&&latest.antibodyScreening!=='Not Done')?latest.antibodyScreening:null}];
    chips.innerHTML=tests.filter(t=>t.val).map(t=>{const ok=t.val==='Non-Reactive'||t.val==='Negative';return `<span class="chip ${ok?'chip-ok':'chip-danger'}" style="${ok?'':'background:rgba(225,29,72,0.15);border:1px solid rgba(225,29,72,0.3);color:#f87171'}"><i class="fa-solid ${ok?'fa-check':'fa-xmark'}"></i> ${t.label} ${t.val}</span>`;}).join('')||'<span class="chip" style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);color:#f59e0b"><i class="fa-solid fa-hourglass-half"></i> Awaiting lab report</span>';
  }
  if (latestWrap) {
    const isOk=v=>v==='Non-Reactive'||v==='Negative'||v==='Not Done'||!v;
    const allClear=['hiv','hepatitisB','hepatitisC','syphilis','malaria','nat','antibodyScreening'].every(k=>isOk(latest[k]));
    const date=latest.donationDate?new Date(latest.donationDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
    latestWrap.innerHTML=`<div style="background:linear-gradient(135deg,${allClear?'#0d1f15,#0a2010':'#1f0d0d,#200a0a'});border:1px solid ${allClear?'rgba(34,197,94,.25)':'rgba(225,29,72,.25)'};border-radius:20px;padding:28px 32px;position:relative;overflow:hidden"><div style="position:absolute;top:-50px;right:-50px;width:180px;height:180px;background:radial-gradient(circle,${allClear?'rgba(34,197,94,.12)':'rgba(225,29,72,.12)'} 0%,transparent 70%);pointer-events:none"></div><div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:24px"><div><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${allClear?'rgba(34,197,94,.6)':'rgba(225,29,72,.6)'};margin-bottom:6px"><i class="fa-solid fa-flask-vial" style="margin-right:6px"></i>Latest Lab Report · ${latest.bloodBank||'Blood Bank'}</div><div style="font-size:20px;font-weight:800;color:#fff">${allClear?'✅ All Tests Clear — You\'re Healthy!':'⚠️ Some Results Need Attention'}</div><div style="font-size:13px;color:rgba(255,255,255,.45);margin-top:5px">Donation date: ${date} · Finalised by ${latest.finalisedBy||'Blood Bank Staff'}</div></div><div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><span style="display:inline-flex;align-items:center;gap:6px;background:${allClear?'rgba(34,197,94,.15)':'rgba(225,29,72,.15)'};border:1px solid ${allClear?'rgba(34,197,94,.3)':'rgba(225,29,72,.3)'};padding:6px 14px;border-radius:99px;font-size:12px;font-weight:700;color:${allClear?'#4ade80':'#f87171'}"><span style="width:8px;height:8px;border-radius:50%;background:${allClear?'#4ade80':'#f87171'};animation:blink 1.2s infinite;flex-shrink:0"></span>${allClear?'Eligible to Donate':'Consult Your Doctor'}</span><button onclick="window.downloadReportPDF('${latest.id}','${date}')" style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.7);padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px"><i class="fa-solid fa-download"></i> Download PDF</button></div></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:12px">${[{label:'Blood Group',val:latest.bloodGroup,color:'#f87171'},{label:'ABO / Rh',val:latest.aboGroup?`${latest.aboGroup} / ${latest.rhTyping||'—'}`:'—',color:'#fff'},{label:'Hemoglobin',val:`${latest.hemoglobin} g/dL`,color:'#fff'},{label:'PCV / HCT',val:latest.pcv?`${latest.pcv}%`:'—',color:'#fff'},{label:'HIV 1&2',val:latest.hiv,color:(latest.hiv==='Non-Reactive'||latest.hiv==='Negative')?'#4ade80':'#f87171'},{label:'Hepatitis B',val:latest.hepatitisB,color:(latest.hepatitisB==='Non-Reactive'||latest.hepatitisB==='Negative')?'#4ade80':'#f87171'},{label:'Hepatitis C',val:latest.hepatitisC,color:(latest.hepatitisC==='Non-Reactive'||latest.hepatitisC==='Negative')?'#4ade80':'#f87171'},{label:'Syphilis',val:latest.syphilis,color:(latest.syphilis==='Non-Reactive'||latest.syphilis==='Negative')?'#4ade80':'#f87171'},{label:'Malaria',val:latest.malaria,color:(latest.malaria==='Negative'||latest.malaria==='Non-Reactive')?'#4ade80':'#f87171'},{label:'NAT',val:latest.nat||'—',color:(latest.nat==='Non-Reactive'||latest.nat==='Not Done')?'#4ade80':'#f87171'},{label:'Antibody',val:latest.antibodyScreening||'—',color:(latest.antibodyScreening==='Negative'||latest.antibodyScreening==='Not Done')?'#4ade80':'#f87171'}].map(f=>`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:rgba(255,255,255,.35);margin-bottom:4px">${f.label}</div><div style="font-size:14px;font-weight:800;color:${f.color||'#fff'}">${f.val||'—'}</div></div>`).join('')}</div>${latest.notes?`<div style="margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font-size:12px;color:rgba(255,255,255,.45);font-style:italic;line-height:1.6"><i class="fa-solid fa-notes-medical" style="margin-right:6px;color:rgba(255,255,255,.3)"></i>${latest.notes}</div>`:''}</div>`;
  }

  list.innerHTML = reports.map((r, idx) => {
    const allOk = ['hiv','hepatitisB','hepatitisC','syphilis','malaria'].every(k=>r[k]==='Negative');
    const date  = r.donationDate?new Date(r.donationDate).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'—';
    const isLatest = idx === 0;
    return `<div style="display:flex;gap:16px;padding:18px 0;border-bottom:1px solid var(--border-color);${isLatest?'background:var(--primary-soft);margin:0 -22px;padding:18px 22px;':''}"><div style="width:44px;height:44px;border-radius:12px;flex-shrink:0;background:${allOk?'var(--ok-dim)':'var(--danger-dim)'};display:grid;place-items:center;color:${allOk?'var(--ok)':'var(--danger)'}"><i class="fa-solid ${allOk?'fa-circle-check':'fa-triangle-exclamation'}" style="font-size:18px"></i></div><div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px"><span style="font-size:13.5px;font-weight:800;color:var(--text-primary)">Lab Report — ${date}</span>${isLatest?'<span class="chip chip-teal" style="font-size:10px">Latest</span>':''}<span class="chip ${allOk?'chip-ok':'chip-danger'}" style="font-size:10px">${allOk?'All Clear':'Review Required'}</span></div><div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${r.bloodBank||'Blood Bank'} &nbsp;·&nbsp; Finalised by <strong>${r.finalisedBy||'Staff'}</strong> &nbsp;·&nbsp; Blood Group: <strong style="color:var(--danger)">${r.bloodGroup}</strong> &nbsp;·&nbsp; Hb: <strong style="color:var(--text-primary)">${r.hemoglobin} g/dL</strong></div><div style="display:flex;flex-wrap:wrap;gap:7px">${[{l:'HIV 1&2',v:r.hiv},{l:'Hep-B',v:r.hepatitisB},{l:'Hep-C',v:r.hepatitisC},{l:'Syphilis',v:r.syphilis},{l:'Malaria',v:r.malaria},{l:'NAT',v:(r.nat&&r.nat!=='Not Done')?r.nat:null},{l:'Antibody',v:(r.antibodyScreening&&r.antibodyScreening!=='Not Done')?r.antibodyScreening:null}].filter(t=>t.v).map(t=>{const ok=t.v==='Non-Reactive'||t.v==='Negative';return `<span class="chip ${ok?'chip-ok':'chip-danger'}" style="font-size:11px"><i class="fa-solid ${ok?'fa-check':'fa-xmark'}"></i> ${t.l}</span>`;}).join('')}</div>${r.pcv?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px"><i class="fa-solid fa-flask" style="margin-right:5px;color:var(--orange)"></i>PCV: <strong>${r.pcv}%</strong>${r.labTechnician?` &nbsp;·&nbsp; Lab Tech: <strong>${r.labTechnician}</strong>`:''}</div>`:''}</div><button onclick="window.downloadReportPDF('${r.id}','${date}')" class="btn-ghost" style="font-size:11px;padding:6px 12px;align-self:center;flex-shrink:0"><i class="fa-solid fa-download"></i> PDF</button></div>`;
  }).join('');

};

window.loadMedicalReports = async () => {
  const loading = document.getElementById('reportsLoading');
  const list    = document.getElementById('reportsList');
  const empty   = document.getElementById('reportsEmpty');
  if (loading) loading.style.display = '';
  if (list)    list.style.display    = 'none';
  if (empty)   empty.style.display   = 'none';
  try {
    const phone   = window._currentUser?.phoneNumber || _donorData.phone || '';
    const reports = window._fetchMedicalReports ? await window._fetchMedicalReports(phone) : [];
    window._renderMedicalReports(reports || [], false);
  } catch(err) {
    console.error('Could not load medical reports:', err);
    window._renderMedicalReports([], false);
  }
};

// ════════════════════════════════════════════════════════════
//  DOM-CONTENT-LOADED — all UI init
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // ── Header avatar dropdown (teleport to body) ─────────────
  const avatarWrap = document.getElementById('headerAvatarWrap');
  const dropdown   = document.getElementById('headerDropdown');
  document.body.appendChild(dropdown);
  function positionDropdown() {
    const rect = avatarWrap.getBoundingClientRect();
    dropdown.style.top   = (rect.bottom + 8) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.style.left  = 'auto';
  }
  avatarWrap.addEventListener('click', e => {
    e.stopPropagation();
    if (!dropdown.classList.contains('open')) positionDropdown();
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
  });

  // ── D2: Notification panel ────────────────────────────────
  const notifBtn   = document.getElementById('notifBtn');
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

  // ── Profile photo upload ──────────────────────────────────
  function setAllAvatars(url) {
    const ha  = document.getElementById('headerAvatar');
    if (ha)  { ha.src = url; ha.style.display = ''; }
    const hap = document.getElementById('headerAvatarPlaceholder'); if(hap) hap.style.display='none';
    const hda = document.getElementById('hdpAvatar');   if(hda) hda.src=url;
    const pa  = document.getElementById('profileAvatar'); if(pa) pa.src=url;
  }
  window.uploadProfilePhoto = async (input) => {
    const file = input.files[0]; if (!file) return;
    const user = window._currentUser; if (!user) { window.showToast('❌ Not logged in'); return; }
    window.showToast('📤 Uploading photo...');
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('upload_preset','lifynk'); fd.append('folder','profile_photos');
      const res  = await fetch('https://api.cloudinary.com/v1_1/duxukomd3/image/upload',{method:'POST',body:fd});
      const data = await res.json();
      if (!data.secure_url) throw new Error('Upload failed');
      await updateDoc(doc(db,'donors',user.uid),{ photoUrl:data.secure_url });
      setAllAvatars(data.secure_url);
      window.showToast('✅ Profile photo updated!');
    } catch(e) { window.showToast('❌ Upload failed: '+e.message); }
    input.value = '';
  };
  const changePhotoBtn = document.getElementById('changePhotoBtn');
  const profilePhotoInput = document.getElementById('profilePhotoInput');
  if (changePhotoBtn) changePhotoBtn.addEventListener('click', () => profilePhotoInput.click());
  if (profilePhotoInput) profilePhotoInput.addEventListener('change', function() { window.uploadProfilePhoto(this); });

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

  // ── Firestore profile load (greeting, sidebar, etc.) ─────
  onAuthStateChanged(auth, async user => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'donors', user.uid));
      if (snap.exists()) {
        const data = snap.data();
        _donorData = data; window._donorData = data;
        const banner = document.getElementById('unverifiedBanner');
        if (banner) banner.style.display = (data.verificationStatus==='verified'||data.verified===true)?'none':'';
        const name = data.name || 'Donor';
        const bg   = data.bloodGroup || '';
        const city = data.city || '';
        const av80 = data.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1D9E75&color=fff&size=80`;
        document.getElementById('sidebarName').textContent      = name;
        document.getElementById('sidebarRole').textContent      = `${bg} · ${city}`;
        document.getElementById('profileName').textContent      = name;
        document.getElementById('profileNameInput').value       = name;
        document.getElementById('profilePhoneInput').value      = data.phone || '';
        document.getElementById('profileEmailInput').value      = data.email || '';
        document.getElementById('profileAgeInput').value        = data.age   || '';
        const bgSel = document.getElementById('profileBloodGroupInput');
        if (bgSel && data.bloodGroup) bgSel.value = data.bloodGroup;
        document.getElementById('hdpName').textContent          = name;
        document.getElementById('greetingTitle').textContent    = `Hello, ${name} 👋`;
        setAllAvatars(av80);
        try { localStorage.setItem('lifynkDonorUser', JSON.stringify({name,bloodGroup:bg,city,photoUrl:data.photoUrl||''})); } catch(e) {}
      }
    } catch(e) { console.warn('Profile fetch error:', e); }
  });

  // ── Instant name from cache (before Firebase resolves) ────
  const _cached = JSON.parse(localStorage.getItem('lifynkDonorUser') || localStorage.getItem('signupData') || '{}');
  if (_cached.name) {
    const av = _cached.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(_cached.name)}&background=1D9E75&color=fff&size=80`;
    const sn = document.getElementById('sidebarName');   if(sn) sn.textContent = _cached.name;
    const hn = document.getElementById('hdpName');       if(hn) hn.textContent = _cached.name;
    const gt = document.getElementById('greetingTitle'); if(gt) gt.textContent = `Hello, ${_cached.name} 👋`;
    const ha = document.getElementById('headerAvatar');  if(ha) { ha.src=av; ha.style.display=''; }
    const hap= document.getElementById('headerAvatarPlaceholder'); if(hap) hap.style.display='none';
    const hda= document.getElementById('hdpAvatar');     if(hda) hda.src=av;
  }

  // ── Greeting date ─────────────────────────────────────────
  const now = new Date();
  const greetDateEl = document.getElementById('greetingDate');
  if (greetDateEl) greetDateEl.textContent =
    now.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) + ' · Lifynk';

  // ── Profile save ──────────────────────────────────────────
  window.saveProfileChanges = async () => {
    const btn  = document.getElementById('saveProfileBtn');
    const user = window._currentUser;
    if (!user) { window.showToast('❌ Not logged in'); return; }
    const name=document.getElementById('profileNameInput').value.trim();
    const age =document.getElementById('profileAgeInput').value.trim();
    const bg  =document.getElementById('profileBloodGroupInput').value;
    const phone=document.getElementById('profilePhoneInput').value.trim();
    const email=document.getElementById('profileEmailInput').value.trim();
    if (!name) { window.showToast('❌ Name cannot be empty'); return; }
    btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    try {
      await updateDoc(doc(db,'donors',user.uid),{name,age,bloodGroup:bg,phone,email});
      _donorData={..._donorData,name,age,bloodGroup:bg,phone,email}; window._donorData=_donorData;
      document.getElementById('profileName').textContent   = name;
      document.getElementById('sidebarName').textContent   = name;
      document.getElementById('hdpName').textContent       = name;
      document.getElementById('greetingTitle').textContent = `Hello, ${name} 👋`;
      window.showToast('✅ Profile saved successfully');
    } catch(err) { console.error(err); window.showToast('❌ Could not save. Check connection.'); }
    finally { btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-check"></i> Save Changes'; }
  };
  window.loadProfileFromData = () => {
    const d = _donorData || {};
    document.getElementById('profileNameInput').value  = d.name  || '';
    document.getElementById('profileAgeInput').value   = d.age   || '';
    document.getElementById('profilePhoneInput').value = d.phone || '';
    document.getElementById('profileEmailInput').value = d.email || '';
    const sel = document.getElementById('profileBloodGroupInput');
    if (sel && d.bloodGroup) sel.value = d.bloodGroup;
  };

  // ── Theme ─────────────────────────────────────────────────
  const html     = document.documentElement;
  const themeBtn = document.getElementById('themeToggle');
  const saved    = localStorage.getItem('lifynkTheme') || 'light';
  html.setAttribute('data-theme', saved);
  if (themeBtn) {
    themeBtn.innerHTML = saved==='dark'?'<i class="fa-solid fa-sun"></i>':'<i class="fa-solid fa-moon"></i>';
    themeBtn.addEventListener('click', () => {
      const next = html.getAttribute('data-theme')==='light'?'dark':'light';
      html.setAttribute('data-theme', next);
      localStorage.setItem('lifynkTheme', next);
      themeBtn.innerHTML = next==='dark'?'<i class="fa-solid fa-sun"></i>':'<i class="fa-solid fa-moon"></i>';
    });
  }

  // ── Settings notification toggles ────────────────────────────
  function applyToggleVisual(btn, isOn) {
    btn.style.background = isOn ? 'var(--primary)' : 'var(--border)';
    const knob = btn.querySelector('span');
    if (knob) knob.style.transform = isOn ? 'translateX(20px)' : 'translateX(0)';
  }
  document.querySelectorAll('.notif-toggle-btn').forEach(btn => {
    const key = btn.dataset.notifKey;
    if (!key) return;
    const savedVal = localStorage.getItem('notif_'+key);
    const isOn = savedVal !== null ? savedVal === 'true' : btn.classList.contains('active');
    btn.classList.toggle('active', isOn);
    applyToggleVisual(btn, isOn);
    btn.addEventListener('click', () => {
      const nowOn = btn.classList.toggle('active');
      localStorage.setItem('notif_'+key, nowOn);
      applyToggleVisual(btn, nowOn);
      window.showToast(nowOn ? '🔔 Notifications enabled' : '🔕 Notifications disabled');
    });
  });

  // ── Availability toggle ───────────────────────────────────
  const availToggle = document.getElementById('availToggle');
  const availWrap   = document.getElementById('availWrap');
  if (availToggle) availToggle.addEventListener('change', () => {
    const on = availToggle.checked;
    availWrap.classList.toggle('on', on);
    document.getElementById('availTitle').textContent = on?'Available for Donation':'Currently Unavailable';
    document.getElementById('availSub').textContent   = on?'You are visible to hospitals and NGOs near you':'You are hidden from search results';
    document.getElementById('availIcon').className    = on?'fa-solid fa-circle-check':'fa-solid fa-circle-xmark';
  });

  // ── Counter animation ─────────────────────────────────────
  function animateCount(el) {
    const target = parseInt(el.getAttribute('data-count'));
    let count=0; const inc=Math.ceil(target/40);
    const tick=()=>{ count=Math.min(count+inc,target); el.textContent=count.toLocaleString(); if(count<target) setTimeout(tick,30); };
    setTimeout(tick,400);
  }
  document.querySelectorAll('[data-count]').forEach(animateCount);

  // ── Progress bars ─────────────────────────────────────────
  document.querySelectorAll('[data-width]').forEach(bar => {
    setTimeout(()=>{ bar.style.width=bar.getAttribute('data-width'); },700);
  });

  // ── Eligibility ring ──────────────────────────────────────
  const dtypeCards = document.querySelectorAll('.dtype-card');
  const C = 283;
  function updateRing(total, passed) {
    const offset = C - ((passed/total)*C);
    const el = document.getElementById('eligRing');
    if (el) { el.style.strokeDashoffset=offset; el.style.stroke=passed/total>=0.85?'#10b981':passed/total>=0.5?'#f59e0b':'#0d9488'; }
    const el2 = document.getElementById('eligRing2');
    if (el2) el2.style.strokeDashoffset = offset;
    document.querySelectorAll('#ringDays').forEach(d=>d.textContent=total-passed);
  }
  dtypeCards.forEach(card => {
    card.addEventListener('click', () => {
      dtypeCards.forEach(c=>c.classList.remove('active')); card.classList.add('active');
      updateRing(parseInt(card.dataset.days), parseInt(card.dataset.passed));
    });
  });
  setTimeout(()=>updateRing(56,24),400);

  // ── D4: Nearby requests (empty state) ────────────────────
  const nl = document.getElementById('nearbyList');
  if (nl && !nl.innerHTML.trim()) {
    nl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">
      <i class="fa-solid fa-location-dot" style="font-size:36px;display:block;margin-bottom:12px;opacity:.4"></i>
      <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px">No nearby requests</div>
      <div style="font-size:13px">Live requests will appear here when blood is needed near you</div>
    </div>`;
  }

  // ════════════════════════════════════════════════════════
  //  NEARBY MAP — Leaflet
  // ════════════════════════════════════════════════════════
  const PILLARS = {
    ngos:       [{name:'Red Cross Society',addr:'Shahibaug, Ahmedabad',lat:23.0431,lng:72.5880,dist:'1.4 km',type:'NGO'},{name:'City Civil NGO',addr:'Law Garden, Ahmedabad',lat:23.0268,lng:72.5536,dist:'2.8 km',type:'NGO'},{name:'SBT Red Cross',addr:'SG Road, Ahmedabad',lat:23.0556,lng:72.5742,dist:'5.0 km',type:'NGO'}],
    bloodBanks: [{name:'City Blood Bank',addr:'Navrangpura, Ahmedabad',lat:23.0310,lng:72.5590,dist:'3.1 km',type:'Blood Bank'},{name:'Apollo Blood Bank',addr:'Satellite, Ahmedabad',lat:23.0192,lng:72.5060,dist:'4.2 km',type:'Blood Bank'}],
    hospitals:  [{name:'Apollo Hospital',addr:'Satellite Road',lat:23.0195,lng:72.5074,dist:'4.3 km',type:'Hospital'},{name:'Civil Hospital',addr:'Asarwa, Ahmedabad',lat:23.0432,lng:72.5963,dist:'3.8 km',type:'Hospital'},{name:'CIMS Hospital',addr:'SG Road, Ahmedabad',lat:23.0546,lng:72.5606,dist:'5.1 km',type:'Hospital'}],
    camps:      [{name:'Red Cross Blood Drive',addr:'Silver Oak University',lat:23.0470,lng:72.5621,dist:'2.2 km',type:'Camp',date:'22 Mar'},{name:'City Civil NGO Camp',addr:'Law Garden',lat:23.0268,lng:72.5536,dist:'2.8 km',type:'Camp',date:'05 Apr'}]
  };
  let donorMap=null, donorMarker=null, donorLat=23.0225, donorLng=72.5714;
  let _liveMapMarkers = []; // track dynamic markers for refresh

  // ── Load LIVE orgs + camps from Firestore and plot on map ──
  async function loadLiveMapData(lat, lng) {
    const donorCity = (_donorData?.city || window._donorData?.city || '').toLowerCase().split(',')[0].trim();
    try {
      const [bbSnap, ngoSnap, hospSnap, campSnap] = await Promise.all([
        getDocs(query(collection(db,'bloodbanks'), where('status','==','approved'))),
        getDocs(query(collection(db,'ngos'),       where('status','==','approved'))),
        getDocs(query(collection(db,'hospitals'),  where('status','==','approved'))),
        getDocs(query(collection(db,'camps'),      where('status','==','active')))
      ]);
      const orgs = [];
      const mapCfg = [
        {snap:bbSnap,   type:'Blood Bank', nameField:'bbname',        color:'#3b82f6', icon:'fa-flask'},
        {snap:ngoSnap,  type:'NGO',        nameField:'ngoname',       color:'#8b5cf6', icon:'fa-people-group'},
        {snap:hospSnap, type:'Hospital',   nameField:'hospitalName',  color:'#e11d48', icon:'fa-hospital'},
        {snap:campSnap, type:'Camp',       nameField:'campName',      color:'#f59e0b', icon:'fa-tent'},
      ];
      mapCfg.forEach(({snap,type,nameField,color,icon}) => {
        snap.docs.forEach(d => {
          const data = d.data();
          const city = (data.city||'').toLowerCase().split(',')[0].trim();
          if (!donorCity || city.includes(donorCity) || donorCity.includes(city)) {
            orgs.push({ id:d.id, name:data[nameField]||data.name||type, city:data.city||'',
              lat:data.lat||null, lng:data.lng||null, type, color, icon,
              date: data.date||data.campDate||null });
          }
        });
      });
      // Geocode missing coords (rate-limited)
      for (const o of orgs) {
        if (o.lat && o.lng) continue;
        if (!o.city) continue;
        const coords = await _geocode(o.city);
        if (coords) { o.lat=coords.lat; o.lng=coords.lng; }
        await new Promise(r=>setTimeout(r,1100));
      }
      // Remove old dynamic markers
      _liveMapMarkers.forEach(m => { try { donorMap.removeLayer(m); } catch(e){} });
      _liveMapMarkers = [];
      // Plot on map
      orgs.filter(o=>o.lat&&o.lng).forEach(o => {
        const distKm = _haversine(lat,lng,o.lat,o.lng);
        const distLabel = distKm<1?(distKm*1000).toFixed(0)+' m':distKm.toFixed(1)+' km';
        const icon = L.divIcon({className:'',html:`<div style="width:34px;height:34px;border-radius:50% 50% 50% 0;background:${o.color};transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center"><i class="fa-solid ${o.icon}" style="transform:rotate(45deg);color:white;font-size:13px"></i></div>`,iconSize:[34,34],iconAnchor:[17,34]});
        const m = L.marker([o.lat,o.lng],{icon}).addTo(donorMap)
          .bindPopup(`<div style="font-size:13px;font-weight:700;color:#0d1117;margin-bottom:3px">${o.name}</div><div style="font-size:11px;color:#555">${o.type} · ${o.city}</div><div style="font-size:11px;color:#0d9488;font-weight:700;margin-top:3px">${distLabel} away${o.date?' · '+o.date:''}</div>${o.type!=='Hospital'?`<button onclick="window.openApptModal('donation')" style="margin-top:8px;background:#0d9488;color:white;border:none;padding:5px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;width:100%">Book Appointment</button>`:''}`);
        _liveMapMarkers.push(m);
      });
    } catch(e) { console.warn('Live map data error:', e); }
  }

  // ── Real-time Nearby Blood Requests (Nearby section + overview preview) ──
  async function loadNearbyRequests() {
    const donorBg   = (_donorData?.bloodGroup || window._donorData?.bloodGroup || '').trim();
    const donorCity = (_donorData?.city || window._donorData?.city || '').toLowerCase().split(',')[0].trim();
    const nl = document.getElementById('nearbyList');
    const overviewReqs = document.querySelectorAll('.req-item'); // static preview items
    if (nl) nl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;margin-bottom:12px;display:block"></i><div style="font-size:14px">Loading nearby requests…</div></div>`;

    // Blood compatibility map
    const compatible = {
      'O+':['O+','O-'],'O-':['O-'],'A+':['A+','A-','O+','O-'],'A-':['A-','O-'],
      'B+':['B+','B-','O+','O-'],'B-':['B-','O-'],'AB+':['A+','A-','B+','B-','O+','O-','AB+','AB-'],'AB-':['A-','B-','O-','AB-']
    };
    const canDonate = (reqBg) => !donorBg || (compatible[reqBg]||[]).includes(donorBg);

    try {
      const q = query(collection(db,'bloodRequests'), where('status','==','pending'));
      onSnapshot(q, async snap => {
        let requests = snap.docs.map(d=>({id:d.id,...d.data()}));
        // Filter by city + compatibility
        requests = requests.filter(r => {
          const rc = (r.city||'').toLowerCase().split(',')[0].trim();
          const cityMatch = !donorCity || rc.includes(donorCity) || donorCity.includes(rc);
          return cityMatch;
        });
        // Compute distances
        for (const r of requests) {
          if (r.lat && r.lng) { r._distKm = _haversine(donorLat,donorLng,r.lat,r.lng); }
          else if (r.city) {
            const coords = await _geocode(r.city);
            if (coords) { r._distKm = _haversine(donorLat,donorLng,coords.lat,coords.lng); r.lat=coords.lat; r.lng=coords.lng; }
          }
          if (!r._distKm) r._distKm = Infinity;
        }
        requests.sort((a,b)=>a._distKm-b._distKm);

        // Update Nearby section badge
        const secTag = document.querySelector('#sec-nearby .sec-tag');
        if (secTag) secTag.textContent = `${requests.length} Active`;

        // Overview preview card - update counts
        const overviewChip = document.querySelector('#sec-overview .chip-danger');
        if (overviewChip) overviewChip.textContent = `${requests.length} Active`;

        // Render overview preview (top 3 static items replaced)
        const overviewContainer = document.getElementById('overviewNearbyList');
        if (overviewContainer) {
          overviewContainer.innerHTML = requests.slice(0,3).map(r => {
            const dist = r._distKm===Infinity?'?':(r._distKm<1?(r._distKm*1000).toFixed(0)+' m':r._distKm.toFixed(1)+' km');
            return `<div class="req-item">
              <div class="blood-badge">${r.bloodGroup||'?'}</div>
              <div class="req-info">
                <div class="req-name">${r.hospitalName||r.requesterName||'Hospital'}</div>
                <div class="req-meta">${r.units||1} unit · ${r.urgency||'Urgent'} · ${r.reason||'Blood needed'}</div>
              </div>
              <div class="req-dist">${dist}</div>
            </div>`;
          }).join('') || `<div style="text-align:center;padding:16px;color:var(--text-muted);font-size:13px">No nearby requests</div>`;
        }

        // Render full Nearby section with Accept/Cancel buttons
        if (!nl) return;
        if (!requests.length) {
          nl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)"><i class="fa-solid fa-location-dot" style="font-size:36px;display:block;margin-bottom:12px;opacity:.4"></i><div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:6px">No nearby requests</div><div style="font-size:13px">Live requests will appear here when blood is needed near you</div></div>`;
          return;
        }
        nl.innerHTML = requests.map(r => {
          const dist = r._distKm===Infinity?'?':(r._distKm<1?(r._distKm*1000).toFixed(0)+' m':r._distKm.toFixed(1)+' km');
          const compat = canDonate(r.bloodGroup);
          const urgColor = {Critical:'#e11d48',High:'#f97316',Medium:'#f59e0b',Planned:'#22c55e'}[r.urgency]||'#f59e0b';
          return `<div class="d-card" style="margin-bottom:12px;border-left:4px solid ${urgColor}">
            <div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap">
              <div style="width:52px;height:52px;border-radius:12px;background:var(--danger-dim);color:var(--danger);font-size:14px;font-weight:900;display:grid;place-items:center;flex-shrink:0">${r.bloodGroup||'?'}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:800;color:var(--text-primary);margin-bottom:4px">${r.hospitalName||r.requesterName||'Hospital'}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${r.city||''} · ${r.units||1} unit(s) · <span style="color:${urgColor};font-weight:700">${r.urgency||'Urgent'}</span> · ${r.reason||'Blood needed'}</div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="font-size:12px;font-weight:700;color:var(--primary)"><i class="fa-solid fa-location-dot"></i> ${dist}</span>
                  ${compat?'<span class="chip chip-ok" style="font-size:10px"><i class="fa-solid fa-check"></i> Compatible</span>':'<span class="chip chip-warn" style="font-size:10px">Type mismatch</span>'}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0">
                <button onclick="window._acceptRequest('${r.id}','${r.hospitalName||r.requesterName||''}',this)" class="btn-primary" style="font-size:12px;padding:8px 16px"><i class="fa-solid fa-check"></i> Accept</button>
                <button onclick="window._cancelRequest('${r.id}',this)" class="btn-ghost" style="font-size:12px;padding:8px 16px;color:var(--danger);border-color:var(--danger)"><i class="fa-solid fa-xmark"></i> Cancel</button>
              </div>
            </div>
          </div>`;
        }).join('');
      });
    } catch(e) {
      console.error('Nearby requests error:', e);
      if (nl) nl.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">Could not load requests</div>`;
    }
  }

  // ── Accept / Cancel request handlers ───────────────────
  window._acceptRequest = async (reqId, name, btn) => {
    const user = window._currentUser; if (!user) return;
    btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      await updateDoc(doc(db,'bloodRequests',reqId),{
        acceptedBy: user.uid,
        acceptedByName: _donorData.name||'Donor',
        acceptedByPhone: _donorData.phone||'',
        status:'accepted',
        acceptedAt: serverTimestamp()
      });
      window.showToast(`✅ You accepted the request from ${name}. They will be notified!`);
    } catch(e) { console.error(e); window.showToast('❌ Could not accept. Try again.'); btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-check"></i> Accept'; }
  };
  window._cancelRequest = async (reqId, btn) => {
    btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
      // Just dismiss from this donor's view — don't delete the request
      window.showToast('Request dismissed');
      btn.closest('.d-card').style.opacity='0.4';
      btn.closest('.d-card').style.pointerEvents='none';
    } catch(e) { btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-xmark"></i> Cancel'; }
  };
  function buildNearbyMap(lat,lng) {
    if (!document.getElementById('nearbyPillarsMap')) return;
    if (donorMap) { donorMap.setView([lat,lng],13); if(donorMarker) donorMarker.setLatLng([lat,lng]); loadLiveMapData(lat,lng); return; }
    donorMap = L.map('nearbyPillarsMap',{zoomControl:true,scrollWheelZoom:false}).setView([lat,lng],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(donorMap);
    const youIcon = L.divIcon({className:'',html:`<div style="width:18px;height:18px;border-radius:50%;background:#0d9488;border:3px solid #fff;box-shadow:0 0 0 4px rgba(13,148,136,.3),0 2px 8px rgba(0,0,0,.3)"></div>`,iconSize:[18,18],iconAnchor:[9,9]});
    donorMarker = L.marker([lat,lng],{icon:youIcon}).addTo(donorMap).bindPopup('<strong>You are here</strong>');
    loadLiveMapData(lat,lng);
  }

  window.locateAndRefreshMap = function() {
    if (!navigator.geolocation) { window.showToast('⚠️ Geolocation not supported'); buildNearbyMap(donorLat,donorLng); return; }
    navigator.geolocation.getCurrentPosition(pos=>{ donorLat=pos.coords.latitude; donorLng=pos.coords.longitude; buildNearbyMap(donorLat,donorLng); loadNearbyRequests(); window.showToast('📍 Location updated'); }, ()=>{ window.showToast('📍 Using default location — Ahmedabad'); buildNearbyMap(donorLat,donorLng); loadNearbyRequests(); },{timeout:6000});
  };

  // Auto-get GPS on load
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => { donorLat=pos.coords.latitude; donorLng=pos.coords.longitude; buildNearbyMap(donorLat,donorLng); loadNearbyRequests(); },
      ()  => { buildNearbyMap(donorLat,donorLng); loadNearbyRequests(); },
      { timeout:6000 }
    );
  } else {
    setTimeout(()=>{ buildNearbyMap(donorLat,donorLng); loadNearbyRequests(); },300);
  }

  // ── Real-time Nearest Pillars from Firestore (same city as donor) ──
  async function loadNearestPillars() {
    const pll = document.getElementById('nearestPillarsList');
    if (!pll) return;
    const donorCity = (_donorData?.city || window._donorData?.city || '').toLowerCase();
    pll.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px"><i class="fa-solid fa-spinner fa-spin"></i> Loading nearby centres…</div>';
    try {
      const [bbSnap, ngoSnap, hospSnap] = await Promise.all([
        getDocs(query(collection(db,'bloodbanks'), where('status','==','approved'))),
        getDocs(query(collection(db,'ngos'),       where('status','==','approved'))),
        getDocs(query(collection(db,'hospitals'),  where('status','==','approved')))
      ]);
      const cfg = [
        {docs:bbSnap.docs,  icon:'fa-flask',       color:'#3b82f6', type:'Blood Bank', nameField:'bbname'},
        {docs:ngoSnap.docs, icon:'fa-people-group', color:'#8b5cf6', type:'NGO',        nameField:'ngoname'},
        {docs:hospSnap.docs,icon:'fa-hospital',    color:'#e11d48', type:'Hospital',   nameField:'hospname'}
      ];
      let all = [];
      cfg.forEach(({docs,icon,color,type,nameField}) => {
        docs.forEach(d => {
          const data = d.data();
          const city = (data.city||'').toLowerCase();
          // Show if same city keyword matches OR no city filter yet
          if (!donorCity || city.includes(donorCity.split(',')[0].trim()) || donorCity.includes(city.split(',')[0].trim())) {
            all.push({id:d.id, name:data[nameField]||data.name||type, city:data.city||'', icon, color, type});
          }
        });
      });
      if (!all.length) {
        pll.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">No registered centres in your city yet</div>';
        return;
      }
      pll.innerHTML = all.slice(0,6).map(p => `
        <div class="pillar-item">
          <div class="pillar-icon" style="background:${p.color}22;color:${p.color}"><i class="fa-solid ${p.icon}"></i></div>
          <div style="flex:1;min-width:0">
            <div class="pillar-name">${p.name}</div>
            <div class="pillar-meta">${p.type} · ${p.city}</div>
          </div>
          <span class="chip" style="font-size:10px;background:${p.color}22;color:${p.color}">${p.type}</span>
        </div>`).join('');
    } catch(e) {
      console.error('Pillars load error:', e);
      pll.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px">Could not load centres</div>';
    }
  }
  // Load after donor data is ready
  setTimeout(loadNearestPillars, 1000);

  // ── Real-time Upcoming Camps from Firestore ───────────────
  async function loadUpcomingCamps() {
    const campsCard = document.getElementById('upcomingCampsList');
    if (!campsCard) return;
    const donorCity = (_donorData?.city || window._donorData?.city || '').toLowerCase().split(',')[0].trim();
    try {
      const q = query(collection(db,'camps'), where('status','==','active'));
      onSnapshot(q, async snap => {
        let camps = snap.docs.map(d=>({id:d.id,...d.data()}));
        // Filter by donor city
        if (donorCity) camps = camps.filter(c => {
          const cc = (c.city||c.location||'').toLowerCase();
          return cc.includes(donorCity) || donorCity.includes(cc.split(',')[0].trim());
        });
        // Sort by date
        camps.sort((a,b) => new Date(a.campDate||a.date||0) - new Date(b.campDate||b.date||0));
        if (!camps.length) {
          campsCard.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px"><i class="fa-solid fa-tent" style="display:block;font-size:24px;margin-bottom:8px;opacity:.4"></i>No upcoming camps in your city</div>`;
          return;
        }
        // Compute distances
        for (const c of camps) {
          if (c.lat && c.lng) { c._distKm = _haversine(donorLat,donorLng,c.lat,c.lng); }
          else if (c.city||c.location) {
            const coords = await _geocode(c.city||c.location);
            if (coords) c._distKm = _haversine(donorLat,donorLng,coords.lat,coords.lng);
          }
        }
        campsCard.innerHTML = camps.slice(0,4).map(c => {
          const d = new Date(c.campDate||c.date||Date.now());
          const day = d.getDate(); const mon = d.toLocaleString('en',{month:'short'}).toUpperCase();
          const dist = c._distKm?(c._distKm<1?(c._distKm*1000).toFixed(0)+' m':c._distKm.toFixed(1)+' km'):'';
          return `<div class="camp-row">
            <div class="camp-pill"><div class="day">${day}</div><div class="mon">${mon}</div></div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${c.campName||c.name||'Blood Camp'}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px"><i class="fa-solid fa-location-dot" style="color:var(--primary);font-size:10px"></i> ${c.location||c.city||'—'}${dist?' · '+dist:''}</div>
            </div>
            <button class="btn-primary" style="padding:7px 14px;font-size:12px" onclick="window.showToast('✅ Registered for ${(c.campName||'camp').replace(/'/g,'')}')">${c.registrationOpen!==false?'Join':'Remind'}</button>
          </div>`;
        }).join('');
      });
    } catch(e) { console.warn('Camps load error:', e); }
  }
  setTimeout(loadUpcomingCamps, 1200);

  // ════════════════════════════════════════════════════════
  //  APPOINTMENT BOOKING
  // ════════════════════════════════════════════════════════
  let _selectedApptType='donation', _selectedSlot='';
  window._myAppointments = [];

  const apptDateEl = document.getElementById('apptDate');
  if (apptDateEl) { apptDateEl.min=new Date().toISOString().split('T')[0]; apptDateEl.value=new Date().toISOString().split('T')[0]; }

  window.openApptModal = (type='donation') => {
    _selectedApptType=type; _selectedSlot='';
    document.querySelectorAll('.slot-btn:not(.full)').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.appt-type-btn').forEach(b=>b.classList.toggle('active',b.dataset.type===type));
    document.getElementById('apptModalTitle').textContent=type==='donation'?'Book Blood Donation Slot':'Book Verification Test';
    document.getElementById('apptModalOverlay').classList.add('open');
    document.body.style.overflow='hidden';
    window._loadCentres();
  };
  window.closeApptModal = () => { document.getElementById('apptModalOverlay').classList.remove('open'); document.body.style.overflow=''; };
  window.selectApptType = (btn, type) => {
    _selectedApptType=type;
    document.querySelectorAll('.appt-type-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    document.getElementById('apptModalTitle').textContent=type==='donation'?'Book Blood Donation Slot':'Book Screening Test';
    const dtRow=document.getElementById('donationTypeRow'); if(dtRow) dtRow.style.display=type==='test'?'none':'';
  };
  window.selectSlot = btn => {
    document.querySelectorAll('.slot-btn:not(.full)').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); _selectedSlot=btn.textContent.trim();
  };

  // ── D6: renderMyAppointments — exposed on window ──────────
  function renderMyAppointments() {
    const el   = document.getElementById('myApptList');
    const chip = document.getElementById('apptCountChip');
    if (!el) return;
    const upcoming = window._myAppointments.filter(a=>a.status!=='cancelled');
    if (chip) { chip.textContent=`${upcoming.length} upcoming`; chip.className=upcoming.length?'chip chip-ok':'chip chip-teal'; }
    if (!window._myAppointments.length) {
      el.innerHTML=`<div style="text-align:center;padding:16px 0;color:var(--text-muted);font-size:13px"><i class="fa-solid fa-calendar" style="display:block;font-size:22px;margin-bottom:8px;opacity:.3"></i>No appointments yet</div>`; return;
    }
    const statusColor={pending:'var(--warn)',confirmed:'var(--ok)',rescheduled:'var(--orange)',cancelled:'var(--text-muted)'};
    el.innerHTML=window._myAppointments.slice(0,4).map(a=>`<div class="my-appt-item"><div class="appt-dot" style="background:${statusColor[a.status]||'var(--warn)'}"></div><div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${a.type==='donation'?'🩸':'🧪'} ${a.type==='donation'?a.donationType:'Verification Test'}</div><div style="font-size:11px;color:var(--text-muted);margin-top:2px">${a.centreName} · ${a.date} · ${a.timeSlot}</div></div><span class="chip" style="font-size:10px;background:${statusColor[a.status]}22;color:${statusColor[a.status]}">${a.status.charAt(0).toUpperCase()+a.status.slice(1)}</span></div>`).join('');
  }
  window.renderMyAppointments = renderMyAppointments; // D6: expose for module's onSnapshot
  renderMyAppointments();

  window.submitAppointment = async () => {
    const centre=document.getElementById('apptCentre');
    const date  =document.getElementById('apptDate').value;
    const dtype =document.getElementById('apptDonationType').value;
    const notes =document.getElementById('apptNotes').value;
    if (!centre.value) { centre.style.borderColor='var(--danger)'; setTimeout(()=>{ centre.style.borderColor=''; },1500); window.showToast('⚠️ Please select a centre'); return; }
    if (!date)         { window.showToast('⚠️ Please select a date'); return; }
    if (!_selectedSlot){ window.showToast('⚠️ Please pick a time slot'); return; }
    const btn=document.getElementById('apptSubmitBtn');
    btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Confirming…'; btn.disabled=true;
    const centreType=centre.options[centre.selectedIndex].dataset.type||'BloodBank';
    const appointment={
      donorUid:        window._currentUser?.uid||'',
      donorPhone:      _donorData.phone||window._currentUser?.phoneNumber||'',
      donorName:       _donorData.name||'Unknown',
      donorBloodGroup: _donorData.bloodGroup||'Unknown',
      donorLifynkId:   _donorData.lifynkId||'',
      centreId:        centre.value,
      centreName:      centre.options[centre.selectedIndex].text.split('—')[0].trim(),
      centreType, type:_selectedApptType, donationType:dtype, date, timeSlot:_selectedSlot, notes, status:'pending'
    };
    try {
      if (window._saveAppointment) await window._saveAppointment(appointment);
      else await new Promise(r=>setTimeout(r,800));
      window._myAppointments.unshift({...appointment,id:'appt-'+Date.now()});
      renderMyAppointments();
      window.closeApptModal();
      window.showToast(`✅ Appointment booked at ${appointment.centreName} — ${date} · ${_selectedSlot}`);
    } catch(err) { console.error(err); window.showToast('❌ Could not book. Check connection.'); }
    finally { btn.innerHTML='<i class="fa-solid fa-calendar-check"></i> Confirm Appointment'; btn.disabled=false; }
  };

  // ── Medical Update Modal ──────────────────────────────────
  window.openModal = (type) => {
    document.getElementById('modalBody').innerHTML=`<div class="form-row"><div class="form-field"><label>Blood Pressure</label><input type="text" value="118/76"/></div><div class="form-field"><label>Hemoglobin (g/dL)</label><input type="number" value="14.2" step="0.1"/></div></div><div class="form-row"><div class="form-field"><label>Weight (kg)</label><input type="number" value="72"/></div><div class="form-field"><label>Pulse (bpm)</label><input type="number" value="72"/></div></div><div class="form-row"><div class="form-field"><label>Temperature (°F)</label><input type="number" value="98.6" step="0.1"/></div><div class="form-field"><label>Last Donation</label><input type="date" value="2026-01-12"/></div></div>`;
    document.getElementById('modalOverlay').classList.add('open');
  };
  window.closeModal = (e) => { if(!e||e.target===document.getElementById('modalOverlay')) document.getElementById('modalOverlay').classList.remove('open'); };

  // ── Nav routing ───────────────────────────────────────────
  const sections=['overview','donations','nearby','medical','heroes','profile','settings'];
  window.switchSection = (sec) => {
    document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
    document.querySelector(`[data-section="${sec}"]`)?.classList.add('active');
    sections.forEach(s=>{ const el=document.getElementById('sec-'+s); if(el) el.style.display=s===sec?'':'none'; });
    if (sec==='medical'&&!window._medResumeLoaded) { window._medResumeLoaded=true; if(window.loadMedicalReports) window.loadMedicalReports(); }
    if (sec==='nearby') loadNearbyRequests();
    if (sec==='heroes') loadLeaderboard(window._currentUser?.uid||'');
  };
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',e=>{ e.preventDefault(); const sec=item.dataset.section; if(!sec) return; window.switchSection(sec); });
  });

  // ── Toast ─────────────────────────────────────────────────
  window.showToast = (msg) => {
    const t=document.getElementById('toast');
    t.innerHTML=msg; t.style.transform='translateY(0)'; t.style.opacity='1';
    setTimeout(()=>{ t.style.transform='translateY(80px)'; t.style.opacity='0'; },3000);
  };

  // ── 3D Tilt ───────────────────────────────────────────────
  document.querySelectorAll('.d-card,.emergency-card').forEach(card=>{
    card.addEventListener('mousemove',e=>{ const r=card.getBoundingClientRect(); card.style.transform=`perspective(800px) rotateX(${((e.clientY-r.top-r.height/2)/(r.height/2))*-3}deg) rotateY(${((e.clientX-r.left-r.width/2)/(r.width/2))*3}deg) translateY(-4px)`; });
    card.addEventListener('mouseleave',()=>{ card.style.transition='transform 0.5s ease'; card.style.transform=''; });
    card.addEventListener('mouseenter',()=>{ card.style.transition='none'; });
  });

}); // end DOMContentLoaded
// ════════════════════════════════════════════════════════════
//  BROADCAST LISTENER — Donor
//  Listens to admin broadcasts targeted at 'donors'
//  Writes new ones to notifications/{uid}/items → triggers
//  existing notif panel + sound automatically
// ════════════════════════════════════════════════════════════
(function _initDonorBroadcastListener() {
  const ROLE = 'donor';
  let _lastBroadcastCheck = Date.now();

  auth.onAuthStateChanged
    ? auth.onAuthStateChanged(_hookBroadcast)
    : document.addEventListener('DOMContentLoaded', () => {
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js")
          .then(({ onAuthStateChanged }) => onAuthStateChanged(auth, _hookBroadcast));
      });

  async function _hookBroadcast(user) {
    if (!user) return;
    const uid = user.uid;

    const { collection, query, where, onSnapshot, addDoc,
            getDocs, serverTimestamp, orderBy, limit } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    // Listen to broadcasts targeting this role
    const bq = query(
      collection(db, 'broadcasts'),
      where('targets', 'array-contains', ROLE),
      orderBy('sentAt', 'desc'),
      limit(20)
    );

    let _init = true;
    onSnapshot(bq, snap => {
      if (_init) { _init = false; return; } // skip initial load, only react to new
      snap.docChanges()
        .filter(c => c.type === 'added')
        .forEach(async change => {
          const b   = change.doc.data();
          const now = Date.now();
          // Only process broadcasts sent after page load
          const sentMs = b.sentAt?.toMillis?.() || 0;
          if (sentMs < _lastBroadcastCheck) return;

          await addDoc(collection(db, 'notifications', uid, 'items'), {
            type:      'broadcast',
            priority:  b.priority || 'normal',
            title:     `📢 ${b.title || 'Announcement'}`,
            body:      b.message || '',
            read:      false,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        });
    });
  }
})();