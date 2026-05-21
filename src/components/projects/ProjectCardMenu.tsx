"use client";

import styles from "./ProjectsDashboard.module.css";

type ProjectCardMenuProps = {
  onCopyLink: () => void;
  onRename: () => void;
  onDelete: () => void;
};

export function ProjectCardMenu({ onCopyLink, onRename, onDelete }: ProjectCardMenuProps) {
  return (
    <div className={styles.cardMenu}>
      <button type="button" className={styles.cardMenuAction} onClick={onCopyLink}>
        copy link
      </button>
      <button type="button" className={styles.cardMenuAction} onClick={onRename}>
        rename
      </button>
      <button type="button" className={styles.cardMenuDanger} onClick={onDelete}>
        delete
      </button>
    </div>
  );
}
