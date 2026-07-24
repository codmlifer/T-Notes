const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');
const { chromium } = require("playwright");

let mainWindow;
let context = null;
let page = null;

const userDir = () => app.getPath('userData');
const dataFile = () => path.join(userDir(), 'notes.json');
const dbFile = () => path.join(userDir(), 'notes.db.json'); // "DB" mode is a separate JSON file with indexed structure
const settingsFile = () => path.join(userDir(), 'settings.json');
const attachDir = () => {
  const p = path.join(userDir(), 'attachments');
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
};

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getSettings() {
  return readJson(settingsFile(), { storage: 'file' }); // 'file' | 'db'
}
function saveSettings(s) {
  writeJson(settingsFile(), s);
  return s;
}

function currentStore() {
  const s = getSettings();
  const file = s.storage === 'db' ? dbFile() : dataFile();
  const shape = s.storage === 'db'
    ? { version: 1, storage: 'db', notes: [], index: {} }
    : { version: 1, storage: 'file', notes: [] };
  const data = readJson(file, shape);
  if (!data.notes) data.notes = [];
  return { file, data, mode: s.storage };
}

function saveStore(file, data, mode) {
  if (mode === 'db') {
    // rebuild simple word index
    const index = {};
    for (const n of data.notes) {
      const words = (n.title + ' ' + n.content).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
      for (const w of words) {
        if (!index[w]) index[w] = [];
        if (!index[w].includes(n.id)) index[w].push(n.id);
      }
    }
    data.index = index;
    data.storage = 'db';
  } else {
    data.storage = 'file';
  }
  writeJson(file, data);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    center: true,
    darkTheme: true,
    disableAutoHideCursor: true,
    hasShadow: true,
    icon: path.join(__dirname, 'icon.ico'),
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
}

function openWebSite(url) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(url);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ---------- IPC ----------

ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:set', (_e, s) => saveSettings(s));

ipcMain.handle('notes:list', () => {
  const { data } = currentStore();
  return data.notes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});

ipcMain.handle('notes:save', (_e, note) => {
  const { file, data, mode } = currentStore();
  const now = Date.now();
  if (note.id) {
    const idx = data.notes.findIndex(n => n.id === note.id);
    if (idx >= 0) {
      data.notes[idx] = { ...data.notes[idx], ...note, updatedAt: now };
    } else {
      data.notes.push({ ...note, createdAt: now, updatedAt: now });
    }
  } else {
    note.id = 'n_' + now + '_' + Math.random().toString(36).slice(2, 8);
    note.createdAt = now;
    note.updatedAt = now;
    data.notes.push(note);
  }
  saveStore(file, data, mode);
  return note;
});

ipcMain.handle('notes:delete', (_e, id) => {
  const { file, data, mode } = currentStore();
  const note = data.notes.find(n => n.id === id);
  if (note && note.attachments) {
    for (const a of note.attachments) {
      try { fs.unlinkSync(a.path); } catch {}
    }
  }
  data.notes = data.notes.filter(n => n.id !== id);
  saveStore(file, data, mode);
  return true;
});

ipcMain.handle('notes:search', (_e, query) => {
  const { data, mode } = currentStore();
  const q = (query || '').trim().toLowerCase();
  if (!q) return data.notes;
  if (mode === 'db' && data.index) {
    const words = q.match(/[\p{L}\p{N}]+/gu) || [];
    if (words.length) {
      const idSets = words.map(w => {
        const ids = new Set();
        for (const key of Object.keys(data.index)) {
          if (key.includes(w)) data.index[key].forEach(id => ids.add(id));
        }
        return ids;
      });
      const intersect = [...idSets[0]].filter(id => idSets.every(s => s.has(id)));
      return data.notes.filter(n => intersect.includes(n.id));
    }
  }
  return data.notes.filter(n =>
    (n.title || '').toLowerCase().includes(q) ||
    (n.content || '').toLowerCase().includes(q)
  );
});

