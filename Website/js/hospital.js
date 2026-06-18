// ═══════════════════════════════════════════════════════════
//  hospital.js  —  Lifynk Hospital Dashboard
//  ES Module · All logic extracted from hospital-dashboard.html
// ═══════════════════════════════════════════════════════════

import { auth, db } from './firebase.js';
import {
  collection, query, where, orderBy,
  getDocs, getDoc, doc, onSnapshot, addDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── App State ────────────────────────────────────────────────
let currentUser    = null;
let userProfile    = null;          // { name, city, ... }
let allRequests    = [];            // bloodRequests docs
let allSurgeries   = [];            // surgeries docs
let selectedReqBg  = '';
let selectedSurgBg = '';
let donorMapInst   = null;          // Leaflet map instance
let auditUnsubscribe = null;

// ── Section List ─────────────────────────────────────────────
const ALL_SECTIONS = [
  'commandcenter', 'bloodinventory', 'donormatch',
  'surgeryschedule', 'audittrail', 'liverequest',
  'profile', 'settings',
];

// ════════════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = '../auth/login.html'; return; }
  currentUser = user;
  await loadProfile(user.uid);
  setupRealtimeListeners(user.uid);
  initUI();
});

async function loadProfile(uid) {
  try {
    const snap = await getDoc(doc(db, 'hospitals', uid));
    if (snap.exists()) {
      const d = snap.data();
      userProfile = d;
      const name = d.name || d.hospitalName || 'Hospital';
      const city = d.city || d.address || '';
      const av   = d.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0d9488&color=fff&size=80`;

      // Sidebar
      setEl('sidebarName', name);
      setEl('sidebarRole', city ? `Hospital · ${city}` : 'Hospital');
      setSrc('sidebarAvatar', av);

      // Header
      const ha = $('headerAvatar');
      if (ha) { ha.src = av; ha.style.display = ''; }
      $('headerAvatarPlaceholder')?.style && ($('headerAvatarPlaceholder').style.display = 'none');
      setSrc('hdpAvatar', av);
      setEl('hdpName', name);
      setSrc('profileAvatar', av);

      // Subtitle
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
      setEl('headerSubtitle', `${dateStr} · ${name}${city ? ', ' + city : ''}`);

      // Profile section fields
      setVal('pfHospitalName', name);
      setVal('pfRegNo', d.registrationNo || d.regNo || '');
      setVal('pfEmail', d.email || d.contactEmail || '');
      setVal('pfPhone', d.phone || d.contactPhone || '');
      setVal('pfAddress', d.address || '');
      setVal('pfCity', city);
      setVal('pfPincode', d.pincode || '');
      setEl('profileName', name);
      setEl('profileMeta', `Hospital · ${city || 'Ahmedabad'}`);

      // Cache
      localStorage.setItem('lifynkUser', JSON.stringify({ name, city, photoUrl: av }));
    }
  } catch (e) { console.warn('Profile fetch:', e); }
}

// ── Restore cache instantly on load ─────────────────────────
(function restoreCache() {
  try {
    const c = JSON.parse(localStorage.getItem('lifynkHospitalUser') || '{}');
    if (c.name) {
      const av = c.photoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=0d9488&color=fff&size=80`;
      setSrc('sidebarAvatar', av);
      setEl('sidebarName', c.name);
      setEl('sidebarRole', c.city ? `Hospital · ${c.city}` : 'Hospital');
    }
  } catch (e) {}
})();

// ════════════════════════════════════════════════════════════
//  REAL-TIME LISTENERS
// ════════════════════════════════════════════════════════════
function setupRealtimeListeners(uid) {
  listenBloodRequests(uid);
  listenSurgeries(uid);
  listenInventory(uid);
  listenAuditTrail(uid);
}

// ── Blood Requests ───────────────────────────────────────────
function listenBloodRequests(uid) {
  const q = query(
    collection(db, 'bloodRequests'),
    where('hospitalId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  onSnapshot(q, snap => {
    allRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRequestsTable(allRequests);
    updateRequestKPIs(allRequests);
    updateCommandCenterKPIs();
    updateActivityFeed();
    updateNavBadge();
    updateCriticalAlert();
  }, err => { console.warn('bloodRequests listener:', err); showRequestsLoaded([]); });
}

// ── Surgeries ────────────────────────────────────────────────
function listenSurgeries(uid) {
  const q = query(
    collection(db, 'surgeries'),
    where('hospitalId', '==', uid),
    orderBy('date', 'asc')
  );
  onSnapshot(q, snap => {
    allSurgeries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSurgeryTable(allSurgeries);
    updateSurgeryKPIs(allSurgeries);
    updateCommandCenterKPIs();
  }, err => { console.warn('surgeries listener:', err); });
}

// ── Blood Inventory ──────────────────────────────────────────
function listenInventory(uid) {
  const q = query(
    collection(db, 'bloodInventory'),
    where('hospitalId', '==', uid)
  );
  onSnapshot(q, snap => {
    const inv = {};
    snap.docs.forEach(d => { const data = d.data(); inv[data.bloodGroup] = data.units || 0; });
    renderInventoryGrid('inventoryFullGrid', inv);
    renderInventoryGrid('inventoryOverviewGrid', inv);
    updateBloodOnHandKPI(inv);
  }, err => {
    console.warn('inventory listener:', err);
    renderInventoryGrid('inventoryFullGrid', {});
    renderInventoryGrid('inventoryOverviewGrid', {});
  });
}

// ── Audit Trail ──────────────────────────────────────────────
function listenAuditTrail(uid) {
  if (auditUnsubscribe) auditUnsubscribe();
  const filterType = $('auditFilterType')?.value || 'all';
  // Build audit from bloodRequests + surgeries in memory after both listeners fire
  renderAuditTrail();
}

// ════════════════════════════════════════════════════════════
//  RENDER — BLOOD REQUESTS TABLE
// ════════════════════════════════════════════════════════════
function showRequestsLoaded(requests) {
  $('requestsLoading')  && ($('requestsLoading').style.display  = 'none');
  $('requestsTableWrap')&& ($('requestsTableWrap').style.display= requests.length ? '' : 'none');
  $('requestsEmpty')    && ($('requestsEmpty').style.display    = requests.length ? 'none' : '');
}

