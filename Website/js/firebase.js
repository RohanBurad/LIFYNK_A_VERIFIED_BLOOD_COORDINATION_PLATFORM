// ================================================================
//  Lifynk — js/firebase.js
//  Central config file — import this across your whole project
//  Usage: import { auth, db, CLOUDINARY } from './firebase.js'
// ================================================================

import { initializeApp }             from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }                   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }              from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Firebase Config ───────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyC-HnJq3DU9wc3DpvSGQM3OWfxwUwThPT8",
    authDomain: "lifynk.firebaseapp.com",
    projectId: "lifynk",
    storageBucket: "lifynk.firebasestorage.app",
    messagingSenderId: "658656685385",
    appId: "1:658656685385:web:1a02d664f685a7049a7e98",
    measurementId: "G-NW2L14SB01"
};

// ── Cloudinary Config ─────────────────────────────────────────
export const CLOUDINARY = {
  cloudName:   "duxukomd3",
  uploadPreset: "lifynk", // create this in Cloudinary dashboard (unsigned preset)
  baseUrl:      "https://api.cloudinary.com/v1_1/duxukomd3/image/upload"
};

// ── Init ──────────────────────────────────────────────────────
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);