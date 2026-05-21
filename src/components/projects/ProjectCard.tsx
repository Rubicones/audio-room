"use client";

import { KeyboardEvent, useMemo, useState } from "react";
import { ProjectCardMenu } from "./ProjectCardMenu";
import type { ProjectListItem } from "./types";
import styles from "./ProjectsDashboard.module.css";

type ProjectCardProps = {
  project: ProjectListItem;
  isActive: boolean;
  onOpen: (projectId: string) => void;
  onCopyLink: (projectId: string) => void;
  onRename: (projectId: string, nextTitle: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
};

function toRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const buckets: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];
  for (const [unit, seconds] of buckets) {
    if (Math.abs(deltaSeconds) >= seconds || unit === "second") {
      return rtf.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return "just now";
}

export function ProjectCard({
  project,
  isActive,
  onOpen,
  onCopyLink,
  onRename,
  onDelete,
}: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(project.title || "Untitled project");
  const [busy, setBusy] = useState(false);
  const updatedLabel = useMemo(() => toRelativeTime(project.updated_at), [project.updated_at]);

  const commitRename = async () => {
    const next = draftTitle.trim();
    if (!next) return;
    setBusy(true);
    await onRename(project.id, next);
    setBusy(false);
    setIsRenaming(false);
  };

  const onTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraftTitle(project.title || "Untitled project");
      setIsRenaming(false);
    }
  };

  return (
    <article
      className={`${styles.projectCard} ${isActive ? styles.projectCardActive : ""}`}
      onClick={() => onOpen(project.id)}
    >
      <div className={styles.projectCardHeader}>
        {isRenaming ? (
          <input
            autoFocus
            className={styles.cardTitleInput}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={onTitleKeyDown}
            onBlur={() => void commitRename()}
            disabled={busy}
          />
        ) : (
          <h3 className={styles.projectCardTitle}>{project.title || "Untitled project"}</h3>
        )}
        <button
          type="button"
          className={styles.cardMenuToggle}
          aria-label="Project actions"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
        >
          ⋮
        </button>
      </div>
      {menuOpen ? (
        <div
          className={styles.cardMenuWrap}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <ProjectCardMenu
            onCopyLink={() => {
              setMenuOpen(false);
              onCopyLink(project.id);
            }}
            onRename={() => {
              setMenuOpen(false);
              setIsRenaming(true);
            }}
            onDelete={() => {
              setMenuOpen(false);
              if (!window.confirm("Delete this project?")) return;
              void onDelete(project.id);
            }}
          />
        </div>
      ) : null}
      <p className={styles.projectCardMeta}>Last updated: {updatedLabel}</p>
    </article>
  );
}
