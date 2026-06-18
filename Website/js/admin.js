// ================================================================
//  Lifynk — admin.js  (fixed)
//  Super Admin Dashboard
// ================================================================
import { auth, db } from './firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, updateDoc, deleteDoc,
  addDoc, query, orderBy, serverTimestamp, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Auth guard ────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) return (window.location.href = '../auth/login.html');
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists() || snap.data().role !== 'admin') {
    await signOut(auth);
    return (window.location.href = '../auth/login.html');
  }
  const data = snap.data();
  const name = data.name || data.displayName || 'Admin';
  document.getElementById('sidebarName').textContent = name;
  document.getElementById('hdpName').textContent = name;
  if (data.photoURL) {
    ['sidebarAvatar','headerAvatar','hdpAvatar'].forEach(id => {
      document.getElementById(id).src = data.photoURL;
    });
  }
  initDashboard();
});

// ── In-memory caches ──────────────────────────────────────────
let allOrgs = [], allDonors = [], allRecipients = [], allRequests = [], allReports = [];
let auditLog = [];
let currentOrgFilter = 'all', currentDonorFilter = 'all',
    currentRecipientFilter = 'all', currentRequestFilter = 'all',
    currentReportFilter = 'open';

// ── Init ──────────────────────────────────────────────────────
async function initDashboard() {
  setupNav();
  setupTheme();
  setupLogout();
  setupHeaderDropdown();
  setupNotifPanel();
  setupSearch();
  await loadAll();
  _initDone = true;
  renderOverview();
  renderAnalytics();
  loadAuditLog();
  loadBroadcastHistory();
}

// ── Load all collections ──────────────────────────────────────
// ── Real-time listeners (replaces one-shot getDocs) ──────────
function loadAll() {
  return new Promise(resolve => {
    let ready = 0;
    const total = 7;
    const check = () => { if (++ready === total) resolve(); };

    onSnapshot(collection(db, 'donors'), snap => {
      allDonors = snap.docs.map(d => ({ id: d.id, _col: 'donors', ...d.data() }));
      check(); _onLiveUpdate();
    });

    onSnapshot(collection(db, 'recipients'), snap => {
      allRecipients = snap.docs.map(d => ({ id: d.id, _col: 'recipients', ...d.data() }));
      check(); _onLiveUpdate();
    });

    onSnapshot(collection(db, 'hospitals'), snap => {
      const hospitals = snap.docs.map(d => ({ id: d.id, _col: 'hospitals', orgType: 'hospital', ...d.data() }));
      allOrgs = [...hospitals, ...allOrgs.filter(o => o.orgType !== 'hospital')];
      check(); _onLiveUpdate();
    });

    onSnapshot(collection(db, 'ngos'), snap => {
      const ngos = snap.docs.map(d => ({ id: d.id, _col: 'ngos', orgType: 'ngo', ...d.data() }));
      allOrgs = [...allOrgs.filter(o => o.orgType !== 'ngo'), ...ngos];
      check(); _onLiveUpdate();
    });

    onSnapshot(collection(db, 'bloodbanks'), snap => {
      const bloodbanks = snap.docs.map(d => ({ id: d.id, _col: 'bloodbanks', orgType: 'bloodbank', ...d.data() }));
      allOrgs = [...allOrgs.filter(o => o.orgType !== 'bloodbank'), ...bloodbanks];
      check(); _onLiveUpdate();
    });

    onSnapshot(collection(db, 'bloodRequests'), snap => {
      allRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      check(); _onLiveUpdate();
    }, () => { allRequests = []; check(); });

    onSnapshot(collection(db, 'reports'), snap => {
      allReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      check(); _onLiveUpdate();
    }, () => { allReports = []; check(); });
  });
}

// ── Re-render active section on every live update ─────────────
let _initDone = false;
function _onLiveUpdate() {
  if (!_initDone) return;
  refreshBadges();
  renderOverview();
  renderAnalytics();
  const active = document.querySelector('section.active')?.id?.replace('sec-', '');
  if      (active === 'orgs')       renderOrgs();
  else if (active === 'donors')     renderUsers('donors');
  else if (active === 'recipients') renderUsers('recipients');
  else if (active === 'requests')   renderRequests();
  else if (active === 'reports')    renderReports();
}

// ── Overview ──────────────────────────────────────────────────
function renderOverview() {
  const totalUsers    = allDonors.length + allRecipients.length;
  const totalDonations = allDonors.reduce((s, d) => s + (d.totalDonations || 0), 0);
  const pendingOrgs   = allOrgs.filter(o => o.status === 'pending').length;
  const openReports   = allReports.filter(r => r.status === 'open').length;

  document.getElementById('kpiTotalUsers').textContent      = totalUsers;
  document.getElementById('kpiTotalDonations').textContent  = totalDonations;
  document.getElementById('kpiTotalOrgs').textContent       = allOrgs.length;
  document.getElementById('kpiOpenReports').textContent     = openReports;
  document.getElementById('kpiOrgPendingTrend').innerHTML   =
    `<i class="fa-solid fa-clock"></i> ${pendingOrgs} pending approval`;
  document.getElementById('kpiOrgPendingTrend').className   =
    'stat-trend ' + (pendingOrgs > 0 ? 'down' : 'up');
  document.getElementById('pendingApprovalChip').textContent = pendingOrgs;

  // Pending list (up to 5)
  const pending = allOrgs.filter(o => o.status === 'pending').slice(0, 5);
  document.getElementById('overviewPendingList').innerHTML = pending.length
    ? pending.map(o => orgRowHTML(o, true)).join('')
    : '<div class="empty-state"><i class="fa-solid fa-circle-check"></i>All caught up!</div>';

  loadRecentAudit();
}

