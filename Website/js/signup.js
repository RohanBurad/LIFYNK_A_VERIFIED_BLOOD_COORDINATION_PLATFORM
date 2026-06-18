import { auth, db, CLOUDINARY } from "./firebase.js";
// ================================================================
//  Lifynk — js/signup.js
//  Reads form data → compresses image → stores in localStorage
//  verify.js picks this up AFTER OTP and saves to Firestore + Cloudinary
// ================================================================

// ================================================================
//  Lifynk — Unique ID Generator
// ================================================================
function generateLifynkId(role) {
    const prefixMap = {
        donor:     'LFY-DNR',
        recipient: 'LFY-RCP',
        hospital:  'LFY-HSP',
        ngo:       'LFY-NGO',
        bloodbank: 'LFY-BBK'
    };
    const prefix = prefixMap[role] || 'LFY-USR';
    const rand   = Math.floor(1000 + Math.random() * 9000);
    const ts     = Date.now().toString().slice(-4);
    return `${prefix}-${rand}${ts}`;
}

// ── Max file size allowed (4MB) ───────────────────────────────
const MAX_FILE_SIZE = 4 * 1024 * 1024;

// ── Image compression quality ─────────────────────────────────
const COMPRESS_QUALITY  = 0.7;
const COMPRESS_MAX_WIDTH = 1200;

