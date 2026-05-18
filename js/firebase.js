// ─────────────────────────────────────────────────────────────
//  firebase.js  ·  Configuración compartida Firebase
//  Importar desde cualquier módulo JS del proyecto
// ─────────────────────────────────────────────────────────────
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyD75kntcW_TqAJznShE50ACAgvgjp1DlQc",
  authDomain:        "semana-comercial.firebaseapp.com",
  projectId:         "semana-comercial",
  storageBucket:     "semana-comercial.firebasestorage.app",
  messagingSenderId: "52687643666",
  appId:             "1:52687643666:web:48e7106b88b2f2c2b364cb"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
