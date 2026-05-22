import { buildProjectPageMetadata } from "@/lib/siteMetadata";
import { createServerSupabase } from "@/lib/supabaseServer";

type ProjectRouteParams = {
  id: string;
};

type ProjectRouteSearchParams = {
  [key: string]: string | string[] | undefined;
};

function readSearchParam(
  searchParams: ProjectRouteSearchParams,
  key: string
): string | undefined {
  const value = searchParams[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function isQuizModeFromSearchParams(
  searchParams: ProjectRouteSearchParams
): boolean {
  return (
    readSearchParam(searchParams, "quizMode") === "true" ||
    readSearchParam(searchParams, "mode") === "quiz"
  );
}

export async function fetchProjectTitle(projectId: string): Promise<string | null> {
  const supabase = createServerSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("projects")
    .select("title")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !data?.title) return null;
  return String(data.title);
}

export async function generateProjectRouteMetadata(input: {
  params: ProjectRouteParams;
  searchParams: ProjectRouteSearchParams;
  pathPrefix?: "project" | "p";
}) {
  const isQuizMode = isQuizModeFromSearchParams(input.searchParams);
  const projectTitle = isQuizMode
    ? null
    : await fetchProjectTitle(input.params.id);

  return buildProjectPageMetadata({
    projectId: input.params.id,
    projectTitle,
    isQuizMode,
    pathPrefix: input.pathPrefix,
  });
}
