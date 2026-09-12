
import { useState, useTransition } from 'react';
import { toggleSavedAction } from '../lib/actions';
import { Bookmark } from './icons';

/**
 * `iconOnly` is for the places where the word is redundant because the control
 * sits against the thing it saves — beside a reel's headline, say, where a
 * labelled button would compete with the headline for the eye.
 */
export function SaveButton(
  { clusterId, initial, iconOnly = false }:
  { clusterId: string; initial: boolean; iconOnly?: boolean },
) {
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      className={iconOnly ? 'savebtn savebtn--icon' : 'savebtn'}
      data-saved={saved}
      aria-pressed={saved}
      aria-label={iconOnly ? (saved ? 'Saved' : 'Save story') : undefined}
      disabled={pending}
      onClick={() => start(async () => setSaved(await toggleSavedAction(clusterId)))}
    >
      <Bookmark size={17} />
      {!iconOnly && <span>{saved ? 'Saved' : 'Save'}</span>}
    </button>
  );
}
