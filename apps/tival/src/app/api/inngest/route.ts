import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { enrichMeetArtifacts } from "@/inngest/functions/enrich-meet";
import { remindMeetingWhatsapp } from "@/inngest/functions/meeting-remind";
import { collectPostMeetArtifacts } from "@/inngest/functions/post-meet-collect";
import { notifyRescheduleWhatsappFn } from "@/inngest/functions/reschedule-notify";

export const runtime = "nodejs";

/**
 * Endpoint que Inngest (Cloud o Dev Server) invoca.
 * Sync: URL pública + /api/inngest  ·  Local: npx inngest-cli dev -u http://localhost:3000/api/inngest
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    enrichMeetArtifacts,
    collectPostMeetArtifacts,
    remindMeetingWhatsapp,
    notifyRescheduleWhatsappFn,
  ],
});