function renderRequestsTable(requests) {
  const tbody = $('requestsTableBody');
  if (!tbody) return;
  showRequestsLoaded(requests);
  if (!requests.length) return;

  const statusConf = {
    open:         { label:'Open',         cls:'req-open' },
    acknowledged: { label:'Acknowledged', cls:'req-acknowledged' },
    in_progress:  { label:'In Progress',  cls:'req-in_progress' },
    dispatched:   { label:'Dispatched',   cls:'req-dispatched' },
    received:     { label:'Received',     cls:'req-received' },
    cancelled:    { label:'Cancelled',    cls:'req-cancelled' },
  };
  const urgConf = {
    critical: { cls:'urg-critical', label:'Critical' },
    urgent:   { cls:'urg-urgent',   label:'Urgent' },
    routine:  { cls:'urg-routine',  label:'Routine' },
  };

  tbody.innerHTML = requests.map(r => {
    const sc  = statusConf[r.status] || statusConf.open;
    const uc  = urgConf[r.urgency]   || urgConf.routine;
    const ts  = r.createdAt?.toDate ? r.createdAt.toDate() : (r.createdAt?.seconds ? new Date(r.createdAt.seconds * 1000) : new Date());
    const timeStr = ts.toLocaleDateString('en-IN', { day:'numeric', month:'short' }) + ' · ' + ts.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    const bbName  = r.acceptedByBBName || '—';
    const canConfirm = r.status === 'dispatched';
    const canCancel  = r.status === 'open';

    return `<tr id="reqrow-${r.id}">
      <td><span style="font-size:16px;font-weight:900;color:var(--danger)">${r.bloodGroup || '?'}</span></td>
      <td><strong>${r.units || '?'}</strong> units</td>
      <td><span class="chip ${uc.cls}">${uc.label}</span></td>
      <td style="color:var(--text-muted);font-size:12px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.patientInfo || '—'}</td>
      <td><span class="chip ${sc.cls}">${sc.label}</span></td>
      <td style="font-size:12px;color:var(--text-secondary)">${bbName}</td>
      <td style="font-size:12px;color:var(--text-muted)">${timeStr}</td>
      <td>
        <div style="display:flex;gap:6px">
          ${canConfirm ? `<button class="btn-primary" style="font-size:11px;padding:5px 10px;border-radius:7px" data-action="confirm-received" data-id="${r.id}"><i class="fa-solid fa-check"></i> Received</button>` : ''}
          ${canCancel  ? `<button class="btn-ghost" style="font-size:11px;padding:5px 10px;border-radius:7px;border-color:var(--danger);color:var(--danger)" data-action="cancel-request" data-id="${r.id}"><i class="fa-solid fa-xmark"></i></button>` : ''}
          ${!canConfirm && !canCancel ? `<span style="font-size:11px;color:var(--text-muted)">—</span>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════
//  RENDER — SURGERY TABLE
// ════════════════════════════════════════════════════════════
function renderSurgeryTable(surgeries) {
  const tbody  = $('surgeryTableBody');
  const wrap   = $('surgeryTableWrap');
  const empty  = $('surgeryEmpty');
  if (!tbody) return;

  if (!surgeries.length) {
    wrap  && (wrap.style.display  = 'none');
    empty && (empty.style.display = '');
    return;
  }
  wrap  && (wrap.style.display  = '');
  empty && (empty.style.display = 'none');

  tbody.innerHTML = surgeries.map(s => {
    const dt     = s.date?.toDate ? s.date.toDate() : new Date(s.date || Date.now());
    const dateStr = dt.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    const timeStr = s.time || dt.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    const covered = s.bloodCovered || false;
    const statusCls  = covered ? 'surgery-status-covered' : 'surgery-status-pending';
    const statusLabel = covered ? '✅ Covered' : '⏳ Pending Blood';

    return `<tr>
      <td><div style="font-weight:700;color:var(--text-primary)">${s.name || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted)">${s.ward || ''}</div></td>
      <td>${dateStr} · ${timeStr}</td>
      <td style="font-size:13px;color:var(--text-secondary)">${s.surgeon || '—'}</td>
      <td><span class="surgery-row-bg">${s.bloodGroup || '?'}</span></td>
      <td><strong>${s.units || '?'}</strong> u</td>
      <td><span class="${statusCls}" style="font-size:13px;font-weight:700">${statusLabel}</span></td>
      <td>
        ${!covered ? `<button class="btn-primary" style="font-size:11px;padding:5px 10px;border-radius:7px" data-action="request-for-surgery" data-bg="${s.bloodGroup}" data-units="${s.units}">Request Blood</button>` : '<span style="font-size:11px;color:var(--text-muted)">—</span>'}
      </td>
    </tr>`;
  }).join('');

  setEl('surgeryCountTag', `${surgeries.length} scheduled`);
}

function updateSurgeryKPIs(surgeries) {
  const now      = new Date();
  const oneWeek  = new Date(now.getTime() + 7 * 86400 * 1000);
  const upcoming = surgeries.filter(s => {
    const dt = s.date?.toDate ? s.date.toDate() : new Date(s.date || 0);
    return dt >= now && dt <= oneWeek;
  });
  const unitsNeeded = upcoming.reduce((t, s) => t + (parseInt(s.units) || 0), 0);
  const covered  = upcoming.filter(s => s.bloodCovered).length;
  const pending  = upcoming.filter(s => !s.bloodCovered).length;

  setEl('surgKpiUpcoming',     upcoming.length || '0');
  setEl('surgKpiUnitsNeeded',  unitsNeeded || '0');
  setEl('surgKpiCovered',      covered || '0');
  setEl('surgKpiPending',      pending || '0');

  const badge = $('surgeryNavBadge');
  if (badge) { badge.textContent = pending; badge.style.display = pending ? '' : 'none'; }
}

// ════════════════════════════════════════════════════════════
//  RENDER — INVENTORY GRID
// ════════════════════════════════════════════════════════════
const BLOOD_GROUPS = ['A+','A-','B+','B-','AB+','AB-','O+','O-'];
const BG_MAX_UNITS = 20; // reference max for bar

function renderInventoryGrid(containerId, inv) {
  const el = $(containerId);
  if (!el) return;

  const COLORS = {
    'A+':'#3b82f6','A-':'#6366f1','B+':'#0d9488','B-':'#14b8a6',
    'AB+':'#8b5cf6','AB-':'#a855f7','O+':'#e11d48','O-':'#f97316',
  };

  el.innerHTML = BLOOD_GROUPS.map(bg => {
    const units = inv[bg] !== undefined ? inv[bg] : 0;
    const pct   = Math.min(100, Math.round((units / BG_MAX_UNITS) * 100));
    const level = units === 0 ? 'critical' : units < 5 ? 'low' : 'ok';
    const statusLabel = units === 0 ? '<span class="chip chip-danger" style="font-size:10px;padding:2px 7px">Out of stock</span>'
                      : units < 5  ? '<span class="chip chip-warn" style="font-size:10px;padding:2px 7px">Low</span>'
                                   : '<span class="chip chip-ok" style="font-size:10px;padding:2px 7px">OK</span>';
    return `<div class="inv-card ${level}">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div class="inv-bg-label" style="color:${COLORS[bg]}">${bg}</div>
        ${statusLabel}
      </div>
      <div class="inv-units">${units}<span style="font-size:14px;font-weight:600;color:var(--text-muted)"> u</span></div>
      <div class="inv-bar-wrap"><div class="inv-bar" style="width:0%;background:${COLORS[bg]}" data-width="${pct}%"></div></div>
    </div>`;
  }).join('');

  // Animate bars
  setTimeout(() => {
    el.querySelectorAll('.inv-bar[data-width]').forEach(b => { b.style.width = b.dataset.width; });
  }, 200);
}

function updateBloodOnHandKPI(inv) {
  const total = Object.values(inv).reduce((t, v) => t + (parseInt(v) || 0), 0);
  setEl('kpiBloodOnHand', total);
  const critGroups = BLOOD_GROUPS.filter(bg => (inv[bg] || 0) === 0);
  setEl('kpiBloodOnHandSub', critGroups.length ? `${critGroups.join(', ')} out of stock` : 'All groups stocked');
}

// ════════════════════════════════════════════════════════════
//  RENDER — AUDIT TRAIL
// ════════════════════════════════════════════════════════════
function renderAuditTrail() {
  const el = $('auditTrailList');
  if (!el) return;
  const filterType = $('auditFilterType')?.value || 'all';

  // Build events from in-memory data
  const events = [];

  allRequests.forEach(r => {
    if (filterType !== 'all' && filterType !== 'request') return;
    const ts = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt?.seconds * 1000 || 0);
    events.push({
      icon: 'fa-paper-plane', color: 'var(--blue)', bg: 'var(--blue-dim)',
      title: `Blood request — ${r.bloodGroup} · ${r.units} units`,
      meta: `Status: ${capitalize(r.status)}${r.acceptedByBBName ? ' · ' + r.acceptedByBBName : ''}`,
      ts,
    });
    if (r.status === 'received') {
      const rt = r.receivedAt?.toDate ? r.receivedAt.toDate() : null;
      if (rt) events.push({
        icon: 'fa-circle-check', color: 'var(--ok)', bg: 'var(--ok-dim)',
        title: `Blood received — ${r.bloodGroup} · ${r.dispatchedUnits || r.units} units`,
        meta: `From ${r.acceptedByBBName || 'blood bank'}`,
        ts: rt,
      });
    }
    if (r.status === 'dispatched') {
      const dt = r.dispatchedAt?.toDate ? r.dispatchedAt.toDate() : null;
      if (dt) events.push({
        icon: 'fa-truck-medical', color: 'var(--primary)', bg: 'rgba(13,148,136,.1)',
        title: `Blood dispatched — ${r.bloodGroup} · ${r.dispatchedUnits || r.units} units`,
        meta: `By ${r.acceptedByBBName || 'blood bank'}`,
        ts: dt,
      });
    }
  });

  allSurgeries.forEach(s => {
    if (filterType !== 'all' && filterType !== 'surgery') return;
    const ts = s.createdAt?.toDate ? s.createdAt.toDate() : new Date(s.createdAt?.seconds * 1000 || 0);
    events.push({
      icon: 'fa-scalpel', color: 'var(--purple)', bg: 'var(--purple-dim)',
      title: `Surgery scheduled — ${s.name}`,
      meta: `${s.bloodGroup} · ${s.units} units · ${s.surgeon || 'Unknown surgeon'}`,
      ts,
    });
  });

  // Sort newest first
  events.sort((a, b) => b.ts - a.ts);

  if (!events.length) {
    el.innerHTML = `<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><h3>No activity yet</h3><p>Your actions will be logged here.</p></div>`;
    return;
  }

  el.innerHTML = events.slice(0, 50).map(e => `
    <div class="audit-item">
      <div class="audit-icon" style="background:${e.bg};color:${e.color}"><i class="fa-solid ${e.icon}"></i></div>
      <div class="audit-body">
        <div class="audit-title">${e.title}</div>
        <div class="audit-meta">${e.meta}</div>
      </div>
      <div class="audit-time">${fmtTime(e.ts)}</div>
    </div>`).join('');
}

// ════════════════════════════════════════════════════════════
//  RENDER — COMMAND CENTER
// ════════════════════════════════════════════════════════════
function updateCommandCenterKPIs() {
  // Active requests (open + acknowledged + in_progress)
  const active = allRequests.filter(r => ['open','acknowledged','in_progress'].includes(r.status)).length;
  setEl('kpiActiveReqs', active || '0');
  setEl('kpiActiveReqsSub', active ? `${active} active request${active > 1 ? 's' : ''}` : 'No active requests');

  // Surgeries this week
  const now      = new Date();
  const oneWeek  = new Date(now.getTime() + 7 * 86400 * 1000);
  const surgsThisWeek = allSurgeries.filter(s => {
    const dt = s.date?.toDate ? s.date.toDate() : new Date(s.date || 0);
    return dt >= now && dt <= oneWeek;
  });
  setEl('kpiSurgeries', surgsThisWeek.length || '0');
  const pendingSurgs = surgsThisWeek.filter(s => !s.bloodCovered).length;
  setEl('kpiSurgeriesSub', pendingSurgs ? `${pendingSurgs} need blood` : 'All covered');

  // Dispatched today
  const today    = new Date(); today.setHours(0,0,0,0);
  const dispatched = allRequests.filter(r => {
    if (r.status !== 'dispatched' && r.status !== 'received') return false;
    const dt = r.dispatchedAt?.toDate ? r.dispatchedAt.toDate() : null;
    return dt && dt >= today;
  });
  setEl('kpiDispatched', dispatched.length || '0');

  drawSparklines();
}

function updateRequestKPIs(requests) {
  setEl('reqKpiOpen',       requests.filter(r => r.status === 'open').length || '0');
  setEl('reqKpiAck',        requests.filter(r => r.status === 'acknowledged').length || '0');
  setEl('reqKpiInProg',     requests.filter(r => r.status === 'in_progress').length || '0');
  setEl('reqKpiDispatched', requests.filter(r => r.status === 'dispatched').length || '0');
}

function updateNavBadge() {
  const active = allRequests.filter(r => ['open','acknowledged','in_progress'].includes(r.status)).length;
  const badge  = $('requestNavBadge');
  if (badge) { badge.textContent = active; badge.style.display = active ? '' : 'none'; }
}

function updateCriticalAlert() {
  const critical = allRequests.filter(r => r.urgency === 'critical' && ['open','acknowledged'].includes(r.status)).length;
  const alertEl  = $('criticalAlert');
  if (!alertEl) return;
  if (critical) {
    alertEl.style.display = '';
    setEl('criticalAlertText', `${critical} Critical Request${critical > 1 ? 's' : ''}`);
  } else {
    alertEl.style.display = 'none';
  }
}

function updateActivityFeed() {
  const el = $('recentActivityList');
  if (!el) return;
  const events = [];

  allRequests.slice(0, 8).forEach(r => {
    const ts = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt?.seconds * 1000 || 0);
    const urgConf = { critical:'var(--danger)', urgent:'var(--warn)', routine:'var(--ok)' };
    events.push({
      icon: 'fa-droplet', color: urgConf[r.urgency] || 'var(--blue)',
      title: `${r.bloodGroup} · ${r.units} units — ${capitalize(r.status)}`,
      meta: r.acceptedByBBName ? `Assigned: ${r.acceptedByBBName}` : `Urgency: ${capitalize(r.urgency || 'routine')}`,
      ts,
    });
  });

  allSurgeries.slice(0, 4).forEach(s => {
    const ts = s.createdAt?.toDate ? s.createdAt.toDate() : new Date(s.createdAt?.seconds * 1000 || 0);
    events.push({ icon:'fa-scalpel', color:'var(--purple)', title:`Surgery: ${s.name}`, meta:`${s.bloodGroup} · ${s.units} units`, ts });
  });

  events.sort((a, b) => b.ts - a.ts);

  if (!events.length) {
    el.innerHTML = `<div class="empty-state" style="padding:24px 0"><i class="fa-solid fa-clock" style="font-size:28px"></i><h3>No activity yet</h3><p>Your actions will appear here.</p></div>`;
    return;
  }

  el.innerHTML = events.slice(0, 8).map(e => `
    <div class="audit-item">
      <div class="audit-icon" style="background:${e.color}22;color:${e.color}"><i class="fa-solid ${e.icon}"></i></div>
      <div class="audit-body"><div class="audit-title">${e.title}</div><div class="audit-meta">${e.meta}</div></div>
      <div class="audit-time">${fmtTime(e.ts)}</div>
    </div>`).join('');

  // Critical Alerts panel
  const alertsEl = $('criticalAlertsList');
  if (!alertsEl) return;
  const critReqs = allRequests.filter(r => r.urgency === 'critical' && ['open','acknowledged'].includes(r.status));
  const lowStock = []; // populated by inventory listener via window event if needed

  if (!critReqs.length) {
    alertsEl.innerHTML = `<div style="text-align:center;padding:24px 0"><i class="fa-solid fa-circle-check" style="font-size:28px;color:var(--ok);display:block;margin-bottom:8px"></i><div style="font-size:13px;font-weight:700;color:var(--text-primary)">All clear</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">No critical alerts</div></div>`;
    return;
  }
  alertsEl.innerHTML = critReqs.map(r => `
    <div class="alert-banner critical">
      <i class="fa-solid fa-triangle-exclamation" style="color:var(--danger);margin-top:2px;flex-shrink:0"></i>
      <div><div style="font-size:13px;font-weight:700;color:var(--text-primary)">Critical: ${r.bloodGroup} · ${r.units} units</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${r.patientInfo || 'Awaiting blood bank response'}</div></div>
    </div>`).join('');
}

// ════════════════════════════════════════════════════════════
//  SUBMIT — BLOOD REQUEST
// ════════════════════════════════════════════════════════════
async function submitBloodRequest() {
  const units   = parseInt($('reqUnits')?.value || 0);
  const urgency = $('reqUrgency')?.value;
  const notes   = $('reqNotes')?.value?.trim() || '';
  const patient = $('reqPatientInfo')?.value?.trim() || '';

  if (!selectedReqBg)  return showToast('⚠️ Please select a blood group', true);
  if (!units || units < 1) return showToast('⚠️ Enter valid units', true);
  if (!urgency)         return showToast('⚠️ Select urgency level', true);

  const btn = $('submitRequestBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';

  try {
    const expiryHours = { critical: 4, urgent: 12, routine: 48 };
    const hrs = expiryHours[urgency] || 48;
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + hrs * 3600 * 1000));

    await addDoc(collection(db, 'bloodRequests'), {
      hospitalId:   currentUser.uid,
      hospitalName: userProfile?.name || userProfile?.hospitalName || 'Hospital',
      city:         userProfile?.city || '',
      bloodGroup:   selectedReqBg,
      units,
      urgency,
      patientInfo:  patient,
      notes,
      status:       'open',
      acceptedByBBId:   null,
      acceptedByBBName: null,
      acceptedAt:       null,
      reservedUnits:    0,
      dispatchedUnits:  0,
      dispatchedAt:     null,
      receivedAt:       null,
      expiresAt,
      createdAt:    serverTimestamp(),
      timeline:     [{ status:'open', note:'Request created by hospital', ts: new Date().toISOString() }],
    });

    closeModal('bloodRequestModalOverlay');
    resetRequestForm();
    showToast(`✅ ${selectedReqBg} · ${units} units request sent!`);
    switchSection('liverequest');
  } catch (e) {
    console.error('submitBloodRequest:', e);
    showToast('❌ Failed to send request: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Request';
  }
}

function resetRequestForm() {
  setVal('reqUnits', '');
  setVal('reqUrgency', '');
  setVal('reqPatientInfo', '');
  setVal('reqNotes', '');
  selectedReqBg = '';
  document.querySelectorAll('#reqBgPicker .bg-btn').forEach(b => b.classList.remove('selected'));
  $('reqExpiryCopy') && ($('reqExpiryCopy').style.display = 'none');
}

// ── Confirm Received ─────────────────────────────────────────
async function confirmReceived(requestId) {
  try {
    await updateDoc(doc(db, 'bloodRequests', requestId), {
      status:     'received',
      receivedAt: serverTimestamp(),
      timeline:   /* append — omit for now */ [],
    });
    showToast('✅ Blood marked as received!');
  } catch (e) { showToast('❌ Error: ' + e.message, true); }
}

// ── Cancel Request ───────────────────────────────────────────
async function cancelRequest(requestId) {
  if (!confirm('Cancel this blood request?')) return;
  try {
    await updateDoc(doc(db, 'bloodRequests', requestId), {
      status:    'cancelled',
      timeline:  [],
    });
    showToast('🚫 Request cancelled');
  } catch (e) { showToast('❌ Error: ' + e.message, true); }
}

// ════════════════════════════════════════════════════════════
//  SUBMIT — SURGERY
// ════════════════════════════════════════════════════════════
async function submitSurgery() {
  const name    = $('surgName')?.value?.trim();
  const date    = $('surgDate')?.value;
  const time    = $('surgTime')?.value;
  const units   = parseInt($('surgUnits')?.value || 0);
  const surgeon = $('surgSurgeon')?.value?.trim() || '';
  const ward    = $('surgWard')?.value?.trim() || '';
  const notes   = $('surgNotes')?.value?.trim() || '';

  if (!name)    return showToast('⚠️ Surgery name required', true);
  if (!date)    return showToast('⚠️ Date required', true);
  if (!selectedSurgBg) return showToast('⚠️ Select blood group', true);
  if (!units)   return showToast('⚠️ Enter units required', true);

  const btn = $('submitSurgeryBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';

  try {
    await addDoc(collection(db, 'surgeries'), {
      hospitalId:   currentUser.uid,
      hospitalName: userProfile?.name || 'Hospital',
      name,
      surgeon,
      ward,
      date:         Timestamp.fromDate(new Date(`${date}T${time || '09:00'}:00`)),
      time,
      bloodGroup:   selectedSurgBg,
      units,
      notes,
      bloodCovered: false,
      createdAt:    serverTimestamp(),
    });

    closeModal('surgeryModalOverlay');
    resetSurgeryForm();
    showToast(`✅ Surgery "${name}" added`);
  } catch (e) {
    console.error('submitSurgery:', e);
    showToast('❌ Error: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Save Surgery';
  }
}

function resetSurgeryForm() {
  ['surgName','surgSurgeon','surgDate','surgWard','surgNotes'].forEach(id => setVal(id, ''));
  setVal('surgUnits', '');
  setVal('surgTime', '09:00');
  selectedSurgBg = '';
  document.querySelectorAll('#surgBgPicker .bg-btn').forEach(b => b.classList.remove('selected'));
}

// ════════════════════════════════════════════════════════════
//  DONOR MATCH
// ════════════════════════════════════════════════════════════
let donorListData   = [];
let selectedDonorBg = 'all';

function loadDonorMatch(bloodGroup) {
  selectedDonorBg = bloodGroup;
  const city = userProfile?.city || '';
  let q;
  if (bloodGroup === 'all') {
    q = query(collection(db, 'donors'), where('verified', '==', true), where('city', '==', city));
  } else {
    q = query(collection(db, 'donors'), where('bloodGroup', '==', bloodGroup), where('verified', '==', true), where('city', '==', city));
  }

  const wrap = $('donorListWrap');
  if (wrap) wrap.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading donors…</p></div>';

  onSnapshot(q, snap => {
    donorListData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDonorTable(donorListData);
    updateDonorMap(donorListData);
  }, () => {
    if (wrap) wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-users"></i><h3>No verified donors found</h3><p>Donors matching this blood group will appear here.</p></div>';
  });
}

function renderDonorTable(donors) {
  const wrap = $('donorListWrap');
  if (!wrap) return;
  const searchVal = ($('donorSearchInput')?.value || '').toLowerCase();
  const filtered  = donors.filter(d => {
    if (!searchVal) return true;
    return (d.name || '').toLowerCase().includes(searchVal);
  });

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-users"></i><h3>No donors found</h3><p>Try a different blood group or search term.</p></div>`;
    return;
  }

  wrap.innerHTML = `<table class="h-table">
    <thead><tr><th>Donor</th><th>Blood Group</th><th>Last Donated</th><th>Eligibility</th><th>Action</th></tr></thead>
    <tbody>${filtered.map(d => {
      const init   = (d.name || 'D').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      const lastDon = d.lastDonationDate?.toDate ? d.lastDonationDate.toDate() : null;
      const lastStr = lastDon ? lastDon.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : 'Never';
      const eligible = d.eligible !== false;
      const statusChip = eligible
        ? '<span class="chip chip-ok">Eligible</span>'
        : '<span class="chip chip-warn">Cooling Down</span>';
      return `<tr>
        <td><div style="display:flex;align-items:center;gap:10px"><div class="h-avatar">${init}</div><div><div style="font-weight:700;color:var(--text-primary)">${d.name || '—'}</div><div style="font-size:11px;color:var(--text-muted)">${d.city || ''}</div></div></div></td>
        <td><span style="font-size:14px;font-weight:800;color:var(--danger)">${d.bloodGroup || '?'}</span></td>
        <td style="font-size:12px;color:var(--text-muted)">${lastStr}</td>
        <td>${statusChip}</td>
        <td><button class="btn-ghost" style="font-size:11px;padding:5px 10px;border-radius:7px" ${eligible ? '' : 'disabled'}>Contact</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function updateDonorMap(donors) {
  if (!window.L) return;
  if (!donorMapInst) {
    const mapEl = $('donorMap');
    if (!mapEl || mapEl._mapInit) return;
    mapEl._mapInit = true;
    donorMapInst = L.map('donorMap', { zoomControl:true, scrollWheelZoom:false }).setView([23.0225, 72.5714], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap' }).addTo(donorMapInst);
  }
  // Clear existing markers and add new ones
  donorMapInst.eachLayer(layer => { if (layer instanceof L.CircleMarker) donorMapInst.removeLayer(layer); });
  donors.forEach(d => {
    if (!d.lat || !d.lng) return;
    const eligible = d.eligible !== false;
    L.circleMarker([d.lat, d.lng], {
      radius: 7, fillColor: eligible ? '#0d9488' : '#f59e0b',
      color: '#fff', weight: 2, fillOpacity: .85,
    }).addTo(donorMapInst).bindPopup(`<strong>${d.name || 'Donor'}</strong><br>${d.bloodGroup} · ${eligible ? 'Eligible' : 'Cooling Down'}`);
  });
}

// ════════════════════════════════════════════════════════════
//  SECTION SWITCHING
// ════════════════════════════════════════════════════════════
function switchSection(sec) {
  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`[data-section="${sec}"]`)?.classList.add('active');

  // Show/hide sections
  ALL_SECTIONS.forEach(s => {
    const el = $('sec-' + s);
    if (el) el.style.display = s === sec ? '' : 'none';
  });

  // Section-specific init
  const titles = {
    commandcenter:   'Command Center 🏥',
    bloodinventory:  'Blood Inventory 🩸',
    donormatch:      'Donor Match 👥',
    surgeryschedule: 'Surgery Schedule 🔪',
    audittrail:      'Audit Trail 📋',
    liverequest:     'Live Requests 🚨',
    profile:         'My Profile 👤',
    settings:        'Settings ⚙️',
  };
  setEl('headerTitle', titles[sec] || 'Hospital');

  if (sec === 'donormatch') {
    loadDonorMatch(selectedDonorBg || 'all');
    setTimeout(() => donorMapInst && donorMapInst.invalidateSize(), 200);
  }
  if (sec === 'audittrail') renderAuditTrail();
  if (sec === 'commandcenter') drawSparklines();
}

// ════════════════════════════════════════════════════════════
//  UI INIT
// ════════════════════════════════════════════════════════════
function initUI() {
  initTheme();
  initNavigation();
  initHeaderDropdown();
  initModals();
  initBgPickers();
  initDonorFilter();
  initAuditFilter();
  init3DTilt();
  switchSection('commandcenter');
  drawSparklines();
}

// ── Theme ────────────────────────────────────────────────────
function initTheme() {
  const html  = document.documentElement;
  const btn   = $('themeToggle');
  const btn2  = $('themeToggleSettings');
  const saved = localStorage.getItem('LifynkTheme') || 'light';
  html.setAttribute('data-theme', saved);
  if (btn) btn.innerHTML = saved === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';

  function toggle() {
    const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', next);
    localStorage.setItem('LifynkTheme', next);
    if (btn) btn.innerHTML = next === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
  }
  btn  && btn.addEventListener('click', toggle);
  btn2 && btn2.addEventListener('click', toggle);
}

// ── Navigation ───────────────────────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-item[data-section], .btn-ghost[data-section], .hpd-item[data-section]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); switchSection(el.dataset.section); });
  });

  // Sidebar logout icon
  $('sidebarLogout')?.addEventListener('click', doLogout);

  // Critical alert banner → go to live requests
  $('criticalAlert')?.addEventListener('click', () => switchSection('liverequest'));

  // Request button in inventory shortcut
  $('requestBloodShortcut')?.addEventListener('click', () => switchSection('liverequest'));
}

