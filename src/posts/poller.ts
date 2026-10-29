// Checks every profile on its own schedule while the site is open; new posts become designs right away.
import { usePosts, loadPosts, mergePosts, updateProfile, profileById } from './store';
import { fetchProfile } from './sources';
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
    const patch: Parameters<typeof updateProfile>[1] = { lastChecked: Date.now(), lastError: null, checkedOnce: true };
    if (r.avatar && r.avatar !== prof.avatarAuto) patch.avatarAuto = r.avatar;
    const viewing = !useWorkspace.getState().launcher && useWorkspace.getState().mode === 'posts' && usePosts.getState().active === id && document.visibilityState === 'visible';
    if (!first && fresh.length && !viewing) patch.unread = (prof.unread || 0) + fresh.length;
    updateProfile(id, patch);
    if (!first && fresh.length) void announce(id, fresh.length);
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

async function announce(id: string, n: number) {
  const prof = profileById(id); if (!prof) return;
  const { settings } = usePosts.getState();
  const msg = n === 1 ? tr('New post from {0} — the design is ready', prof.tab || prof.name) : tr('{0} new posts from {1} — the designs are ready', n, prof.tab || prof.name);
  toast(msg, 'success', 7000);
  if (settings.notify && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    const post = usePosts.getState().posts[id]?.[0];
    try { new Notification(`SARWAR DESIGN · ${prof.tab || prof.name}`, { body: post?.text.slice(0, 140) || msg, tag: `sarwar-${id}` }); } catch { /* not allowed here */ }
  }
  if (settings.autoDownload) {
    for (const post of (usePosts.getState().posts[id] ?? []).filter((p) => p.isNew).slice(0, n).reverse()) {
      try { const cv = await renderPost({ post, profile: prof, tpl: prof.template }); await saveBlob(await canvasBlob(cv, settings.format), fileName(prof, post, settings.format)); } catch { /* skip this one */ }
    }
  }
}

let timer = 0;
/** starts checking in the background (whole app, any section) */
export async function startPolling() {
  if (timer) return;
  await loadPosts();
  const tick = () => {
    const now = Date.now();
    for (const p of usePosts.getState().profiles) {
      const every = Math.max(1, p.interval || 5) * 60_000;
      if (now - (p.lastChecked || 0) >= every - 5_000) void checkProfile(p.id);
    }
  };
  timer = window.setInterval(tick, 30_000);
  tick();
}
export async function askNotifications() {
  if (!('Notification' in window)) { toast(tr('This browser cannot show notifications.'), 'warning'); return false; }
  if (Notification.permission === 'granted') return true;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}
