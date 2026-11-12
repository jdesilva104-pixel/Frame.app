async function loadAdminOverview() {
  const response = await fetch('/api/admin/overview');
  if (response.status === 401 || response.status === 403) {
    window.location.replace('/admin/login');
    return;
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load admin information.');
  const metrics = [
    ['users', '#adminUsers'], ['activeUsers', '#adminActiveUsers'], ['videos', '#adminVideos'],
    ['comments', '#adminComments'], ['suspended', '#adminSuspended'], ['limited', '#adminLimited'],
    ['openReports', '#adminOpenReports']
  ];
  const missing = [];
  for (const [field, selector] of metrics) {
    const value = data[field];
    const count = Number(value);
    if (value === undefined || value === null || !Number.isFinite(count)) {
      document.querySelector(selector).textContent = '—';
      missing.push(field);
    } else {
      document.querySelector(selector).textContent = count.toLocaleString();
    }
  }
  document.querySelector('#adminLoadError').textContent = missing.length
    ? 'Some dashboard totals are missing from the backend. Restart with “npm start”, then hard refresh the page (Ctrl+F5).'
    : '';
}

loadAdminOverview().catch(error => {
  document.querySelector('#adminLoadError').textContent = error.message || 'Could not load the admin dashboard.';
});

const adminLists = {
  users: { offset: 0, total: 0, search: '', list: '#userList', status: '#userListStatus', more: '#userLoadMore', endpoint: '/api/admin/users' },
  videos: { offset: 0, total: 0, search: '', creatorId: '', list: '#videoList', status: '#videoListStatus', more: '#videoLoadMore', endpoint: '/api/admin/videos' },
  comments: { offset: 0, total: 0, search: '', list: '#commentList', status: '#commentListStatus', more: '#commentLoadMore', endpoint: '/api/admin/comments' },
  reports: { offset: 0, total: 0, statusFilter: 'open', list: '#reportList', status: '#reportListStatus', more: '#reportLoadMore', endpoint: '/api/admin/reports' }
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function loadAdminList(type, append = false) {
  const config = adminLists[type];
  const list = document.querySelector(config.list);
  const status = document.querySelector(config.status);
  const more = document.querySelector(config.more);
  if (!append) {
    config.offset = 0;
    list.replaceChildren();
    status.textContent = 'Loading…';
  }
  const params = new URLSearchParams({ search: config.search, limit: '20', offset: String(config.offset) });
  if (type === 'videos' && config.creatorId) params.set('creatorId', config.creatorId);
  if (type === 'reports') { params.delete('search'); params.set('status', config.statusFilter); }
  try {
    const response = await fetch(`${config.endpoint}?${params}`);
    if (response.status === 401 || response.status === 403) return window.location.replace('/admin/login');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load this list.');
    config.total = data.total;
    const records = data[type] || data.reports || [];
    for (const record of records) {
      const rendered = type === 'users' ? renderUser(record) : type === 'videos' ? renderVideo(record) : type === 'comments' ? renderComment(record) : renderReport(record);
      list.append(rendered);
    }
    config.offset += records.length;
    status.textContent = records.length ? `Showing ${config.offset} of ${config.total}` : (config.total ? 'No more results.' : `No ${type} found.`);
    more.hidden = config.offset >= config.total;
  } catch (error) {
    status.textContent = error.message || 'The server could not be reached.';
    more.hidden = true;
  }
}

function renderUser(user) {
  const row = element('article', 'admin-record');
  const details = element('div', 'admin-record-details');
  const title = element('strong', 'admin-record-title', user.name || 'Unnamed user');
  const meta = element('span', 'admin-record-meta', `${user.email} · User #${user.id} · ${user.video_count} videos · Joined ${new Date(user.created_at).toLocaleDateString()}`);
  const stateLabel = user.isAdmin ? 'Administrator · Protected' : (user.isSuspended ? 'Suspended' : 'Active');
  const state = element('span', user.isAdmin ? 'admin-status admin-status-protected' : (user.isSuspended ? 'admin-status admin-status-suspended' : 'admin-status'), stateLabel);
  const restrictions = element('span', 'admin-record-meta', [user.isLimited ? 'Limited interactions' : '', user.uploadsBlocked ? 'Uploads blocked' : '', user.commentsBlocked ? 'Comments blocked' : ''].filter(Boolean).join(' · ') || 'No restrictions');
  details.append(title, meta, state, restrictions);
  const extra = element('div', 'admin-user-details');
  const photo = user.profilePhotoUrl ? element('img', 'admin-user-photo') : null;
  if (photo) { photo.src = user.profilePhotoUrl; photo.alt = `${user.name}'s profile photo`; }
  const bio = element('span', 'admin-record-meta', `Bio: ${user.bio || 'No bio'}`);
  const active = element('span', 'admin-record-meta', `Last active: ${user.last_active_at ? new Date(user.last_active_at).toLocaleString() : 'No recorded activity yet'}`);
  if (photo) extra.append(photo);
  extra.append(bio, active); extra.hidden = true; details.append(extra);
  const actions = element('div', 'admin-record-actions');
  const profileLink = element('a', 'admin-button admin-action', 'View profile');
  profileLink.href = `/creator.html?id=${encodeURIComponent(user.id)}`;
  profileLink.target = '_blank'; profileLink.rel = 'noopener';
  const detailsButton = element('button', 'admin-button admin-action', 'View details');
  detailsButton.type = 'button';
  detailsButton.addEventListener('click', () => { extra.hidden = !extra.hidden; detailsButton.textContent = extra.hidden ? 'View details' : 'Hide details'; });
  if (user.isAdmin) {
    actions.append(element('span', 'admin-record-meta', 'Admin account controls are protected'));
    actions.prepend(profileLink, detailsButton);
    row.append(details, actions);
    return row;
  }
  const suspend = element('button', 'admin-button admin-action', user.isSuspended ? 'Reactivate' : 'Suspend');
  suspend.type = 'button'; suspend.dataset.action = 'suspension'; suspend.dataset.id = user.id; suspend.dataset.suspended = String(!user.isSuspended);
  const limit = element('button', 'admin-button admin-action', user.isLimited ? 'Remove limit' : 'Limit');
  limit.type = 'button'; limit.dataset.action = 'restriction'; limit.dataset.id = user.id;
  limit.dataset.limited = String(!user.isLimited); limit.dataset.uploadsBlocked = String(user.uploadsBlocked); limit.dataset.commentsBlocked = String(user.commentsBlocked);
  const uploads = element('button', 'admin-button admin-action', user.uploadsBlocked ? 'Allow uploads' : 'Block uploads');
  uploads.type = 'button'; uploads.dataset.action = 'restriction'; uploads.dataset.id = user.id;
  uploads.dataset.limited = String(user.isLimited); uploads.dataset.uploadsBlocked = String(!user.uploadsBlocked); uploads.dataset.commentsBlocked = String(user.commentsBlocked);
  const comments = element('button', 'admin-button admin-action', user.commentsBlocked ? 'Allow comments' : 'Block comments');
  comments.type = 'button'; comments.dataset.action = 'restriction'; comments.dataset.id = user.id;
  comments.dataset.limited = String(user.isLimited); comments.dataset.uploadsBlocked = String(user.uploadsBlocked); comments.dataset.commentsBlocked = String(!user.commentsBlocked);
  const remove = element('button', 'admin-button admin-action admin-danger', 'Delete account');
  remove.type = 'button'; remove.dataset.action = 'delete-user'; remove.dataset.id = user.id;
  actions.append(profileLink, detailsButton, suspend, limit, uploads, comments, remove); row.append(details, actions);
  return row;
}

function renderRecentUser(user) {
  const row = element('article', 'admin-record');
  const details = element('div', 'admin-record-details');
  const registered = user.created_at ? new Date(user.created_at).toLocaleString() : 'Registration date unavailable';
  details.append(
    element('strong', 'admin-record-title', user.name || 'Unnamed user'),
    element('span', 'admin-record-meta', `${user.email} · User #${user.id} · Joined ${registered} · ${user.video_count} videos`),
    element('span', user.isSuspended ? 'admin-status admin-status-suspended' : 'admin-status', user.isAdmin ? 'Administrator' : (user.isSuspended ? 'Suspended' : 'Active'))
  );
  const actions = element('div', 'admin-record-actions');
  const profile = element('a', 'admin-button admin-action', 'View profile');
  profile.href = `/creator.html?id=${encodeURIComponent(user.id)}`;
  profile.target = '_blank'; profile.rel = 'noopener';
  actions.append(profile);
  row.append(details, actions);
  return row;
}

async function loadRecentUsers() {
  const list = document.querySelector('#recentUserList');
  const status = document.querySelector('#recentUserListStatus');
  try {
    const response = await fetch('/api/admin/users/recent?limit=6');
    if (response.status === 401 || response.status === 403) return window.location.replace('/admin/login');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load recently registered users.');
    list.replaceChildren(...data.users.map(renderRecentUser));
    if (!data.users.length) list.append(element('div', 'admin-record-meta', 'No user accounts have registered yet.'));
    status.textContent = data.users.length ? `Showing the ${data.users.length} newest accounts` : '';
  } catch (error) {
    list.replaceChildren(element('div', 'admin-record-meta', error.message || 'Could not load recently registered users.'));
    status.textContent = '';
  }
}

function renderComment(comment) {
  const row = element('article', 'admin-record');
  const details = element('div', 'admin-record-details');
  details.append(element('strong', 'admin-record-title', `Comment #${comment.id} · ${comment.authorName}`));
  details.append(element('span', 'admin-record-meta', `${comment.authorEmail} · On “${comment.videoTitle}” · ${new Date(comment.createdAt).toLocaleString()} · ${comment.openReports} open reports`));
  details.append(element('span', 'admin-record-description', comment.content));
  const actions = element('div', 'admin-record-actions');
  const remove = element('button', 'admin-button admin-action admin-danger', 'Delete comment');
  remove.type = 'button'; remove.dataset.action = 'delete-comment'; remove.dataset.id = comment.id;
  actions.append(remove); row.append(details, actions);
  return row;
}

function renderReport(report) {
  const row = element('article', 'admin-record');
  const details = element('div', 'admin-record-details');
  details.append(element('strong', 'admin-record-title', `${report.targetType[0].toUpperCase()}${report.targetType.slice(1)} report #${report.id} · ${report.targetLabel}`));
  details.append(element('span', 'admin-record-meta', `${report.reason} · Reported by ${report.reporterName} (${report.reporterEmail}) · ${new Date(report.createdAt).toLocaleString()}`));
  if (report.targetText) details.append(element('span', 'admin-record-description', report.targetText));
  if (report.details) details.append(element('span', 'admin-record-description', `Report details: ${report.details}`));
  if (report.relatedVideoId) {
    const view = element('a', 'admin-button admin-action admin-open', 'Open reported video');
    view.href = `/watch.html?v=${encodeURIComponent(report.relatedVideoId)}`; view.target = '_blank'; view.rel = 'noopener';
    details.append(view);
  }
  const actions = element('div', 'admin-record-actions');
  const status = document.createElement('select'); status.className = 'admin-visibility'; status.dataset.action = 'report-status'; status.dataset.id = report.id;
  for (const value of ['open', 'reviewing', 'resolved', 'dismissed']) {
    const option = element('option', '', value[0].toUpperCase() + value.slice(1)); option.value = value; option.selected = report.status === value; status.append(option);
  }
  const note = document.createElement('input'); note.className = 'admin-report-note'; note.type = 'text'; note.maxLength = 1000;
  note.placeholder = 'Optional moderator note'; note.value = report.adminNote || ''; note.dataset.reportNote = report.id;
  const save = element('button', 'admin-button admin-action', 'Save review');
  save.type = 'button'; save.dataset.action = 'save-report'; save.dataset.id = report.id;
  actions.append(status, note, save);
  if ((report.targetType === 'video' || report.targetType === 'comment') && report.targetId) {
    const remove = element('button', 'admin-button admin-action admin-danger', report.targetType === 'video' ? 'Delete video' : 'Delete comment');
    remove.type = 'button'; remove.dataset.action = 'delete-reported-content'; remove.dataset.id = report.targetId; remove.dataset.type = report.targetType;
    actions.append(remove);
  }
  if (report.targetType === 'user' && report.targetId && !report.targetSuspended) {
    const suspend = element('button', 'admin-button admin-action admin-danger', 'Suspend reported user');
    suspend.type = 'button'; suspend.dataset.action = 'suspend-reported-user'; suspend.dataset.id = report.targetId;
    actions.append(suspend);
  }
  row.append(details, actions);
  return row;
}

function renderVideo(video) {
  const row = element('article', 'admin-record');
  const details = element('div', 'admin-record-details');
  const title = element('strong', 'admin-record-title', video.title || 'Untitled video');
  const meta = element('span', 'admin-record-meta', `Video #${video.id} · By ${video.creatorName} (${video.creatorEmail}) · ${Number(video.viewCount).toLocaleString()} views · ${new Date(video.createdAt).toLocaleDateString()}`);
  const description = element('span', 'admin-record-description', video.description || 'No description');
  const visibility = element('span', 'admin-record-meta', `Visibility: ${video.visibility}`);
  details.append(title, meta, description, visibility);
  const actions = element('div', 'admin-record-actions');
  const open = element('a', 'admin-button admin-action admin-open', 'Open video');
  open.href = video.videoUrl; open.target = '_blank'; open.rel = 'noopener';
  const remove = element('button', 'admin-button admin-action admin-danger', 'Delete video');
  remove.type = 'button'; remove.dataset.action = 'delete-video'; remove.dataset.id = video.id;
  const visibilitySelect = document.createElement('select');
  visibilitySelect.className = 'admin-visibility'; visibilitySelect.dataset.action = 'visibility'; visibilitySelect.dataset.id = video.id;
  for (const value of ['public', 'hidden', 'private']) {
    const option = element('option', '', value[0].toUpperCase() + value.slice(1)); option.value = value; option.selected = value === video.visibility; visibilitySelect.append(option);
  }
  visibilitySelect.setAttribute('aria-label', `Visibility for ${video.title}`);
  actions.append(open, visibilitySelect, remove); row.append(details, actions);
  return row;
}

document.querySelector('#userSearchButton').addEventListener('click', () => {
  adminLists.users.search = document.querySelector('#userSearch').value.trim();
  loadAdminList('users');
});
document.querySelector('#videoSearchButton').addEventListener('click', () => {
  adminLists.videos.search = document.querySelector('#videoSearch').value.trim();
  adminLists.videos.creatorId = document.querySelector('#videoCreatorFilter').value;
  loadAdminList('videos');
});
document.querySelector('#commentSearchButton').addEventListener('click', () => {
  adminLists.comments.search = document.querySelector('#commentSearch').value.trim();
  loadAdminList('comments');
});
document.querySelector('#analyticsPeriod').addEventListener('change', loadAnalytics);
document.querySelector('#reportStatusFilter').addEventListener('change', event => {
  adminLists.reports.statusFilter = event.target.value;
  loadAdminList('reports');
});
for (const [inputId, buttonId] of [['userSearch', 'userSearchButton'], ['videoSearch', 'videoSearchButton']]) {
  document.querySelector(`#${inputId}`).addEventListener('keydown', event => {
    if (event.key === 'Enter') document.querySelector(`#${buttonId}`).click();
  });
}
document.querySelector('#commentSearch').addEventListener('keydown', event => {
  if (event.key === 'Enter') document.querySelector('#commentSearchButton').click();
});
document.querySelector('#userLoadMore').addEventListener('click', () => loadAdminList('users', true));
document.querySelector('#videoLoadMore').addEventListener('click', () => loadAdminList('videos', true));
document.querySelector('#commentLoadMore').addEventListener('click', () => loadAdminList('comments', true));
document.querySelector('#reportLoadMore').addEventListener('click', () => loadAdminList('reports', true));

async function handleAdminAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const isUser = action === 'suspension' || action === 'restriction' || action === 'delete-user' || action === 'suspend-reported-user';
  const type = isUser ? 'users' : action === 'save-report' ? 'reports' : (action === 'delete-comment' || (action === 'delete-reported-content' && button.dataset.type === 'comment')) ? 'comments' : 'videos';
  let url = `/api/admin/${type}/${id}`;
  let method = 'DELETE';
  let body;
  if (action === 'suspension') {
    const suspended = button.dataset.suspended === 'true';
    if (!window.confirm(`${suspended ? 'Suspend' : 'Reactivate'} this account? ${suspended ? 'The user will lose access immediately.' : 'The user will be able to sign in again.'}`)) return;
    method = 'PATCH'; url += '/suspension'; body = { suspended };
  } else if (action === 'suspend-reported-user') {
    if (!window.confirm('Suspend this reported account? The user will lose access immediately.')) return;
    method = 'PATCH'; url += '/suspension'; body = { suspended: true };
  } else if (action === 'restriction') {
    method = 'PATCH'; url += '/restrictions';
    body = { limited: button.dataset.limited === 'true', uploadsBlocked: button.dataset.uploadsBlocked === 'true', commentsBlocked: button.dataset.commentsBlocked === 'true' };
  } else if (action === 'save-report') {
    method = 'PATCH';
    const row = button.closest('.admin-record');
    body = { status: row.querySelector('[data-action="report-status"]').value, adminNote: row.querySelector('[data-report-note]').value };
  } else if (action === 'delete-reported-content') {
    const targetType = button.dataset.type;
    url = `/api/admin/${targetType === 'comment' ? 'comments' : 'videos'}/${id}`;
    if (!window.confirm(`Permanently delete this reported ${targetType}?`)) return;
  } else {
    const target = action === 'delete-user' ? 'This permanently deletes the account, its videos, comments, and uploaded files.' : action === 'delete-comment' ? 'This permanently deletes the comment and its replies.' : 'This permanently deletes this video and its comments and reactions.';
    if (!window.confirm(`${target} Continue?`)) return;
  }
  button.disabled = true;
  try {
    const response = await fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    if (response.status === 401 || response.status === 403) return window.location.replace('/admin/login');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Action failed.');
    const reloads = [loadAdminList(type), loadAdminOverview()];
    if (action === 'suspend-reported-user') reloads.push(loadAdminList('reports'));
    if (action === 'delete-reported-content') reloads.push(loadAdminList('reports'));
    if (action === 'delete-comment') reloads.push(loadAdminList('reports'));
    await Promise.all(reloads);
  } catch (error) {
    window.alert(error.message || 'The server could not be reached.');
    button.disabled = false;
  }
}
document.querySelector('#userList').addEventListener('click', handleAdminAction);
document.querySelector('#videoList').addEventListener('click', handleAdminAction);
document.querySelector('#commentList').addEventListener('click', handleAdminAction);
document.querySelector('#reportList').addEventListener('click', handleAdminAction);
document.querySelector('#videoList').addEventListener('change', async event => {
  const select = event.target.closest('select[data-action="visibility"]');
  if (!select) return;
  select.disabled = true;
  try {
    const response = await fetch(`/api/admin/videos/${select.dataset.id}/visibility`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility: select.value })
    });
    const result = await response.json();
    if (response.status === 401 || response.status === 403) return window.location.replace('/admin/login');
    if (!response.ok) throw new Error(result.error || 'Could not update video visibility.');
    await loadAdminList('videos');
  } catch (error) {
    window.alert(error.message || 'The server could not be reached.');
    await loadAdminList('videos');
  }
});

