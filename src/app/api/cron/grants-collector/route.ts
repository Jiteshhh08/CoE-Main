import { NextRequest } from "next/server";
import { authenticate, authorize, errorRes, successRes } from "@/lib/api-helpers";
import { collectMonthlyGrants } from "@/lib/grants/automation";

function isAuthorizedCron(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  const querySecret = (
    new URL(req.url).searchParams.get("secret") || ""
  ).trim();

  if (expectedSecret) {
    return headerSecret === expectedSecret || querySecret === expectedSecret;
  }

  const user = authenticate(req);
  return Boolean(user && authorize(user, "ADMIN"));
}

// GET /api/cron/grants-collector
export async function GET(req: NextRequest) {
  try {
    if (!isAuthorizedCron(req)) {
      return errorRes("Forbidden", ["Invalid cron secret"], 403);
    }

    const result = await collectMonthlyGrants();
    return successRes(result, "Grants collection completed.");
  } catch (err) {
    console.error("Grants collector cron error:", err);
    return errorRes("Internal server error", [], 500);
  }
}