// Attachments: user picks file(s); we copy to userData/attachments
ipcMain.handle('attach:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All files', extensions: ['*'] },
      { name: 'Images', extensions: ['png','jpg','jpeg','gif','webp','bmp'] },
    ],
  });
  if (res.canceled) return [];
  const out = [];
  for (const src of res.filePaths) {
    const base = path.basename(src);
    const dest = path.join(attachDir(), Date.now() + '_' + base);
    fs.copyFileSync(src, dest);
    const stat = fs.statSync(dest);
    const ext = path.extname(base).toLowerCase().slice(1);
    const isImage = ['png','jpg','jpeg','gif','webp','bmp'].includes(ext);
    out.push({
      name: base,
      path: dest,
      size: stat.size,
      type: isImage ? 'image' : 'file',
      ext,
    });
  }
  return out;
});

ipcMain.handle('attach:open', (_e, filePath) => shell.openPath(filePath));
ipcMain.handle('attach:reveal', (_e, filePath) => shell.showItemInFolder(filePath));

ipcMain.handle('attach:readImage', (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
});

// Web search via DuckDuckGo Instant Answer API + related topics
function httpsJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'MyNotes/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function closeParser() {
    if (context) {
        await context.close();
        context = null;
        page = null;
    }
}
async function parseWeb(url) {
    if (!context) {
        context = await chromium.launchPersistentContext("./profile", {
            headless: true,
            viewport: { width: 1366, height: 768 },
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
        });

        page = context.pages()[0] || await context.newPage();
    }

    await page.goto(url, {
        waitUntil: "domcontentloaded"
    });

    //Google
    // await page.waitForSelector("div.MjjYud", {
    //     timeout: 10000
    // });
    //DuckDuckGo
    await page.waitForSelector(".react-results--main", {
        timeout: 10000
    });

    const results = await page.evaluate(() => {
      //Google
        // return [...document.querySelectorAll("div.MjjYud")].map(item => ({
        //     title: item.querySelector("h3")?.textContent ?? "",
        //     url: item.querySelector("a")?.href ?? "",
        //     description: item.querySelector(".VwiC3b")?.textContent ?? ""
        // })).filter(r => r.url);
      //DukDuckGo
        return [...document.querySelectorAll("li[data-layout='organic']")].map(item => ({
            title: item.querySelector("h2")?.textContent ?? "",
            url: item.querySelector("h2 a[data-handled-by-react='true']")?.href ?? "",
            description: item.querySelector("div[data-result='snippet'] span")?.textContent ?? ""
        })).filter(r => r.url);
    });

    return results;
}

ipcMain.handle('web:search', async (_e, query) => {
  const q = encodeURIComponent(query);
  try {
    const ddg = await httpsJson(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`);
    const results = [];
    if (ddg.AbstractText) {
      results.push({
        title: ddg.Heading || query,
        description: ddg.AbstractText,
        url: ddg.AbstractURL || '',
        source: ddg.AbstractSource || 'DuckDuckGo',
      });
    }
    const walk = (arr) => {
      for (const t of arr || []) {
        if (t.Topics) walk(t.Topics);
        else if (t.Text) {
          results.push({
            title: t.Text.split(' - ')[0],
            description: t.Text,
            url: t.FirstURL || '',
            source: 'DuckDuckGo',
          });
        }
      }
    };
    walk(ddg.RelatedTopics);

    // Wikipedia fallback / enrichment
    try {
      const wiki = await httpsJson(`https://uk.wikipedia.org/api/rest_v1/page/summary/${q}`);
      if (wiki && wiki.extract) {
        results.unshift({
          title: wiki.title,
          description: wiki.extract,
          url: wiki.content_urls?.desktop?.page || '',
          source: 'Wikipedia',
        });
      }

    } catch {}

    try {
      const web = await parseWeb(`https://duckduckgo.com/?q=${q}&chip-select=search&ia=web`) //https://www.google.com/search?q=${q}
      if (web) {
        for (const r of web) {
          results.push({
            title: r.title,
            description: r.description,
            url: r.url || '',
            source: 'Google',
          });
        }
      }
    } catch {}

    return results.slice(0, 15);
  } catch (e) {
    return [{ title: 'Search error', description: String(e.message || e), url: '', source: '' }];
  }
});

ipcMain.handle('web:open', (_e, url) => {
  //shell.openExternal(url)
  openWebSite(url);
});

ipcMain.handle('storage:info', () => {
  const s = getSettings();
  return {
    mode: s.storage,
    file: s.storage === 'db' ? dbFile() : dataFile(),
    attachments: attachDir(),
  };
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});
