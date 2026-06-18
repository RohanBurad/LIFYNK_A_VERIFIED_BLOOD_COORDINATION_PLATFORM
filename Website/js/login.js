import { auth, db } from './firebase.js';
import {
    signInWithEmailAndPassword,
    RecaptchaVerifier,
    signInWithPhoneNumber,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc,
    getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── reCAPTCHA setup ───────────────────────────────────────────
let recaptchaVerifier;

function initRecaptcha() {
    if (recaptchaVerifier) return;
    recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
        callback: () => {},
        'expired-callback': () => {
            recaptchaVerifier.clear();
            recaptchaVerifier = null;
        }
    });
    recaptchaVerifier.render();
}

document.addEventListener('DOMContentLoaded', initRecaptcha);

// ─────────────────────────────────────────────────────────────
//  SHOW INLINE ERROR
// ─────────────────────────────────────────────────────────────
function showLoginError(message) {
    let el = document.getElementById('login-error');
    if (!el) {
        el = document.createElement('p');
        el.id = 'login-error';
        el.style.cssText = 'color:#e11d48;font-size:13px;text-align:center;font-weight:600;margin-top:8px;';
        document.querySelector('.btn-submit').insertAdjacentElement('afterend', el);
    }
    el.textContent = message;
    setTimeout(() => (el.textContent = ''), 4000);
}

// ─────────────────────────────────────────────────────────────
//  FORM SUBMIT
// ─────────────────────────────────────────────────────────────
const loginForm = document.querySelector('.login-form');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const role     = document.getElementById('userRole').value;
    const identity = document.getElementById('identity').value.trim();
    const password = document.getElementById('password').value;
    const btn      = e.target.querySelector('.btn-submit');

    btn.classList.add('btn-loading');

    // ── ADMIN ─────────────────────────────────────────────────
    if (role === 'admin') {
        try {
            const userCredential = await signInWithEmailAndPassword(auth, identity, password);
            const uid  = userCredential.user.uid;
            const snap = await getDoc(doc(db, 'users', uid));

            if (!snap.exists() || snap.data().role !== 'admin') {
                await auth.signOut();
                btn.classList.remove('btn-loading');
                return showLoginError('Access denied. Authorised personnel only.');
            }

            window.location.href = '../dashboard/admin.html';
        } catch (err) {
            console.error('Admin login error:', err);
            btn.classList.remove('btn-loading');
            showLoginError(getFriendlyAuthError(err.code));
        }
        return;
    }

    // ── DONOR / RECIPIENT ─────────────────────────────────────
    // Supports TWO login methods:
    // 1. Phone OTP  — identity looks like a phone number (digits only)
    // 2. Email+Password — identity contains '@'
    
    if (role === 'donor' || role === 'recipient') {

        const isEmail = identity.includes('@');

        if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(identity)) {
            btn.classList.remove('btn-loading');
            return showLoginError('Please enter a valid email address (e.g. name@gmail.com)');
        }

        if (isEmail) {
            // ── Email + Password login ────────────────────────
            try {
                const userCredential = await signInWithEmailAndPassword(auth, identity, password);
                const uid = userCredential.user.uid;

                const snap = await getDoc(doc(db, 'users', uid));
                if (!snap.exists()) throw new Error('User record not found.');

                const status = snap.data().status;
                if (status === 'suspended' || status === 'banned') {
                    await auth.signOut();
                    btn.classList.remove('btn-loading');
                    return showLoginError('Your account has been suspended. Contact support.');
                }

                const actualRole = snap.data().role;
                const routes = {
                    donor:     '../dashboard/donor-dashboard.html',
                    recipient: '../dashboard/recipient-dashboard.html',
                };

                window.location.href = routes[actualRole] ?? '../dashboard/dashboard.html';

            } catch (err) {
                console.error('Email login error:', err);
                btn.classList.remove('btn-loading');
                showLoginError(getFriendlyAuthError(err.code));
            }

        } else {
            // ── Phone OTP login ───────────────────────────────
            const codeEl      = document.getElementById('country-code');
            const phoneNumber = (codeEl ? codeEl.value : '+91') + identity;

            localStorage.setItem('userPhone', phoneNumber);
            localStorage.setItem('otpFlow',   'login');
            localStorage.setItem('userRole',  role);

            if (!recaptchaVerifier) initRecaptcha();

            try {
                const confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
                window.confirmationResult = confirmationResult;
                window.location.href = 'verify.html';
            } catch (err) {
                console.error('OTP send error:', err);
                btn.classList.remove('btn-loading');

                if (recaptchaVerifier) {
                    recaptchaVerifier.clear();
                    recaptchaVerifier = null;
                }
                initRecaptcha();
                showLoginError(getFriendlyAuthError(err.code));
            }
        }
        return;
    }

    // ── HOSPITAL / NGO / BLOOD BANK: Email + Password ─────────
    try {
        const userCredential = await signInWithEmailAndPassword(auth, identity, password);
        const uid = userCredential.user.uid;

        const snap = await getDoc(doc(db, 'users', uid));
        if (!snap.exists()) throw new Error('User record not found.');

        const status = snap.data().status;
        if (status === 'suspended' || status === 'banned') {
            await auth.signOut();
            btn.classList.remove('btn-loading');
            return showLoginError('Your account has been suspended. Contact support.');
        }

        const actualRole = snap.data().role;
        const routes = {
            hospital:  '../dashboard/hospital-dashboard.html',
            ngo:       '../dashboard/ngo-dashboard.html',
            bloodbank: '../dashboard/bloodbank-dashboard.html',
        };

        const destination = routes[actualRole];
        if (!destination) throw new Error('Unknown role: ' + actualRole);

        window.location.href = destination;

    } catch (err) {
        console.error('Org Login Error:', err);
        btn.classList.remove('btn-loading');
        showLoginError(getFriendlyAuthError(err.code));
    }
});

// ─────────────────────────────────────────────────────────────
//  FRIENDLY ERROR MESSAGES
// ─────────────────────────────────────────────────────────────
function getFriendlyAuthError(code) {
    const map = {
        'auth/invalid-credential':    'Invalid email or password. Please try again.',
        'auth/user-not-found':        'No account found. Please sign up first.',
        'auth/wrong-password':        'Incorrect password. Please try again.',
        'auth/invalid-email':         'Invalid email address.',
        'auth/too-many-requests':     'Too many attempts. Please wait a few minutes.',
        'auth/invalid-phone-number':  'Invalid phone number. Please check and try again.',
        'auth/network-request-failed':'Network error. Please check your connection.',
    };
    return map[code] || 'Login failed. Please try again.';
}