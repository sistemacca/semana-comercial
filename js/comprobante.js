// ─────────────────────────────────────────────────────────────
//  comprobante.js  ·  Verificación y descarga del comprobante
// ─────────────────────────────────────────────────────────────
import { db } from "./firebase.js";
import {
  collection, query, where, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ── Helpers ───────────────────────────────────────────────────
function mostrarError(msg) {
  document.getElementById("estado-cargando").style.display = "none";
  document.getElementById("estado-error").style.display   = "block";
  if (msg) document.getElementById("error-detalle").textContent = msg;
}

function mostrarComprobante(nombre, boleta, empresaNombre) {
  document.getElementById("estado-cargando").style.display = "none";
  document.getElementById("estado-ok").style.display       = "block";
  document.getElementById("nombre").textContent  = nombre;
  document.getElementById("boleta").textContent  = boleta;
  document.getElementById("empresa").textContent = empresaNombre;
}

function normalizar(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/\s+/g," ");
}

// ── Verificar registro ────────────────────────────────────────
const params   = new URLSearchParams(window.location.search);
const pBoleta  = (params.get("boleta")  || "").trim();
const pEmpresa = (params.get("empresa") || "").trim();
const pNombre  = (params.get("nombre")  || "").trim();

if (!pBoleta || !pEmpresa || !pNombre) {
  mostrarError("El enlace está incompleto o mal formado.");
} else {
  (async () => {
    try {
      const empSnap = await getDoc(doc(db,"empresas", pEmpresa));
      if (!empSnap.exists()) {
        mostrarError("La empresa de este enlace no existe en el sistema.");
        return;
      }
      const empresaNombre = empSnap.data().nombre || pEmpresa;

      const snap = await getDocs(
        query(collection(db,"registros"), where("boleta","==", Number(pBoleta)))
      );
      if (snap.empty) {
        mostrarError("No se encontró un registro con este número de boleta.");
        return;
      }

      const datos = snap.docs[0].data();
      if (datos.empresa !== pEmpresa || normalizar(datos.nombre) !== normalizar(pNombre)) {
        mostrarError("Este comprobante no es válido. Los datos no coinciden.");
        return;
      }

      mostrarComprobante(datos.nombre, datos.boleta, empresaNombre);
    } catch(e) {
      mostrarError("Error al verificar el registro. Intenta de nuevo más tarde.");
      console.error(e);
    }
  })();
}

// ── Descarga JPG ──────────────────────────────────────────────
function dibujarCanvas(ctx, W, H, nombreV, boletaV, empresaV, cv, btn) {
  ctx.fillStyle = "#007d42"; ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = "#d4af37"; ctx.fillRect(0, H - 6, W, 6);
  ctx.fillStyle = "#007d42"; ctx.font = "bold 20px Arial"; ctx.textAlign = "center";
  ctx.fillText("Cámara de Comercio de Arauca", W/2, 52);
  ctx.font = "14px Arial"; ctx.fillStyle = "#64748b";
  ctx.fillText("Semana Comercial 2026", W/2, 76);
  ctx.strokeStyle = "#e2e8f0"; ctx.beginPath(); ctx.moveTo(40,95); ctx.lineTo(W-40,95); ctx.stroke();
  ctx.font = "bold 15px Arial"; ctx.fillStyle = "#007d42";
  ctx.fillText(empresaV, W/2, 125);
  ctx.font = "16px Arial"; ctx.fillStyle = "#1e293b";
  ctx.fillText(nombreV, W/2, 155);
  ctx.font = "bold 90px Arial"; ctx.fillStyle = "#007d42";
  ctx.fillText(boletaV, W/2, 260);
  ctx.font = "14px Arial"; ctx.fillStyle = "#64748b";
  ctx.fillText("Número de boleta", W/2, 288);
  ctx.strokeStyle = "#e2e8f0"; ctx.beginPath(); ctx.moveTo(40,308); ctx.lineTo(W-40,308); ctx.stroke();
  ctx.font = "bold 13px Arial"; ctx.fillStyle = "#166534";
  ctx.fillText("Comprobante oficial de registro", W/2, 338);
  ctx.font = "12px Arial"; ctx.fillStyle = "#64748b";
  ctx.fillText("Conserva este documento como soporte", W/2, 360);

  cv.toBlob(blob => {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href  = url;
    link.download = `boleta-${boletaV}-semana-comercial.jpg`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    const svgCheck = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.innerHTML = `${svgCheck} Descargado`;
    btn.style.background = "#16a34a";
    setTimeout(() => {
      btn.innerHTML = svgDescarga();
      btn.style.background = "#007d42";
      btn.disabled = false;
    }, 2500);
  }, "image/jpeg", 0.95);
}

function svgDescarga() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar comprobante`;
}

window.descargarJPG = function() {
  const nombreV  = document.getElementById("nombre").textContent;
  const boletaV  = document.getElementById("boleta").textContent;
  const empresaV = document.getElementById("empresa").textContent;
  const btn      = document.getElementById("btn-descargar");

  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Generando...`;
  btn.disabled = true;

  const W = 600, H = 400;
  const cv  = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function() {
    ctx.drawImage(img, 0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(0, 0, W, H);
    dibujarCanvas(ctx, W, H, nombreV, boletaV, empresaV, cv, btn);
  };
  img.onerror = function() {
    ctx.fillStyle = "#f0fdf4"; ctx.fillRect(0, 0, W, H);
    dibujarCanvas(ctx, W, H, nombreV, boletaV, empresaV, cv, btn);
  };
  img.src = "../assets/fondo_login.jpg";
};
