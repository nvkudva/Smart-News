'use server';

import { revalidatePath } from 'next/cache';
import { getPrefs, savePrefs, type Prefs } from '@/lib/feed';
import { toggleSaved } from '@/lib/library';
import { CATEGORIES } from '@/lib/db';

export async function toggleSavedAction(clusterId: string): Promise<boolean> {
  const nowSaved = await toggleSaved(clusterId);
  revalidatePath('/saved');
  return nowSaved;
}

export async function savePrefsAction(formData: FormData) {
  const picked = CATEGORIES.filter((c) => formData.get(`cat:${c}`) === 'on');
  const prefs: Prefs = {
    country: String(formData.get('country') ?? 'IN').toUpperCase().slice(0, 2),
    // An empty set leaves the ranker and the exploration reserve with nothing to
    // work against, so keep the last real selection instead of storing [].
    categories: picked.length > 0 ? picked : (await getPrefs()).categories,
    places: String(formData.get('places') ?? '')
      .split(',').map((p) => p.trim()).filter(Boolean).slice(0, 12),
  };
  await savePrefs(prefs);
  revalidatePath('/');
  revalidatePath('/profile');
}