// ── Header Dropdown ──────────────────────────────────────────
function initHeaderDropdown() {
  const wrap     = $('headerAvatarWrap');
  const dropdown = $('headerDropdown');
  if (!wrap || !dropdown) return;

  // Teleport to body to avoid overflow clipping
  document.body.appendChild(dropdown);

  function position() {
    const rect = wrap.getBoundingClientRect();
    dropdown.style.top   = (rect.bottom + 8) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.style.left  = 'auto';
  }

  wrap.addEventListener('click', e => {
    e.stopPropagation();
    if (!dropdown.classList.contains('open')) position();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
  });

  $('changePhotoBtn')?.addEventListener('click', () => $('profilePhotoInput')?.click());
  $('logoutBtn')?.addEventListener('click', doLogout);

  $('profilePhotoInput')?.addEventListener('change', function() { uploadProfilePhoto(this); });
}

// ── Modals ───────────────────────────────────────────────────
function initModals() {
  // Blood Request Modal
  $('openRequestModalBtn')?.addEventListener('click', () => openModal('bloodRequestModalOverlay'));
  $('emptyStateNewReqBtn')?.addEventListener('click', () => openModal('bloodRequestModalOverlay'));
  $('closeRequestModalBtn')?.addEventListener('click', () => { closeModal('bloodRequestModalOverlay'); resetRequestForm(); });
  $('cancelRequestModalBtn')?.addEventListener('click', () => { closeModal('bloodRequestModalOverlay'); resetRequestForm(); });
  $('bloodRequestModalOverlay')?.addEventListener('click', e => { if (e.target.id === 'bloodRequestModalOverlay') { closeModal('bloodRequestModalOverlay'); resetRequestForm(); } });
  $('submitRequestBtn')?.addEventListener('click', submitBloodRequest);

  // Surgery Modal
  $('openSurgeryModalBtn')?.addEventListener('click', () => openModal('surgeryModalOverlay'));
  $('closeSurgeryModalBtn')?.addEventListener('click', () => { closeModal('surgeryModalOverlay'); resetSurgeryForm(); });
  $('cancelSurgeryBtn')?.addEventListener('click', () => { closeModal('surgeryModalOverlay'); resetSurgeryForm(); });
  $('surgeryModalOverlay')?.addEventListener('click', e => { if (e.target.id === 'surgeryModalOverlay') { closeModal('surgeryModalOverlay'); resetSurgeryForm(); } });
  $('submitSurgeryBtn')?.addEventListener('click', submitSurgery);

  // Urgency → expiry copy
  $('reqUrgency')?.addEventListener('change', function() {
    const hrs = { critical:4, urgent:12, routine:48 };
    const h   = hrs[this.value];
    const box = $('reqExpiryCopy');
    if (h && box) {
      box.style.display = '';
      setEl('reqExpiryText', `This request will expire in ${h} hour${h > 1 ? 's' : ''} if not acknowledged.`);
    } else if (box) box.style.display = 'none';
  });

  // Table action delegation
  $('requestsTableBody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'confirm-received') confirmReceived(id);
    if (action === 'cancel-request')   cancelRequest(id);
  });

  $('surgeryTableBody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'request-for-surgery') {
      selectedReqBg = btn.dataset.bg || '';
      document.querySelectorAll('#reqBgPicker .bg-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.bg === selectedReqBg);
      });
      setVal('reqUnits', btn.dataset.units || '');
      openModal('bloodRequestModalOverlay');
    }
  });
}

