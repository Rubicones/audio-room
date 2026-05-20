"use client";

import styles from "./ProjectsDashboard.module.css";

type ProjectCardMenuProps = {
  onRename: () => void;
  onDelete: () => void;
};

export function ProjectCardMenu({ onRename, onDelete }: ProjectCardMenuProps) {
  return (
    <div className={styles.cardMenu}>
      <button type="button" className={styles.cardMenuAction} onClick={onRename}>
        Rename
      </button>
      <button type="button" className={styles.cardMenuDanger} onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
