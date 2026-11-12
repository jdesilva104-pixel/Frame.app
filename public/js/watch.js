const $ = selector => document.querySelector(selector);
const videoId = new URLSearchParams(location.search).get('v');
const sampleVideos = [
  { id: 'sample-1', title: 'A softer kind of morning', description: 'Watching the day wake up above the clouds.', tags: ['nature', 'travel'], creator: 'Maya Ellis', thumbnailUrl: './media/mountain-dawn.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-2', title: 'The long way home', description: 'Took a turn I had never taken before.', tags: ['travel', 'everyday'], creator: 'Jonah Reed', thumbnailUrl: './media/coast-road.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-3', title: 'Where the water slows down', description: 'A quiet afternoon, nowhere to be.', tags: ['nature', 'everyday'], creator: 'Anika Bose', thumbnailUrl: './media/forest-river.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-4', title: 'A table for the whole afternoon', description: 'Fresh bread, a sunny window, and no rush.', tags: ['food', 'everyday'], creator: 'Leo Park', thumbnailUrl: './media/supper-table.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-5', title: 'Golden hour, one more time', description: 'The last light made everything glow.', tags: ['travel', 'nature'], creator: 'Sofia Lane', thumbnailUrl: './media/golden-hour.jpg', videoUrl: './media/forest-aerial.mp4', sample: true },
  { id: 'sample-6', title: 'A little room to breathe', description: 'A small walk through a very big world.', tags: ['nature', 'music'], creator: 'Theo James', thumbnailUrl: './media/green-hills.jpg', videoUrl: './media/forest-aerial.mp4', sample: true }
];
let currentUser = null;
let watchData = null;
let comments = [];
let sortOrder = 'newest';
let toastTimer;
let sampleMode = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function showToast(message, error = false) {
  const toast = $('#watchToast');
  toast.textContent = message;
  toast.classList.toggle('watch-toast-error', error);
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 4500);
}
function signIn() {
  const returnTo = `${location.pathname}${location.search}`;
  location.href = `/?signin=1&return=${encodeURIComponent(returnTo)}`;
}
function initials(name = 'Frame creator') {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
}
function ago(date) {
  const elapsed = Math.max(0, Date.now() - new Date(date).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function number(value) { return new Intl.NumberFormat().format(Number(value) || 0); }
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}
function updateWatchPage() {
  const { video, stats, viewer } = watchData;
  $('#videoTitle').textContent = video.title;
  $('#creatorName').textContent = video.creator || 'Frame creator';
  $('#creatorAvatar').innerHTML = video.creatorPhotoUrl
    ? `<img src="${escapeHtml(video.creatorPhotoUrl)}" alt="${escapeHtml(video.creator || 'Creator')}'s profile photo">`
    : escapeHtml(initials(video.creator));
  const creatorProfileLink = $('#creatorProfileLink');
  if (video.userId && !sampleMode) {
    creatorProfileLink.href = `/creator.html?id=${encodeURIComponent(video.userId)}`;
    creatorProfileLink.removeAttribute('aria-disabled');
  } else {
    creatorProfileLink.href = '#';
    creatorProfileLink.setAttribute('aria-disabled', 'true');
  }
  $('#subscriberCount').textContent = `${number(stats.subscribers)} ${stats.subscribers === 1 ? 'subscriber' : 'subscribers'}`;
  $('#viewCount').textContent = `${number(stats.views)} ${stats.views === 1 ? 'view' : 'views'}`;
  $('#publishedAt').textContent = ago(video.createdAt);
  $('#dislikeCount').textContent = `${number(stats.dislikes)} dislikes`;
  $('#likeCount').textContent = number(stats.likes);
  $('#videoDescription').textContent = video.description || 'No description provided.';
  $('#videoTags').innerHTML = video.tags.map(tag => `<span class="tag-pill">${escapeHtml(tag)}</span>`).join('');
  $('#likeButton').classList.toggle('is-active', viewer.reaction === 'like');
  $('#dislikeButton').classList.toggle('is-active', viewer.reaction === 'dislike');
  $('#watchLaterButton').classList.toggle('is-active', viewer.saved);
  $('#watchLaterButton').innerHTML = viewer.saved ? '▣ <span>Saved</span>' : '▣ <span>Watch later</span>';
  $('#subscribeButton').classList.toggle('is-subscribed', viewer.subscribed);
  $('#subscribeButton').textContent = viewer.subscribed ? 'Subscribed' : 'Subscribe';
  $('#subscribeButton').classList.toggle('hidden', watchData.isOwner || sampleMode);
  $('.watch-reaction-group').classList.toggle('hidden', sampleMode);
  $('#watchLaterButton').classList.toggle('hidden', sampleMode);
  $('#ownerLabel').classList.toggle('hidden', !watchData.isOwner);
  $('#commentsSettings').classList.toggle('hidden', !watchData.isOwner);
  $('#commentsToggle').setAttribute('aria-pressed', String(video.commentsEnabled));
  $('#commentsToggleText').textContent = video.commentsEnabled ? 'On' : 'Off';
  $('#commentsToggle').disabled = false;
  $('#manageVideoLink').classList.toggle('hidden', !watchData.isOwner);
  $('#reportVideoButton').classList.toggle('hidden', !currentUser || watchData.isOwner || sampleMode);
  $('#reportCreatorButton').classList.toggle('hidden', !currentUser || watchData.isOwner || sampleMode);
  const poster = video.thumbnailUrl || '';
  $('#watchVideo').poster = poster;
  $('#watchVideo').src = video.videoUrl;
  $('#downloadButton').href = video.videoUrl;
  $('#downloadButton').download = `${video.title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'frame-video'}`;
  document.title = `${video.title} · Frame`;
  $('#watchAccountButton').textContent = currentUser ? 'Dashboard' : 'Sign in';
  $('#viewerAvatar').innerHTML = currentUser?.profilePhotoUrl
    ? `<img src="${escapeHtml(currentUser.profilePhotoUrl)}" alt="">`
    : escapeHtml(currentUser ? initials(currentUser.name) : '?');
}
async function loadWatchData() {
  const session = await jsonRequest('/api/me').catch(() => ({ user: null }));
  currentUser = session.user;
  try {
    watchData = await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}`);
  } catch (error) {
    const sample = sampleVideos.find(video => video.id === videoId);
    if (!sample) throw error;
    sampleMode = true;
    watchData = {
      video: { ...sample, userId: null, viewCount: 0, commentsEnabled: false, createdAt: new Date().toISOString() },
      stats: { views: 0, likes: 0, dislikes: 0, subscribers: 0 },
      viewer: { reaction: null, saved: false, subscribed: false }, isOwner: false
    };
  }
  updateWatchPage();
}
async function recordView() {
  if (sampleMode) return;
  try {
    const result = await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}/view`, { method: 'POST' });
    watchData.stats.views = result.views;
    $('#viewCount').textContent = `${number(result.views)} ${result.views === 1 ? 'view' : 'views'}`;
  } catch { /* The video can still be watched if view tracking is unavailable. */ }
}
async function loadComments() {
  if (sampleMode) { renderComments(); return; }
  try {
    const result = await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}/comments?sort=${encodeURIComponent(sortOrder)}`);
    comments = result.comments || [];
    watchData.video.commentsEnabled = result.commentsEnabled;
    watchData.isOwner = result.isOwner;
    updateWatchPage();
    renderComments();
  } catch (error) {
    $('#commentList').innerHTML = `<div class="comment-loading">${escapeHtml(error.message)}</div>`;
  }
}
function renderComment(comment, replies = []) {
  const ownerActions = watchData.isOwner
    ? `<button type="button" class="comment-heart ${comment.creatorHeart ? 'is-active' : ''}" data-comment-action="heart" data-comment-id="${comment.id}" aria-label="${comment.creatorHeart ? 'Remove creator heart' : 'Heart comment'}">${comment.creatorHeart ? '♥ Creator heart' : '♡ Heart'}</button><button type="button" class="comment-owner-action" data-comment-action="pin" data-comment-id="${comment.id}">${comment.pinned ? 'Unpin' : 'Pin'}</button>` : '';
  const authorAction = comment.canManage ? `<button type="button" data-comment-action="delete" data-comment-id="${comment.id}">Delete</button>` : '';
  const reportAction = currentUser && !comment.isAuthor && !sampleMode ? `<button type="button" data-comment-action="report" data-comment-id="${comment.id}">Report</button>` : '';
  const reactionActions = `<button type="button" class="comment-reaction ${comment.viewerReaction === 'like' ? 'is-active' : ''}" data-comment-action="like" data-comment-id="${comment.id}" aria-label="Like comment">👍 ${number(comment.likes)}</button><button type="button" class="comment-reaction ${comment.viewerReaction === 'dislike' ? 'is-active' : ''}" data-comment-action="dislike" data-comment-id="${comment.id}" aria-label="Dislike comment">👎 ${number(comment.dislikes)}</button>`;
  const replyAction = currentUser && !comment.parentId && (watchData.video.commentsEnabled || watchData.isOwner)
    ? `<button type="button" data-comment-action="reply" data-comment-id="${comment.id}">Reply</button>` : '';
  const replyForm = replyAction ? `<form class="comment-reply-form hidden" data-reply-form data-parent-id="${comment.id}"><span class="watch-avatar">${escapeHtml(initials(currentUser.name))}</span><div class="reply-fields"><textarea name="content" rows="1" maxlength="1500" required placeholder="Write a reply…"></textarea><div class="reply-form-actions"><button type="button" data-comment-action="cancel-reply">Cancel</button><button type="submit">Reply</button></div></div></form>` : '';
  const commentAvatar = comment.authorPhotoUrl ? `<img src="${escapeHtml(comment.authorPhotoUrl)}" alt="">` : escapeHtml(initials(comment.author));
  return `<article class="comment-item" data-comment-id="${comment.id}"><span class="watch-avatar">${commentAvatar}</span><div class="comment-body">${comment.pinned ? '<div class="comment-pinned">⌖ Pinned by creator</div>' : ''}<div class="comment-byline"><strong>${escapeHtml(comment.author)}</strong>${comment.userId === watchData.video.userId ? '<span class="comment-author-badge">Creator</span>' : ''}<time>${escapeHtml(ago(comment.createdAt))}</time></div><p class="comment-text">${escapeHtml(comment.content)}</p>${comment.creatorHeart ? '<div class="comment-pinned">♥ Hearted by creator</div>' : ''}<div class="comment-actions">${reactionActions}${replyAction}${ownerActions}${authorAction}${reportAction}</div>${replyForm}${replies.length ? `<div class="comment-replies">${replies.map(reply => renderComment(reply)).join('')}</div>` : ''}</div></article>`;
}
function renderComments() {
  const enabled = watchData.video.commentsEnabled || watchData.isOwner;
  const topLevel = comments.filter(comment => !comment.parentId);
  const replies = new Map();
  comments.filter(comment => comment.parentId).forEach(comment => {
    const group = replies.get(comment.parentId) || [];
    group.push(comment);
    replies.set(comment.parentId, group);
  });
  $('#commentsHeading').textContent = `${number(comments.length)} ${comments.length === 1 ? 'Comment' : 'Comments'}`;
  $('#commentsCount').textContent = comments.length ? '' : 'Start the conversation';
  $('#commentForm').classList.toggle('hidden', !currentUser || !enabled);
  $('#commentSignin').classList.toggle('hidden', Boolean(currentUser) || !enabled);
  $('#commentsDisabled').classList.toggle('hidden', enabled);
  $('#commentList').innerHTML = topLevel.length
    ? topLevel.map(comment => renderComment(comment, replies.get(comment.id) || [])).join('')
    : `<div class="comment-loading">${sampleMode ? 'Comments are available on creator uploads.' : enabled ? 'No comments yet. Be the first to comment.' : 'No comments are shown.'}</div>`;
}
async function refreshStats() {
  if (sampleMode) return;
  const result = await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}`);
  watchData = result;
  updateWatchPage();
}
async function setReaction(reaction) {
  if (sampleMode) return;
  if (!currentUser) return signIn();
  const next = watchData.viewer.reaction === reaction ? 'none' : reaction;
  try {
    await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}/reaction`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reaction: next })
    });
    await refreshStats();
  } catch (error) { showToast(error.message, true); }
}
async function toggleWatchLater() {
  if (sampleMode) return;
  if (!currentUser) return signIn();
  try {
    const response = await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}/watch-later`, { method: watchData.viewer.saved ? 'DELETE' : 'POST' });
    watchData.viewer.saved = response.saved;
    updateWatchPage();
    showToast(response.saved ? 'Saved to Watch later.' : 'Removed from Watch later.');
  } catch (error) { showToast(error.message, true); }
}
async function toggleSubscription() {
  if (sampleMode) return;
  if (!currentUser) return signIn();
  try {
    const response = await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}/subscribe`, { method: watchData.viewer.subscribed ? 'DELETE' : 'POST' });
    watchData.viewer.subscribed = response.subscribed;
    watchData.stats.subscribers = response.subscribers;
    updateWatchPage();
  } catch (error) { showToast(error.message, true); }
}
async function toggleComments() {
  if (sampleMode) return;
  if (!watchData.isOwner) return;
  const button = $('#commentsToggle');
  button.disabled = true;
  try {
    const response = await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}/comments-settings`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !watchData.video.commentsEnabled })
    });
    watchData.video.commentsEnabled = response.commentsEnabled;
    updateWatchPage();
    await loadComments();
    showToast(response.commentsEnabled ? 'Comments are on.' : 'Comments are off.');
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
}
async function postComment(content, parentId = null) {
  if (sampleMode) return false;
  if (!currentUser) return signIn();
  try {
    await jsonRequest(`/api/videos/${encodeURIComponent(videoId)}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, parentId })
    });
    await loadComments();
    showToast(parentId ? 'Reply posted.' : 'Comment posted.');
    return true;
  } catch (error) { showToast(error.message, true); return false; }
}
async function performCommentAction(button) {
  const { commentAction: action, commentId } = button.dataset;
  const comment = comments.find(item => String(item.id) === String(commentId));
  if (action === 'reply') {
    const form = button.closest('.comment-body').querySelector('[data-reply-form]');
    form?.classList.toggle('hidden');
    form?.querySelector('textarea')?.focus();
    return;
  }
  if (action === 'cancel-reply') { button.closest('[data-reply-form]')?.classList.add('hidden'); return; }
  if (!comment) return;
  try {
    if (action === 'delete') {
      if (!window.confirm('Delete this comment?')) return;
      await jsonRequest(`/api/comments/${comment.id}`, { method: 'DELETE' });
    } else if (action === 'report') {
      await submitReport('comment', comment.id);
      return;
    } else if (action === 'like' || action === 'dislike') {
      if (!currentUser) return signIn();
      const reaction = comment.viewerReaction === action ? 'none' : action;
      await jsonRequest(`/api/comments/${comment.id}/reaction`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reaction })
      });
    } else if (action === 'heart' || action === 'pin') {
      await jsonRequest(`/api/comments/${comment.id}/${action}`, { method: 'POST' });
    }
    await loadComments();
  } catch (error) { showToast(error.message, true); }
}
async function shareVideo() {
  const url = new URL(`/watch.html?v=${encodeURIComponent(videoId)}`, location.origin).href;
  try { await navigator.clipboard.writeText(url); showToast('Video link copied.'); }
  catch { window.prompt('Copy this video link:', url); }
  $('#moreMenu').classList.add('hidden');
  $('#moreButton').setAttribute('aria-expanded', 'false');
}
async function submitReport(targetType, targetId) {
  if (!currentUser) return signIn();
  const reasonInput = window.prompt('Choose a report reason: spam, harassment, inappropriate, violence, copyright, other', 'other');
  if (reasonInput === null) return;
  const reason = reasonInput.trim().toLowerCase();
  if (!['spam', 'harassment', 'inappropriate', 'violence', 'copyright', 'other'].includes(reason)) {
    showToast('Use one of the listed report reasons.', true);
    return;
  }
  const details = window.prompt('Add details for the moderators (optional):', '') || '';
  try {
    await jsonRequest('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType, targetId, reason, details })
    });
    showToast('Report sent to the moderation team.');
    $('#moreMenu').classList.add('hidden');
    $('#moreButton').setAttribute('aria-expanded', 'false');
  } catch (error) { showToast(error.message, true); }
}
async function loadRelatedVideos() {
  try {
    const result = await jsonRequest('/api/videos?limit=12&offset=0');
    const related = [...result.videos, ...sampleVideos].filter(video => String(video.id) !== String(videoId)).slice(0, 8);
    $('#relatedVideos').innerHTML = related.length ? related.map(video => `<button class="related-card" type="button" data-related-id="${escapeHtml(video.id)}"><span class="related-thumb"><img src="${escapeHtml(video.thumbnailUrl || './media/mountain-dawn.jpg')}" alt="" loading="lazy"><span>VIDEO</span></span><span class="related-meta"><strong class="related-title">${escapeHtml(video.title)}</strong><small>${escapeHtml(video.creator)}<br>${number(video.viewCount)} views · ${escapeHtml(ago(video.createdAt || Date.now()))}</small></span></button>`).join('') : '<div class="comment-loading">No more videos yet.</div>';
  } catch { $('#relatedVideos').innerHTML = '<div class="comment-loading">Could not load more videos.</div>'; }
}

$('#watchAccountButton').addEventListener('click', () => { if (currentUser) location.href = '/?dashboard=1'; else signIn(); });
$('#creatorProfileLink').addEventListener('click', event => { if (event.currentTarget.getAttribute('aria-disabled') === 'true') event.preventDefault(); });
$('#likeButton').addEventListener('click', () => setReaction('like'));
$('#dislikeButton').addEventListener('click', () => setReaction('dislike'));
$('#watchLaterButton').addEventListener('click', toggleWatchLater);
$('#subscribeButton').addEventListener('click', toggleSubscription);
$('#shareButton').addEventListener('click', shareVideo);
$('#copyVideoLink').addEventListener('click', shareVideo);
$('#reportVideoButton').addEventListener('click', () => submitReport('video', videoId));
$('#reportCreatorButton').addEventListener('click', () => submitReport('user', watchData?.video.userId));
$('#commentsToggle').addEventListener('click', toggleComments);
$('#commentSort').addEventListener('change', event => { sortOrder = event.target.value; loadComments(); });
$('#commentSigninButton').addEventListener('click', signIn);
$('#moreButton').addEventListener('click', () => {
  const menu = $('#moreMenu');
  const open = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !open);
  $('#moreButton').setAttribute('aria-expanded', String(open));
});
$('#commentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#commentInput');
  const button = $('#postCommentButton');
  button.disabled = true;
  const success = await postComment(input.value);
  if (success) input.value = '';
  button.disabled = false;
});
$('#commentList').addEventListener('click', event => {
  const button = event.target.closest('[data-comment-action]');
  if (button) performCommentAction(button);
});
$('#commentList').addEventListener('submit', async event => {
  const form = event.target.closest('[data-reply-form]');
  if (!form) return;
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const success = await postComment(form.elements.content.value, Number(form.dataset.parentId));
  if (success) form.elements.content.value = '';
  submit.disabled = false;
});
$('#relatedVideos').addEventListener('click', event => {
  const card = event.target.closest('[data-related-id]');
  if (card) location.href = `/watch.html?v=${encodeURIComponent(card.dataset.relatedId)}`;
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.watch-more-wrap')) {
    $('#moreMenu').classList.add('hidden');
    $('#moreButton').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    $('#moreMenu').classList.add('hidden');
    $('#moreButton').setAttribute('aria-expanded', 'false');
  }
});

async function startWatchPage() {
  if (!videoId) { location.href = '/'; return; }
  try {
    await loadWatchData();
    if (sampleMode) $('#commentsDisabled').textContent = 'Comments are available on creator uploads.';
    await Promise.all([recordView(), loadComments(), loadRelatedVideos()]);
  } catch (error) {
    $('#videoTitle').textContent = 'Video unavailable';
    $('#videoError').textContent = error.message || 'Could not load this video.';
    $('#videoError').classList.remove('hidden');
  }
}
startWatchPage();