// ── Org row HTML ──────────────────────────────────────────────
function orgRowHTML(o, mini = false) {
  const icons  = { hospital: '🏥', ngo: '🤝', bloodbank: '🩸' };
  const icon   = icons[o.orgType] || '🏢';
  const statusCls = {
    pending: 'sbadge-pending', approved: 'sbadge-approved',
    rejected: 'sbadge-rejected', suspended: 'sbadge-suspended'
  }[o.status] || 'sbadge-pending';

  let actions = '';
  if (o.status === 'pending') {
    actions = `<button class="btn-viewdoc" onclick="openOrgModal('${o.id}')"><i class="fa-solid fa-eye"></i> Review</button>`;
  } else if (o.status === 'approved') {
    actions = `<button class="btn-suspend" onclick="suspendOrg('${o.id}')"><i class="fa-solid fa-pause"></i> Suspend</button>`;
  } else {
    actions = `<button class="btn-restore" onclick="restoreOrg('${o.id}')"><i class="fa-solid fa-rotate-left"></i> Restore</button>`;
  }
  if (!mini) {
    actions += `<button class="btn-icon-del" onclick="deleteOrg('${o.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>`;
  }

  return `<div class="org-row" id="orgrow-${o.id}">
    <div class="org-avatar" style="background:var(--primary-soft)">${icon}</div>
    <div style="flex:1;min-width:0">
      <div class="org-name">${getOrgName(o)}</div>
      <div class="org-meta">${o.email || ''} · ${(o.city || '').split(',')[0]}</div>
    </div>
    <span class="sbadge ${statusCls}">${o.status || 'pending'}</span>
    <div class="org-actions">${actions}</div>
  </div>`;
}

// ── Analytics ─────────────────────────────────────────────────
function renderAnalytics() {
  const roleCounts = { donor: allDonors.length, recipient: allRecipients.length };
  const maxRole = Math.max(...Object.values(roleCounts), 1);
  document.getElementById('analyticsRoleChart').innerHTML = barChart([
    { label: 'Donors',     val: roleCounts.donor,     color: '#0d9488' },
    { label: 'Recipients', val: roleCounts.recipient,  color: '#8b5cf6' },
  ], maxRole);

  const bgCount = {};
  [...allDonors, ...allRecipients].forEach(u => {
    if (u.bloodGroup) bgCount[u.bloodGroup] = (bgCount[u.bloodGroup] || 0) + 1;
  });
  const bgMax = Math.max(...Object.values(bgCount), 1);
  document.getElementById('analyticsBloodChart').innerHTML = barChart(
    Object.entries(bgCount).sort((a, b) => b[1] - a[1]).map(([g, v]) => ({ label: g, val: v, color: '#e11d48' })),
    bgMax
  );

  const orgTypes = { hospital: 0, ngo: 0, bloodbank: 0 };
  allOrgs.forEach(o => { if (orgTypes[o.orgType] !== undefined) orgTypes[o.orgType]++; });
  const orgMax = Math.max(...Object.values(orgTypes), 1);
  document.getElementById('analyticsOrgChart').innerHTML = barChart([
    { label: 'Hospitals',   val: orgTypes.hospital,  color: '#f97316' },
    { label: 'NGOs',        val: orgTypes.ngo,        color: '#8b5cf6' },
    { label: 'Blood Banks', val: orgTypes.bloodbank,  color: '#e11d48' },
  ], orgMax);

  const totalDonations = allDonors.reduce((s, d) => s + (d.totalDonations || 0), 0);
  document.getElementById('analyticsSummary').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${summaryRow('Total Users',         allDonors.length + allRecipients.length, '👥')}
      ${summaryRow('Total Organisations', allOrgs.length, '🏥')}
      ${summaryRow('Total Donations',     totalDonations, '🩸')}
      ${summaryRow('Open Requests',       allRequests.filter(r => r.status === 'open').length, '🆘')}
      ${summaryRow('Open Reports',        allReports.filter(r => r.status === 'open').length, '🚩')}
    </div>`;
}

function summaryRow(label, val, icon) {
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-subtle)">
    <div style="font-size:13px;font-weight:600;color:var(--text-secondary)">${icon} ${label}</div>
    <div style="font-size:18px;font-weight:800;color:var(--text-primary)">${val}</div>
  </div>`;
}

function barChart(rows, max) {
  if (!rows.length) return '<div style="color:var(--text-muted);font-size:13px;padding:12px 0">No data yet</div>';
  return rows.map(r => `
    <div class="bar-row">
      <div class="bar-label">${r.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((r.val / max) * 100)}%;background:${r.color}"></div></div>
      <div class="bar-val">${r.val}</div>
    </div>`).join('');
}

// ── Organisations ─────────────────────────────────────────────
function renderOrgs(filter) {
  currentOrgFilter = filter || currentOrgFilter;
  let list = allOrgs;
  if (currentOrgFilter !== 'all') {
    if (['hospital', 'ngo', 'bloodbank'].includes(currentOrgFilter)) {
      list = list.filter(o => o.orgType === currentOrgFilter);
    } else {
      list = list.filter(o => o.status === currentOrgFilter);
    }
  }
  document.getElementById('orgSectionTag').textContent = `${list.length} ${currentOrgFilter}`;
  document.getElementById('orgList').innerHTML = list.length
    ? list.map(o => orgRowHTML(o)).join('')
    : '<div class="empty-state"><i class="fa-solid fa-building"></i>No organisations found</div>';
}

async function approveOrg(id) {
  const o = allOrgs.find(x => x.id === id) || {};
  await updateDoc(doc(db, o._col || 'hospitals', id), {
    status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser?.email, rejectionReason: ''
  });
  updateLocalOrg(id, { status: 'approved' });
  logAudit('approved', `Organisation "${getOrgName(o)}" approved`);
  showToast('✅ Organisation approved');
  renderOrgs(); renderOverview(); refreshBadges();
}

