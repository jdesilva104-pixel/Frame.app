const demoVideos = [
  { id: 'sample-1', title: 'A softer kind of morning', description: 'Watching the day wake up above the clouds.', tags: ['nature', 'travel'], creator: 'Maya Ellis', thumbnailUrl: './media/mountain-dawn.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-2', title: 'The long way home', description: 'Took a turn I had never taken before.', tags: ['travel', 'everyday'], creator: 'Jonah Reed', thumbnailUrl: './media/coast-road.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-3', title: 'Where the water slows down', description: 'A quiet afternoon, nowhere to be.', tags: ['nature', 'everyday'], creator: 'Anika Bose', thumbnailUrl: './media/forest-river.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-4', title: 'A table for the whole afternoon', description: 'Fresh bread, a sunny window, and no rush.', tags: ['food', 'everyday'], creator: 'Leo Park', thumbnailUrl: './media/supper-table.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-5', title: 'Golden hour, one more time', description: 'The last light made everything glow.', tags: ['travel', 'nature'], creator: 'Sofia Lane', thumbnailUrl: './media/golden-hour.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-6', title: 'A little room to breathe', description: 'A small walk through a very big world.', tags: ['nature', 'music'], creator: 'Theo James', thumbnailUrl: './media/green-hills.jpg', videoUrl: './media/forest-aerial.mp4', sample: true }
];
const $ = (selector) => document.querySelector(selector);
const grid = $('#videoGrid');
const homeView = $('#top');
const dashboardView = $('#dashboardView');
const authDialog = $('#authDialog');
const uploadDialog = $('#uploadDialog');
const playlistDialog = $('#playlistDialog');
const playerDialog = $('#playerDialog');
const editVideoDialog = $('#editVideoDialog');
const editPlaylistDialog = $('#editPlaylistDialog');
const settingsDialog = $('#settingsDialog');
let authMode = 'login';
let currentTag = '';
let currentUser = null;
let uploadedVideos = [];
const feedPageSize = 24;
let feedOffset = 0;
let hasMoreFeedVideos = false;
let loadingFeedVideos = false;
let feedRequestId = 0;
let feedLoadFailed = false;
let searchDebounceTimer;
let myVideos = [];
let libraryData = { history: [], liked: [], watchLater: [], playlists: [] };
let dashboardTab = 'videos';
let currentPlayerVideo = null;
let playerLiked = false;
let playerSaved = false;
let lastHistoryUpdate = 0;
let toastTimer;
let settingsPhotoPreviewUrl = null;

