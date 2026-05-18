// ─────────────────────────────────────────────────────────────
//  admin.js  ·  Lógica completa del panel de administración
// ─────────────────────────────────────────────────────────────
import { db, auth } from "./firebase.js";
import {
  collection, getDocs, orderBy, query, doc, setDoc,
  serverTimestamp, limit, startAfter, where,
  getCountFromServer, writeBatch, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

const BASE = "https://sistemacca.github.io/boletas-camara/?empresa=";

// ── Helpers ───────────────────────────────────────────────────
const capitalizarNombre = str =>
  (str || "").toLowerCase().replace(/(?:^|\s|-)(\S)/g, l => l.toUpperCase());

const esc = s => String(s == null ? "" : s)
  .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

const authTxt   = v => v === true ? "Sí" : v === false ? "No" : "—";
const authColor = v => v === true ? "var(--verde)" : v === false ? "var(--rojo)" : "var(--sub)";
const fstr      = f => !f ? "" : f.toDate ? f.toDate().toISOString() : f.toString();

// ── Estado global ─────────────────────────────────────────────
let emps = [], conts = {}, empsMap = {};
let dashPagActual = 1;
let regs = [], regsCache = [], paginaActual = 1;
const POR_PAGINA     = 50;
const INACTIVIDAD_MS = 15 * 60 * 1000;
let inactividadTimer = null;
let _lastRender = 0;

let _unsubEmps = null, _unsubConts = null, _unsubStats = null;
let _cacheEmps = null, _cacheConts = null, _cacheStats = null;
let _cacheListo = false;

const PAGE_SIZE     = 200;
let regCursors      = [null];
let regBloqueActual = 0;
let regFiltroEmp    = "";
let regFiltroBusq   = "";
let regCargando     = false;

Object.defineProperty(window, "regBloqueActual", { get: () => regBloqueActual });

// ── Inactividad ───────────────────────────────────────────────
function resetInactividad() {
  clearTimeout(inactividadTimer);
  inactividadTimer = setTimeout(() => {
    cerrarSesion();
    document.getElementById("err-login").textContent = "Sesión cerrada por inactividad";
  }, INACTIVIDAD_MS);
}
["click","keydown","touchstart","scroll","mousemove"].forEach(ev =>
  document.addEventListener(ev, resetInactividad, { passive: true })
);

// ── Offline badge ─────────────────────────────────────────────
function setOffline(v) {
  const b = document.getElementById("badge-offline");
  if (b) b.style.display = v ? "block" : "none";
}
window.addEventListener("online",  () => setOffline(false));
window.addEventListener("offline", () => setOffline(true));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && auth.currentUser) {
    const now = Date.now();
    if (now - _lastRender > 60000) { _lastRender = now; if (_cacheListo) renderDashboard(); }
  }
});

// ── Código único de empresa ───────────────────────────────────
function genCodigo() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 8; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
async function genCodigoUnico(snapDocs) {
  const usados = new Set(snapDocs.map(d => d.id));
  let codigo;
  do { codigo = genCodigo(); } while (usados.has(codigo));
  return codigo;
}

// ── Auth ──────────────────────────────────────────────────────
let loginBloqueado = false, loginIntentos = 0;
const MAX_INTENTOS = 5, BLOQUEO_MS = 30000;

onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display   = "block";
    document.getElementById("lbl-usuario").textContent = user.email;
    iniciarListeners();
    resetInactividad();
  } else {
    detenerListeners();
    clearTimeout(inactividadTimer);
    document.getElementById("app").style.display   = "none";
    document.getElementById("login").style.display = "flex";
  }
});

window.entrar = async () => {
  if (loginBloqueado) return;
  const email = document.getElementById("clave-email").value.trim();
  const pass  = document.getElementById("clave-pass").value;
  const errEl = document.getElementById("err-login");
  const btn   = document.getElementById("btn-login");
  if (!email || !pass) { errEl.textContent = "Completa email y contraseña"; return; }
  btn.disabled = true; btn.textContent = "Verificando…"; errEl.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    loginIntentos = 0;
  } catch(e) {
    loginIntentos++;
    if (loginIntentos >= MAX_INTENTOS) {
      loginBloqueado = true;
      errEl.textContent = "Demasiados intentos. Espera 30 segundos.";
      btn.textContent = "Bloqueado…";
      setTimeout(() => {
        loginBloqueado = false; loginIntentos = 0;
        btn.disabled = false; btn.textContent = "Ingresar al Panel"; errEl.textContent = "";
      }, BLOQUEO_MS);
    } else {
      const r = MAX_INTENTOS - loginIntentos;
      errEl.textContent = `Credenciales incorrectas (${r} intento${r!==1?"s":""} restante${r!==1?"s":""})`;
      btn.disabled = false; btn.textContent = "Ingresar al Panel";
    }
  }
};

window.cerrarSesion = async () => {
  detenerListeners(); clearTimeout(inactividadTimer);
  await signOut(auth);
};

// ── Navegación ────────────────────────────────────────────────
window.irA = (panel, nombre) => {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("activo"));
  document.querySelectorAll(".menu-item").forEach(m => m.classList.remove("activo"));
  document.getElementById("panel-" + panel).classList.add("activo");
  document.querySelectorAll(".menu-item").forEach(m => {
    if (m.getAttribute("onclick")?.includes(`'${panel}'`)) m.classList.add("activo");
  });
  document.getElementById("panel-titulo-movil").textContent = nombre;
  document.getElementById("sidebar").classList.remove("abierto");
  document.getElementById("overlay").classList.remove("visible");
  if (panel === "registros") cargarRegistros();
  if (panel === "empresas")  cargarEmpresas();
  if (panel === "enlaces")   cargarEnlaces();
};