async function rejectOrg(id, reason) {
  const o = allOrgs.find(x => x.id === id) || {};
  await updateDoc(doc(db, o._col || 'hospitals', id), {
    status: 'rejected', reviewedAt: serverTimestamp(),
    reviewedBy: auth.currentUser?.email, rejectionReason: reason || ''
  });
  updateLocalOrg(id, { status: 'rejected', rejectionReason: reason || '' });
  logAudit('rejected', `Organisation "${getOrgName(o)}" rejected${reason ? ': ' + reason : ''}`);
  showToast('❌ Organisation rejected');
  renderOrgs(); renderOverview(); refreshBadges();
}

async function suspendOrg(id) {
  const o = allOrgs.find(x => x.id === id) || {};
  await updateDoc(doc(db, o._col || 'hospitals', id), { status: 'suspended' });
  updateLocalOrg(id, { status: 'suspended' });
  logAudit('suspended', `Organisation "${getOrgName(o)}" suspended`);
  showToast('⏸️ Organisation suspended');
  renderOrgs(); renderOverview();
}

async function restoreOrg(id) {
  const o = allOrgs.find(x => x.id === id) || {};
  await updateDoc(doc(db, o._col || 'hospitals', id), { status: 'approved', rejectionReason: '' });
  updateLocalOrg(id, { status: 'approved' });
  logAudit('restored', `Organisation "${getOrgName(o)}" restored`);
  showToast('✅ Organisation restored');
  renderOrgs(); renderOverview(); refreshBadges();
}

async function deleteOrg(id) {
  if (!confirm('Permanently delete this organisation? This cannot be undone.')) return;
  const o = allOrgs.find(x => x.id === id) || {};
  await deleteDoc(doc(db, o._col || 'hospitals', id));
  allOrgs = allOrgs.filter(x => x.id !== id);
  logAudit('deleted', `Organisation "${getOrgName(o)}" deleted`);
  showToast('🗑️ Organisation deleted');
  renderOrgs(); renderOverview(); refreshBadges();
}

function updateLocalOrg(id, changes) {
  const idx = allOrgs.findIndex(o => o.id === id);
  if (idx > -1) allOrgs[idx] = { ...allOrgs[idx], ...changes };
}

// ── Donors & Recipients ───────────────────────────────────────
function renderUsers(type) {
  const list   = type === 'donors' ? allDonors : allRecipients;
  const filter = type === 'donors' ? currentDonorFilter : currentRecipientFilter;
  const filtered = filter === 'all' ? list : list.filter(u => (u.status || 'active') === filter);
  const tagId  = type === 'donors' ? 'donorSectionTag'    : 'recipientSectionTag';
  const listId = type === 'donors' ? 'donorList'          : 'recipientList';

  document.getElementById(tagId).textContent  = `${filtered.length} ${filter}`;
  document.getElementById(listId).innerHTML = filtered.length
    ? filtered.map(u => userRowHTML(u)).join('')
    : `<div class="empty-state"><i class="fa-solid fa-users"></i>No users found</div>`;
}

function userRowHTML(u) {
  const status     = u.status || 'active';
  const statusCls  = { active: 'sbadge-active', suspended: 'sbadge-suspended', banned: 'sbadge-banned', warned: 'sbadge-warned' }[status] || 'sbadge-active';
  const isSuspended = status === 'suspended' || status === 'banned';
  return `<div class="org-row" id="userrow-${u.id}">
    <div class="org-avatar" style="background:var(--primary-soft)"><i class="fa-solid fa-user" style="color:var(--primary)"></i></div>
    <div style="flex:1;min-width:0">
      <div class="org-name">${getUserName(u)}</div>
      <div class="org-meta">${u.mobile || u.phone || u.email || ''} · BG: ${u.bloodGroup || u.blood_group || '—'} · Donations: ${u.totalDonations || u.donations || 0}</div>
    </div>
    <span class="sbadge ${statusCls}">${status}</span>
    <div class="org-actions">
      <button class="btn-viewdoc" onclick="openUserModal('${u.id}')"><i class="fa-solid fa-eye"></i> View</button>
      ${isSuspended
        ? `<button class="btn-restore" onclick="restoreUser('${u.id}')"><i class="fa-solid fa-rotate-left"></i> Restore</button>`
        : `<button class="btn-suspend" onclick="suspendUser('${u.id}')"><i class="fa-solid fa-pause"></i> Suspend</button>
           <button class="btn-ban"     onclick="banUser('${u.id}')"><i class="fa-solid fa-ban"></i> Ban</button>`
      }
      <button class="btn-icon-del" onclick="deleteUser('${u.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
  </div>`;
}

async function suspendUser(id) {
  const u = findUser(id);
  await updateDoc(doc(db, u._col || 'donors', id), { status: 'suspended' });
  updateLocalUser(id, { status: 'suspended' });
  logAudit('suspended', `User "${getUserName(u)}" suspended`);
  showToast('⏸️ User suspended');
  renderUsers('donors'); renderUsers('recipients');
}

async function restoreUser(id) {
  const u = findUser(id);
  await updateDoc(doc(db, u._col || 'donors', id), { status: 'active' });
  updateLocalUser(id, { status: 'active' });
  logAudit('restored', `User "${getUserName(u)}" restored`);
  showToast('✅ User restored');
  renderUsers('donors'); renderUsers('recipients');
}

async function banUser(id) {
  const u = findUser(id);
  await updateDoc(doc(db, u._col || 'donors', id), { status: 'banned' });
  updateLocalUser(id, { status: 'banned' });
  logAudit('banned', `User "${getUserName(u)}" banned`);
  showToast('🚫 User banned');
  renderUsers('donors'); renderUsers('recipients');
}

async function deleteUser(id) {
  if (!confirm('Permanently delete this user? This cannot be undone.')) return;
  const u = findUser(id);
  await deleteDoc(doc(db, u._col || 'donors', id));
  allDonors     = allDonors.filter(x => x.id !== id);
  allRecipients = allRecipients.filter(x => x.id !== id);
  logAudit('deleted', `User "${getUserName(u)}" deleted`);
  showToast('🗑️ User deleted');
  renderUsers('donors'); renderUsers('recipients');
}

