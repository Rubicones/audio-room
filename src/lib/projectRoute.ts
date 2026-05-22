export function getProjectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:p|project)\/([0-9a-fA-F-]+)$/);
  return match ? match[1] : null;
}

export function isProjectSharePath(pathname: string): boolean {
  return getProjectIdFromPath(pathname) !== null;
}

export function getProjectSharePath(
  projectId: string,
  options?: { quizMode?: boolean }
): string {
  const path = `/project/${projectId}`;
  if (options?.quizMode) {
    return `${path}?quizMode=true`;
  }
  return path;
}

export function isQuizModeSearch(search: string): boolean {
  return new URLSearchParams(search).get("quizMode") === "true";
}
