import { api } from './api.js';

// "Save to private gallery": copies a photo/video from anywhere in CHEX into the hidden private space.
// It needs no password to SAVE (nothing private is shown); the gallery itself opens only with the password.
export async function saveToPrivate({ url, kind, name = '', source = 'app' }) {
  const toast = (text) => window.dispatchEvent(new CustomEvent('chex:toast', { detail: { text } }));
  if (!url) { toast('Nothing to save.'); return false; }
  try {
    await api.privateGallerySave({ url, kind: kind === 'video' ? 'video' : 'image', name, source });
    toast('🔒 Saved to your private gallery');
    return true;
  } catch (err) {
    toast(err.code === 'NO_SPACE' ? '🔒 Create your private space first (＋ menu → Private space).' : (err.message || 'Could not save.'));
    return false;
  }
}
