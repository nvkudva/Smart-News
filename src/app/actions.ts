'use server';

import { revalidatePath } from 'next/cache';
import { savePrefs, type Prefs } from '@/lib/feed';
import { toggleSaved } from '@/lib/library';
import { CATEGORIES } from '@/lib/db';

export async function toggleSavedAction(clusterId: string): Promise<boolean> {
  const nowSaved = toggleSaved(clusterId);
  revalidatePath('/saved');
  return nowSaved;
}

export async function savePrefsAction(formData: FormData) {
  const prefs: Prefs = {
    country: String(formData.get('country') ?? 'IN').toUpperCase().slice(0, 2),
    categories: CATEGORIES.filter((c) => formData.get(`cat:${c}`) === 'on'),
    places: String(formData.get('places') ?? '')
      .split(',').map((p) => p.trim()).filter(Boolean).slice(0, 12),
  };
  savePrefs(prefs);
  revalidatePath('/');
  revalidatePath('/profile');
}