function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
function userInitials(name = 'Frame creator') { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase(); }
function renderUserAvatar(element, user) {
  if (!element) return;
  element.innerHTML = user?.profilePhotoUrl
    ? `<img src="${escapeHtml(user.profilePhotoUrl)}" alt="">`
    : escapeHtml(userInitials(user?.name));
}
function showAppToast(message, isError = false) {
  const toast = $('#appToast');
  toast.textContent = message;
  toast.classList.toggle('app-toast-error', isError);
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
}
function connectionMessage(error) {
  if (location.protocol === 'file:' || location.port !== '3000') return `This page is open at ${location.href}. Open http://localhost:3000 to use sign-in and uploads.`;
  if (error instanceof TypeError || error instanceof SyntaxError) return 'Could not read a response from the backend. Restart it with npm start and reload this page.';
  return error.message || 'Could not reach the server.';
}
function timeAgo(date) {
  if (!date) return 'Just shared';
  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  const days = Math.floor(elapsed / 86400000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function filteredVideos() {
  const query = $('#searchInput').value.trim().toLowerCase();
  return [...uploadedVideos, ...demoVideos].filter(video => {
    const matchesTag = !currentTag || video.tags.some(tag => tag.toLowerCase() === currentTag);
    const haystack = [video.title, video.description, video.creator, ...video.tags].join(' ').toLowerCase();
    return matchesTag && (!query || haystack.includes(query));
  });
}
function videoMenuMarkup(video, playlistId = '') {
  const isOwner = Boolean(currentUser && !video.sample && Number(video.userId) === Number(currentUser.id));
  const liked = libraryData.liked.some(item => String(item.id) === String(video.id));
  const saved = libraryData.watchLater.some(item => String(item.id) === String(video.id));
  const actions = [];
  if (isOwner) {
    actions.push(`<button type="button" data-video-menu-action="edit" data-video-id="${escapeHtml(video.id)}">Edit video</button>`);
    actions.push(`<button type="button" class="video-menu-danger" data-video-menu-action="delete" data-video-id="${escapeHtml(video.id)}">Delete video</button>`);
  } else if (!video.sample && currentUser) {
    actions.push(`<button type="button" data-video-menu-action="like" data-video-id="${escapeHtml(video.id)}">${liked ? 'Unlike video' : 'Like video'}</button>`);
    actions.push(`<button type="button" data-video-menu-action="watch-later" data-video-id="${escapeHtml(video.id)}">${saved ? 'Remove from Watch later' : 'Save to Watch later'}</button>`);
    if (libraryData.playlists.length) {
      actions.push(`<div class="video-menu-subtitle">Add to playlist</div>${libraryData.playlists.map(list => `<button type="button" data-video-menu-action="playlist" data-playlist-id="${escapeHtml(list.id)}" data-video-id="${escapeHtml(video.id)}">＋ ${escapeHtml(list.name)}</button>`).join('')}`);
    } else {
      actions.push('<button type="button" data-video-menu-action="new-playlist">＋ Create a playlist</button>');
    }
  } else if (!video.sample) {
    actions.push(`<button type="button" data-video-menu-action="signin" data-video-id="${escapeHtml(video.id)}">Sign in to save or like</button>`);
  }
  if (playlistId) actions.push(`<button type="button" data-video-menu-action="remove-playlist" data-playlist-id="${escapeHtml(playlistId)}" data-video-id="${escapeHtml(video.id)}">Remove from this playlist</button>`);
  actions.push(`<button type="button" data-video-menu-action="share" data-video-id="${escapeHtml(video.id)}">Share video</button>`);
  return `<div class="video-card-menu"><button class="video-menu-toggle" type="button" aria-label="Video options for ${escapeHtml(video.title)}" aria-expanded="false">⋮</button><div class="video-menu-panel hidden" role="menu">${actions.join('')}</div></div>`;
}
function renderVideos() {
  const videos = filteredVideos();
  grid.innerHTML = videos.map(video => `<article class="video-card" data-video-id="${escapeHtml(video.id)}">
    <div class="video-thumb"><img src="${escapeHtml(video.thumbnailUrl || './media/mountain-dawn.jpg')}" alt="" loading="lazy"><span class="duration">${video.sample ? '0:41' : 'VIDEO'}</span><span class="thumb-play">▶</span></div>${videoMenuMarkup(video)}
    <div class="video-meta"><div><h3>${escapeHtml(video.title)}</h3><p>${escapeHtml(video.creator || 'Frame creator')} · ${timeAgo(video.createdAt)}</p></div><span class="video-symbol">✳</span></div>
    <div class="tag-row">${video.tags.slice(0, 3).map(tag => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join('')}</div></article>`).join('');
  $('#emptyState').classList.toggle('hidden', videos.length > 0 || loadingFeedVideos || hasMoreFeedVideos);
  $('#loadingState').classList.toggle('hidden', !loadingFeedVideos || feedOffset > 0);
  $('#feedLoadingMore').classList.toggle('hidden', !loadingFeedVideos || feedOffset === 0);
  const loadMoreButton = $('#loadMoreVideos');
  loadMoreButton.classList.toggle('hidden', !hasMoreFeedVideos || loadingFeedVideos);
  loadMoreButton.textContent = feedLoadFailed ? 'Try loading again' : 'Load more videos';
}
async function loadVideos(reset = false) {
  if (reset) {
    feedRequestId += 1;
    feedOffset = 0;
    hasMoreFeedVideos = true;
    loadingFeedVideos = false;
    feedLoadFailed = false;
    uploadedVideos = [];
  }
  if (loadingFeedVideos || !hasMoreFeedVideos) return;
  const requestId = feedRequestId;
  loadingFeedVideos = true;
  feedLoadFailed = false;
  renderVideos();
  try {
    const params = new URLSearchParams({ limit: String(feedPageSize), offset: String(feedOffset) });
    const query = $('#searchInput').value.trim();
    if (query) params.set('q', query);
    if (currentTag) params.set('tag', currentTag);
    const response = await fetch(`/api/videos?${params}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load the video feed.');
    if (requestId !== feedRequestId) return;
    const nextVideos = result.videos || [];
    const existingIds = new Set(uploadedVideos.map(video => String(video.id)));
    uploadedVideos.push(...nextVideos.filter(video => !existingIds.has(String(video.id))));
    feedOffset += nextVideos.length;
    hasMoreFeedVideos = nextVideos.length === feedPageSize;
  } catch (error) {
    if (requestId !== feedRequestId) return;
    feedLoadFailed = true;
    hasMoreFeedVideos = true;
    if (feedOffset === 0 && !uploadedVideos.length) console.warn('Feed could not load:', error.message);
  } finally {
    if (requestId === feedRequestId) {
      loadingFeedVideos = false;
      renderVideos();
      openSharedVideoFromHash();
    }
  }
}
$('#loadMoreVideos').addEventListener('click', () => loadVideos());
const feedObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadVideos();
    }, { rootMargin: '700px 0px' })
  : null;
if (feedObserver) feedObserver.observe($('.feed-pagination'));
else window.addEventListener('scroll', () => {
  if (hasMoreFeedVideos && !loadingFeedVideos && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700) loadVideos();
}, { passive: true });
function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  $('#authTitle').textContent = registering ? 'Make yourself at home.' : 'Good to see you.';
  $('#authSubtitle').textContent = registering ? 'Create an account and start sharing.' : 'Sign in and pick up where you left off.';
  document.querySelectorAll('.register-only').forEach(el => el.classList.toggle('hidden', !registering));
  $('#authName').required = registering;
  $('#authPassword').autocomplete = registering ? 'new-password' : 'current-password';
  $('#authSubmit').innerHTML = `${registering ? 'Create account' : 'Sign in'} <span>↗</span>`;
  $('#switchPrompt').textContent = registering ? 'Already have an account?' : 'New around here?';
  $('#switchAuth').textContent = registering ? 'Sign in' : 'Create an account';
  $('#authError').textContent = '';
  if (!authDialog.open) authDialog.showModal();
}
document.querySelectorAll('[data-open-auth]').forEach(button => button.addEventListener('click', () => setAuthMode(button.dataset.openAuth)));
$('#switchAuth').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
$('#closeAuth').addEventListener('click', () => authDialog.close());
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const response = await fetch(`/api/${authMode === 'register' ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Please try again.');
    currentUser = result.user;
    authDialog.close();
    updateAccount();
    const returnTo = new URLSearchParams(location.search).get('return');
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) { location.replace(returnTo); return; }
    await showDashboard();
  } catch (error) { $('#authError').textContent = connectionMessage(error); }
});
function updateAccount() {
  document.querySelectorAll('.account-actions [data-open-auth]').forEach(el => el.classList.toggle('hidden', Boolean(currentUser)));
  $('#userMenu').classList.toggle('hidden', !currentUser);
  $('#userName').textContent = currentUser ? `Hi, ${currentUser.name.split(' ')[0]}` : '';
  if (currentUser && !$('#dashboardButton')) {
    const button = document.createElement('button'); button.id = 'dashboardButton'; button.className = 'button button-small'; button.textContent = 'Dashboard';
    button.addEventListener('click', showDashboard);
    $('.account-actions').prepend(button);
  }
  if (currentUser) {
    const firstName = currentUser.name.split(' ')[0];
    $('#dashboardName').textContent = firstName;
    $('#sidebarName').textContent = currentUser.name;
    $('#sidebarUserId').textContent = `User ID: ${currentUser.id}`;
    $('#dashboardProfileName').textContent = currentUser.name;
    $('#dashboardProfileEmail').textContent = currentUser.email;
    $('#dashboardProfileId').textContent = `User ID: ${currentUser.id}`;
    $('#dashboardPublicProfile').href = `/creator.html?id=${encodeURIComponent(currentUser.id)}`;
    $('#settingsUserId').textContent = currentUser.id;
    renderUserAvatar($('#sidebarAvatar'), currentUser);
    renderUserAvatar($('#dashboardProfileAvatar'), currentUser);
  }
  if (!currentUser) { $('#dashboardButton')?.remove(); myVideos = []; }
  renderVideos();
}
async function showDashboard() {
  homeView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  await loadDashboard();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showHome() {
  closePersonalMenu();
  dashboardView.classList.add('hidden');
  homeView.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function closePersonalMenu() {
  $('#personalMenu').classList.add('hidden');
  $('#personalMenuToggle').setAttribute('aria-expanded', 'false');
}
$('#personalMenuToggle').addEventListener('click', () => {
  const menu = $('#personalMenu');
  const isOpening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !isOpening);
  $('#personalMenuToggle').setAttribute('aria-expanded', String(isOpening));
});
$('#personalMenu').addEventListener('click', event => {
  const item = event.target.closest('[data-personal-view]');
  if (!item) return;
  closePersonalMenu();
  document.querySelector(`[data-library-view="${item.dataset.personalView}"]`)?.click();
});
$('#personalMenuLogout').addEventListener('click', () => { closePersonalMenu(); $('#logoutButton').click(); });
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.personal-menu-wrap')) closePersonalMenu();
  const videoMenu = event.target.closest('.video-card-menu');
  closeVideoMenus(videoMenu);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closePersonalMenu(); closeVideoMenus(); } });
