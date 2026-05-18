# Semana Comercial 2026 — Cámara de Comercio de Arauca

Sistema de registro de boletas para la Semana Comercial.

## Estructura del proyecto

```
boletas-camara/
├── index.html           ← Formulario público de registro
├── admin.html           ← Panel de administración
├── comprobante.html     ← Comprobante de registro
├── .nojekyll            ← Necesario para GitHub Pages
│
├── css/
│   ├── registro.css     ← Estilos del formulario
│   ├── admin.css        ← Estilos del panel admin
│   └── comprobante.css  ← Estilos del comprobante
│
├── js/
│   ├── firebase.js      ← Configuración Firebase (compartida)
│   ├── registro.js      ← Lógica del formulario
│   ├── admin.js         ← Lógica del panel admin
│   └── comprobante.js   ← Lógica del comprobante
│
└── assets/
    ├── logo.png
    ├── fondo_login.jpg
    ├── logotipo_semana.png
    └── semana_comercial_logo.png
```

## Despliegue en GitHub Pages

1. Sube todos los archivos al repositorio
2. Ve a **Settings → Pages**
3. En **Source** selecciona **Deploy from a branch**
4. Selecciona la rama `main` y carpeta `/ (root)`
5. Guarda — en ~2 minutos el sitio estará disponible

## URLs del sistema

| Página | URL |
|--------|-----|
| Formulario registro | `https://sistemacca.github.io/boletas-camara/` |
| Panel admin | `https://sistemacca.github.io/boletas-camara/admin.html` |
| Comprobante | `https://sistemacca.github.io/boletas-camara/comprobante.html` |

## Notas técnicas

- No requiere Node.js, npm, ni ningún proceso de compilación
- Firebase se carga directamente desde CDN (gstatic.com)
- Compatible con GitHub Pages gratuito
- Los assets (imágenes) se sirven desde la carpeta `assets/`
