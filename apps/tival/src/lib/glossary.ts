/** Glosario de producto — UI expresa arquitectura. */

export const GLOSSARY = {
  playbook: {
    term: "Playbook",
    short: "Plantilla: etapas + campos de opp + triggers + efectos.",
  },
  iniciativa: {
    term: "Iniciativa",
    short: "Oferta concreta: tipo + playbook + defaults de campos + canal.",
  },
  tipo: {
    term: "Tipo",
    short: "Familia (guía, webinar, agenda…) con playbook por defecto y entry.",
  },
  segmento: {
    term: "Segmento",
    short: "Perfil que busca el workspace (S1, S2…). Atributo, no etapa.",
  },
  producto: {
    term: "Producto",
    short: "Ítem del catálogo del workspace (nombre + precio).",
  },
  contacto: {
    term: "Contacto",
    short: "Persona (identidad). Email + teléfonos. No es la cola operativa.",
  },
  empresa: {
    term: "Empresa",
    short: "Sociedad / RUT. Opcional: persona natural no tiene empresa.",
  },
  oportunidad: {
    term: "Oportunidad",
    short:
      "Contacto en una iniciativa (etapa + campos). Empresa primaria opcional.",
  },
  campo: {
    term: "Campo",
    short:
      "Atributo del playbook en la opp. Identidad (contacto/empresa) vive aparte.",
  },
  extras: {
    term: "Extras",
    short: "Datos fuera del esquema (UTM, payload crudo). Baúl, no contrato.",
  },
  etapa: {
    term: "Etapa",
    short: "Posición en el playbook (mapa).",
  },
  trigger: {
    term: "Trigger",
    short: "Señal de entrada que escuchamos (webhook, form, click ops).",
  },
  efecto: {
    term: "Efecto",
    short: "Trabajo que Tival hace a consecuencia (Drive, Meta, crear opp…).",
  },
  evento: {
    term: "Evento",
    short: "Hecho en la historia de la oportunidad (con resultado del efecto).",
  },
  integracion: {
    term: "Integración",
    short: "Conexión de un proveedor a un workspace (credenciales + webhook).",
  },
  miembro: {
    term: "Miembro",
    short: "Persona del workspace con roles ops / consultor.",
  },
  rol: {
    term: "Rol",
    short: "Expectativa operativa (ops, consultor). No es el actor de etapa.",
  },
  asignacion: {
    term: "Asignación",
    short: "Consultor dueño de la opp (se pide en Diagnóstico pagado).",
  },
} as const;

/** Flujo canónico en una línea. */
export const FLOW_LINE = "Trigger → Efecto → Evento (historia)";