$('#exploreButton').addEventListener('click', showHome);
$('#sidebarProfileButton').addEventListener('click', openSettings);
$('#editDashboardProfile').addEventListener('click', openSettings);
document.querySelectorAll('[data-library-view]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.libraryView === 'settings') {
    document.querySelectorAll('[data-library-view]').forEach(item => item.classList.toggle('selected', item === button));
    openSettings();
    return;
  }
  dashboardTab = button.dataset.libraryView;
  renderDashboard();
}));
$('#logoutButton').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  updateAccount();
  showHome();
});
$('#dashboardUpload').addEventListener('click', () => uploadDialog.showModal());
$('#newPlaylistButton').addEventListener('click', () => { $('#playlistError').textContent = ''; playlistDialog.showModal(); });
$('#closePlaylist').addEventListener('click', () => playlistDialog.close());
$('#playlistForm').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  $('#playlistError').textContent = '';
  const form = Object.fromEntries(new FormData(formElement));
  try {
    const response = await fetch('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not create playlist.');
    libraryData.playlists.unshift(result.playlist);
    dashboardTab = 'playlists';
    renderDashboard();
    formElement.reset();
    playlistDialog.close();
  } catch (error) { $('#playlistError').textContent = connectionMessage(error); }
});
function openEditVideo(videoId) {
  const video = myVideos.find(item => String(item.id) === String(videoId));
  if (!video) return;
  const form = $('#editVideoForm');
  form.elements.videoId.value = video.id;
  form.elements.title.value = video.title;
  form.elements.description.value = video.description || '';
  form.elements.tags.value = (video.tags || []).join(', ');
  $('#editVideoError').textContent = '';
  editVideoDialog.showModal();
}
$('#closeEditVideo').addEventListener('click', () => editVideoDialog.close());
$('#editVideoForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const videoId = form.videoId;
  delete form.videoId;
  $('#editVideoError').textContent = '';
  try {
    const response = await fetch(`/api/my/videos/${encodeURIComponent(videoId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update video.');
    myVideos = myVideos.map(video => String(video.id) === String(videoId) ? result.video : video);
    uploadedVideos = uploadedVideos.map(video => String(video.id) === String(videoId) ? result.video : video);
    renderDashboard(); editVideoDialog.close(); await loadVideos(true);
  } catch (error) { $('#editVideoError').textContent = connectionMessage(error); }
});
async function deleteMyVideo(videoId) {
  const video = myVideos.find(item => String(item.id) === String(videoId));
  if (!video || !window.confirm(`Delete “${video.title}” and its uploaded file? This cannot be undone.`)) return;
  try {
    const response = await fetch(`/api/my/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete video.');
    myVideos = myVideos.filter(item => String(item.id) !== String(videoId));
    uploadedVideos = uploadedVideos.filter(item => String(item.id) !== String(videoId));
    libraryData.history = libraryData.history.filter(item => String(item.id) !== String(videoId));
    libraryData.liked = libraryData.liked.filter(item => String(item.id) !== String(videoId));
    libraryData.watchLater = libraryData.watchLater.filter(item => String(item.id) !== String(videoId));
    libraryData.playlists.forEach(list => { list.videos = list.videos.filter(item => String(item.id) !== String(videoId)); });
    renderDashboard(); await loadVideos(true);
  } catch (error) { window.alert(connectionMessage(error)); }
}
function closeVideoMenus(except = null) {
  document.querySelectorAll('.video-card-menu').forEach(menu => {
    if (menu === except) return;
    menu.closest('.video-card,.dashboard-video-entry')?.classList.remove('menu-open');
    menu.querySelector('.video-menu-panel')?.classList.add('hidden');
    menu.querySelector('.video-menu-toggle')?.setAttribute('aria-expanded', 'false');
  });
}
function toggleVideoMenu(button) {
  const wrapper = button.closest('.video-card-menu');
  const panel = wrapper.querySelector('.video-menu-panel');
  const isOpening = panel.classList.contains('hidden');
  closeVideoMenus(wrapper);
  panel.classList.toggle('hidden', !isOpening);
  wrapper.closest('.video-card,.dashboard-video-entry')?.classList.toggle('menu-open', isOpening);
  button.setAttribute('aria-expanded', String(isOpening));
}
async function refreshLibrary() {
  const response = await fetch('/api/me/library');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not refresh your library.');
  libraryData = result;
  renderDashboard();
  renderVideos();
}
async function performVideoMenuAction(button) {
  const action = button.dataset.videoMenuAction;
  const video = findVideo(button.dataset.videoId);
  if (!video) return;
  closeVideoMenus();
  const ownsVideo = Boolean(currentUser && !video.sample && Number(video.userId) === Number(currentUser.id));
  if (action === 'signin') { setAuthMode('login'); return; }
  if (action === 'edit') { if (ownsVideo) openEditVideo(video.id); return; }
  if (action === 'delete') { if (ownsVideo) await deleteMyVideo(video.id); return; }
  if (action === 'share') {
    const shareUrl = new URL(`/watch.html?v=${encodeURIComponent(video.id)}`, location.origin);
    try {
      await navigator.clipboard.writeText(shareUrl.href);
      showAppToast('Video link copied.');
    } catch {
      window.prompt('Copy this video link:', shareUrl.href);
    }
    return;
  }
  if (action === 'new-playlist') {
    dashboardTab = 'playlists';
    await showDashboard();
    $('#newPlaylistButton').click();
    return;
  }
  if (!currentUser) { setAuthMode('login'); return; }

  try {
    if (action === 'like' || action === 'watch-later') {
      const collectionKey = action === 'like' ? 'liked' : 'watchLater';
      const existing = libraryData[collectionKey].some(item => String(item.id) === String(video.id));
      const endpoint = action === 'like' ? 'like' : 'watch-later';
      const response = await fetch(`/api/videos/${encodeURIComponent(video.id)}/${endpoint}`, { method: existing ? 'DELETE' : 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update this video.');
      await refreshLibrary();
      showAppToast(existing ? 'Removed from your saved videos.' : 'Saved to your account.');
    } else if (action === 'playlist') {
      const playlistId = button.dataset.playlistId;
      const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/videos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.id })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not add this video to the playlist.');
      await refreshLibrary();
      showAppToast('Added to playlist.');
    } else if (action === 'remove-playlist') {
      const response = await fetch(`/api/playlists/${encodeURIComponent(button.dataset.playlistId)}/videos/${encodeURIComponent(video.id)}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not remove this video from the playlist.');
      await refreshLibrary();
      showAppToast('Removed from playlist.');
    }
  } catch (error) { showAppToast(connectionMessage(error), true); }
}
function openSettings() {
  $('#settingsName').value = currentUser?.name || '';
  $('#settingsBio').value = currentUser?.bio || '';
  $('#settingsEmail').value = currentUser?.email || '';
  $('#settingsPasswordForm').reset();
  $('#settingsPasswordError').textContent = '';
  $('#settingsPhoto').value = '';
  $('#settingsError').textContent = '';
  $('#settingsUserId').textContent = currentUser?.id ?? '—';
  $('#removeProfilePhoto').classList.toggle('hidden', !currentUser?.profilePhotoUrl);
  if (settingsPhotoPreviewUrl) URL.revokeObjectURL(settingsPhotoPreviewUrl);
  settingsPhotoPreviewUrl = null;
  renderUserAvatar($('#settingsPhotoPreview'), currentUser);
  settingsDialog.showModal();
}
$('#closeSettings').addEventListener('click', () => settingsDialog.close());
$('#settingsPhoto').addEventListener('change', event => {
  const photo = event.currentTarget.files?.[0];
  if (!photo) return;
  if (photo.size > 5 * 1024 * 1024) {
    event.currentTarget.value = '';
    $('#settingsError').textContent = 'Choose an image smaller than 5 MB.';
    return;
  }
  if (settingsPhotoPreviewUrl) URL.revokeObjectURL(settingsPhotoPreviewUrl);
  settingsPhotoPreviewUrl = URL.createObjectURL(photo);
  $('#settingsPhotoPreview').innerHTML = `<img src="${settingsPhotoPreviewUrl}" alt="Preview of your new profile photo">`;
  $('#settingsError').textContent = '';
});
$('#removeProfilePhoto').addEventListener('click', async () => {
  $('#settingsError').textContent = '';
  try {
    const response = await fetch('/api/me/profile-photo', { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not remove your profile photo.');
    currentUser = result.user;
    updateAccount();
    $('#settingsPhoto').value = '';
    $('#removeProfilePhoto').classList.add('hidden');
    renderUserAvatar($('#settingsPhotoPreview'), currentUser);
    showAppToast('Profile photo removed.');
  } catch (error) { $('#settingsError').textContent = connectionMessage(error); }
});
$('#settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('#settingsError').textContent = '';
  try {
    const formData = new FormData(event.currentTarget);
    const photo = formData.get('photo');
    if (!(photo instanceof File) || !photo.size) formData.delete('photo');
    const response = await fetch('/api/me/profile', { method: 'PUT', body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save account settings.');
    currentUser = result.user;
    updateAccount();
    if (settingsPhotoPreviewUrl) URL.revokeObjectURL(settingsPhotoPreviewUrl);
    settingsPhotoPreviewUrl = null;
    $('#settingsPhoto').value = '';
    settingsDialog.close();
    showAppToast('Profile settings saved.');
  } catch (error) { $('#settingsError').textContent = connectionMessage(error); }
});
$('#settingsPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $('#settingsPasswordError');
  const currentPassword = form.elements.currentPassword.value;
  const newPassword = form.elements.newPassword.value;
  const confirmPassword = form.elements.confirmPassword.value;
  errorBox.textContent = '';
  if (newPassword !== confirmPassword) {
    errorBox.textContent = 'The new passwords do not match.';
    return;
  }
  if (newPassword === currentPassword) {
    errorBox.textContent = 'Choose a new password that differs from your current password.';
    return;
  }
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/me/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not change your password.');
    form.reset();
    showAppToast('Password changed successfully.');
  } catch (error) {
    errorBox.textContent = connectionMessage(error);
  } finally {
    submitButton.disabled = false;
  }
});
function openEditPlaylist(playlistId) {
  const playlist = libraryData.playlists.find(item => String(item.id) === String(playlistId));
  if (!playlist) return;
  const form = $('#editPlaylistForm');
  form.elements.playlistId.value = playlist.id;
  form.elements.name.value = playlist.name;
  form.elements.description.value = playlist.description || '';
  $('#editPlaylistError').textContent = '';
  editPlaylistDialog.showModal();
}
$('#closeEditPlaylist').addEventListener('click', () => editPlaylistDialog.close());
$('#editPlaylistForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget));
  const playlistId = form.playlistId;
  delete form.playlistId;
  $('#editPlaylistError').textContent = '';
  try {
    const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update playlist.');
    libraryData.playlists = libraryData.playlists.map(list => String(list.id) === String(playlistId) ? { ...list, ...result.playlist } : list);
    renderDashboard(); editPlaylistDialog.close();
  } catch (error) { $('#editPlaylistError').textContent = connectionMessage(error); }
});
async function deletePlaylist(playlistId) {
  const playlist = libraryData.playlists.find(item => String(item.id) === String(playlistId));
  if (!playlist || !window.confirm(`Delete the playlist “${playlist.name}”? Videos in it will not be deleted.`)) return;
  try {
    const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not delete playlist.');
    libraryData.playlists = libraryData.playlists.filter(list => String(list.id) !== String(playlistId));
    if (dashboardTab === `playlist:${playlistId}`) dashboardTab = 'playlists';
    renderDashboard();
  } catch (error) { window.alert(connectionMessage(error)); }
}
function renderDashboard() {
  $('#dashboardCount').textContent = myVideos.length;
  const container = $('#dashboardVideos');
  const headings = {
    videos: ['YOUR LIBRARY', 'Your videos'], history: ['YOUR ACTIVITY', 'Watch history'],
    liked: ['YOUR COLLECTIONS', 'Liked videos'], watchLater: ['YOUR COLLECTIONS', 'Watch later'],
    playlists: ['YOUR COLLECTIONS', 'Playlists'], playlist: ['YOUR PLAYLIST', 'Playlist videos']
  };
  const playlistDetail = dashboardTab.startsWith('playlist:');
  const headingKey = playlistDetail ? 'playlist' : dashboardTab;
  $('#dashboardSectionEyebrow').textContent = headings[headingKey][0];
  $('#dashboardSectionHeading').textContent = playlistDetail ? libraryData.playlists.find(list => String(list.id) === dashboardTab.split(':')[1])?.name || 'Playlist' : headings[headingKey][1];
  $('#newPlaylistButton').classList.toggle('hidden', dashboardTab !== 'playlists');
  document.querySelectorAll('[data-library-view]').forEach(button => button.classList.toggle('selected', button.dataset.libraryView === dashboardTab || (playlistDetail && button.dataset.libraryView === 'playlists')));

  if (dashboardTab === 'playlists' && !playlistDetail) {
    const lists = libraryData.playlists;
    if (!lists.length) {
      container.innerHTML = '<div class="dashboard-empty"><span>☷</span><strong>No playlists yet.</strong><p>Create one, then add videos to build a collection.</p></div>';
      return;
    }
    container.innerHTML = lists.map(list => `<article class="playlist-tile"><button class="playlist-card" data-dashboard-playlist="${escapeHtml(list.id)}"><span class="playlist-card-icon">☷</span><strong>${escapeHtml(list.name)}</strong><small>${list.videos.length} ${list.videos.length === 1 ? 'video' : 'videos'}</small></button><div class="dashboard-card-actions"><button type="button" data-edit-playlist="${escapeHtml(list.id)}">Edit</button><button type="button" data-delete-playlist="${escapeHtml(list.id)}">Delete</button></div></article>`).join('');
    return;
  }

  let videos = myVideos;
  if (dashboardTab === 'history') videos = libraryData.history;
  if (dashboardTab === 'liked') videos = libraryData.liked;
  if (dashboardTab === 'watchLater') videos = libraryData.watchLater;
  if (playlistDetail) videos = libraryData.playlists.find(list => String(list.id) === dashboardTab.split(':')[1])?.videos || [];
  if (!videos.length) {
    const emptyText = dashboardTab === 'videos' ? ['Your first video starts here.', 'Upload a video and add a few tags so people can find it.'] : ['Nothing here yet.', 'Videos you save or watch will show up here.'];
    container.innerHTML = `<div class="dashboard-empty"><span>✳</span><strong>${emptyText[0]}</strong><p>${emptyText[1]}</p></div>`;
    return;
  }
  container.innerHTML = videos.map(video => {
    const card = `<button class="dashboard-video" data-dashboard-video="${escapeHtml(video.id)}"><span class="dashboard-video-thumb"><img src="${escapeHtml(video.thumbnailUrl || './media/mountain-dawn.jpg')}" alt=""><i>▶</i></span><span class="dashboard-video-copy"><strong>${escapeHtml(video.title)}</strong><small>${escapeHtml(video.creator || 'You')} · ${timeAgo(video.createdAt)} · ${video.tags.map(escapeHtml).join(' · ') || 'No tags'}</small></span></button>`;
    const menu = videoMenuMarkup(video, playlistDetail ? dashboardTab.split(':')[1] : '');
    return `<article class="dashboard-video-entry">${card}${menu}</article>`;
  }).join('');
}
async function loadDashboard() {
  $('#dashboardName').textContent = currentUser?.name.split(' ')[0] || 'creator';
  $('#dashboardVideos').innerHTML = '<div class="dashboard-empty">Loading your videos…</div>';
  try {
    const [videosResponse, libraryResponse] = await Promise.all([fetch('/api/my/videos'), fetch('/api/me/library')]);
    const [videosResult, libraryResult] = await Promise.all([videosResponse.json(), libraryResponse.json()]);
    if (!videosResponse.ok || !libraryResponse.ok) throw new Error(videosResult.error || libraryResult.error || 'Could not load your videos.');
    myVideos = videosResult.videos || [];
    libraryData = libraryResult;
    renderDashboard();
  } catch (error) {
    $('#dashboardVideos').innerHTML = `<div class="dashboard-empty">${escapeHtml(connectionMessage(error))}</div>`;
  }
}
$('#closeUpload').addEventListener('click', () => uploadDialog.close());
$('#videoFile').addEventListener('change', event => { $('#fileName').textContent = event.target.files[0]?.name || 'Choose a video to upload'; });
$('#uploadForm').addEventListener('submit', async event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const title = formElement.elements.title.value.trim();
  const file = formElement.elements.video.files[0];
  const startedAt = Date.now();
  const previousVideoIds = new Set(myVideos.map(video => String(video.id)));
  $('#uploadError').textContent = '';
  const submitButton = formElement.querySelector('[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Uploading…';
  let uploadedVideo = null;
  try {
    const response = await fetch('/api/videos', { method: 'POST', body: new FormData(formElement) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    uploadedVideo = result.video;
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError) {
      try {
        const verifyResponse = await fetch('/api/my/videos', { cache: 'no-store' });
        if (verifyResponse.ok) {
          const verifyResult = await verifyResponse.json();
          uploadedVideo = (verifyResult.videos || []).find(video =>
            !previousVideoIds.has(String(video.id)) && video.title === title &&
            Number(video.fileSize) === Number(file?.size) &&
            new Date(video.createdAt).getTime() >= startedAt - 30000
          ) || null;
        }
      } catch { /* Keep the original error if the follow-up check also cannot reach the server. */ }
    }
    if (!uploadedVideo) {
      $('#uploadError').textContent = error instanceof TypeError || error instanceof SyntaxError
        ? 'We could not confirm the upload. Check My videos before trying again.'
        : error.message || 'Upload failed. Please try again.';
      submitButton.disabled = false;
      submitButton.innerHTML = 'Upload video <span>↗</span>';
      return;
    }
  }

  $('#uploadError').textContent = '';
  showAppToast('Video uploaded successfully.');
  uploadedVideos = [uploadedVideo, ...uploadedVideos.filter(video => String(video.id) !== String(uploadedVideo.id))];
  myVideos = [uploadedVideo, ...myVideos.filter(video => String(video.id) !== String(uploadedVideo.id))];
  formElement.reset();
  $('#fileName').textContent = 'Choose a video to upload';
  uploadDialog.close();
  submitButton.disabled = false;
  submitButton.innerHTML = 'Upload video <span>↗</span>';
  await loadVideos(true);
  await loadDashboard();
});
$('#topicChips').addEventListener('click', event => {
  const button = event.target.closest('[data-tag]'); if (!button) return;
  currentTag = button.dataset.tag;
  document.querySelectorAll('.chip').forEach(chip => chip.classList.toggle('active', chip === button));
  loadVideos(true);
});
$('#searchForm').addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchDebounceTimer); loadVideos(true); });
$('#searchInput').addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => loadVideos(true), 300);
});
function openPlayer(video) {
  if (!video) return;
  location.href = `/watch.html?v=${encodeURIComponent(video.id)}`;
}
function findVideo(id) {
  const collectionVideos = [...libraryData.history, ...libraryData.liked, ...libraryData.watchLater, ...libraryData.playlists.flatMap(list => list.videos || [])];
  return [...uploadedVideos, ...myVideos, ...collectionVideos, ...demoVideos].find(video => String(video.id) === String(id));
}
function openSharedVideoFromHash() {
  const match = location.hash.match(/^#video=(.+)$/);
  if (!match) return;
  let videoId;
  try { videoId = decodeURIComponent(match[1]); } catch { return; }
  if (videoId) location.href = `/watch.html?v=${encodeURIComponent(videoId)}`;
}
window.addEventListener('hashchange', openSharedVideoFromHash);
function updatePlayerActionButtons() {
  $('#playerLike').textContent = playerLiked ? '♥ Liked' : '♡ Like';
  $('#playerLike').classList.toggle('is-active', playerLiked);
  $('#playerWatchLater').textContent = playerSaved ? '✓ Saved' : '＋ Watch later';
  $('#playerWatchLater').classList.toggle('is-active', playerSaved);
}
async function loadPlayerActions() {
  try {
    const response = await fetch('/api/me/library');
    if (!response.ok) return;
    const result = await response.json();
    libraryData = result;
    playerLiked = result.liked.some(video => String(video.id) === String(currentPlayerVideo.id));
    playerSaved = result.watchLater.some(video => String(video.id) === String(currentPlayerVideo.id));
    $('#playlistSelect').innerHTML = '<option value="">Add to playlist…</option>' + result.playlists.map(list => `<option value="${escapeHtml(list.id)}">${escapeHtml(list.name)}</option>`).join('');
    updatePlayerActionButtons();
  } catch { /* Video playback remains available if collection loading fails. */ }
}
async function changePlayerCollection(action, active) {
  if (!currentUser || !currentPlayerVideo || currentPlayerVideo.sample) return;
  const endpoint = `/api/videos/${encodeURIComponent(currentPlayerVideo.id)}/${action}`;
  try {
    const response = await fetch(endpoint, { method: active ? 'POST' : 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update your collection.');
    if (action === 'like') playerLiked = active;
    else playerSaved = active;
    updatePlayerActionButtons();
    $('#playerActionMessage').textContent = active ? 'Saved to your account.' : 'Removed from your account.';
    const responseAgain = await fetch('/api/me/library');
    if (responseAgain.ok) { libraryData = await responseAgain.json(); renderDashboard(); }
  } catch (error) { $('#playerActionMessage').textContent = connectionMessage(error); }
}
$('#playerLike').addEventListener('click', () => changePlayerCollection('like', !playerLiked));
$('#playerWatchLater').addEventListener('click', () => changePlayerCollection('watch-later', !playerSaved));
$('#addToPlaylist').addEventListener('click', async () => {
  const playlistId = $('#playlistSelect').value;
  if (!playlistId || !currentPlayerVideo) return;
  try {
    const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/videos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: currentPlayerVideo.id }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not add video to playlist.');
    $('#playerActionMessage').textContent = 'Added to playlist.';
    const refresh = await fetch('/api/me/library');
    if (refresh.ok) { libraryData = await refresh.json(); renderDashboard(); }
  } catch (error) { $('#playerActionMessage').textContent = connectionMessage(error); }
});
async function saveWatchHistory(completed = false) {
  if (!currentUser || !currentPlayerVideo || currentPlayerVideo.sample || !Number.isFinite(Number(currentPlayerVideo.id))) return;
  const seconds = $('#playerVideo').currentTime || 0;
  try {
    await fetch(`/api/videos/${encodeURIComponent(currentPlayerVideo.id)}/history`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchSeconds: seconds, completed })
    });
    lastHistoryUpdate = Date.now();
  } catch { /* Keep playback working when history cannot be saved. */ }
}
$('#playerVideo').addEventListener('play', () => saveWatchHistory());
$('#playerVideo').addEventListener('timeupdate', () => { if (Date.now() - lastHistoryUpdate > 12000) saveWatchHistory(); });
$('#playerVideo').addEventListener('ended', () => saveWatchHistory(true));
grid.addEventListener('click', event => {
  const menuToggle = event.target.closest('.video-menu-toggle');
  if (menuToggle) { event.preventDefault(); event.stopPropagation(); toggleVideoMenu(menuToggle); return; }
  const menuAction = event.target.closest('[data-video-menu-action]');
  if (menuAction) { event.preventDefault(); event.stopPropagation(); performVideoMenuAction(menuAction); return; }
  const card = event.target.closest('[data-video-id]'); if (!card) return;
  openPlayer(findVideo(card.dataset.videoId));
});
$('#dashboardVideos').addEventListener('click', event => {
  const menuToggle = event.target.closest('.video-menu-toggle');
  if (menuToggle) { event.preventDefault(); event.stopPropagation(); toggleVideoMenu(menuToggle); return; }
  const menuAction = event.target.closest('[data-video-menu-action]');
  if (menuAction) { event.preventDefault(); event.stopPropagation(); performVideoMenuAction(menuAction); return; }
  const editVideo = event.target.closest('[data-edit-video]');
  if (editVideo) { openEditVideo(editVideo.dataset.editVideo); return; }
  const deleteVideo = event.target.closest('[data-delete-video]');
  if (deleteVideo) { deleteMyVideo(deleteVideo.dataset.deleteVideo); return; }
  const editPlaylist = event.target.closest('[data-edit-playlist]');
  if (editPlaylist) { openEditPlaylist(editPlaylist.dataset.editPlaylist); return; }
  const deleteList = event.target.closest('[data-delete-playlist]');
  if (deleteList) { deletePlaylist(deleteList.dataset.deletePlaylist); return; }
  const removePlaylistVideo = event.target.closest('[data-remove-playlist-video]');
  if (removePlaylistVideo) {
    const { playlistId, removePlaylistVideo: videoId } = removePlaylistVideo.dataset;
    fetch(`/api/playlists/${encodeURIComponent(playlistId)}/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not remove video from playlist.');
      const playlist = libraryData.playlists.find(list => String(list.id) === String(playlistId));
      if (playlist) playlist.videos = playlist.videos.filter(video => String(video.id) !== String(videoId));
      renderDashboard();
    }).catch(error => window.alert(connectionMessage(error)));
    return;
  }
  const playlist = event.target.closest('[data-dashboard-playlist]');
  if (playlist) { dashboardTab = `playlist:${playlist.dataset.dashboardPlaylist}`; renderDashboard(); return; }
  const item = event.target.closest('[data-dashboard-video]'); if (!item) return;
  openPlayer(findVideo(item.dataset.dashboardVideo));
});
$('#closePlayer').addEventListener('click', () => { $('#playerVideo').pause(); playerDialog.close(); });
playerDialog.addEventListener('close', () => { $('#playerVideo').pause(); });
async function restoreSession() {
  try { const response = await fetch('/api/me'); const result = await response.json(); currentUser = result.user; } catch { currentUser = null; }
  updateAccount();
  if (currentUser) await showDashboard();
  else if (new URLSearchParams(location.search).get('signin') === '1') setAuthMode('login');
}
restoreSession();
loadVideos(true);