function findUser(id) {
  return [...allDonors, ...allRecipients].find(x => x.id === id) || {};
}

function updateLocalUser(id, changes) {
  let idx = allDonors.findIndex(u => u.id === id);
  if (idx > -1) { allDonors[idx] = { ...allDonors[idx], ...changes }; return; }
  idx = allRecipients.findIndex(u => u.id === id);
  if (idx > -1) allRecipients[idx] = { ...allRecipients[idx], ...changes };
}

// ── Blood Requests ────────────────────────────────────────────
function renderRequests(filter) {
  currentRequestFilter = filter || currentRequestFilter;
  const list = currentRequestFilter === 'all'
    ? allRequests
    : allRequests.filter(r => r.status === currentRequestFilter);

  document.getElementById('requestList').innerHTML = list.length
    ? list.map(r => `
        <div class="org-row">
          <div class="org-avatar" style="background:var(--danger-dim);color:var(--danger);font-size:12px;font-weight:900">${r.bloodGroup || '?'}</div>
          <div style="flex:1;min-width:0">
            <div class="org-name">${r.patientName || 'Unknown Patient'}</div>
            <div class="org-meta">${r.hospital || ''} · ${r.city || ''} · Units: ${r.units || 1}</div>
          </div>
          <span class="sbadge ${{ open: 'sbadge-pending', fulfilled: 'sbadge-approved', expired: 'sbadge-banned' }[r.status] || 'sbadge-pending'}">${r.status || 'open'}</span>
        </div>`).join('')
    : '<div class="empty-state"><i class="fa-solid fa-hand-holding-medical"></i>No requests found</div>';
}

// ── Reports ───────────────────────────────────────────────────
function renderReports(filter) {
  currentReportFilter = filter || currentReportFilter;
  const list = allReports.filter(r => r.status === currentReportFilter);
  document.getElementById('reportSectionTag').textContent = `${list.length} ${currentReportFilter}`;
  document.getElementById('reportList').innerHTML = list.length
    ? list.map(r => reportRowHTML(r)).join('')
    : '<div class="empty-state"><i class="fa-solid fa-flag"></i>No reports found</div>';
}

function reportRowHTML(r) {
  const count = r.count || 1;
  const cls   = count >= 3 ? 'rep-c3' : count >= 2 ? 'rep-c2' : 'rep-c1';
  return `<div class="org-row" id="reprow-${r.id}">
    <div class="org-avatar" style="background:var(--danger-dim);color:var(--danger)"><i class="fa-solid fa-flag"></i></div>
    <div style="flex:1;min-width:0">
      <div class="org-name">Reported: ${r.targetId || 'Unknown'}</div>
      <div class="org-meta">${r.reason || ''} · by ${r.reportedBy || ''}</div>
    </div>
    <span class="rep-count ${cls}">${count}×</span>
    <div class="org-actions">
      <button class="btn-viewdoc" onclick="openReportModal('${r.id}')"><i class="fa-solid fa-eye"></i> View</button>
      <button class="btn-approve" onclick="resolveReport('${r.id}')"><i class="fa-solid fa-check"></i> Resolve</button>
      <button class="btn-ghost"   onclick="dismissReport('${r.id}')">Dismiss</button>
    </div>
  </div>`;
}

async function resolveReport(id) {
  await updateDoc(doc(db, 'reports', id), { status: 'resolved' });
  const idx = allReports.findIndex(r => r.id === id);
  if (idx > -1) allReports[idx].status = 'resolved';
  logAudit('resolved', `Report ${id} resolved`);
  showToast('✅ Report resolved');
  renderReports(); refreshBadges();
}

async function dismissReport(id) {
  await updateDoc(doc(db, 'reports', id), { status: 'dismissed' });
  const idx = allReports.findIndex(r => r.id === id);
  if (idx > -1) allReports[idx].status = 'dismissed';
  logAudit('dismissed', `Report ${id} dismissed`);
  showToast('Report dismissed');
  renderReports(); refreshBadges();
}

// ── Broadcast ─────────────────────────────────────────────────
let bcTargetState = { donors: true, recipients: true, hospitals: true, ngos: true, bloodbanks: true };

document.querySelectorAll('.target-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const t = chip.dataset.target;
    bcTargetState[t] = !bcTargetState[t];
    chip.classList.toggle('checked', bcTargetState[t]);
  });
});

async function sendBroadcast() {
  const title    = document.getElementById('bcTitle').value.trim();
  const message  = document.getElementById('bcMessage').value.trim();
  const priority = document.getElementById('bcPriority').value;
  if (!title || !message) return showToast('⚠️ Please fill title and message');

  const targets = Object.entries(bcTargetState).filter(([, v]) => v).map(([k]) => k);
  await addDoc(collection(db, 'broadcasts'), {
    title, message, priority, targets,
    sentAt: serverTimestamp(), sentBy: auth.currentUser?.uid,
  });
  document.getElementById('bcTitle').value   = '';
  document.getElementById('bcMessage').value = '';
  logAudit('broadcast', `Broadcast sent: "${title}"`);
  showToast('📢 Broadcast sent!');
  loadBroadcastHistory();
}

