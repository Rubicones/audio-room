export function getProjectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:p|project)\/([0-9a-fA-F-]+)$/);
  return match ? match[1] : null;
}

export function isProjectSharePath(pathname: string): boolean {
  return getProjectIdFromPath(pathname) !== null;
}

export function getProjectSharePath(projectId: string): string {
  return `/project/${projectId}`;
}