window.toggleSidebar = () => {
  document.getElementById("sidebar").classList.toggle("abierto");
  document.getElementById("overlay").classList.toggle("visible");
};

// ── Listeners realtime ────────────────────────────────────────
function iniciarListeners() {
  if (_unsubEmps) return;
  _unsubEmps = onSnapshot(collection(db,"empresas"), snap => {
    _cacheEmps = snap;
    if (_cacheConts !== null && _cacheStats !== null) { _cacheListo = true; renderDashboard(); }
  }, err => console.error("onSnapshot empresas:", err));
  _unsubConts = onSnapshot(collection(db,"contadores"), snap => {
    _cacheConts = snap;
    if (_cacheEmps !== null && _cacheStats !== null) { _cacheListo = true; renderDashboard(); }
  }, err => console.error("onSnapshot contadores:", err));
  _unsubStats = onSnapshot(doc(db,"stats","_stats"), snap => {
    _cacheStats = snap;
    if (_cacheEmps !== null && _cacheConts !== null) { _cacheListo = true; renderDashboard(); }
  }, err => console.error("onSnapshot stats:", err));
}

function detenerListeners() {
  if (_unsubEmps)  { _unsubEmps();  _unsubEmps  = null; }
  if (_unsubConts) { _unsubConts(); _unsubConts = null; }
  if (_unsubStats) { _unsubStats(); _unsubStats = null; }
  _cacheEmps = null; _cacheConts = null; _cacheStats = null; _cacheListo = false;
}

// ── Dashboard ─────────────────────────────────────────────────
async function renderDashboard() {
  if (!_cacheListo) return;
  _lastRender = Date.now();
  try {
    emps  = _cacheEmps.docs.map(d => ({ id: d.id, ...d.data() }));
    conts = {};
    _cacheConts.docs.forEach(d => { conts[d.id] = d.data().actual || 0; });
    empsMap = {};
    emps.forEach(e => { empsMap[e.id] = e.nombre || e.id; });

    const totB         = Object.values(conts).reduce((a,b) => a+b, 0);
    const totalVendidas = emps.reduce((acc,e) => acc + (Number(e.hasta) - Number(e.desde) + 1), 0);
    document.getElementById("s-emp").textContent      = emps.length;
    document.getElementById("s-vendidas").textContent = totalVendidas;
    document.getElementById("s-bol").textContent      = totB;

    const sorted = [...emps].sort((a,b) => {
      const tA = a.creadoEn||0, tB = b.creadoEn||0;
      if (tB !== tA) return tB - tA;
      return capitalizarNombre(a.nombre||a.id).localeCompare(capitalizarNombre(b.nombre||b.id));
    });

    const DASH_POR_PAG = 50;
    const totalEmp = sorted.length;
    const inicio   = (dashPagActual - 1) * DASH_POR_PAG;
    const fin      = Math.min(inicio + DASH_POR_PAG, totalEmp);
    const pagina   = sorted.slice(inicio, fin);

    const tbody = document.getElementById("tb-dash");
    tbody.innerHTML = "";
    pagina.forEach((e, i) => {
      const nombre = capitalizarNombre(e.nombre || e.id);
      const ent   = conts[e.id] || 0;
      const total = Number(e.hasta) - Number(e.desde) + 1;
      const disp  = Math.max(0, total - ent);
      const pct   = total > 0 ? Math.min(100, Math.round((ent/total)*100)) : 0;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="row-num">${inicio+i+1}</span></td>
        <td><strong style="color:var(--azul)">${esc(nombre)}</strong></td>
        <td>${ent}</td><td>${total}</td>
        <td><span style="color:${disp>0?'var(--verde)':'var(--rojo)'};font-weight:700">${disp}</span></td>
        <td style="min-width:140px">
          <div style="font-size:11px;color:var(--sub);margin-bottom:3px">${pct}% (${ent}/${total})</div>
          <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
        </td>`;
      tbody.appendChild(tr);
    });

    const lm = document.getElementById("lm-dash");
    lm.innerHTML = "";
    pagina.forEach((e, i) => {
      const nombre = capitalizarNombre(e.nombre || e.id);
      const ent   = conts[e.id] || 0;
      const total = Number(e.hasta) - Number(e.desde) + 1;
      const disp  = Math.max(0, total - ent);
      const pct   = total > 0 ? Math.min(100, Math.round((ent/total)*100)) : 0;
      const d = document.createElement("div");
      d.style.cssText = "padding:14px 16px;border-bottom:1px solid var(--borde)";
      d.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--azul)">
              <span style="font-size:11px;color:var(--sub);font-weight:500;margin-right:6px">#${inicio+i+1}</span>${nombre}
            </div>
            <div style="font-size:11px;color:var(--sub)">Rango: ${e.desde} – ${e.hasta}</div>
          </div>
          <span class="badge-b" style="font-size:12px">${ent}/${total}</span>
        </div>
        <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--sub);margin-top:4px">
          <span>${pct}% completado</span>
          <span style="color:${disp>0?'var(--verde)':'var(--rojo)'};font-weight:600">${disp} disponibles</span>
        </div>`;
      lm.appendChild(d);
    });

    document.getElementById("spin-dash").style.display  = "none";
    document.getElementById("vacio-dash").style.display = totalEmp === 0 ? "block" : "none";
    if (window.innerWidth > 768)  document.getElementById("t-dash").style.display  = totalEmp > 0 ? "table" : "none";
    if (window.innerWidth <= 768) document.getElementById("lm-dash").style.display = totalEmp > 0 ? "block" : "none";

    buildPaginator("pag-dash", totalEmp, dashPagActual, DASH_POR_PAG, pg => {
      dashPagActual = pg; renderDashboard(); window.scrollTo({top:0,behavior:"smooth"});
    });
  } catch(e) {
    console.error(e);
    document.getElementById("spin-dash").innerHTML =
      "<p style='color:var(--rojo);padding:20px'>Error al cargar. Reintentando...</p>";
  }
}

