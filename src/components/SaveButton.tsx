'use client';

import { useState, useTransition } from 'react';
import { toggleSavedAction } from '@/app/actions';
import { Bookmark } from './icons';

export function SaveButton({ clusterId, initial }: { clusterId: string; initial: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      className="savebtn"
      data-saved={saved}
      aria-pressed={saved}
      disabled={pending}
      onClick={() => start(async () => setSaved(await toggleSavedAction(clusterId)))}
    >
      <Bookmark size={17} />
      <span>{saved ? 'Saved' : 'Save'}</span>
    </button>
  );
}