// ─────────────────────────────────────────────────────────────
//  IMAGE COMPRESSOR
// ─────────────────────────────────────────────────────────────
function compressImage(file) {
    return new Promise((resolve, reject) => {
        if (file.type === 'application/pdf') {
            const reader = new FileReader();
            reader.onload = (e) => resolve({
                base64: e.target.result,
                type:   'pdf',
                name:   file.name,
                sizeMB: (file.size / 1024 / 1024).toFixed(2)
            });
            reader.onerror = () => reject(new Error('Failed to read PDF'));
            reader.readAsDataURL(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width  = img.width;
                let height = img.height;

                if (width > COMPRESS_MAX_WIDTH) {
                    height = Math.round((height * COMPRESS_MAX_WIDTH) / width);
                    width  = COMPRESS_MAX_WIDTH;
                }

                canvas.width  = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const compressed   = canvas.toDataURL('image/jpeg', COMPRESS_QUALITY);
                const originalMB   = (file.size / 1024 / 1024).toFixed(2);
                const compressedKB = Math.round((compressed.length * 0.75) / 1024);

                console.log(`Compressed: ${originalMB}MB → ~${compressedKB}KB`);

                resolve({
                    base64: compressed,
                    type:   'image',
                    name:   file.name.replace(/\.[^/.]+$/, '.jpg'),
                    sizeMB: (compressedKB / 1024).toFixed(2)
                });
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

// ─────────────────────────────────────────────────────────────
//  SHOW INLINE ERROR
// ─────────────────────────────────────────────────────────────
function showFieldError(inputEl, message) {
    const existing = inputEl.parentElement.querySelector('.field-error');
    if (existing) existing.remove();

    const err = document.createElement('p');
    err.className   = 'field-error';
    err.textContent = message;
    err.style.cssText = 'color:#e11d48;font-size:12px;margin-top:5px;font-weight:600;';
    inputEl.parentElement.appendChild(err);
    inputEl.style.borderColor = '#e11d48';
    inputEl.focus();

    setTimeout(() => {
        err.remove();
        inputEl.style.borderColor = '';
    }, 4000);
}

// ─────────────────────────────────────────────────────────────
//  SHOW SUCCESS TOAST
// ─────────────────────────────────────────────────────────────
function showSuccess(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        background:#0d9488; color:#fff; padding:12px 24px; border-radius:12px;
        font-size:14px; font-weight:600; box-shadow:0 4px 20px rgba(0,0,0,.2);
        z-index:9999; animation:fadeIn .3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ─────────────────────────────────────────────────────────────
//  SHOW UPLOAD PROGRESS
// ─────────────────────────────────────────────────────────────
function setUploadState(wrapper, state, filename = '') {
    const icon = wrapper.querySelector('i');
    const text = wrapper.querySelector('p');

    if (state === 'loading') {
        icon.className = 'fa-solid fa-spinner fa-spin';
        text.textContent = 'Processing file…';
        wrapper.style.borderColor = '#0d9488';
    } else if (state === 'done') {
        icon.className = 'fa-solid fa-circle-check';
        icon.style.color = '#10b981';
        text.textContent = `✅ ${filename}`;
        wrapper.style.borderColor = '#10b981';
        wrapper.style.background  = '#f0fdf4';
    } else if (state === 'error') {
        icon.className = 'fa-solid fa-circle-xmark';
        icon.style.color = '#e11d48';
        text.textContent = filename || 'Upload failed. Try again.';
        wrapper.style.borderColor = '#e11d48';
    }
}

// ─────────────────────────────────────────────────────────────
//  COLLECT FORM DATA per role
//  NOTE: password is intentionally excluded — handled separately
//        so it never ends up stored in localStorage as plain text
//        any longer than absolutely necessary
// ─────────────────────────────────────────────────────────────
function collectFormData(role) {
    const g = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    const base = { role, createdAt: new Date().toISOString() };

    if (role === 'donor') {
        return {
            ...base,
            name:       g('donor-name'),
            bloodGroup: g('donor-blood'),
            age:        g('donor-age'),
            gender:     g('donor-gender'),
            email:      g('donor-email'),
            phone:      g('donor-phone'),
            city:       g('donor-city'),
            idType:     g('donor-id-type'),
            // ✅ password excluded — saved separately in localStorage
        };
    }

    if (role === 'recipient') {
        return {
            ...base,
            name:       g('recipient-name'),
            bloodGroup: g('recipient-blood'),
            age:        g('recipient-age'),
            gender:     g('recipient-gender'),
            email:      g('recipient-email'),
            phone:      g('recipient-phone'),
            city:       g('recipient-city'),
            idType:     g('recipient-id-type'),
            // ✅ password excluded — saved separately in localStorage
        };
    }

    if (role === 'hospital') {
        return {
            ...base,
            hospitalName: g('hospital-name'),
            email:        g('hospital-email'),
            phone:        g('hospital-phone'),
            city:         g('hospital-city'),
            licenseNo:    g('hospital-license'),
            // ✅ password excluded — read directly in handleSignup
        };
    }

    if (role === 'ngo') {
        return {
            ...base,
            name:    g('ngo-name'),
            owner:   g('ngo-owner'),
            email:   g('ngo-email'),
            phone:   g('ngo-phone'),
            city:    g('ngo-city'),
            regId:   g('ngo-reg-id'),
            // ✅ password excluded — read directly in handleSignup
        };
    }

    if (role === 'bloodbank') {
        return {
            ...base,
            bbname:   g('bb-name'),
            director: g('bb-director'),
            email:    g('bb-email'),
            phone:    g('bb-phone'),
            city:     g('bb-city'),
            license:  g('bb-license'),
            // ✅ password excluded — read directly in handleSignup
        };
    }

    return base;
}

// ─────────────────────────────────────────────────────────────
//  FILE INPUT IDS per role
// ─────────────────────────────────────────────────────────────
const fileInputMap = {
    donor:     'donor-id-file',
    recipient: 'recipient-id-file',
    hospital:  'hospital-doc',
    ngo:       'ngo-doc',
    bloodbank: 'bb-doc',
};

// ─────────────────────────────────────────────────────────────
//  PASSWORD FIELD IDS per role
// ─────────────────────────────────────────────────────────────
const passwordMap = {
    donor:     'donor-password',
    recipient: 'recipient-password',
    hospital:  'hospital-password',
    ngo:       'ngo-password',
    bloodbank: 'bb-password',
};

// ─────────────────────────────────────────────────────────────
//  PHONE MAP per role
// ─────────────────────────────────────────────────────────────
const phoneMap = {
    donor:     { code: 'donor-code',     number: 'donor-phone'     },
    recipient: { code: 'recipient-code', number: 'recipient-phone' },
    hospital:  { code: 'hospital-code',  number: 'hospital-phone'  },
    ngo:       { code: 'ngo-code',       number: 'ngo-phone'       },
    bloodbank: { code: 'bb-code',        number: 'bb-phone'        },
};

function buildPhone(role) {
    const pm     = phoneMap[role];
    const code   = document.getElementById(pm.code).value;
    const raw    = document.getElementById(pm.number).value;
    const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
    return { fullPhone: code + digits, digits };
}

async function uploadToCloudinary({ base64, name, type }) {
    const formData = new FormData();
    formData.append('file', base64);
    formData.append('upload_preset', CLOUDINARY.uploadPreset);
    formData.append('public_id', `lifynk/${name}`);

    const res  = await fetch(CLOUDINARY.baseUrl, { method: 'POST', body: formData });
    const data = await res.json();

    if (!data.secure_url) throw new Error('Cloudinary upload failed');
    return data.secure_url;
}

// ─────────────────────────────────────────────────────────────
//  MAIN SUBMIT HANDLER
// ─────────────────────────────────────────────────────────────
async function handleSignup(form) {
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';

    const role   = form.getAttribute('data-role');
    const btn    = form.querySelector('.btn-submit');
    const fileId = fileInputMap[role];
    const fileEl = document.getElementById(fileId);
    const file   = fileEl ? fileEl.files[0] : null;

    // ── Read password directly from form field ────────────────
    // IMPORTANT: Never pass through collectFormData or store in
    // signupData — Firebase Auth handles password storage securely
    const passwordEl = document.getElementById(passwordMap[role]);
    const password   = passwordEl ? passwordEl.value : '';

    if (!password || password.length < 6) {
        showFieldError(passwordEl, 'Password must be at least 6 characters.');
        form.dataset.submitting = 'false';
        return;
    }

    // ── Validate email format ─────────────────────────────────
    const emailMap = {
        donor:     'donor-email',
        recipient: 'recipient-email',
        hospital:  'hospital-email',
        ngo:       'ngo-email',
        bloodbank: 'bb-email',
    };
    const emailEl  = document.getElementById(emailMap[role]);
    const emailVal = emailEl ? emailEl.value.trim() : '';

    if (emailEl && emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailVal)) {
        showFieldError(emailEl, 'Please enter a valid email address (e.g. name@gmail.com)');
        form.dataset.submitting = 'false';
        return;
    }

    // ── Validate phone ────────────────────────────────────────
    const { fullPhone, digits } = buildPhone(role);
    const phoneEl = document.getElementById(phoneMap[role].number);

    if (digits.length < 7) {
        showFieldError(phoneEl, 'Please enter a valid phone number.');
        form.dataset.submitting = 'false';
        return;
    }

    // ── Validate file ─────────────────────────────────────────
    if (!file) {
        showFieldError(fileEl, 'Please upload the required document.');
        form.dataset.submitting = 'false';
        return;
    }

    if (file.size > MAX_FILE_SIZE) {
        const wrapper = fileEl.closest('.file-upload-wrapper');
        setUploadState(wrapper, 'error', `File too large (${(file.size/1024/1024).toFixed(1)}MB). Max 4MB.`);
        form.dataset.submitting = 'false';
        return;
    }

    // ── Start loading ─────────────────────────────────────────
    btn.classList.add('btn-loading');
    btn.disabled = true;
    const wrapper = fileEl.closest('.file-upload-wrapper');
    setUploadState(wrapper, 'loading');

    try {
        const fileData = await compressImage(file);
        setUploadState(wrapper, 'done', fileData.name);

        const formData = collectFormData(role); // no password inside

        const otpRoles = ['donor', 'recipient'];

        if (otpRoles.includes(role)) {
            // ── Donor & Recipient → OTP flow ──────────────────
            // Password saved separately so verify.js can use it
            // for linkWithCredential, then immediately removes it
            localStorage.setItem('userPhone',      fullPhone);
            localStorage.setItem('userRole',       role);
            localStorage.setItem('otpFlow',        'signup');
            localStorage.setItem('signupData',     JSON.stringify(formData));
            localStorage.setItem('signupPassword', password);       // ✅ separate key
            localStorage.setItem('signupFile',     fileData.base64);
            localStorage.setItem('signupFileName', fileData.name);
            localStorage.setItem('signupFileType', fileData.type);

            setTimeout(() => { window.location.href = 'verify.html'; }, 800);

        } else {
            // ── Hospital / NGO / Bloodbank → Email+Password flow ──
            const { createUserWithEmailAndPassword } = await import(
                "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
            const { doc, setDoc } = await import(
                "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

            const email = formData.email;

            // ✅ password read directly from field, NOT from formData
            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            const uid      = userCred.user.uid;

            const cloudUrl = await uploadToCloudinary(fileData);

            const collectionMap = {
                hospital:  'hospitals',
                ngo:       'ngos',
                bloodbank: 'bloodbanks'
            };

            const nameMap = {
                hospital:  formData.hospitalName,
                ngo:       formData.name,
                bloodbank: formData.bbname
            };

            const lifynkId = generateLifynkId(role);

            // ✅ password: '' — never store in Firestore
            await setDoc(doc(db, collectionMap[role], uid), {
                ...formData,
                idFileUrl: cloudUrl,
                lifynkId,
                status:   'pending',
                password: '',
            });

            await setDoc(doc(db, 'users', uid), {
                role,
                name:      nameMap[role],
                email,
                lifynkId,
                createdAt: new Date().toISOString()
            });

            // ✅ Fixed paths — auth/ folder is one level below root
            const routes = {
                hospital:  '../dashboard/hospital-dashboard.html',
                ngo:       '../dashboard/ngo-dashboard.html',
                bloodbank: '../dashboard/bloodbank-dashboard.html',
            };

            showSuccess('Account created! Redirecting...');
            setTimeout(() => { window.location.href = routes[role]; }, 800);
        }

    } catch (err) {
        console.error('Signup error:', err);
        btn.classList.remove('btn-loading');
        btn.disabled = false;
        form.dataset.submitting = 'false';

        const firebaseErrors = {
            'auth/email-already-in-use':   'This email is already registered. Please log in instead.',
            'auth/invalid-email':          'Invalid email address. Please check and try again.',
            'auth/weak-password':          'Password is too weak. Use at least 6 characters.',
            'auth/network-request-failed': 'Network error. Please check your connection.',
            'auth/too-many-requests':      'Too many attempts. Please wait a moment and try again.',
        };

        const message = firebaseErrors[err.code] || err.message || 'Processing failed. Please try again.';
        setUploadState(wrapper, 'error', message);
    }
}

// ─────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    document.querySelectorAll('.signup-form').forEach(form => {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSignup(form);
        });
    });

    document.querySelectorAll('.file-upload-wrapper').forEach(wrapper => {
        const fi = wrapper.querySelector('input[type="file"]');

        fi.addEventListener('dragenter', () => wrapper.classList.add('file-drag-active'));
        fi.addEventListener('dragleave', () => wrapper.classList.remove('file-drag-active'));
        fi.addEventListener('drop',      () => wrapper.classList.remove('file-drag-active'));

        fi.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > MAX_FILE_SIZE) {
                setUploadState(wrapper, 'error',
                    `Too large (${(file.size/1024/1024).toFixed(1)}MB). Max 4MB.`);
                fi.value = '';
                return;
            }

            const icon = wrapper.querySelector('i');
            const text = wrapper.querySelector('p');
            icon.className = 'fa-solid fa-file-circle-check';
            icon.style.color = '#0d9488';
            text.textContent = `📎 ${file.name}`;
            wrapper.style.borderColor = '#0d9488';
        });
    });

    document.querySelectorAll('input, select').forEach(input => {
        input.addEventListener('invalid', (e) => {
            e.preventDefault();
            input.classList.remove('shake-error');
            void input.offsetWidth;
            input.classList.add('shake-error');
        });
        input.addEventListener('input', () => {
            input.classList.remove('shake-error');
            input.style.borderColor = '';
            const err = input.parentElement.querySelector('.field-error');
            if (err) err.remove();
        });
    });
});