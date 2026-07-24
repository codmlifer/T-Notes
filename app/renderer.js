const $ = (id) => document.getElementById(id);
const _ = (tag) => document.getElementsByTagName(tag)[0];
const state = {
  notes: [],
  currentId: null,
  tab: 'local',
  editing: null, // {id?, title, content, attachments:[]}
};

// --- Init ---
async function init() {
  await refreshStorageBadge();
  await loadNotes();
  bindEvents();
}

async function refreshStorageBadge() {
  const info = await window.api.storage.info();
  $('storageBadge').textContent = info.mode === 'db' ? 'Mode: Database' : 'Mode: File';
}

async function loadNotes() {
  state.notes = await window.api.notes.list();
  renderNotes();
}

function renderNotes() {
  const list = $('notesList');
  const q = $('searchInput').value.trim().toLowerCase();
  const filtered = q
    ? state.notes.filter(n =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.content || '').toLowerCase().includes(q))
    : state.notes;

  if (!filtered.length) {
    list.innerHTML = '<p class="muted" style="padding:12px;text-align:center;">No notes</p>';
    return;
  }
  list.innerHTML = filtered.map(n => `
    <div class="note-item ${n.id === state.currentId ? 'active' : ''}" data-id="${n.id}">
      <h3>${escapeHtml(n.title || 'No Title')}</h3>
      <p>${escapeHtml((n.content || '').slice(0, 120))}</p>
      <div class="meta">
        <span>${new Date(n.updatedAt).toLocaleString('uk-UA')}</span>
        <span>${(n.attachments || []).length ? '📎 ' + n.attachments.length : ''}</span>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.note-item').forEach(el => {
    el.addEventListener('click', () => openNote(el.dataset.id));
  });
}

function openNote(id) {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  state.currentId = id;
  state.editing = JSON.parse(JSON.stringify(n));
  renderEditor();
  renderNotes();
}

function newNote() {
  state.currentId = null;
  state.editing = { title: '', content: '', attachments: [] };
  renderEditor();
  renderNotes();
  $('noteTitle').focus();
  _('title').innerText = '*New Note';
}

function changedNote() {
  $('changed').textContent = '*';
  $('saveBtn').classList.remove("no-active");
  _('title').innerText = '*' + _('title').innerText;
}

function renderEditor() {
  if (!state.editing) {
    $('editorInner').classList.add('hidden');
    $('emptyState').classList.remove('hidden');
    return;
  }
  $('editorInner').classList.remove('hidden');
  $('emptyState').classList.add('hidden');
  $('noteTitle').value = state.editing.title || '';
  $('noteContent').value = state.editing.content || '';
  $('noteMeta').textContent = state.editing.updatedAt
    ? 'Updated: ' + new Date(state.editing.updatedAt).toLocaleString('uk-UA')
    : 'New note';
  $('deleteBtn').style.display = state.editing.id ? '' : 'none';
  renderAttachments();
  _('title').innerText = state.editing.title;
}

async function renderAttachments() {
  const box = $('attachments');
  const atts = state.editing.attachments || [];
  box.innerHTML = '';
  for (let i = 0; i < atts.length; i++) {
    const a = atts[i];
    const el = document.createElement('div');
    el.className = 'attach';
    if (a.type === 'image') {
      const dataUrl = await window.api.attach.readImage(a.path);
      el.innerHTML = `<img src="${dataUrl}" alt="${escapeHtml(a.name)}" /><span>${escapeHtml(a.name)}</span><button class="rm">✕</button>`;
    } else {
      el.innerHTML = `<span>📄 ${escapeHtml(a.name)}</span><button class="rm">✕</button>`;
    }
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('rm')) {
        state.editing.attachments.splice(i, 1);
        renderAttachments();
      } else {
        window.api.attach.open(a.path);
      }
    });
    box.appendChild(el);
  }
}

async function saveNote() {
  state.editing.title = $('noteTitle').value.trim();
  state.editing.content = $('noteContent').value;
  if (!state.editing.title && !state.editing.content && !(state.editing.attachments||[]).length) {
    alert('An empty note will not be saved');
    return;
  }
  const saved = await window.api.notes.save(state.editing);
  state.currentId = saved.id;
  await loadNotes();
  openNote(saved.id);

  $('changed').textContent = '';
  $('saveBtn').classList.add("no-active");
  _('title').innerText = state.editing.title;
}

async function deleteNote() {
  if (!state.editing?.id) return;
  if (!confirm('Delete this note?')) return;
  await window.api.notes.delete(state.editing.id);
  state.currentId = null;
  state.editing = null;
  renderEditor();
  await loadNotes();
}

async function attachFiles() {
  const files = await window.api.attach.pick();
  if (!files.length) return;
  state.editing.attachments = [...(state.editing.attachments || []), ...files];
  renderAttachments();
  $('saveBtn').classList.remove("no-active");
  $('changed').textContent = '*';
}

// --- Web search ---
async function webSearch() {
  const q = $('searchInput').value.trim();
  const box = $('webList');
  if (!q) { box.innerHTML = '<p class="muted" style="padding:12px;text-align:center;">Enter a query</p>'; return; }
  box.innerHTML = '<p class="muted" style="padding:12px;text-align:center;">Searching...</p>';
  const results = await window.api.web.search(q);
  console.log(results);
  if (!results.length) {
    box.innerHTML = '<p class="muted" style="padding:12px;text-align:center;">Not Found</p>';
    return;
  }
  box.innerHTML = results.map((r, i) => `
    <div class="web-item">
      <h3 data-i="${i}" url="${r.url}">${escapeHtml(r.title)}</h3>
      <p>${escapeHtml(r.description)}</p>
      <div class="src">${escapeHtml(r.source)}${r.url ? ' · open ↗' : ''}</div>
    </div>
  `).join('');
  box.querySelectorAll('.web-item h3').forEach(h => {
    h.addEventListener('click', (t) => {
      console.log(t)
      //const r = results[+h.dataset.i];
      if (t.target.getAttribute("url")) window.api.web.open(t.target.getAttribute("url"));
    });
  });
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('notesList').classList.toggle('hidden', tab !== 'local');
  $('webList').classList.toggle('hidden', tab !== 'web');
  $('searchInput').placeholder = tab === 'local' ? 'Search notes...' : 'Search the web (Enter)...';
  if (tab === 'web' && !$('webList').innerHTML) {
    $('webList').innerHTML = '<p class="muted" style="padding:12px;text-align:center;">Enter a query and press Enter</p>';
  }
}

// --- Settings ---
async function openSettings() {
  const s = await window.api.settings.get();
  const info = await window.api.storage.info();
  document.querySelectorAll('input[name="storage"]').forEach(r => {
    r.checked = r.value === s.storage;
  });
  $('storagePath').textContent = 'File: ' + info.file;
  $('settingsModal').classList.remove('hidden');
}
async function saveSettingsFromModal() {
  const val = document.querySelector('input[name="storage"]:checked')?.value || 'file';
  await window.api.settings.set({ storage: val });
  $('settingsModal').classList.add('hidden');
  await refreshStorageBadge();
  await loadNotes();
  state.currentId = null;
  state.editing = null;
  renderEditor();
}

function bindEvents() {
  $('newNoteBtn').addEventListener('click', newNote);
  $('newNoteA').addEventListener('click', newNote);
  $('noteContent').addEventListener('input', changedNote);
  $('saveBtn').addEventListener('click', saveNote);
  $('deleteBtn').addEventListener('click', deleteNote);
  $('attachBtn').addEventListener('click', attachFiles);
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsCancel').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('minimizeBtn').addEventListener('click', () => window.api.window.minimize());
  $('maximizeBtn').addEventListener('click', () => window.api.window.maximize());
  $('closeBtn').addEventListener('click', () => window.api.window.close());
  $('settingsSave').addEventListener('click', saveSettingsFromModal);
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('searchInput').addEventListener('input', () => {
    if (state.tab === 'local') renderNotes();
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.tab === 'web') webSearch();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (state.editing) saveNote();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      newNote();
    }
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

init();
