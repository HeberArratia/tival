(function () {
  const page = document.body.dataset.page || "";

  const NAV = [
    {
      label: "Operar",
      items: [
        { href: "runtime.html", id: "runtime", label: "Runtime", badge: "3" },
        { href: "caso.html", id: "caso", label: "Caso (detalle)" },
        { href: "proceso.html", id: "proceso", label: "Proceso" },
      ],
    },
    {
      label: "Embudo",
      items: [
        { href: "captacion.html", id: "captacion", label: "Captación" },
        { href: "diagnosticos.html", id: "diagnosticos", label: "Diagnósticos" },
        { href: "reunion.html", id: "reunion", label: "Reunión" },
        { href: "propuesta.html", id: "propuesta", label: "Propuesta" },
        { href: "seguimiento.html", id: "seguimiento", label: "Seguimiento" },
      ],
    },
    {
      label: "Sistema",
      items: [
        { href: "inteligencia.html", id: "inteligencia", label: "Inteligencia" },
        { href: "integraciones.html", id: "integraciones", label: "Integraciones" },
      ],
    },
  ];

  function navHtml() {
    return NAV.map((group) => {
      const items = group.items
        .map((item) => {
          const active = item.id === page ? "is-active" : "";
          const badge = item.badge
            ? `<span class="badge">${item.badge}</span>`
            : "";
          return `<a class="${active}" href="${item.href}"><span class="dot"></span>${item.label}${badge}</a>`;
        })
        .join("");
      return `<div class="nav-group"><div class="nav-label">${group.label}</div>${items}</div>`;
    }).join("");
  }

  const mount = document.getElementById("sidebar");
  if (!mount) return;

  mount.innerHTML = `
    <a class="brand" href="index.html">
      <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div>
        <strong>tival</strong>
        <small>sistema comercial</small>
      </div>
    </a>
    <div class="tenant">
      <label>Workspace</label>
      <strong>Alfondo</strong>
      <p>Consultoría B2B · playbook activo</p>
    </div>
    <nav class="nav">${navHtml()}</nav>
    <div class="sidebar-foot">
      <p>Mock navegable · datos ficticios para validar el concepto unificado.</p>
    </div>
  `;
})();