// ── Blood Group Pickers ──────────────────────────────────────
function initBgPickers() {
  // Request modal picker
  document.querySelectorAll('#reqBgPicker .bg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#reqBgPicker .bg-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedReqBg = btn.dataset.bg;
    });
  });

  // Surgery modal picker
  document.querySelectorAll('#surgBgPicker .bg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#surgBgPicker .bg-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSurgBg = btn.dataset.bg;
    });
  });
}

// ── Donor Filter Buttons ─────────────────────────────────────
function initDonorFilter() {
  document.querySelectorAll('.bg-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadDonorMatch(btn.dataset.bg);
    });
  });

  $('donorSearchInput')?.addEventListener('input', () => renderDonorTable(donorListData));
}

// ── Audit Filter ─────────────────────────────────────────────
function initAuditFilter() {
  $('auditFilterType')?.addEventListener('change', renderAuditTrail);
}

// ── 3D Tilt Cards ─────────────────────────────────────────────
function init3DTilt() {
  document.querySelectorAll('.h-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const r = card.getBoundingClientRect();
      card.style.transform = `perspective(800px) rotateX(${((e.clientY - r.top - r.height / 2) / (r.height / 2)) * -3}deg) rotateY(${((e.clientX - r.left - r.width / 2) / (r.width / 2)) * 3}deg) translateY(-4px)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transition = 'transform 0.5s ease'; card.style.transform = ''; });
    card.addEventListener('mouseenter', () => { card.style.transition = 'none'; });
  });
}

// ── Sparklines ───────────────────────────────────────────────
function drawSparklines() {
  const reqCounts   = allRequests.length ? buildTrend(allRequests, 7) : [0,0,0,1,1,1,1];
  const surgCounts  = allSurgeries.length ? buildTrend(allSurgeries, 7) : [0,0,1,1,1,2,2];
  drawSparkline('sp1', reqCounts, '#3b82f6');
  drawSparkline('sp2', [10,12,8,15,9,14,12], '#e11d48');
  drawSparkline('sp3', surgCounts, '#8b5cf6');
  drawSparkline('sp4', [1,0,2,1,3,2,1], '#22c55e');
}

function buildTrend(docs, days) {
  const buckets = new Array(days).fill(0);
  const now = Date.now();
  docs.forEach(d => {
    const ts = d.createdAt?.seconds ? d.createdAt.seconds * 1000 : 0;
    const dayIdx = days - 1 - Math.floor((now - ts) / 86400000);
    if (dayIdx >= 0 && dayIdx < days) buckets[dayIdx]++;
  });
  return buckets;
}

function drawSparkline(id, data, color) {
  const svg = $(id); if (!svg) return;
  const w = 100, h = 36, min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * (h - 6) - 3;
    return `${x},${y}`;
  }).join(' ');
  svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="0,${h} ${pts} ${w},${h}" fill="${color}22" stroke="none"/>`;
}

// ── Profile Save ─────────────────────────────────────────────
$('saveProfileBtn')?.addEventListener?.('click', async () => {
  try {
    const updates = {
      name:           $('pfHospitalName')?.value?.trim(),
      registrationNo: $('pfRegNo')?.value?.trim(),
      email:          $('pfEmail')?.value?.trim(),
      phone:          $('pfPhone')?.value?.trim(),
      address:        $('pfAddress')?.value?.trim(),
      city:           $('pfCity')?.value?.trim(),
      pincode:        $('pfPincode')?.value?.trim(),
    };
    await updateDoc(doc(db, 'hospitals', currentUser.uid), updates);
    showToast('✅ Profile saved!');
  } catch (e) { showToast('❌ Save failed: ' + e.message, true); }
});

// ── Logout ───────────────────────────────────────────────────
function doLogout() {
  $('headerDropdown')?.classList.remove('open');
  signOut(auth).catch(() => {}).finally(() => { window.location.href = '../auth/login.html'; });
}

// ── Profile Photo Upload ─────────────────────────────────────
async function uploadProfilePhoto(input) {
  const file = input.files[0]; if (!file) return;
  showToast('📤 Uploading photo…');
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'lifynk');
    formData.append('folder', 'profile_photos');
    const res  = await fetch('https://api.cloudinary.com/v1_1/duxukomd3/image/upload', { method:'POST', body:formData });
    const data = await res.json();
    if (!data.secure_url) throw new Error('Upload failed');
    const url = data.secure_url;
    await updateDoc(doc(db, 'hospitals', currentUser.uid), { photoUrl: url });
    ['headerAvatar','hdpAvatar','sidebarAvatar','profileAvatar'].forEach(id => {
      const el = $(id); if (el) { el.src = url; if (id === 'headerAvatar') el.style.display = ''; }
    });
    $('headerAvatarPlaceholder') && ($('headerAvatarPlaceholder').style.display = 'none');
    try { const c = JSON.parse(localStorage.getItem('lifynkHospitalUser') || '{}'); c.photoUrl = url; localStorage.setItem('lifynkUser', JSON.stringify(c)); } catch(e){}
    showToast('✅ Photo updated!');
  } catch (e) { showToast('❌ Upload failed: ' + e.message, true); }
  input.value = '';
}