async function loadBroadcastHistory() {
  const snap = await getDocs(query(collection(db, 'broadcasts'), orderBy('sentAt', 'desc'), limit(20)));
  const container = document.getElementById('broadcastHistory');
  if (snap.empty) {
    container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bullhorn"></i>No broadcasts yet</div>';
    return;
  }
  container.innerHTML = snap.docs.map(d => {
    const b = d.data();
    const pri = { urgent: 'chip-danger', important: 'chip-warn', normal: 'chip-teal' }[b.priority] || 'chip-teal';
    return `<div class="broadcast-entry">
      <div class="broadcast-icon"><i class="fa-solid fa-bullhorn"></i></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${b.title}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px;line-height:1.4">${b.message}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <span class="chip ${pri}">${b.priority || 'normal'}</span>
          <span style="font-size:11px;color:var(--text-muted)">${(b.targets || []).join(', ')}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Audit Log ─────────────────────────────────────────────────
const iconMap = {
  approved: 'fa-circle-check', rejected: 'fa-circle-xmark', suspended: 'fa-pause',
  restored: 'fa-rotate-left',  banned: 'fa-ban',             broadcast: 'fa-bullhorn',
  resolved: 'fa-check',        dismissed: 'fa-times',        deleted: 'fa-trash',
  export:   'fa-file-csv',
};
const colorMap = {
  approved:  'background:var(--ok-dim);color:var(--ok)',
  rejected:  'background:var(--danger-dim);color:var(--danger)',
  suspended: 'background:var(--orange-dim);color:var(--orange)',
  restored:  'background:var(--primary-soft);color:var(--primary)',
  banned:    'background:var(--danger-dim);color:var(--danger)',
  broadcast: 'background:var(--primary-soft);color:var(--primary)',
  resolved:  'background:var(--ok-dim);color:var(--ok)',
  dismissed: 'background:var(--surface-2);color:var(--text-muted)',
  deleted:   'background:var(--danger-dim);color:var(--danger)',
  export:    'background:var(--ok-dim);color:var(--ok)',
};

function logAudit(type, text) {
  const entry = { type, text, time: new Date() };
  auditLog.unshift(entry);
  renderAuditLog();
  loadRecentAudit();
  addDoc(collection(db, 'adminAudit'), {
    type, text, at: serverTimestamp(), by: auth.currentUser?.uid
  }).catch(() => {});
}

async function loadAuditLog() {
  try {
    const snap = await getDocs(query(collection(db, 'adminAudit'), orderBy('at', 'desc'), limit(50)));
    auditLog = snap.docs.map(d => {
      const data = d.data();
      return { type: data.type, text: data.text, time: data.at?.toDate() || new Date() };
    });
  } catch (_) {}
  renderAuditLog();
}

function renderAuditLog() {
  const el = document.getElementById('auditLog');
  if (!auditLog.length) {
    el.innerHTML = '<div class="empty-state"><i class="fa-solid fa-scroll"></i>No actions logged yet</div>';
    return;
  }
  el.innerHTML = auditLog.map(e => `
    <div class="audit-entry">
      <div class="audit-icon" style="${colorMap[e.type] || 'background:var(--surface-2);color:var(--text-muted)'}">
        <i class="fa-solid ${iconMap[e.type] || 'fa-circle-dot'}"></i>
      </div>
      <div>
        <div class="audit-text">${e.text}</div>
        <div class="audit-time">${e.time ? fmtTime(e.time) : 'Just now'}</div>
      </div>
    </div>`).join('');
}

function loadRecentAudit() {
  const el = document.getElementById('overviewAuditList');
  const recent = auditLog.slice(0, 5);
  el.innerHTML = recent.length
    ? recent.map(e => `
        <div class="audit-entry">
          <div class="audit-icon" style="${colorMap[e.type] || 'background:var(--surface-2);color:var(--text-muted)'}">
            <i class="fa-solid ${iconMap[e.type] || 'fa-circle-dot'}"></i>
          </div>
          <div>
            <div class="audit-text">${e.text}</div>
            <div class="audit-time">${e.time ? fmtTime(e.time) : 'Just now'}</div>
          </div>
        </div>`).join('')
    : '<div class="empty-state"><i class="fa-solid fa-scroll"></i>No activity yet</div>';
}

// ── Org Modal — shows doc image or PDF link ───────────────────
function openOrgModal(id) {
  const o = allOrgs.find(x => x.id === id);
  if (!o) return;

  const name   = getOrgName(o);
  const docUrl = o.idFileUrl || o.documentUrl || o.docURL || '';
  const isImage = docUrl && /\.(jpg|jpeg|png|webp|gif)/i.test(docUrl);

  let docBlock = '';
  if (docUrl) {
    docBlock = isImage
      ? `<div style="margin-top:12px">
           <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">Uploaded Document</div>
           <img src="${docUrl}" alt="Document"
                style="width:100%;max-height:320px;object-fit:contain;border-radius:12px;border:1px solid var(--border-color);background:var(--surface-2)"
                onerror="this.style.display='none'">
           <a href="${docUrl}" target="_blank" class="btn-viewdoc" style="display:inline-flex;margin-top:10px">
             <i class="fa-solid fa-arrow-up-right-from-square"></i> Open full size
           </a>
         </div>`
      : `<div style="margin-top:12px">
           <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">Uploaded Document</div>
           <a href="${docUrl}" target="_blank" class="btn-viewdoc" style="display:inline-flex;gap:8px;padding:12px 18px;font-size:13px">
             <i class="fa-solid fa-file-lines" style="font-size:16px"></i> View / Download Document
           </a>
         </div>`;
  } else {
    docBlock = `<div style="margin-top:12px;background:var(--surface-2);border:1.5px dashed var(--border-color);border-radius:10px;padding:20px;text-align:center;color:var(--text-muted);font-size:13px">
      <i class="fa-solid fa-file-slash" style="font-size:22px;display:block;margin-bottom:8px;opacity:.4"></i>No document uploaded
    </div>`;
  }

  document.getElementById('orgModalTitle').textContent = name;
  document.getElementById('orgModalBody').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
      ${modalRow('Type',       o.orgType || '—')}
      ${modalRow('Status',     o.status  || '—')}
      ${modalRow('Email',      o.email   || '—')}
      ${modalRow('Phone',      o.phone   || '—')}
      ${modalRow('City',       o.city    || '—')}
      ${modalRow('Reg / Lic',  o.regId || o.licenseNo || o.license || o.registrationNo || '—')}
      ${modalRow('Lifynk ID',  o.lifynkId || '—')}
      ${modalRow('Registered', o.createdAt?.toDate?.()?.toLocaleDateString() || '—')}
    </div>
    ${docBlock}
    ${o.status === 'pending' ? `
      <div style="margin-top:16px">
        <label style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);display:block;margin-bottom:6px">
          Rejection Reason <span style="color:var(--danger)">(required if rejecting)</span>
        </label>
        <textarea id="orgRejectReason" placeholder="e.g. License number not verifiable. Please resubmit with valid documentation."
          style="width:100%;min-height:80px;background:var(--surface);border:1.5px solid var(--border-color);color:var(--text-primary);border-radius:9px;padding:10px 13px;font-family:inherit;font-size:13px;outline:none;resize:vertical"></textarea>
      </div>` : ''}
  `;

  document.getElementById('orgModalFooter').innerHTML = o.status === 'pending'
    ? `<button class="btn-ghost" onclick="closeModal('orgModal')">Cancel</button>
       <button class="btn-reject"  onclick="handleOrgReject('${id}')"><i class="fa-solid fa-xmark"></i> Reject</button>
       <button class="btn-approve" onclick="approveOrg('${id}');closeModal('orgModal')"><i class="fa-solid fa-check"></i> Approve</button>`
    : `<button class="btn-ghost" onclick="closeModal('orgModal')">Close</button>`;

  openModal('orgModal');
}

window.handleOrgReject = function(id) {
  const reason = document.getElementById('orgRejectReason')?.value.trim();
  if (!reason) { showToast('⚠️ Please enter a rejection reason'); return; }
  rejectOrg(id, reason);
  closeModal('orgModal');
};

// ── User Modal ────────────────────────────────────────────────
function openUserModal(id) {
  const u = findUser(id);
  if (!u.id) return;

  const docUrl  = u.idFileUrl || u.documentUrl || '';
  const isImage = docUrl && /\.(jpg|jpeg|png|webp|gif)/i.test(docUrl);
  let docBlock  = '';
  if (docUrl) {
    docBlock = isImage
      ? `<div style="margin-top:12px">
           <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">ID Proof</div>
           <img src="${docUrl}" alt="ID Proof"
                style="width:100%;max-height:260px;object-fit:contain;border-radius:12px;border:1px solid var(--border-color);background:var(--surface-2)"
                onerror="this.style.display='none'">
         </div>`
      : `<div style="margin-top:12px">
           <a href="${docUrl}" target="_blank" class="btn-viewdoc" style="display:inline-flex;gap:8px">
             <i class="fa-solid fa-file-lines"></i> View ID Document
           </a>
         </div>`;
  }

  document.getElementById('userModalTitle').textContent = getUserName(u);
  document.getElementById('userModalBody').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0;font-size:13px">
      ${modalRow('Role',        u.role        || '—')}
      ${modalRow('Blood Group', u.bloodGroup  || '—')}
      ${modalRow('Phone',       u.mobile || u.phone || '—')}
      ${modalRow('Email',       u.email       || '—')}
      ${modalRow('City',        u.city        || '—')}
      ${modalRow('Age',         u.age         || '—')}
      ${modalRow('Donations',   u.totalDonations || 0)}
      ${modalRow('Status',      u.status      || 'active')}
      ${modalRow('Lifynk ID',   u.lifynkId    || '—')}
    </div>
    ${docBlock}
  `;

  const status = u.status || 'active';
  document.getElementById('userModalFooter').innerHTML =
    `<button class="btn-ghost" onclick="closeModal('userModal')">Close</button>
     ${status === 'active'
       ? `<button class="btn-suspend" onclick="suspendUser('${id}');closeModal('userModal')"><i class="fa-solid fa-pause"></i> Suspend</button>
          <button class="btn-ban"     onclick="banUser('${id}');closeModal('userModal')"><i class="fa-solid fa-ban"></i> Ban</button>`
       : `<button class="btn-restore" onclick="restoreUser('${id}');closeModal('userModal')"><i class="fa-solid fa-rotate-left"></i> Restore</button>`
     }`;
  openModal('userModal');
}

// ── Report Modal ──────────────────────────────────────────────
function openReportModal(id) {
  const r = allReports.find(x => x.id === id);
  if (!r) return;
  document.getElementById('reportModalBody').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0;font-size:13px">
      ${modalRow('Target',      r.targetId   || '—')}
      ${modalRow('Reason',      r.reason     || '—')}
      ${modalRow('Reported By', r.reportedBy || '—')}
      ${modalRow('Status',      r.status     || 'open')}
      ${r.notes ? modalRow('Notes', r.notes) : ''}
    </div>`;
  document.getElementById('reportModalFooter').innerHTML = r.status === 'open'
    ? `<button class="btn-ghost"   onclick="dismissReport('${id}');closeModal('reportModal')">Dismiss</button>
       <button class="btn-suspend" onclick="suspendUser('${r.targetId}');resolveReport('${id}');closeModal('reportModal')"><i class="fa-solid fa-pause"></i> Suspend User</button>
       <button class="btn-approve" onclick="resolveReport('${id}');closeModal('reportModal')"><i class="fa-solid fa-check"></i> Resolve</button>`
    : `<button class="btn-ghost" onclick="closeModal('reportModal')">Close</button>`;
  openModal('reportModal');
}

// ── Modal helpers ─────────────────────────────────────────────
function modalRow(label, val) {
  return `<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-subtle)">
    <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);width:100px;flex-shrink:0">${label}</span>
    <span style="color:var(--text-primary);font-weight:600;word-break:break-all">${val}</span>
  </div>`;
}

function openModal(id) {
  document.getElementById(id + 'Overlay').classList.add('open');
}
window.closeModal = function(id) {
  document.getElementById(id + 'Overlay').classList.remove('open');
};

// ── Export CSV ────────────────────────────────────────────────
window.exportCSV = function(type) {
  let rows = [], filename = type + '.csv';
  if (type === 'users' || type === 'donors') {
    rows = [['Name', 'Phone', 'Email', 'Blood Group', 'City', 'Role', 'Total Donations', 'Status'],
            ...allDonors.map(u => [u.name||'', u.phone||'', u.email||'', u.bloodGroup||'', u.city||'', u.role||'', u.totalDonations||0, u.status||'active'])];
  } else if (type === 'recipients') {
    rows = [['Name', 'Phone', 'Email', 'Blood Group', 'City', 'Status'],
            ...allRecipients.map(u => [u.name||'', u.phone||'', u.email||'', u.bloodGroup||'', u.city||'', u.status||'active'])];
  } else if (type === 'orgs') {
    rows = [['Name', 'Type', 'Email', 'Phone', 'City', 'Reg No', 'Status'],
            ...allOrgs.map(o => [getOrgName(o), o.orgType||'', o.email||'', o.phone||'', o.city||'', o.regId||o.licenseNo||'', o.status||''])];
  } else if (type === 'requests') {
    rows = [['Patient', 'Blood Group', 'Hospital', 'City', 'Units', 'Status'],
            ...allRequests.map(r => [r.patientName||'', r.bloodGroup||'', r.hospital||'', r.city||'', r.units||1, r.status||''])];
  } else if (type === 'audit') {
    rows = [['Action', 'Detail', 'Time'],
            ...auditLog.map(e => [e.type, e.text, e.time ? fmtTime(e.time) : ''])];
  } else if (type === 'analytics') {
    rows = [['Metric', 'Value'],
            ['Total Donors',     allDonors.length],
            ['Total Recipients', allRecipients.length],
            ['Total Orgs',       allOrgs.length],
            ['Total Donations',  allDonors.reduce((s, d) => s + (d.totalDonations||0), 0)],
            ['Open Reports',     allReports.filter(r => r.status === 'open').length]];
  }
  if (!rows.length) return showToast('⚠️ No data to export');
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename; a.click();
  showToast('📥 CSV exported');
  logAudit('export', `Exported ${type}.csv`);
};

// ── Nav ───────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      switchSection(item.dataset.section);
    });
  });

  const tabGroups = {
    'sec-orgs':       () => renderOrgs,
    'sec-donors':     () => (f) => { currentDonorFilter = f; renderUsers('donors'); },
    'sec-recipients': () => (f) => { currentRecipientFilter = f; renderUsers('recipients'); },
    'sec-requests':   () => renderRequests,
    'sec-reports':    () => renderReports,
  };

  Object.entries(tabGroups).forEach(([secId, getFn]) => {
    document.querySelectorAll(`#${secId} .ftab`).forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll(`#${secId} .ftab`).forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        getFn()(tab.dataset.filter);
      });
    });
  });
}

