"use client";

import { ProjectCard } from "./ProjectCard";
import type { ProjectListItem } from "./types";
import styles from "./ProjectsDashboard.module.css";

type ProjectsDashboardProps = {
  projects: ProjectListItem[];
  isLoading: boolean;
  currentProjectId: string | null;
  onOpenProject: (projectId: string) => void;
  onRenameProject: (projectId: string, nextTitle: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onStartClean: () => void;
  onLoadDemo: () => void;
};

export function ProjectsDashboard({
  projects,
  isLoading,
  currentProjectId,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  onStartClean,
  onLoadDemo,
}: ProjectsDashboardProps) {
  return (
    <section className={styles.panelDashboard}>
      <div className={styles.dashboardHeader}>
        <h2 className={styles.dashboardTitle}>My Projects</h2>
        <div className={styles.dashboardActions}>
          <button type="button" className={styles.primaryBtn} onClick={onStartClean}>
            New Project (Start Clean)
          </button>
          <button type="button" className={styles.secondaryBtn} onClick={onLoadDemo}>
            Load Demo Scene
          </button>
        </div>
      </div>
      {isLoading ? <p className={styles.dashboardHint}>Loading projects...</p> : null}
      {!isLoading && projects.length === 0 ? (
        <p className={styles.dashboardHint}>No saved projects yet.</p>
      ) : null}
      <div className={styles.projectsGrid}>
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            isActive={currentProjectId === project.id}
            onOpen={onOpenProject}
            onRename={onRenameProject}
            onDelete={onDeleteProject}
          />
        ))}
      </div>
    </section>
  );
}