// ════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════
function $(id) { return document.getElementById(id); }
function setEl(id, text) { const e = $(id); if (e) e.textContent = text; }
function setVal(id, val)  { const e = $(id); if (e) e.value = val; }
function setSrc(id, src)  { const e = $(id); if (e) e.src = src; }
function openModal(id)    { $(id)?.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id)   { $(id)?.classList.remove('open'); document.body.style.overflow = ''; }
function capitalize(s)    { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function fmtTime(date) {
  if (!date) return '—';
  const now  = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60)   return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}

function showToast(msg, isError = false) {
  const t = $('toast'); if (!t) return;
  t.style.background = isError ? 'var(--danger)' : 'var(--primary)';
  $('toastMsg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
// ════════════════════════════════════════════════════════════
//  HOSPITAL NOTIFICATIONS — Real-time + Sound
//  Triggers:
//   • New blood request accepted by a donor
//   • New appointment booked at this hospital
//   • Nearby verified donor available (matching open request)
//   • Admin push notifications
// ════════════════════════════════════════════════════════════

let _hospAudioCtx = null;
document.addEventListener('click', () => {
  if (!_hospAudioCtx) _hospAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_hospAudioCtx.state === 'suspended') _hospAudioCtx.resume();
}, { once: false });

function _playHospNotifSound() {
  try {
    if (!_hospAudioCtx) _hospAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_hospAudioCtx.state === 'suspended') _hospAudioCtx.resume();
    // Urgent double-beep for hospital (lower, more serious tone)
    [0, 0.18].forEach(delay => {
      const o = _hospAudioCtx.createOscillator();
      const g = _hospAudioCtx.createGain();
      o.connect(g); g.connect(_hospAudioCtx.destination);
      o.type = 'sine';
      o.frequency.value = 740; // F#5
      const t = _hospAudioCtx.currentTime + delay;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.start(t); o.stop(t + 0.3);
    });
  } catch(e) {}
}

