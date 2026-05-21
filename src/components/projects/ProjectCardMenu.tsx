"use client";

import styles from "./ProjectsDashboard.module.css";

type ProjectCardMenuProps = {
  onRename: () => void;
  onShare: () => void;
  onDelete: () => void;
};

export function ProjectCardMenu({ onRename, onShare, onDelete }: ProjectCardMenuProps) {
  return (
    <div className={styles.cardMenu}>
      <button type="button" className={styles.cardMenuAction} onClick={onRename}>
        Rename
      </button>
      <button type="button" className={styles.cardMenuAction} onClick={onShare}>
        Copy link
      </button>
      <button type="button" className={styles.cardMenuDanger} onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
