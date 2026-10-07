import { NextRequest, NextResponse } from "next/server";
import {
  addCompanyToCase,
  assignConsultant,
  cancelCase,
  markDiagnosticoRealizado,
  markLost,
  markNoShow,
  markPaid,
  markPropuestaEnviada,
  markWon,
  setClosingScore,
  setPrimaryCompany,
  setProducts,
  setRegion,
  unlinkCompanyFromCase,
  updateCaseCompany,
} from "@/lib/cases";
import { actorLabel, getSessionUser } from "@/lib/auth/session";
import { isChileRegion } from "@/lib/chile-regions";
import { isClosingScore } from "@/lib/closing-scores";
import { isLostReason } from "@/lib/lost-reasons";
import { isMemberId } from "@/lib/members-catalog";
import { retryN8nProposal } from "@/lib/integrations/n8n-proposal";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }
    const actor = actorLabel(session);

    const body = await request.json();
    const action = body?.action as string;

    if (action === "confirm_transfer") {
      const result = await markPaid({
        caseId: id,
        method: "transferencia",
        confirmedBy: actor,
      });
      return NextResponse.json({ ok: true, case: result.case });
    }

    if (action === "assign_consultant") {
      const consultantId =
        typeof body?.consultantId === "string" ? body.consultantId.trim() : "";
      if (!consultantId || !isMemberId(consultantId)) {
        return NextResponse.json(
          { ok: false, error: "invalid_consultant" },
          { status: 400 }
        );
      }
      const row = await assignConsultant({
        caseId: id,
        consultantId,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "mark_lost") {
      const raw = typeof body?.reason === "string" ? body.reason : "no_pago";
      const reason = isLostReason(raw) ? raw : "no_pago";
      const row = await markLost({
        caseId: id,
        reason,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "mark_realizado") {
      const rawScore =
        typeof body?.closingScore === "string" ? body.closingScore : null;
      const closingScore = isClosingScore(rawScore) ? rawScore : null;
      const rawRegion = typeof body?.region === "string" ? body.region : null;
      const region = isChileRegion(rawRegion) ? rawRegion : null;
      const productKeys = Array.isArray(body?.productKeys)
        ? body.productKeys.filter(
            (k: unknown): k is string => typeof k === "string" && !!k.trim()
          )
        : typeof body?.productKey === "string" && body.productKey.trim()
          ? [body.productKey.trim()]
          : null;
      const row = await markDiagnosticoRealizado({
        caseId: id,
        actor,
        closingScore,
        region,
        productKeys,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "mark_propuesta_enviada") {
      const row = await markPropuestaEnviada({
        caseId: id,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "mark_won") {
      const row = await markWon({
        caseId: id,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "set_closing_score") {
      const raw = typeof body?.closingScore === "string" ? body.closingScore : null;
      const closingScore = isClosingScore(raw) ? raw : null;
      const row = await setClosingScore({
        caseId: id,
        closingScore,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "set_region") {
      const raw = typeof body?.region === "string" ? body.region : null;
      const region = isChileRegion(raw) ? raw : null;
      const row = await setRegion({
        caseId: id,
        region,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "set_primary_company") {
      const companyId =
        body?.companyId === null || body?.companyId === ""
          ? null
          : typeof body?.companyId === "string"
            ? body.companyId.trim()
            : null;
      if (body?.companyId != null && body.companyId !== "" && !companyId) {
        return NextResponse.json(
          { ok: false, error: "invalid_company" },
          { status: 400 }
        );
      }
      const row = await setPrimaryCompany({
        caseId: id,
        companyId,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "add_company") {
      const rut = typeof body?.rut === "string" ? body.rut.trim() : "";
      const name =
        typeof body?.name === "string" ? body.name.trim() || null : null;
      if (!rut) {
        return NextResponse.json(
          { ok: false, error: "rut_required" },
          { status: 400 }
        );
      }
      const result = await addCompanyToCase({
        caseId: id,
        rut,
        name,
        actor,
      });
      return NextResponse.json({
        ok: true,
        case: result.case,
        company: result.company,
      });
    }

    if (action === "update_company") {
      const companyId =
        typeof body?.companyId === "string" ? body.companyId.trim() : "";
      if (!companyId) {
        return NextResponse.json(
          { ok: false, error: "invalid_company" },
          { status: 400 }
        );
      }
      const patch = {
        name:
          typeof body?.name === "string" || body?.name === null
            ? body.name
            : undefined,
        rut:
          typeof body?.rut === "string" || body?.rut === null
            ? body.rut
            : undefined,
        societyType:
          typeof body?.societyType === "string" || body?.societyType === null
            ? body.societyType
            : undefined,
        antiquity:
          typeof body?.antiquity === "string" || body?.antiquity === null
            ? body.antiquity
            : undefined,
        sales12m:
          typeof body?.sales12m === "string" || body?.sales12m === null
            ? body.sales12m
            : undefined,
        giro:
          typeof body?.giro === "string" || body?.giro === null
            ? body.giro
            : undefined,
      };
      const result = await updateCaseCompany({
        caseId: id,
        companyId,
        patch,
        actor,
      });
      return NextResponse.json({
        ok: true,
        case: result.case,
        company: result.company,
      });
    }

    if (action === "unlink_company") {
      const companyId =
        typeof body?.companyId === "string" ? body.companyId.trim() : "";
      if (!companyId) {
        return NextResponse.json(
          { ok: false, error: "invalid_company" },
          { status: 400 }
        );
      }
      const row = await unlinkCompanyFromCase({
        caseId: id,
        companyId,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "set_products" || action === "set_product") {
      const productKeys = Array.isArray(body?.productKeys)
        ? body.productKeys.filter(
            (k: unknown): k is string => typeof k === "string" && !!k.trim()
          )
        : typeof body?.productKey === "string" && body.productKey.trim()
          ? [body.productKey.trim()]
          : [];
      const row = await setProducts({
        caseId: id,
        productKeys,
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "generate_proposal") {
      const result = await retryN8nProposal(id);
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.error },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, skipped: result.skipped ?? false });
    }

    if (action === "no_show") {
      const row = await markNoShow(id, actor);
      return NextResponse.json({ ok: true, case: row });
    }

    if (action === "cancel") {
      const row = await cancelCase({
        caseId: id,
        reason: body?.reason ?? "ops_cancelled",
        actor,
      });
      return NextResponse.json({ ok: true, case: row });
    }

    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (error) {
    console.error("[cases.action]", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "error" },
      { status: 500 }
    );
  }
}