window.cargarDashboard = () => {
  dashPagActual = 1;
  if (_cacheListo) renderDashboard();
};

window.recalcularStats = async () => {
  const btn = document.getElementById("btn-recalcular");
  if (btn) { btn.disabled = true; btn.textContent = "Calculando…"; }
  try {
    const hoyStr  = new Date().toISOString().slice(0,10);
    const hoyDate = new Date(hoyStr + "T00:00:00");
    const manDate = new Date(hoyDate.getTime() + 86400000);
    const [cTotal, cHoy] = await Promise.all([
      getCountFromServer(collection(db,"registros")),
      getCountFromServer(query(collection(db,"registros"),
        where("fecha",">=",hoyDate), where("fecha","<",manDate)))
    ]);
    await setDoc(doc(db,"stats","_stats"), {
      total: cTotal.data().count, hoy: cHoy.data().count,
      ultimaActualizacion: serverTimestamp()
    });
    if (btn) {
      btn.textContent = "Listo";
      setTimeout(() => { btn.disabled=false; btn.textContent="Recalcular datos"; }, 2500);
    }
    cargarDashboard();
  } catch(e) {
    if (btn) { btn.disabled=false; btn.textContent="Error — reintentar"; }
    console.error(e);
  }
};

// ── Registros ─────────────────────────────────────────────────
async function _fetchBloque(cursor, empresaId) {
  const constraints = [orderBy("fecha","desc"), limit(PAGE_SIZE)];
  if (empresaId) constraints.unshift(where("empresa","==",empresaId));
  if (cursor)    constraints.push(startAfter(cursor));
  return getDocs(query(collection(db,"registros"), ...constraints));
}

window.cargarRegistros = async () => {
  if (regCargando) return;
  regCargando = true;
  regCursors = [null]; regBloqueActual = 0;
  regFiltroEmp  = document.getElementById("fil-emp").value;
  regFiltroBusq = "";
  document.getElementById("buscar").value = "";
  document.getElementById("spin-reg").style.display  = "block";
  document.getElementById("t-reg").style.display     = "none";
  document.getElementById("lm-reg").innerHTML        = "";
  document.getElementById("vacio-reg").style.display = "none";
  document.getElementById("pag-reg").style.display   = "none";
  try {
    if (Object.keys(empsMap).length === 0) {
      const snapEmp = await getDocs(collection(db,"empresas"));
      snapEmp.docs.forEach(d => { empsMap[d.id] = d.data().nombre || d.id; });
    }
    poblarFiltro();
    const snap = await _fetchBloque(null, regFiltroEmp);
    regs = snap.docs.map(d => d.data());
    if (snap.docs.length === PAGE_SIZE) regCursors[1] = snap.docs[snap.docs.length - 1];
    filtrar();
  } catch(e) {
    document.getElementById("spin-reg").innerHTML =
      `<p style='color:var(--rojo);padding:20px'>Error al cargar: ${e.message}</p>`;
  } finally { regCargando = false; }
};

window.cargarBloque = async (indice) => {
  if (regCargando || indice < 0) return;
  regCargando = true;
  document.getElementById("spin-reg").style.display = "block";
  document.getElementById("t-reg").style.display    = "none";
  document.getElementById("lm-reg").innerHTML       = "";
  try {
    const cursor = regCursors[indice] ?? null;
    const snap   = await _fetchBloque(cursor, regFiltroEmp);
    regs = snap.docs.map(d => d.data());
    regBloqueActual = indice;
    if (snap.docs.length === PAGE_SIZE && !regCursors[indice+1])
      regCursors[indice+1] = snap.docs[snap.docs.length-1];
    regFiltroBusq = document.getElementById("buscar").value.toLowerCase();
    filtrar();
  } catch(e) {
    document.getElementById("spin-reg").innerHTML =
      `<p style='color:var(--rojo);padding:20px'>Error: ${e.message}</p>`;
  } finally { regCargando = false; }
};

function poblarFiltro() {
  const sel    = document.getElementById("fil-emp");
  const act    = sel.value;
  const empIds = Object.keys(empsMap).sort((a,b) => empsMap[a].localeCompare(empsMap[b]));
  sel.innerHTML = '<option value="">Todas las empresas</option>';
  empIds.forEach(id => {
    const o = document.createElement("option");
    o.value = id; o.textContent = empsMap[id]; sel.appendChild(o);
  });
  sel.value = act;
}

window.filtrar = () => {
  regFiltroBusq = document.getElementById("buscar").value.toLowerCase();
  const empNueva = document.getElementById("fil-emp").value;
  if (empNueva !== regFiltroEmp) {
    regFiltroEmp = empNueva; regCursors = [null]; regBloqueActual = 0;
    cargarRegistros(); return;
  }
  regsCache = regs.filter(r => {
    if (!regFiltroBusq) return true;
    return (
      (r.nombre   && r.nombre.toLowerCase().includes(regFiltroBusq)) ||
      (r.cedula   && r.cedula.includes(regFiltroBusq))               ||
      (r.telefono && r.telefono.includes(regFiltroBusq))             ||
      (r.email    && r.email.toLowerCase().includes(regFiltroBusq))
    );
  });
  paginaActual = 1;
  renderPagina();
};