async function loadCreatorOptions() {
  const select = document.querySelector('#videoCreatorFilter');
  try {
    const response = await fetch('/api/admin/creators');
    if (response.status === 401 || response.status === 403) return window.location.replace('/admin/login');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load uploaders.');
    for (const creator of data.creators) {
      const label = `${creator.name} · ${creator.email} · ${creator.videoCount} videos${creator.isAdmin ? ' · admin' : ''}${creator.isSuspended ? ' · suspended' : ''}`;
      const option = element('option', '', label); option.value = String(creator.id); select.append(option);
    }
  } catch (error) {
    document.querySelector('#videoListStatus').textContent = error.message || 'Could not load uploader filters.';
  }
}

function addSummaryMetric(container, label, value) {
  const item = element('div', 'admin-analytics-metric');
  item.append(element('span', '', label), element('strong', '', Number(value).toLocaleString()));
  container.append(item);
}

function renderAnalyticsChart(series) {
  const chart = document.querySelector('#analyticsChart');
  chart.replaceChildren();
  const legend = element('div', 'admin-chart-legend');
  for (const [name, className] of [['Uploads', 'uploads'], ['Comments', 'comments'], ['Removed comments', 'moderated'], ['New users', 'users']]) {
    const entry = element('span', `admin-chart-key admin-chart-${className}`, name);
    legend.append(entry);
  }
  chart.append(legend);
  const maxValue = Math.max(1, ...series.flatMap(day => [day.uploads, day.comments, day.moderated_comments, day.new_users].map(Number)));
  for (const day of series) {
    const row = element('div', 'admin-chart-day');
    row.append(element('span', 'admin-chart-date', new Date(`${day.day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
    for (const [field, className] of [['uploads', 'uploads'], ['comments', 'comments'], ['moderated_comments', 'moderated'], ['new_users', 'users']]) {
      const value = Number(day[field]) || 0;
      const track = element('div', `admin-chart-track admin-chart-${className}`);
      const bar = element('span', 'admin-chart-bar');
      bar.style.width = `${value ? Math.max(1, value / maxValue * 100) : 0}%`;
      track.append(bar);
      const count = element('span', 'admin-chart-count', String(value));
      row.append(track, count);
    }
    chart.append(row);
  }
}

async function loadAnalytics() {
  const period = document.querySelector('#analyticsPeriod').value;
  const summary = document.querySelector('#analyticsSummary');
  try {
    const response = await fetch(`/api/admin/analytics?days=${encodeURIComponent(period)}`);
    if (response.status === 401 || response.status === 403) return window.location.replace('/admin/login');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load analytics.');
    summary.replaceChildren();
    addSummaryMetric(summary, 'Active in last 5 minutes', data.totals.activeUsers);
    addSummaryMetric(summary, 'Uploads in period', data.series.reduce((sum, day) => sum + Number(day.uploads), 0));
    addSummaryMetric(summary, 'Comments today', data.totals.commentsToday);
    addSummaryMetric(summary, 'Reported comments awaiting review', data.totals.commentsReported);
    addSummaryMetric(summary, 'Comments removed in period', data.totals.commentsRemoved);
    renderAnalyticsChart(data.series);
  } catch (error) {
    summary.textContent = error.message || 'Could not load analytics.';
  }
}

async function loadSystemStatus() {
  const badge = document.querySelector('#systemStatus');
  const details = document.querySelector('#systemDetails');
  const checked = document.querySelector('#systemCheckedAt');
  try {
    const response = await fetch('/api/admin/status');
    if (response.status === 401 || response.status === 403) return window.location.replace('/admin/login');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Status check failed.');
    badge.classList.toggle('is-degraded', data.status !== 'operational');
    badge.querySelector('strong').textContent = data.status === 'operational' ? 'Operational' : 'Degraded';
    checked.textContent = `Updated ${new Date(data.checkedAt).toLocaleTimeString()}`;
    details.replaceChildren(
      element('span', '', `Backend: ${data.status === 'operational' ? 'online' : 'degraded'}`),
      element('span', '', `Database: ${data.database}`),
      element('span', '', `Upload storage: ${data.uploads}`),
      element('span', '', `Server uptime: ${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor(data.uptimeSeconds % 3600 / 60)}m`)
    );
  } catch (error) {
    badge.classList.add('is-degraded');
    badge.querySelector('strong').textContent = 'Unavailable';
    checked.textContent = error.message || 'Could not reach the server.';
  }
}

loadAdminList('users');
loadAdminList('videos');
loadAdminList('comments');
loadAdminList('reports');
loadRecentUsers();
loadCreatorOptions();
loadAnalytics();
loadSystemStatus();
window.setInterval(loadSystemStatus, 15000);
window.setInterval(() => { loadAdminOverview().catch(error => { document.querySelector('#adminLoadError').textContent = error.message || 'Could not refresh platform totals.'; }); loadAnalytics(); loadRecentUsers(); }, 60000);

document.querySelector('#adminLogout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.assign('/admin/login');
});

const passwordForm = document.querySelector('#adminPasswordForm');
passwordForm.addEventListener('submit', async event => {
  event.preventDefault();
  const errorBox = document.querySelector('#adminPasswordError');
  const currentPassword = passwordForm.elements.currentPassword.value;
  const newPassword = passwordForm.elements.newPassword.value;
  const confirmPassword = passwordForm.elements.confirmPassword.value;
  errorBox.textContent = '';
  errorBox.classList.remove('admin-success');
  if (newPassword !== confirmPassword) {
    errorBox.textContent = 'The new passwords do not match.';
    return;
  }
  const button = passwordForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch('/api/admin/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update the admin password.');
    passwordForm.reset();
    errorBox.classList.add('admin-success');
    errorBox.textContent = 'Admin password updated.';
  } catch (error) {
    errorBox.classList.remove('admin-success');
    errorBox.textContent = error.message || 'The server could not be reached.';
  } finally {
    button.disabled = false;
  }
});