window.switchSection = function(name) {
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById('sec-' + name)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${name}"]`)?.classList.add('active');

  const titles = {
    overview: 'Command Centre 🛡️', analytics: 'Analytics', orgs: 'Organisations',
    donors: 'Donors', recipients: 'Recipients', requests: 'Blood Requests',
    reports: 'Reports', broadcast: 'Broadcast', audit: 'Audit Log'
  };
  document.getElementById('pageTitle').textContent = titles[name] || name;
  document.getElementById('pageSubtitle').textContent = '';

  if (name === 'orgs')       renderOrgs();
  if (name === 'donors')     renderUsers('donors');
  if (name === 'recipients') renderUsers('recipients');
  if (name === 'requests')   renderRequests();
  if (name === 'reports')    renderReports();
};

// ── Theme ─────────────────────────────────────────────────────
function setupTheme() {
  const btn  = document.getElementById('themeToggle');
  const html = document.documentElement;
  const saved = localStorage.getItem('lifynk-theme') || 'light';
  html.setAttribute('data-theme', saved);
  btn.querySelector('i').className = saved === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  btn.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('lifynk-theme', next);
    btn.querySelector('i').className = next === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  });
}

// ── Logout ────────────────────────────────────────────────────
function setupLogout() {
  document.getElementById('logoutBtn').addEventListener('click', () =>
    document.getElementById('logoutConfirmOverlay').classList.add('open'));
  document.getElementById('sidebarLogoutBtn').addEventListener('click', () =>
    document.getElementById('logoutConfirmOverlay').classList.add('open'));
}
window.closeLogoutModal = () =>
  document.getElementById('logoutConfirmOverlay').classList.remove('open');
