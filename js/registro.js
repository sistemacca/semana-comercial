// ─────────────────────────────────────────────────────────────
//  registro.js  ·  Lógica del formulario público de registro
// ─────────────────────────────────────────────────────────────
import { db } from "./firebase.js";
import {
  collection, addDoc, runTransaction, doc, getDoc
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const CODIGO = new URLSearchParams(window.location.search).get("empresa") || "";

// ── Cargar datos de empresa ───────────────────────────────────
async function cargarEmpresa() {
  const resultado = document.getElementById("resultado");
  if (!CODIGO) {
    resultado.innerHTML = '<p class="fallo">Enlace sin empresa. Contacta al organizador.</p>';
    document.getElementById("empresa-label").textContent = "Sin empresa";
    return;
  }
  try {
    const snap = await getDoc(doc(db, "empresas", CODIGO));
    if (!snap.exists()) {
      resultado.innerHTML = '<p class="fallo">Empresa no registrada. Contacta al organizador.</p>';
      document.getElementById("empresa-label").textContent = "No encontrada";
      return;
    }
    document.getElementById("empresa-label").textContent = snap.data().nombre || CODIGO;
    document.getElementById("formulario").style.display = "block";
  } catch(e) {
    resultado.innerHTML = '<p class="fallo">Error al cargar. Intenta de nuevo.</p>';
    console.error(e);
  }
}

cargarEmpresa();

// ── Modal política de datos ───────────────────────────────────
window.abrirModal = function() {
  document.getElementById("modal-politica").classList.add("activo");
  document.body.style.overflow = "hidden";
};
window.cerrarModal = function() {
  document.getElementById("modal-politica").classList.remove("activo");
  document.body.style.overflow = "";
};
document.getElementById("modal-politica").addEventListener("click", function(e) {
  if (e.target === this) cerrarModal();
});

// ── Autorización ──────────────────────────────────────────────
let autorizacionSeleccionada = null;
window.seleccionarAuth = function(valor) {
  autorizacionSeleccionada = valor;
  document.getElementById("opcion-si").classList.toggle("selected", valor === "si");
  document.getElementById("opcion-no").classList.toggle("selected", valor === "no");
  document.getElementById("err-autorizacion").style.display = "none";
};

// ── Validaciones ──────────────────────────────────────────────
function esEmailValido(e)   { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function esTelefonoValido(t){ let l = t.replace(/\D/g,""); if(l.length===12&&l.startsWith("57")) l=l.substring(2); return l.length===10; }
function esCedulaValida(c)  { const s=c.replace(/\D/g,""); return s.length>=6&&s.length<=10; }
function marcar(inputId, errId, valido) {
  document.getElementById(inputId).classList.toggle("error", !valido);
  document.getElementById(errId).style.display = valido ? "none" : "block";
  return valido;
}

// ── Registro con transacción atómica ─────────────────────────
window.registrar = async function() {
  const nombre    = document.getElementById("nombre").value.trim();
  const cedula    = document.getElementById("cedula").value.trim();
  const telefono  = document.getElementById("telefono").value.trim();
  const email     = document.getElementById("email").value.trim();
  const direccion = document.getElementById("direccion").value.trim();
  const btn       = document.getElementById("btn");
  const resultado = document.getElementById("resultado");

  resultado.innerHTML = "";

  let ok = true;
  ok = marcar("nombre",    "err-nombre",    nombre.length >= 2)         && ok;
  ok = marcar("cedula",    "err-cedula",    esCedulaValida(cedula))      && ok;
  ok = marcar("telefono",  "err-telefono",  esTelefonoValido(telefono))  && ok;
  if (email) ok = marcar("email", "err-email", esEmailValido(email))     && ok;
  ok = marcar("direccion", "err-direccion", direccion.length >= 3)       && ok;

  if (!autorizacionSeleccionada) {
    document.getElementById("err-autorizacion").style.display = "block";
    ok = false;
  }
  if (!ok) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Procesando...';

  try {
    const empresaRef  = doc(db, "empresas",  CODIGO);
    const contadorRef = doc(db, "contadores", CODIGO);
    let numeroBoleta;

    // Transacción atómica — garantiza boletas únicas bajo concurrencia
    await runTransaction(db, async (tx) => {
      const empSnap = await tx.get(empresaRef);
      if (!empSnap.exists()) throw new Error("Empresa no encontrada");
      const { desde, hasta } = empSnap.data();
      const contSnap  = await tx.get(contadorRef);
      const actual    = contSnap.exists() ? contSnap.data().actual : 0;
      const siguiente = desde + actual;
      if (siguiente > hasta) throw new Error("Boletas agotadas para esta empresa");
      numeroBoleta = siguiente;
      tx.set(contadorRef, { actual: actual + 1 });
    });

    await addDoc(collection(db, "registros"), {
      empresa:       CODIGO,
      boleta:        numeroBoleta,
      nombre,
      cedula:        cedula.replace(/\D/g, ""),
      telefono,
      email:         email || "",
      direccion:     direccion || "",
      autorizaDatos: autorizacionSeleccionada === "si",
      fecha:         new Date().toISOString()
    });

    const urlComprobante =
      `comprobante.html?nombre=${encodeURIComponent(nombre)}&boleta=${numeroBoleta}&empresa=${encodeURIComponent(CODIGO)}`;
    window.location.href = urlComprobante;

  } catch(err) {
    resultado.innerHTML = `<p class="fallo">${
      err.message === "Boletas agotadas para esta empresa"
        ? "Ya no hay boletas disponibles para esta empresa."
        : "Error al registrar. Intenta de nuevo."
    }</p>`;
    console.error(err);
    btn.disabled = false;
    btn.innerHTML = "Registrar";
  }
};
