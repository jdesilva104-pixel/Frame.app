const $ = selector => document.querySelector(selector);
const creatorId = new URLSearchParams(location.search).get('id');
let currentUser = null;
let creatorData = null;
let toastTimer;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function initials(name = 'Frame creator') {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
}
function formatNumber(value) { return new Intl.NumberFormat().format(Number(value) || 0); }
function timeAgo(date) {
  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  const days = Math.floor(elapsed / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
function showToast(message, error = false) {
  const toast = $('#creatorToast');
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 4000);
}
async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not complete that request.');
  return result;
}
function renderCreator() {
  const { creator, stats, viewer, isSelf, videos } = creatorData;
  $('#creatorProfileName').textContent = creator.name;
  $('#creatorBio').textContent = creator.bio || 'This creator has not added a bio yet.';
  $('#creatorVideoCount').textContent = formatNumber(stats.videos);
  $('#creatorSubscriberCount').textContent = formatNumber(stats.subscribers);
  $('#creatorVideoCountLabel').textContent = `${formatNumber(stats.videos)} ${stats.videos === 1 ? 'video' : 'videos'}`;
  $('#creatorSubscribeButton').textContent = viewer.subscribed ? 'Subscribed' : 'Subscribe';
  $('#creatorSubscribeButton').classList.toggle('is-subscribed', viewer.subscribed);
  $('#creatorSubscribeButton').classList.toggle('hidden', isSelf);
  $('#creatorDashboardLink').classList.toggle('hidden', !isSelf);
  const avatar = $('#creatorProfileAvatar');
  avatar.innerHTML = creator.profilePhotoUrl
    ? `<img src="${escapeHtml(creator.profilePhotoUrl)}" alt="${escapeHtml(creator.name)}'s profile photo">`
    : escapeHtml(initials(creator.name));
  document.title = `${creator.name} · Frame`;
  $('#creatorVideos').innerHTML = videos.length ? videos.map(video => `<a class="creator-video" href="/watch.html?v=${encodeURIComponent(video.id)}"><span class="creator-video-thumb"><img src="${escapeHtml(video.thumbnailUrl || './media/mountain-dawn.jpg')}" alt="" loading="lazy"><i>${formatNumber(video.viewCount)} views</i></span><span class="creator-video-copy"><strong>${escapeHtml(video.title)}</strong><small>${timeAgo(video.createdAt)}${video.tags.length ? ` · ${video.tags.slice(0, 3).map(escapeHtml).join(' · ')}` : ''}</small></span></a>`).join('') : `<div class="creator-empty"><strong>No public videos yet.</strong>This creator has not uploaded a video.</div>`;
}
async function loadCreator() {
  if (!creatorId || !/^\d+$/.test(creatorId)) throw new Error('This creator profile link is not valid.');
  const [session] = await Promise.all([requestJson('/api/me').catch(() => ({ user: null }))]);
  currentUser = session.user;
  $('#creatorAccountButton').textContent = currentUser ? 'Dashboard' : 'Sign in';
  creatorData = await requestJson(`/api/creators/${encodeURIComponent(creatorId)}`);
  renderCreator();
}
async function toggleSubscription() {
  if (!currentUser) {
    const returnTo = `${location.pathname}${location.search}`;
    location.href = `/?signin=1&return=${encodeURIComponent(returnTo)}`;
    return;
  }
  const button = $('#creatorSubscribeButton');
  button.disabled = true;
  try {
    const result = await requestJson(`/api/creators/${encodeURIComponent(creatorId)}/subscribe`, { method: creatorData.viewer.subscribed ? 'DELETE' : 'POST' });
    creatorData.viewer.subscribed = result.subscribed;
    creatorData.stats.subscribers = result.subscribers;
    renderCreator();
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
}
$('#creatorAccountButton').addEventListener('click', () => { location.href = currentUser ? '/?dashboard=1' : '/?signin=1'; });
$('#creatorSubscribeButton').addEventListener('click', toggleSubscription);
loadCreator().catch(error => {
  $('#creatorProfileName').textContent = 'Profile unavailable';
  $('#creatorBio').textContent = error.message;
  $('#creatorVideos').innerHTML = '<div class="creator-empty">We could not load this creator profile.</div>';
  $('#creatorProfileAvatar').textContent = '?';
});