window.confirmLogout = async () => {
  await signOut(auth);
  window.location.href = '../auth/login.html';
};

// ── Header dropdown ───────────────────────────────────────────
function setupHeaderDropdown() {
  document.getElementById('headerAvatarWrap').addEventListener('click', e => {
    e.stopPropagation();
    const dd   = document.getElementById('headerDropdown');
    const rect = document.getElementById('headerAvatarWrap').getBoundingClientRect();
    dd.style.top   = (rect.bottom + 8) + 'px';
    dd.style.right = (window.innerWidth - rect.right) + 'px';
    dd.classList.toggle('open');
  });
  document.addEventListener('click', () =>
    document.getElementById('headerDropdown').classList.remove('open'));
}

// ── Notification Panel ────────────────────────────────────────
function setupNotifPanel() {
  const btn   = document.getElementById('notifBtn');
  const panel = document.getElementById('notifPanel');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const rect = btn.getBoundingClientRect();
    panel.style.top   = (rect.bottom + 8) + 'px';
    panel.style.right = (window.innerWidth - rect.right) + 'px';
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', () => { panel.style.display = 'none'; });
}

// ── Badges ────────────────────────────────────────────────────
function refreshBadges() {
  const pending  = allOrgs.filter(o => o.status === 'pending').length;
  const openRep  = allReports.filter(r => r.status === 'open').length;

  const orgBadge = document.getElementById('orgPendingBadge');
  orgBadge.textContent    = pending;
  orgBadge.style.display  = pending > 0 ? '' : 'none';

  const repBadge = document.getElementById('reportsBadge');
  repBadge.textContent    = openRep;
  repBadge.style.display  = openRep > 0 ? '' : 'none';

  document.getElementById('notifDot').style.display = (pending > 0 || openRep > 0) ? '' : 'none';

  // Update notification panel list
  const notifItems = [];
  if (pending > 0) notifItems.push(`<div style="padding:12px 16px;border-bottom:1px solid var(--border-subtle);font-size:13px;cursor:pointer" onclick="switchSection('orgs')">
    <b>🏢 ${pending} organisation${pending>1?'s':''}</b> pending approval
  </div>`);
  if (openRep > 0) notifItems.push(`<div style="padding:12px 16px;font-size:13px;cursor:pointer" onclick="switchSection('reports')">
    <b>🚩 ${openRep} open report${openRep>1?'s':''}</b> need review
  </div>`);
  const notifList = document.getElementById('notifList');
  notifList.innerHTML = notifItems.length
    ? notifItems.join('')
    : `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px">
         <i class="fa-solid fa-bell-slash" style="display:block;margin-bottom:8px;font-size:22px;opacity:.4"></i>No new notifications
       </div>`;
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.transform = 'translateY(0)';
  t.style.opacity   = '1';
  clearTimeout(t._to);
  t._to = setTimeout(() => {
    t.style.transform = 'translateY(80px)';
    t.style.opacity   = '0';
  }, 3200);
}