function renderPagina() {
  const isMobile = window.innerWidth <= 768;
  const total    = regsCache.length;
  const inicio   = (paginaActual-1)*POR_PAGINA;
  const fin      = Math.min(inicio+POR_PAGINA, total);
  const pagina   = regsCache.slice(inicio, fin);

  document.getElementById("spin-reg").style.display  = "none";
  document.getElementById("vacio-reg").style.display = total===0 ? "block" : "none";
  document.getElementById("t-reg").style.display     = (total>0&&!isMobile) ? "table" : "none";
  document.getElementById("pag-reg").style.display   = total>POR_PAGINA ? "block" : "none";

  const navBloques = document.getElementById("nav-bloques");
  const hayMas = regs.length===PAGE_SIZE || regBloqueActual>0;
  navBloques.style.display = hayMas ? "flex" : "none";
  const btnAnt = document.getElementById("btn-bloque-ant");
  const btnSig = document.getElementById("btn-bloque-sig");
  if (btnAnt) btnAnt.disabled = regBloqueActual===0 || regCargando;
  if (btnSig) btnSig.disabled = !regCursors[regBloqueActual+1] || regCargando;
  const lbl = document.getElementById("lbl-bloque");
  if (lbl) {
    const desde = regBloqueActual*PAGE_SIZE+1;
    const hasta = regBloqueActual*PAGE_SIZE+regs.length;
    lbl.textContent = `Registros ${desde} – ${hasta}`;
  }

  // Tabla escritorio
  const tbody = document.getElementById("tb-reg");
  tbody.innerHTML = "";
  pagina.forEach((r, i) => {
    const fs2       = fstr(r.fecha);
    const fecha     = fs2 ? new Date(fs2).toLocaleString("es-CO",{dateStyle:"short",timeStyle:"short"}) : "";
    const codigoEmp = r.empresa || "";
    const nombreEmp = empsMap[codigoEmp] || codigoEmp;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="row-num">${inicio+i+1}</span></td>
      <td><span class="badge-b">${r.boleta}</span></td>
      <td><span class="badge-id">${codigoEmp}</span></td>
      <td><span class="badge-e">${nombreEmp}</span></td>
      <td>${esc(r.nombre)}</td>
      <td><span style="font-family:monospace;font-size:12px">${esc(r.cedula||'—')}</span></td>
      <td>${esc(r.telefono)}</td>
      <td>${esc(r.email)}</td>
      <td>${esc(r.direccion||'')}</td>
      <td style="color:var(--sub);font-size:12px">${fecha}</td>
      <td style="font-weight:600;color:${authColor(r.autorizaDatos)}">${authTxt(r.autorizaDatos)}</td>`;
    tbody.appendChild(tr);
  });

  // Lista móvil
  const lm = document.getElementById("lm-reg");
  lm.innerHTML = "";
  if (isMobile) {
    pagina.forEach(r => {
      const fs2       = fstr(r.fecha);
      const fecha     = fs2 ? new Date(fs2).toLocaleString("es-CO",{dateStyle:"short",timeStyle:"short"}) : "";
      const codigoEmp = r.empresa || "";
      const nombreEmp = empsMap[codigoEmp] || codigoEmp;
      const d = document.createElement("div");
      d.className = "row-m";
      d.innerHTML = `
        <div class="row-m-top">
          <div>
            <div class="row-m-nombre">${esc(r.nombre)}</div>
            <div class="row-m-meta"><span class="badge-id" style="margin-right:4px">${codigoEmp}</span>${nombreEmp} · ${fecha}</div>
          </div>
          <span class="badge-b">${r.boleta}</span>
        </div>
        <div class="row-m-meta" style="margin-top:4px">
          CC/ID: <strong style="font-family:monospace">${r.cedula||'—'}</strong>
          · ${r.telefono||"-"} · ${r.email||"-"}${r.direccion?' · '+r.direccion:''}
        </div>
        <div style="margin-top:5px;font-size:11px;font-weight:600;color:${authColor(r.autorizaDatos)}">
          Datos: ${authTxt(r.autorizaDatos)==="Sí"?"Sí autoriza":authTxt(r.autorizaDatos)==="No"?"No autoriza":"—"}
        </div>`;
      lm.appendChild(d);
    });
  }

  buildPaginator("pag-reg", total, paginaActual, POR_PAGINA, pg => {
    paginaActual = pg; renderPagina(); window.scrollTo({top:0,behavior:"smooth"});
  });
}

// ── Exportar CSV — fechas obligatorias ────────────────────────
window.exportarCSV = async () => {
  const btn = document.getElementById("btn-exportar");
  if (btn.disabled) return;

  const desdeStr = document.getElementById("exp-desde").value;
  const hastaStr = document.getElementById("exp-hasta").value;

  if (!desdeStr || !hastaStr) {
    alert("Debes seleccionar un rango de fechas para exportar.");
    return;
  }
  const desdeDate = new Date(desdeStr + "T00:00:00");
  const hastaDate = new Date(hastaStr + "T23:59:59");
  if (desdeDate > hastaDate) { alert("La fecha 'Desde' no puede ser mayor que 'Hasta'."); return; }
  const diffDias = (hastaDate - desdeDate) / (1000*60*60*24);
  if (diffDias > 31) { alert("El rango máximo permitido es 31 días."); return; }

  btn.disabled = true;
  const txtOrig = btn.innerHTML;
  btn.innerHTML = "Preparando…";

  try {
    if (Object.keys(empsMap).length===0) {
      const snapEmp = await getDocs(collection(db,"empresas"));
      snapEmp.docs.forEach(d => { empsMap[d.id]=d.data().nombre||d.id; });
    }
    const empresaFiltro = document.getElementById("fil-emp").value;
    const buscarFiltro  = document.getElementById("buscar").value.toLowerCase();
    const fecha_export  = new Date().toISOString().slice(0,10);
    const nombre_archivo = empresaFiltro
      ? `registros-${(empsMap[empresaFiltro]||empresaFiltro).replace(/[^a-z0-9]/gi,"-")}-${desdeStr}-al-${hastaStr}.csv`
      : `registros-${desdeStr}-al-${hastaStr}-${fecha_export}.csv`;

    let cursor=null, totalLeidos=0, filas=[];
    while (true) {
      const constraints = [
        where("fecha",">=",desdeDate),
        where("fecha","<=",hastaDate),
        orderBy("fecha","desc"),
        limit(500)
      ];
      if (empresaFiltro) constraints.unshift(where("empresa","==",empresaFiltro));
      if (cursor)        constraints.push(startAfter(cursor));
      const snap = await getDocs(query(collection(db,"registros"), ...constraints));
      if (snap.empty) break;
      snap.docs.forEach(d => {
        const r = d.data();
        const fs2 = fstr(r.fecha);
        const fecha = fs2 ? new Date(fs2).toLocaleString("es-CO") : "";
        const codigoEmp = r.empresa||"";
        const nombreEmp = empsMap[codigoEmp]||codigoEmp;
        if (buscarFiltro) {
          const okB =
            (r.nombre   && r.nombre.toLowerCase().includes(buscarFiltro)) ||
            (r.cedula   && r.cedula.includes(buscarFiltro))               ||
            (r.telefono && r.telefono.includes(buscarFiltro))             ||
            (r.email    && r.email.toLowerCase().includes(buscarFiltro));
          if (!okB) return;
        }
        const autorizaTxt = r.autorizaDatos===true?"Sí autoriza":r.autorizaDatos===false?"No autoriza":"Sin respuesta";
        filas.push([r.boleta,codigoEmp,nombreEmp,r.nombre,r.cedula||"",r.telefono,r.email,r.direccion||"",fecha,autorizaTxt]);
      });
      totalLeidos += snap.docs.length;
      btn.innerHTML = `${totalLeidos} registros…`;
      if (snap.docs.length < 500) break;
      cursor = snap.docs[snap.docs.length-1];
    }

    if (filas.length===0) {
      btn.innerHTML="Sin resultados";
      setTimeout(()=>{ btn.disabled=false; btn.innerHTML=txtOrig; },2500);
      return;
    }

    const toCSV = arr => arr.map(v=>JSON.stringify(v==null?"":String(v))).join(",");
    const HEADER = "Boleta,Codigo Empresa,Razon Social,Nombre,Identificacion,Telefono,Email,Direccion,Fecha,Autorizacion datos";
    let csv = HEADER+"\n";
    filas.forEach(f => { csv+=toCSV(f)+"\n"; });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"}));
    a.download = nombre_archivo; a.click(); URL.revokeObjectURL(a.href);

    btn.innerHTML=`${filas.length} filas exportadas`;
    setTimeout(()=>{ btn.disabled=false; btn.innerHTML=txtOrig; },3500);

  } catch(e) {
    console.error("exportarCSV:",e);
    if (e.message?.includes("index"))
      alert("Firestore necesita un índice compuesto. Revisa la consola del navegador.");
    btn.innerHTML="Error";
    setTimeout(()=>{ btn.disabled=false; btn.innerHTML=txtOrig; },3000);
  }
};

// ── Paginador ─────────────────────────────────────────────────
function buildPaginator(containerId, total, pagActual, porPagina, onIr) {
  const pag      = document.getElementById(containerId);
  const totalPag = Math.ceil(total/porPagina);
  const inicio   = (pagActual-1)*porPagina;
  const fin      = Math.min(inicio+porPagina,total);
  pag.style.display = total>porPagina ? "block" : "none";
  if (total<=porPagina) return;
  pag.innerHTML="";
  const wrap=document.createElement("div"); wrap.className="pag-container";
  const meta=document.createElement("div"); meta.className="pag-meta";
  meta.innerHTML=`<b>${inicio+1}–${fin}</b> de <b>${total}</b> &nbsp;|&nbsp; Página <b>${pagActual}</b> de <b>${totalPag}</b>`;
  wrap.appendChild(meta);
  const ctrl=document.createElement("div"); ctrl.className="pag-controls";
  const SVG_LL=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>`;
  const SVG_L =`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
  const SVG_R =`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
  const SVG_RR=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>`;
  const mkNav=(html,disabled,title,cb)=>{ const b=document.createElement("button"); b.className="pag-nav"; b.innerHTML=html; b.disabled=disabled; b.title=title; b.onclick=cb; ctrl.appendChild(b); };
  mkNav(SVG_LL+`<span>Primera</span>`,pagActual===1,"Primera",()=>onIr(1));
  mkNav(SVG_L+`<span>Anterior</span>`,pagActual===1,"Anterior",()=>onIr(pagActual-1));
  let lastP=0;
  for(let p=1;p<=totalPag;p++){
    if(p===1||p===totalPag||(p>=pagActual-2&&p<=pagActual+2)){
      if(lastP&&p-lastP>1){const d=document.createElement("span");d.className="pag-dots-span";d.textContent="···";ctrl.appendChild(d);}
      const b=document.createElement("button"); b.className="pag-num"+(p===pagActual?" on":"");
      b.textContent=p; b.onclick=((pg)=>()=>onIr(pg))(p); ctrl.appendChild(b); lastP=p;
    }
  }
  mkNav(`<span>Siguiente</span>`+SVG_R,pagActual===totalPag,"Siguiente",()=>onIr(pagActual+1));
  mkNav(`<span>Última</span>`+SVG_RR,pagActual===totalPag,"Última",()=>onIr(totalPag));
  wrap.appendChild(ctrl);
  if(totalPag>5){
    const jump=document.createElement("div"); jump.className="pag-jump";
    const lbl=document.createElement("span"); lbl.textContent="Ir a página";
    const inp=document.createElement("input"); inp.type="number"; inp.min=1; inp.max=totalPag; inp.value=pagActual;
    const b=document.createElement("button"); b.textContent="Ir";
    const go=()=>{const v=parseInt(inp.value);if(v>=1&&v<=totalPag)onIr(v);};
    b.onclick=go; inp.addEventListener("keydown",e=>{if(e.key==="Enter")go();});
    jump.appendChild(lbl); jump.appendChild(inp); jump.appendChild(b); wrap.appendChild(jump);
  }
  pag.appendChild(wrap);
}

// ── Empresas ──────────────────────────────────────────────────
let empsCache=[], empsTodos=[], empsPagActual=1;
const EMPS_POR_PAG=20;

window.filtrarEmpresas=()=>{
  const q=document.getElementById("buscar-emp").value.toLowerCase();
  empsCache=q?empsTodos.filter(e=>(e.nombre||"").toLowerCase().includes(q)||(e.nit||"").includes(q)||(e.codigo||"").toLowerCase().includes(q)):[...empsTodos];
  empsPagActual=1; renderEmpresas();
};

window.cargarEmpresas=async()=>{
  document.getElementById("spin-emp").style.display="block";
  document.getElementById("t-emp").style.display="none";
  document.getElementById("lm-emp").innerHTML="";
  document.getElementById("vacio-emp").style.display="none";
  document.getElementById("pag-emp").style.display="none";
  try{
    const[sE,sC]=await Promise.all([getDocs(collection(db,"empresas")),getDocs(collection(db,"contadores"))]);
    emps=sE.docs.map(d=>({id:d.id,...d.data()})); conts={};
    sC.docs.forEach(d=>{conts[d.id]=d.data().actual||0;});
    emps.sort((a,b)=>Number(b.desde)-Number(a.desde));
    empsTodos=emps; empsCache=[...emps]; empsPagActual=1;
    renderEmpresas();
  }catch(e){
    console.error(e);
    document.getElementById("spin-emp").innerHTML="<p style='color:var(--rojo);padding:20px'>Error al cargar</p>";
  }
};

function renderEmpresas(){
  const isMobile=window.innerWidth<=768;
  const total=empsCache.length;
  const inicio=(empsPagActual-1)*EMPS_POR_PAG;
  const fin=Math.min(inicio+EMPS_POR_PAG,total);
  const pagina=empsCache.slice(inicio,fin);
  document.getElementById("spin-emp").style.display="none";
  document.getElementById("vacio-emp").style.display=total===0?"block":"none";
  document.getElementById("t-emp").style.display=(total>0&&!isMobile)?"table":"none";
  document.getElementById("lm-emp").style.display=(total>0&&isMobile)?"block":"none";
  const tbody=document.getElementById("tb-emp");
  tbody.innerHTML="";
  pagina.forEach((e,i)=>{
    const ent=conts[e.id]||0;
    const tot=Number(e.hasta)-Number(e.desde)+1;
    const disp=Math.max(0,tot-ent);
    const pct=tot>0?Math.min(100,Math.round(ent/tot*100)):0;
    const nombreMostrar=capitalizarNombre(e.nombre||e.id);
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><span class="row-num">${inicio+i+1}</span></td>
      <td><span style="font-family:monospace;background:#e6f4ec;color:#005a30;padding:3px 10px;border-radius:8px;font-weight:700;font-size:12px">${e.codigo||'—'}</span></td>
      <td><span style="font-family:monospace;font-size:12px">${esc(e.nit||'—')}</span></td>
      <td><strong style="color:var(--azul)">${esc(nombreMostrar)}</strong></td>
      <td>${e.desde}</td><td>${e.hasta}</td><td><strong>${tot}</strong></td>
      <td><span class="badge-b" style="font-size:12px">${ent}</span></td>
      <td><span style="color:${disp>0?'var(--verde)':'var(--rojo)'};font-weight:700">${disp}</span></td>
      <td style="min-width:130px">
        <div style="font-size:10px;color:var(--sub);margin-bottom:3px;text-align:center">${pct}%</div>
        <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
      </td>
      <td>
        <button class="btn btn-p btn-sm" onclick="abrirModal('${e.id}','${nombreMostrar.replace(/'/g,"\\'")}',${e.desde},${e.hasta},${ent})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Editar
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
  const lm=document.getElementById("lm-emp"); lm.innerHTML="";
  if(isMobile){
    pagina.forEach(e=>{
      const ent=conts[e.id]||0;
      const tot=Number(e.hasta)-Number(e.desde)+1;
      const disp=Math.max(0,tot-ent);
      const pct=tot>0?Math.min(100,Math.round(ent/tot*100)):0;
      const nombreMovil=capitalizarNombre(e.nombre||e.id);
      const d=document.createElement("div"); d.className="emp-card";
      d.innerHTML=`
        <div class="emp-card-top">
          <div>
            <div class="emp-card-nombre" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${nombreMovil}</div>
            <div class="emp-card-id"><span style="font-family:monospace;background:#e6f4ec;color:#005a30;padding:2px 8px;border-radius:6px;font-weight:700;font-size:11px">${e.codigo||'—'}</span> · NIT: ${e.nit||'—'} · Rango: ${e.desde}–${e.hasta}</div>
          </div>
          <button class="btn btn-p btn-sm" onclick="abrirModal('${e.id}','${nombreMovil.replace(/'/g,"\\'")}',${e.desde},${e.hasta},${ent})">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Editar
          </button>
        </div>
        <div class="emp-grid">
          <div class="emp-dato"><div class="dv">${ent}</div><div class="dl">Entregadas</div></div>
          <div class="emp-dato"><div class="dv" style="color:${disp>0?'var(--verde)':'var(--rojo)'}">${disp}</div><div class="dl">Disponibles</div></div>
          <div class="emp-dato"><div class="dv">${tot}</div><div class="dl">Total</div></div>
        </div>
        <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>`;
      lm.appendChild(d);
    });
  }
  buildPaginator("pag-emp",total,empsPagActual,EMPS_POR_PAG,pg=>{empsPagActual=pg;renderEmpresas();window.scrollTo({top:0,behavior:"smooth"});});
}

window.crearEmpresa=async()=>{
  const nit=document.getElementById("e-nit").value.trim().replace(/\D/g,"");
  const _n=document.getElementById("e-nombre").value.trim();
  const nombre=_n?_n.charAt(0).toUpperCase()+_n.slice(1).toLowerCase():_n;
  const desde=Number(document.getElementById("e-desde").value);
  const hasta=Number(document.getElementById("e-hasta").value);
  const msg=document.getElementById("msg-emp"); msg.style.display="none";
  if(!nit){msg.textContent="Ingresa la identificación o NIT";msg.className="fmsg error";msg.style.display="block";return;}
  if(!nombre||!desde||!hasta){msg.textContent="Completa todos los campos";msg.className="fmsg error";msg.style.display="block";return;}
  if(desde>=hasta){msg.textContent="'Hasta' debe ser mayor que 'Desde'";msg.className="fmsg error";msg.style.display="block";return;}
  try{
    const snapEmp=await getDocs(collection(db,"empresas"));
    const conflicto=snapEmp.docs.find(d=>{const e=d.data();return desde<=Number(e.hasta)&&hasta>=Number(e.desde);});
    if(conflicto){msg.textContent=`El rango (${desde}–${hasta}) se cruza con rangos ya asignados.`;msg.className="fmsg error";msg.style.display="block";return;}
    const codigo=await genCodigoUnico(snapEmp.docs);
    await setDoc(doc(db,"empresas",codigo),{nit,nombre,desde,hasta,codigo,creadoEn:Date.now()});
    msg.textContent="Empresa creada exitosamente"; msg.className="fmsg ok"; msg.style.display="block";
    setTimeout(()=>{
      msg.style.display="none";
      document.getElementById("toggle-nueva-empresa").classList.remove("abierto");
      document.getElementById("body-nueva-empresa").classList.remove("abierto");
    },1400);
    ["e-nit","e-nombre","e-desde","e-hasta"].forEach(f=>document.getElementById(f).value="");
    cargarEmpresas();
  }catch(e){msg.textContent="Error: "+e.message;msg.className="fmsg error";msg.style.display="block";}
};

window.abrirModal=(id,nombre,desde,hasta,contador)=>{
  const empData=empsTodos.find(e=>e.id===id)||{};
  document.getElementById("m-id").value=id;
  document.getElementById("m-nit").value=empData.nit||"";
  document.getElementById("m-nombre").value=nombre;
  document.getElementById("m-desde").value=desde;
  document.getElementById("m-hasta").value=hasta;
  document.getElementById("m-contador").value=contador;
  document.getElementById("modal-id").textContent="ID: "+id;
  document.getElementById("msg-modal").style.display="none";
  document.getElementById("modal").classList.add("visible");
};

window.cerrarModal=()=>{ document.getElementById("modal").classList.remove("visible"); };

window.guardarEmpresa=async()=>{
  const id=document.getElementById("m-id").value;
  const nit=document.getElementById("m-nit").value.trim().replace(/\D/g,"");
  const _n2=document.getElementById("m-nombre").value.trim();
  const nombre=_n2?_n2.charAt(0).toUpperCase()+_n2.slice(1).toLowerCase():_n2;
  const desde=Number(document.getElementById("m-desde").value);
  const hasta=Number(document.getElementById("m-hasta").value);
  const contador=Number(document.getElementById("m-contador").value);
  const msg=document.getElementById("msg-modal"); msg.style.display="none";
  if(!nombre||isNaN(desde)||isNaN(hasta)||isNaN(contador)){msg.textContent="Completa todos los campos";msg.className="fmsg error";msg.style.display="block";return;}
  if(desde>=hasta){msg.textContent="'Hasta' debe ser mayor que 'Desde'";msg.className="fmsg error";msg.style.display="block";return;}
  if(contador<0){msg.textContent="El contador no puede ser negativo";msg.className="fmsg error";msg.style.display="block";return;}
  try{
    const snapEmp=await getDocs(collection(db,"empresas"));
    const conflicto=snapEmp.docs.find(d=>{if(d.id===id)return false;const e=d.data();return desde<=Number(e.hasta)&&hasta>=Number(e.desde);});
    if(conflicto){const ec=conflicto.data();msg.textContent=`El rango ${desde}-${hasta} se cruza con (${ec.nombre||conflicto.id}) ${ec.desde}-${ec.hasta}.`;msg.className="fmsg error";msg.style.display="block";return;}
    const batch=writeBatch(db);
    batch.set(doc(db,"empresas",id),{nit,nombre,desde,hasta,codigo:id},{merge:true});
    batch.set(doc(db,"contadores",id),{actual:contador});
    await batch.commit();
    msg.textContent="Cambios guardados"; msg.className="fmsg ok"; msg.style.display="block";
    setTimeout(()=>{cerrarModal();cargarEmpresas();cargarDashboard();},1000);
  }catch(e){msg.textContent="Error: "+e.message;msg.className="fmsg error";msg.style.display="block";}
};

window.toggleFormEmpresa=()=>{
  const toggle=document.getElementById("toggle-nueva-empresa");
  const body=document.getElementById("body-nueva-empresa");
  const abierto=toggle.classList.toggle("abierto");
  body.classList.toggle("abierto",abierto);
};

// ── Enlaces ───────────────────────────────────────────────────
let enlCache=[], enlPagActual=1;
const ENL_POR_PAG=20;

window.cargarEnlaces=async()=>{
  document.getElementById("spin-enl").style.display="block";
  document.getElementById("t-enl").style.display="none";
  document.getElementById("lm-enl").innerHTML="";
  document.getElementById("vacio-enl").style.display="none";
  document.getElementById("pag-enl").style.display="none";
  try{
    const snap=await getDocs(collection(db,"empresas"));
    emps=snap.docs.map(d=>({id:d.id,...d.data()}));
    emps.sort((a,b)=>Number(b.desde)-Number(a.desde));
    enlCache=emps; enlPagActual=1; renderEnlaces();
  }catch(e){document.getElementById("spin-enl").innerHTML="<p style='color:var(--rojo);padding:20px'>Error al cargar</p>";}
};

window.filtrarEnlaces=()=>{
  const q=document.getElementById("buscar-enlace").value.toLowerCase();
  enlCache=emps.filter(e=>(e.nombre||e.id).toLowerCase().includes(q)||e.id.toLowerCase().includes(q));
  enlPagActual=1; renderEnlaces();
};

function renderEnlaces(){
  const isMobile=window.innerWidth<=768;
  const total=enlCache.length;
  const inicio=(enlPagActual-1)*ENL_POR_PAG;
  const fin=Math.min(inicio+ENL_POR_PAG,total);
  const pagina=enlCache.slice(inicio,fin);
  document.getElementById("spin-enl").style.display="none";
  document.getElementById("vacio-enl").style.display=total===0?"block":"none";
  document.getElementById("t-enl").style.display=(total>0&&!isMobile)?"table":"none";
  document.getElementById("lm-enl").style.display=(total>0&&isMobile)?"block":"none";
  const tbody=document.getElementById("tb-enl"); tbody.innerHTML="";
  pagina.forEach((e,i)=>{
    const codigoEnlace=e.codigo||e.id;
    const url=BASE+encodeURIComponent(codigoEnlace);
    const nombreEnl=capitalizarNombre(e.nombre||e.id);
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><span class="row-num">${inicio+i+1}</span></td>
      <td><strong style="color:var(--azul)">${esc(nombreEnl)}</strong></td>
      <td><span style="font-family:monospace;background:#e6f4ec;color:#005a30;padding:3px 10px;border-radius:8px;font-weight:700;font-size:13px">${codigoEnlace}</span>${!e.codigo?'<span title="Empresa creada antes del sistema de códigos" style="font-size:10px;color:#f59e0b;margin-left:4px">⚠</span>':''}</td>
      <td><span class="badge-e">${e.desde}–${e.hasta}</span></td>
      <td style="width:260px;max-width:260px"><span title="${url}" style="display:block;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;background:#f8fafc;padding:6px 10px;border-radius:8px;color:var(--sub)">${url}</span></td>
      <td>
        <button class="btn btn-p btn-sm" onclick="copiarEnlace(this,'${url}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copiar
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
  const lm=document.getElementById("lm-enl"); lm.innerHTML="";
  if(isMobile){
    pagina.forEach(e=>{
      const codigoEnlace=e.codigo||e.id;
      const url=BASE+encodeURIComponent(codigoEnlace);
      const nombreEnlM=capitalizarNombre(e.nombre||e.id);
      const d=document.createElement("div"); d.className="row-m";
      d.innerHTML=`
        <div class="row-m-top">
          <div>
            <div class="row-m-nombre" style="color:var(--azul)">${nombreEnlM}</div>
            <div class="row-m-meta">Código: <span style="font-family:monospace;background:#e6f4ec;color:#005a30;padding:1px 7px;border-radius:6px;font-weight:700">${codigoEnlace}</span> · ${e.desde}–${e.hasta}</div>
          </div>
          <button class="btn btn-p btn-sm" onclick="copiarEnlace(this,'${url}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012 2v1"/></svg>Copiar
          </button>
        </div>
        <div style="font-size:11px;word-break:break-all;background:#f8fafc;padding:6px 10px;border-radius:8px;margin-top:8px;color:var(--sub)">${url}</div>`;
      lm.appendChild(d);
    });
  }
  buildPaginator("pag-enl",total,enlPagActual,ENL_POR_PAG,pg=>{enlPagActual=pg;renderEnlaces();window.scrollTo({top:0,behavior:"smooth"});});
}

window.copiarEnlace=(btn,url)=>{
  navigator.clipboard.writeText(url).then(()=>{
    const orig=btn.innerHTML;
    btn.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg> Copiado`;
    btn.style.background="var(--verde)";
    setTimeout(()=>{btn.innerHTML=orig;btn.style.background="";},2000);
  });
};

window.copiarTodos=()=>{
  const txt=emps.map(e=>(e.nombre||e.id)+": "+BASE+encodeURIComponent(e.codigo||e.id)).join("\n");
  navigator.clipboard.writeText(txt).then(()=>alert("Todos los enlaces copiados al portapapeles."));
};
