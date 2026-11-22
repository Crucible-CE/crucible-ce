// GET /api/exercises/{id}/aar/guide   control: the "How to write the AAR" prompt
// built from the exercise record (names replaced by roles), and what still
// blocks finalize. CE sends the prompt nowhere.
import { NextResponse } from "next/server";
import { withErrors } from "@/lib/exercise/errors";
import { aarCaller, NO_STORE } from "@/lib/exercise/aar/http";
import { gatherAarInputs } from "@/lib/exercise/aar/inputs";
import { buildDeterministicSections } from "@/lib/exercise/aar/draft";
import { readSections } from "@/lib/exercise/aar/edit";
import { latestAar } from "@/lib/exercise/aar/store";
import { signoffState } from "@/lib/exercise/aar/finalize";
import { aarPromptInput, buildAarPrompt } from "@/lib/exercise/aar/guide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withErrors(async () => {
    const { id } = await params;
    await aarCaller(req, id, "control");
    const [inputs, aar] = await Promise.all([gatherAarInputs(id), latestAar(id)]);
    const sections = (aar ? readSections(aar.sections) : null) ?? buildDeterministicSections(inputs);
    const problems = aar ? (await signoffState(aar.id)).problems : ["Create the report draft first."];
    return NextResponse.json({ prompt: buildAarPrompt(aarPromptInput(inputs, sections)), problems }, { headers: NO_STORE });
  });
}
