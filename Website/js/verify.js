// ================================================================
//  Lifynk — js/verify.js
//  Handles: OTP send → verify → role-based dashboard redirect
// ================================================================

import { auth, db, CLOUDINARY } from "./firebase.js";

// ================================================================
//  Unique ID Generator
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

import {
    RecaptchaVerifier,
    signInWithPhoneNumber,
    EmailAuthProvider,
    linkWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    doc,
    getDoc,
    getDocs,
    setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── State ─────────────────────────────────────────────────────
let confirmationResult = null;
let countdown          = null;
let timeLeft           = 60;
let resendCount        = Number(localStorage.getItem("resendCount")) || 0;
let isCooldown         = false;

// ── Grab all 6 OTP inputs ─────────────────────────────────────
const inputs = () => [...document.querySelectorAll(".otp-digit")];

// ─────────────────────────────────────────────────────────────
//  TIMER
// ─────────────────────────────────────────────────────────────
function startTimer() {
    clearInterval(countdown);
    timeLeft = 60;

    const timerEl   = document.getElementById("timer");
    const resendBtn = document.getElementById("resendBtn");
    resendBtn.disabled = true;

    countdown = setInterval(() => {
        timeLeft--;
        timerEl.textContent = `00:${timeLeft < 10 ? "0" : ""}${timeLeft}`;
        if (timeLeft <= 0) {
            clearInterval(countdown);
            resendBtn.disabled = false;
        }
    }, 1000);
}

function startCooldownTimer(seconds) {
    isCooldown = true;

    const timerEl   = document.getElementById("timer");
    const resendBtn = document.getElementById("resendBtn");
    resendBtn.disabled = true;

    clearInterval(countdown);

    countdown = setInterval(() => {
        seconds--;
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        timerEl.textContent = `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;

        if (seconds <= 0) {
            clearInterval(countdown);
            localStorage.removeItem("cooldownEndTime");
            isCooldown  = false;
            resendCount = 0;
            localStorage.setItem("resendCount", 0);
            resendBtn.disabled = false;
            startTimer();
        }
    }, 1000);
}

// ─────────────────────────────────────────────────────────────
//  CLOUDINARY UPLOAD
// ─────────────────────────────────────────────────────────────
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
//  ROLE-BASED REDIRECT
// ─────────────────────────────────────────────────────────────
async function redirectByRole(uid) {
    try {
        const snap = await getDoc(doc(db, "users", uid));

        if (!snap.exists()) {
            window.location.href = "signup.html";
            return;
        }

        const userData = snap.data();
        const role     = userData.role;

        // ── Check suspended / banned (donors & recipients) ────
        if (role === "donor" || role === "recipient") {
            const collMap  = { donor: "donors", recipient: "recipients" };
            const userSnap = await getDoc(doc(db, collMap[role], uid));
            if (userSnap.exists()) {
                const status = userSnap.data().status;
                if (status === "suspended") {
                    showError("Your account has been suspended. Please contact support.");
                    const btn = document.getElementById("verifyBtn");
                    if (btn) { btn.classList.remove("btn-loading"); btn.textContent = "Verify"; }
                    return;
                }
                if (status === "banned") {
                    showError("Your account has been permanently banned.");
                    const btn = document.getElementById("verifyBtn");
                    if (btn) { btn.classList.remove("btn-loading"); btn.textContent = "Verify"; }
                    return;
                }
            }
        }

        // ── Check org approval status ─────────────────────────
        if (role === "hospital" || role === "ngo" || role === "bloodbank") {
            const colMap   = { hospital: "hospitals", ngo: "ngos", bloodbank: "bloodbanks" };
            const orgSnap  = await getDoc(doc(db, colMap[role], uid));
            if (orgSnap.exists()) {
                const { status, rejectionReason } = orgSnap.data();
                if (status === "pending") {
                    showError("Your application is under review. You will be notified once approved.");
                    const btn = document.getElementById("verifyBtn");
                    if (btn) { btn.classList.remove("btn-loading"); btn.textContent = "Verify"; }
                    return;
                }
                if (status === "rejected") {
                    const reason = rejectionReason ? ` Reason: ${rejectionReason}` : " Please re-apply with valid documents.";
                    showError(`Your application was rejected.${reason}`);
                    const btn = document.getElementById("verifyBtn");
                    if (btn) { btn.classList.remove("btn-loading"); btn.textContent = "Verify"; }
                    return;
                }
                if (status === "suspended") {
                    showError("Your organisation account has been suspended. Contact support.");
                    const btn = document.getElementById("verifyBtn");
                    if (btn) { btn.classList.remove("btn-loading"); btn.textContent = "Verify"; }
                    return;
                }
            }
        }

        const routes = {
            donor:     "../dashboard/donor-dashboard.html",
            recipient: "../dashboard/recipient-dashboard.html",
            hospital:  "../dashboard/hospital-dashboard.html",
            ngo:       "../dashboard/ngo-dashboard.html",
            bloodbank: "../dashboard/bloodbank-dashboard.html",
        };

        window.location.href = routes[role] ?? "dashboard.html";

    } catch (err) {
        console.error("Role fetch error:", err);
        window.location.href = "dashboard.html";
    }
}

// ─────────────────────────────────────────────────────────────
//  SEND OTP
// ─────────────────────────────────────────────────────────────
function sendOTP(phone) {
    signInWithPhoneNumber(auth, phone, window.recaptchaVerifier)
        .then((result) => {
            confirmationResult = result;
            console.log("OTP sent to", phone);
        })
        .catch((err) => {
            console.error("OTP send error:", err);
            showError(getFriendlyError(err.code));
        });
}

// ─────────────────────────────────────────────────────────────
//  VERIFY OTP
// ─────────────────────────────────────────────────────────────
window.verifyOTP = async function () {
    const btn = document.getElementById("verifyBtn");
    if (btn.classList.contains("btn-loading")) return;

    const otp = inputs().map((i) => i.value).join("");

    if (otp.length < 6) {
        showError("Please enter the complete 6-digit code.");
        return;
    }

    if (!confirmationResult) {
        showError("Session expired. Please go back and try again.");
        return;
    }

    btn.classList.add("btn-loading");
    btn.textContent = "Verifying…";

    try {
        const result   = await confirmationResult.confirm(otp);
        const uid      = result.user.uid;
        const flowType = localStorage.getItem("otpFlow");

        if (flowType === "emergency") {
            ["otpFlow", "userPhone", "resendCount", "cooldownEndTime"]
                .forEach((k) => localStorage.removeItem(k));

            showSuccess("Emergency request verified!");
            setTimeout(() => (window.location.href = "dashboard/recipient-dashboard.html"), 1200);

        } else if (flowType === "signup") {
            // ── New signup — save to Firestore + Cloudinary ───
            const signupData = JSON.parse(localStorage.getItem("signupData"));
            const role       = localStorage.getItem("userRole");
            const fileBase64 = localStorage.getItem("signupFile");
            const fileName   = localStorage.getItem("signupFileName");
            const fileType   = localStorage.getItem("signupFileType");

            // ✅ Read password from its own key, then immediately remove it
            const password = localStorage.getItem("signupPassword");
            localStorage.removeItem("signupPassword"); // clear right away

            showSuccess("OTP Verified! Saving your account...");

            // Upload document to Cloudinary
            const cloudUrl = await uploadToCloudinary({
                base64: fileBase64,
                name:   fileName,
                type:   fileType
            });

            // ✅ Link email+password to the phone auth account
            // This allows donor/recipient to log in with EITHER
            // phone OTP or email+password
            if (signupData.email && password) {
                try {
                    const emailCred = EmailAuthProvider.credential(
                        signupData.email,
                        password   // ✅ from its own localStorage key, not signupData
                    );
                    await linkWithCredential(result.user, emailCred);
                    console.log("Email+password linked to phone account ✅");
                } catch (linkErr) {
                    // auth/email-already-in-use means it's already linked — safe to continue
                    if (linkErr.code !== 'auth/email-already-in-use') {
                        console.error("linkWithCredential error:", linkErr);
                        // Don't throw — account is created, just log the issue
                    }
                }
            }

            const collectionMap = { donor: "donors", recipient: "recipients" };
            const lifynkId      = generateLifynkId(role);

            // ✅ signupData has no password field — safe to spread directly
            await setDoc(doc(db, collectionMap[role], uid), {
                ...signupData,
                idFileUrl: cloudUrl,
                lifynkId,
                status:   "pending",
                password: "",        // belt-and-suspenders: ensure it's never stored
            });

            await setDoc(doc(db, "users", uid), {
                role,
                name:      signupData.name,
                phone:     localStorage.getItem("userPhone"),
                email:     signupData.email,
                lifynkId,
                createdAt: new Date().toISOString()
            });

            // Clean up all localStorage
            ["otpFlow", "userPhone", "userRole", "resendCount", "cooldownEndTime",
             "signupData", "signupFile", "signupFileName", "signupFileType"]
                .forEach((k) => localStorage.removeItem(k));

            showSuccess("Account created! Loading dashboard...");
            await redirectByRole(uid);

        } else {
            // ── Login flow ────────────────────────────────────
            ["otpFlow", "userPhone", "resendCount", "cooldownEndTime"]
                .forEach((k) => localStorage.removeItem(k));

            showSuccess("Verified! Loading your dashboard…");
            await redirectByRole(uid);
        }

    } catch (err) {
        console.error("OTP verify error:", err);
        btn.classList.remove("btn-loading");
        btn.textContent = "Verify";
        shakeInputs();
        showError(getFriendlyError(err.code) || "Invalid code. Please try again.");
    }
};

// ─────────────────────────────────────────────────────────────
//  RESEND OTP
// ─────────────────────────────────────────────────────────────
window.handleResend = function () {
    if (isCooldown) {
        showError("Cooldown active. Please wait.");
        return;
    }

    if (resendCount >= 2) {
        isCooldown = true;
        localStorage.setItem("cooldownEndTime", Date.now() + 600_000);
        startCooldownTimer(600);
        showError("Too many attempts. Please wait 10 minutes.");
        return;
    }

    const phone = localStorage.getItem("userPhone");
    if (!phone) {
        alert("Phone number missing. Please restart.");
        window.location.href = "pages/home.html";
        return;
    }

    inputs().forEach((i) => (i.value = ""));
    inputs()[0].focus();

    sendOTP(phone);
    resendCount++;
    localStorage.setItem("resendCount", resendCount);
    startTimer();
};

// ─────────────────────────────────────────────────────────────
//  OTP INPUT BEHAVIOUR
// ─────────────────────────────────────────────────────────────
function initInputs() {
    inputs().forEach((input, idx) => {
        input.addEventListener("keypress", (e) => {
            if (!/[0-9]/.test(e.key)) e.preventDefault();
        });

        input.addEventListener("input", (e) => {
            const val = e.target.value;

            if (val.length > 1) {
                const digits = val.replace(/\D/g, "").slice(0, 6);
                inputs().forEach((inp, i) => (inp.value = digits[i] || ""));
                const last = Math.min(digits.length, inputs().length) - 1;
                inputs()[last].focus();
            } else if (val && idx < inputs().length - 1) {
                inputs()[idx + 1].focus();
            }

            if (inputs().every((i) => i.value)) {
                setTimeout(() => window.verifyOTP(), 300);
            }
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !e.target.value && idx > 0) {
                inputs()[idx - 1].focus();
            }
        });

        input.addEventListener("focus", () => (input.style.borderColor = "#0d9488"));
        input.addEventListener("blur",  () => (input.style.borderColor = "#e2e8f0"));
    });
}

// ─────────────────────────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────────────────────────
function showError(msg) {
    const el = getOrCreateFeedback();
    el.style.color = "#ef4444";
    el.textContent = msg;
    setTimeout(() => (el.textContent = ""), 4000);
}

function showSuccess(msg) {
    const el = getOrCreateFeedback();
    el.style.color = "#10b981";
    el.textContent = msg;
}

function getOrCreateFeedback() {
    let el = document.getElementById("otp-feedback");
    if (!el) {
        el = document.createElement("p");
        el.id = "otp-feedback";
        el.style.cssText =
            "font-size:13px;text-align:center;margin-top:10px;font-weight:600;min-height:20px;";
        document.getElementById("verifyBtn").insertAdjacentElement("afterend", el);
    }
    return el;
}

function shakeInputs() {
    const wrapper = document.querySelector(".otp-inputs");
    wrapper.style.animation = "none";
    setTimeout(() => {
        wrapper.style.animation = "shake 0.4s ease";
    }, 10);
}

function getFriendlyError(code) {
    const map = {
        "auth/invalid-phone-number":       "Invalid phone number format.",
        "auth/too-many-requests":          "Too many requests. Try again later.",
        "auth/quota-exceeded":             "SMS quota exceeded. Try again later.",
        "auth/captcha-check-failed":       "reCAPTCHA failed. Please refresh.",
        "auth/invalid-verification-code":  "Wrong OTP. Please check and retry.",
        "auth/session-expired":            "OTP expired. Please resend.",
    };
    return map[code] || "Something went wrong. Please try again.";
}

// ─────────────────────────────────────────────────────────────
//  PAGE INIT
// ─────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
    const phone = localStorage.getItem("userPhone");

    if (!phone) {
        alert("Phone number missing. Please restart.");
        window.location.href = "pages/home.html";
        return;
    }

    document.getElementById("display-phone").textContent = phone;

    const flowType = localStorage.getItem("otpFlow");
    const titleEl  = document.querySelector(".brand-title");
    const msgEl    = document.getElementById("otp-message");

    if (flowType === "emergency") {
        titleEl.textContent = "Confirm Emergency Request";
        msgEl.innerHTML = `Verify OTP to post your emergency blood request for <b>${phone}</b>`;
    } else {
        titleEl.textContent = "Login Verification";
        msgEl.textContent   = `Enter the 6-digit code sent to ${phone}`;
    }

    const savedCooldown = Number(localStorage.getItem("cooldownEndTime"));
    if (savedCooldown && Date.now() < savedCooldown) {
        const remaining = Math.floor((savedCooldown - Date.now()) / 1000);
        startCooldownTimer(remaining);
    } else {
        startTimer();
    }

    initInputs();

    window.recaptchaVerifier = new RecaptchaVerifier(
        auth,
        "recaptcha-container",
        {
            size: "invisible",
            callback: () => console.log("reCAPTCHA solved"),
        }
    );

    sendOTP(phone);
});