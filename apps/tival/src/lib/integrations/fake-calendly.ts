/** Demo payload Calendly con forma Alfondo (pack). Genera data distinta cada vez. */
import { alfondoPack } from "@/workspaces/alfondo";
import { createHmac, randomUUID } from "crypto";

export type FakeInviteeOpts = {
  seed?: string;
};

const FIRST = [
  "Camila",
  "Jorge",
  "Valentina",
  "Felipe",
  "Antonia",
  "Matías",
  "Francisca",
  "Diego",
];
const LAST = [
  "Reyes",
  "Oyarzún",
  "Mora",
  "Soto",
  "Vargas",
  "Núñez",
  "Paredes",
  "Castro",
];
const COMPANIES = [
  { slug: "lapanaderia", label: "La Panadería" },
  { slug: "nortelogistica", label: "Norte Logística" },
  { slug: "andesfood", label: "Andes Food" },
  { slug: "meridian", label: "Meridian SpA" },
  { slug: "vitalsalud", label: "Vital Salud" },
  { slug: "costaverde", label: "Costa Verde" },
];
const PROJECTS = [
  "Queremos postular a un fondo de innovación para digitalizar pedidos.",
  "Necesitamos diagnóstico de modelo de negocio y pricing.",
  "Buscamos ordenar el embudo comercial antes de escalar ads.",
  "Queremos validar si conviene armar un producto SaaS interno.",
  "Diagnóstico para postular a CORFO / Start-Up Chile.",
];

function pick<T>(arr: T[], n: number): T {
  return arr[Math.abs(n) % arr.length]!;
}

function randInt(max: number) {
  return Math.floor(Math.random() * max);
}

function phoneCl() {
  const n = 900000000 + randInt(99999999);
  return `+56 9 ${String(n).slice(1, 5)} ${String(n).slice(5, 9)}`;
}

function rutFake() {
  const body = 10000000 + randInt(80000000);
  const dv = randInt(11);
  return `${body}-${dv === 10 ? "K" : dv}`;
}

/** Payload en forma Calendly (objeto). n8n lo envuelve en `[{...}]`. */
export function buildFakeCalendlyInviteeCreated(opts: FakeInviteeOpts = {}) {
  const id = opts.seed ?? randomUUID();
  const n = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const first = pick(FIRST, n);
  const last = pick(LAST, n >> 3);
  const company = pick(COMPANIES, n >> 5);
  const project = pick(PROJECTS, n >> 7);
  const eventUuid = randomUUID();
  const inviteeUuid = randomUUID();
  const qualLogId = randomUUID();
  const now = new Date();
  const start = new Date(now.getTime() + (3 + randInt(14)) * 86400000);
  start.setMinutes(0, 0, 0);
  start.setHours(10 + randInt(8), randInt(2) * 30, 0, 0);
  const end = new Date(start.getTime() + 50 * 60 * 1000);
  const phone = phoneCl();
  /** ~35% sin RUT: en Calendly real el campo factura es opcional. */
  const rut = Math.random() < 0.35 ? null : rutFake();
  const email = `${first.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")}.${last.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")}@${company.slug}.cl`;

  const questionsAndAnswers = [
    {
      answer: phone,
      position: 0,
      question: "Número de Teléfono",
    },
    {
      answer: project,
      position: 1,
      question:
        "Cuéntenos de qué trata tu proyecto para llegar mejor preparados para la reunión.",
    },
  ];
  if (rut) {
    questionsAndAnswers.push({
      answer: rut,
      position: 2,
      question: "Si necesitas factura, ingresa aquí el RUT de tu empresa",
    });
  }

  const body = {
    created_at: now.toISOString().replace(/\.\d{3}Z$/, ".000000Z"),
    created_by:
      "https://api.calendly.com/users/919edaa4-f5e4-41bb-8ede-c0380c240f89",
    event: "invitee.created",
    payload: {
      cancel_url: `https://calendly.com/cancellations/${inviteeUuid}`,
      created_at: now.toISOString(),
      email,
      event: `https://api.calendly.com/scheduled_events/${eventUuid}`,
      first_name: null,
      invitee_scheduled_by: null,
      last_name: null,
      name: `${first} ${last}`,
      new_invitee: null,
      no_show: null,
      old_invitee: null,
      payment: null,
      questions_and_answers: questionsAndAnswers,
      reconfirmation: null,
      reschedule_url: `https://calendly.com/reschedulings/${inviteeUuid}`,
      rescheduled: false,
      routing_form_submission: null,
      scheduled_event: {
        created_at: now.toISOString(),
        end_time: end.toISOString(),
        event_guests: [],
        event_memberships: [
          {
            user:
              "https://api.calendly.com/users/919edaa4-f5e4-41bb-8ede-c0380c240f89",
            user_email: "hablemos@alfondo.cl",
            user_name: "Alfondo Team",
          },
        ],
        event_type:
          "https://api.calendly.com/event_types/eb16a7d8-7a4c-4e3c-ae0e-969f6d7e796c",
        invitees_counter: { total: 1, active: 1, limit: 1 },
        location: {
          join_url: `https://calendly.com/events/${eventUuid}/google_meet`,
          status: "processing",
          type: "google_conference",
        },
        meeting_notes_html: null,
        meeting_notes_plain: null,
        name: "Diagnóstico de innovación - 50 minutos",
        start_time: start.toISOString(),
        status: "active",
        updated_at: now.toISOString(),
        uri: `https://api.calendly.com/scheduled_events/${eventUuid}`,
      },
      scheduling_method: null,
      status: "active",
      text_reminder_number: null,
      timezone: alfondoPack.timezone,
      tracking: {
        utm_campaign: "diag_qual",
        utm_source: alfondoPack.slug,
        utm_medium: "diagnostico-innovacion",
        utm_content: qualLogId,
        utm_term: null,
        salesforce_uuid: null,
      },
      updated_at: now.toISOString(),
      uri: `https://api.calendly.com/scheduled_events/${eventUuid}/invitees/${inviteeUuid}`,
    },
  };

  return {
    body,
    summary: {
      name: `${first} ${last}`,
      email,
      phone,
      company: rut ? company.label : null,
      rut,
      project,
      eventUuid,
      start: start.toISOString(),
    },
  };
}

export function signCalendlyBody(rawBody: string, signingKey: string) {
  const t = Math.floor(Date.now() / 1000).toString();
  const v1 = createHmac("sha256", signingKey)
    .update(`${t}.${rawBody}`)
    .digest("hex");
  return `t=${t},v1=${v1}`;
}
