import { requireContext } from "@/server/context.ts";
import { listFonts } from "@/server/fonts.ts";
import { route } from "@/server/http.ts";
import { appStorage } from "@/server/storage.ts";

export const GET = route(async () => listFonts(await requireContext(), appStorage()));