// ── Helpers ───────────────────────────────────────────────────
function fmtTime(d) {
  if (!d) return '';
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
  return d.toLocaleDateString();
}

function getOrgName(o) {
  return o.hospitalName || o.ngoName || o.bbname || o.name || o.directorName || o.director || 'Unnamed';
}
function getUserName(u) {
  return u.fullName || u.name || u.displayName || 'Unknown';
}

// ── Expose globals ────────────────────────────────────────────
window.approveOrg      = approveOrg;
window.rejectOrg       = rejectOrg;
window.suspendOrg      = suspendOrg;
window.restoreOrg      = restoreOrg;
window.deleteOrg       = deleteOrg;
window.suspendUser     = suspendUser;
window.restoreUser     = restoreUser;
window.banUser         = banUser;
window.deleteUser      = deleteUser;
window.openOrgModal    = openOrgModal;
window.openUserModal   = openUserModal;
window.openReportModal = openReportModal;
window.resolveReport   = resolveReport;
window.dismissReport   = dismissReport;
window.sendBroadcast   = sendBroadcast;
window.showToast       = showToast;
// ── Search ────────────────────────────────────────────────────
function setupSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      // clear search — re-render current section normally
      const active = document.querySelector('section.active')?.id?.replace('sec-', '');
      if      (active === 'orgs')       renderOrgs();
      else if (active === 'donors')     renderUsers('donors');
      else if (active === 'recipients') renderUsers('recipients');
      else if (active === 'overview')   renderOverview();
      return;
    }
    _runSearch(q);
  });
}

function _runSearch(q) {
  // Search across orgs, donors, recipients simultaneously
  const matchOrg = allOrgs.filter(o =>
    (getOrgName(o) + o.email + o.city + o.orgType + o.status + (o.phone||'')).toLowerCase().includes(q)
  );
  const matchDonor = allDonors.filter(u =>
    (getUserName(u) + (u.email||'') + (u.phone||u.mobile||'') + (u.bloodGroup||'') + (u.city||'')).toLowerCase().includes(q)
  );
  const matchRecipient = allRecipients.filter(u =>
    (getUserName(u) + (u.email||'') + (u.phone||u.mobile||'') + (u.bloodGroup||'') + (u.city||'')).toLowerCase().includes(q)
  );

  const total = matchOrg.length + matchDonor.length + matchRecipient.length;

  // Show results in current section or switch to overview-style combined view
  const active = document.querySelector('section.active')?.id?.replace('sec-', '');

  if (active === 'orgs') {
    document.getElementById('orgSectionTag').textContent = `${matchOrg.length} results`;
    document.getElementById('orgList').innerHTML = matchOrg.length
      ? matchOrg.map(o => orgRowHTML(o)).join('')
      : `<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i>No organisations match "${q}"</div>`;
    return;
  }

  if (active === 'donors') {
    document.getElementById('donorSectionTag').textContent = `${matchDonor.length} results`;
    document.getElementById('donorList').innerHTML = matchDonor.length
      ? matchDonor.map(u => userRowHTML(u)).join('')
      : `<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i>No donors match "${q}"</div>`;
    return;
  }

  if (active === 'recipients') {
    document.getElementById('recipientSectionTag').textContent = `${matchRecipient.length} results`;
    document.getElementById('recipientList').innerHTML = matchRecipient.length
      ? matchRecipient.map(u => userRowHTML(u)).join('')
      : `<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i>No recipients match "${q}"</div>`;
    return;
  }

  // For overview / any other section — show combined results inline
  const overviewPending = document.getElementById('overviewPendingList');
  if (!overviewPending) return;

  if (total === 0) {
    overviewPending.innerHTML = `<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i>No results for "${q}"</div>`;
    return;
  }

  let html = '';
  if (matchOrg.length) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:8px 6px 4px">Organisations (${matchOrg.length})</div>`;
    html += matchOrg.map(o => orgRowHTML(o, true)).join('');
  }
  if (matchDonor.length) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:8px 6px 4px">Donors (${matchDonor.length})</div>`;
    html += matchDonor.map(u => userRowHTML(u)).join('');
  }
  if (matchRecipient.length) {
    html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);padding:8px 6px 4px">Recipients (${matchRecipient.length})</div>`;
    html += matchRecipient.map(u => userRowHTML(u)).join('');
  }
  overviewPending.innerHTML = html;
}