// ── Panel toggle ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const btn   = document.getElementById('hospNotifBtn');
  const panel = document.getElementById('hospNotifPanel');
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

// ── Render panel ──────────────────────────────────────────────
let _hospPrevNotifCount = 0;

function _renderHospNotifs(docs) {
  const list = document.getElementById('hospNotifList');
  if (!list) return;
  if (!docs.length) {
    list.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">
      <i class="fa-solid fa-bell-slash" style="display:block;margin-bottom:8px;font-size:22px;opacity:.4"></i>No new notifications</div>`;
    return;
  }
  const iconMap = {
    request:     { icon: 'fa-droplet',               color: '#e11d48' },
    appointment: { icon: 'fa-calendar-check',         color: '#0d9488' },
    donor:       { icon: 'fa-user-check',             color: '#3b82f6' },
    inventory:   { icon: 'fa-flask-vial',             color: '#f59e0b' },
    general:     { icon: 'fa-bell',                   color: '#8b5cf6' },
  };
  list.innerHTML = docs.map(d => {
    const n   = d.data ? d.data() : d;
    const id  = d.id || '';
    const cfg = iconMap[n.type] || iconMap.general;
    return `<div onclick="window.markHospNotifRead('${id}')"
      style="display:flex;align-items:flex-start;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border-subtle);cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
      <div style="width:34px;height:34px;border-radius:9px;background:${cfg.color}22;color:${cfg.color};display:grid;place-items:center;flex-shrink:0;font-size:14px">
        <i class="fa-solid ${cfg.icon}"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:700;color:var(--text-primary);line-height:1.3">${n.title || 'Notification'}</div>
        <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px;line-height:1.4">${n.body || ''}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Start listeners after auth ────────────────────────────────
function _startHospNotifListeners(uid) {
  // 1. Admin/system push notifications
  onSnapshot(
    query(collection(db, 'notifications', uid, 'items'), where('read', '==', false)),
    snap => {
      const count = snap.size;
      const badge = document.getElementById('hospNotifCount');
      const dot   = document.getElementById('hospNotifDot');
      if (badge) { badge.textContent = count; badge.style.display = count ? 'inline-block' : 'none'; }
      if (dot)   dot.style.display = count ? '' : 'none';
      if (count > _hospPrevNotifCount) _playHospNotifSound();
      _hospPrevNotifCount = count;
      _renderHospNotifs(snap.docs);
    }
  );

  // 2. New appointment booked → auto-push notification
  onSnapshot(
    query(collection(db, 'appointments'),
      where('centreId', '==', uid),
      where('status', '==', 'pending')
    ),
    async snap => {
      if (snap.docChanges().some(c => c.type === 'added')) {
        const added = snap.docChanges().filter(c => c.type === 'added');
        for (const change of added) {
          const appt = change.doc.data();
          // Only notify for new docs (not on initial load)
          if (appt.createdAt?.toMillis && Date.now() - appt.createdAt.toMillis() < 10000) {
            await addDoc(collection(db, 'notifications', uid, 'items'), {
              type: 'appointment',
              title: `New appointment booked`,
              body: `${appt.donorName || 'A donor'} booked a ${appt.donationType || 'donation'} slot on ${appt.date || '—'} at ${appt.timeSlot || '—'}`,
              read: false,
              createdAt: serverTimestamp(),
            }).catch(() => {});
          }
        }
      }
    }
  );

  // 3. Blood request accepted by donor → notify hospital
  onSnapshot(
    query(collection(db, 'bloodRequests'),
      where('hospitalId', '==', uid),
      where('status', '==', 'accepted')
    ),
    async snap => {
      snap.docChanges().filter(c => c.type === 'added' || c.type === 'modified').forEach(async change => {
        const req = change.doc.data();
        if (req.acceptedAt?.toMillis && Date.now() - req.acceptedAt.toMillis() < 10000) {
          await addDoc(collection(db, 'notifications', uid, 'items'), {
            type: 'request',
            title: `Donor accepted your blood request`,
            body: `${req.acceptedByName || 'A donor'} (${req.bloodGroup || '—'}) accepted your request. Phone: ${req.acceptedByPhone || '—'}`,
            read: false,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        }
      });
    }
  );
}

// ── Mark read helpers ─────────────────────────────────────────
window.markHospNotifRead = async (notifId) => {
  if (!notifId || !currentUser) return;
  try {
    await updateDoc(doc(db, 'notifications', currentUser.uid, 'items', notifId), { read: true });
  } catch(e) {}
};

window.markAllHospNotifsRead = async () => {
  if (!currentUser) return;
  try {
    const snap = await getDocs(query(
      collection(db, 'notifications', currentUser.uid, 'items'),
      where('read', '==', false)
    ));
    snap.forEach(d => updateDoc(d.ref, { read: true }));
    const panel = document.getElementById('hospNotifPanel');
    if (panel) panel.style.display = 'none';
  } catch(e) {}
};

// ── Hook into existing onAuthStateChanged ─────────────────────
onAuthStateChanged(auth, user => {
  if (user) _startHospNotifListeners(user.uid);
});

// ════════════════════════════════════════════════════════════
//  BROADCAST LISTENER — Hospital
// ════════════════════════════════════════════════════════════
(function _initHospBroadcastListener() {
  const ROLE = 'hospital';
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