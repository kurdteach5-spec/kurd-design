// Checks every profile on its own schedule (as often as every 15 seconds) while the site is open;
// new posts become designs right away, with a sound, a notification and (if chosen) automatic downloads.
import { usePosts, loadPosts, mergePosts, updateProfile, profileById, type Post, type Profile } from './store';
import { fetchProfile, fetchBlob } from './sources';
import { renderPost, canvasBlob, fileName } from './render';
import { toast } from '../state/uiStore';
import { tr } from '../i18n';
import { saveBlob } from '../file-system/exporters';
import { useWorkspace } from '../state/workspace';

export async function checkProfile(id: string, manual = false): Promise<number> {
  const prof = profileById(id); if (!prof) return 0;
  if (usePosts.getState().checking[id]) return 0;
  usePosts.setState((s) => ({ checking: { ...s.checking, [id]: true } }));
  try {
    const r = await fetchProfile(prof);
    const first = !prof.checkedOnce;
    const fresh = mergePosts(id, r.posts, !first);
    const patch: Parameters<typeof updateProfile>[1] = { lastChecked: Date.now(), lastError: null, checkedOnce: true, via: r.via ?? null };
    if (r.avatar && r.avatar !== prof.avatarAuto) patch.avatarAuto = r.avatar;
    const viewing = !useWorkspace.getState().launcher && useWorkspace.getState().mode === 'posts' && usePosts.getState().active === id && document.visibilityState === 'visible';
    if (!first && fresh.length && !viewing) patch.unread = (prof.unread || 0) + fresh.length;
    updateProfile(id, patch);
    if (!first && fresh.length) void announce(id, fresh);
    else if (manual) toast(fresh.length ? tr('{0} posts found', fresh.length) : tr('No new posts yet'), 'info');
    return fresh.length;
  } catch (e) {
    const msg = (e as Error).message || 'The source could not be read.';
    updateProfile(id, { lastChecked: Date.now(), lastError: msg });
    if (manual) toast(tr(msg), 'error', 6000);
    return 0;
  } finally {
    usePosts.setState((s) => ({ checking: { ...s.checking, [id]: false } }));
  }
}

function ping() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac = new AC(); const t = ac.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.14); g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.14 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.35);
      o.connect(g).connect(ac.destination); o.start(t + i * 0.14); o.stop(t + i * 0.14 + 0.4);
    });
    setTimeout(() => void ac.close(), 1200);
  } catch { /* no sound here */ }
}

// the tab title shows how many new posts arrived while you were away
const baseTitle = document.title;
function titleCount() {
  const n = usePosts.getState().profiles.reduce((a, p) => a + (p.unread || 0), 0);
  document.title = n && document.visibilityState !== 'visible' ? `(${n}) ${tr('New post')} · ${baseTitle}` : baseTitle;
}

export async function downloadPictures(prof: Profile, post: Post) {
  const list = [...post.images, ...(post.videos ?? [])];
  let ok = 0;
  for (let i = 0; i < list.length; i++) {
    const blob = await fetchBlob(list[i]);
    if (!blob) { window.open(list[i], '_blank', 'noopener'); continue; }
    const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : blob.type.includes('gif') ? 'gif' : blob.type.startsWith('video/') ? 'mp4' : 'jpg';
    try { await saveBlob(blob, fileName(prof, post, ext as 'png').replace(/\.\w+$/, `_${i + 1}.${ext}`)); ok++; } catch { /* declined */ }
  }
  return ok;
}

async function announce(id: string, fresh: Post[]) {
  const prof = profileById(id); if (!prof) return;
  const { settings } = usePosts.getState();
  const n = fresh.length;
  const msg = n === 1 ? tr('New post from {0} — the design is ready', prof.tab || prof.name) : tr('{0} new posts from {1} — the designs are ready', n, prof.tab || prof.name);
  toast(msg, 'success', 8000);
  if (settings.sound) ping();
  titleCount();
  if (settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    const post = fresh[0];
    try {
      const nt = new Notification(`${prof.tab || prof.name} · SARWAR DESIGN`, { body: post?.text.slice(0, 180) || msg, tag: `sarwar-${id}-${post?.id}`, icon: prof.avatar || prof.avatarAuto || undefined, ...(post?.images[0] ? { image: post.images[0] } : {}) } as NotificationOptions);
      nt.onclick = () => { window.focus(); useWorkspace.setState({ mode: 'posts', launcher: false }); usePosts.setState({ active: id }); nt.close(); };
    } catch { /* not allowed here */ }
  }
  const posts = (usePosts.getState().posts[id] ?? []).filter((p) => fresh.some((f) => f.id === p.id)).reverse();
  for (const post of posts) {
    if (settings.autoDownload) {
      try { const cv = await renderPost({ post, profile: prof, tpl: { ...prof.template, showImage: post.mode === 'text' ? false : prof.template.showImage } }); await saveBlob(await canvasBlob(cv, settings.format), fileName(prof, post, settings.format)); } catch { /* skip this one */ }
    }
    if (settings.autoPictures && (post.images.length || post.videos?.length)) await downloadPictures(prof, post);
  }
}

let timer = 0;
/** starts checking in the background (whole app, any section) */
export async function startPolling() {
  if (timer) return;
  await loadPosts();
  const tick = () => {
    if (!navigator.onLine) return;
    const now = Date.now();
    for (const p of usePosts.getState().profiles) {
      const every = Math.max(0.25, p.interval || 1) * 60_000;
      // a failing source is tried less often, so it isn't hammered
      const wait = p.lastError ? Math.max(every, 60_000) : every;
      if (now - (p.lastChecked || 0) >= wait - 1_000) void checkProfile(p.id);
    }
  };
  timer = window.setInterval(tick, 5_000);
  document.addEventListener('visibilitychange', () => { titleCount(); if (document.visibilityState === 'visible') tick(); });
  window.addEventListener('online', tick);
  tick();
}
export async function askNotifications() {
  if (!('Notification' in window)) { toast(tr('This browser cannot show notifications.'), 'warning'); return false; }
  if (Notification.permission === 'granted') return true;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}
