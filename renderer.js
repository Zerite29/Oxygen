const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');


const OXYGEN_DIR = path.join(os.homedir(), 'Oxygen');
const SCRIPTS_DIR = path.join(OXYGEN_DIR, 'Scripts');
const AUTOEXEC_DIR = path.join(OXYGEN_DIR, 'AutoExec');

const EXECUTOR_PORTS = {
  Opiumware: { start: 8392, end: 8397 },
  MacSploit: { start: 5553, end: 5563 },
  Hydrogen: { start: 6969, end: 6969 }
};


let tabs = [];
let activeTabId = null;
let currentExecutor = 'MacSploit';
let selectedPort = null;
let portStatuses = {};
let hubSelectedScript = null;
let contextTarget = null;
let autoExecScripts = [];
let monacoReady = false;
let editors = {}; 


const tabsContainer = document.getElementById('tabs-container');
const editorContainer = document.getElementById('editor-container');
const fileTree = document.getElementById('file-tree');
const executorSelect = document.getElementById('executor-select');
const portSelector = document.getElementById('port-selector');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const toast = document.getElementById('toast');
const contextMenu = document.getElementById('context-menu');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const modalInput = document.getElementById('modal-input');


document.getElementById('close-btn')?.addEventListener('click', () => ipcRenderer.send('close-window'));
document.getElementById('minimize-btn')?.addEventListener('click', () => ipcRenderer.send('minimize-window'));
document.getElementById('maximize-btn')?.addEventListener('click', () => ipcRenderer.send('maximize-window'));


function showToast(message, type = '') {
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(() => toast.className = 'toast', 3000);
}


function showModal(title, defaultValue = '') {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalInput.value = defaultValue;
    modalOverlay.classList.add('show');
    modalInput.focus();
    modalInput.select();
    
    const handleOk = () => {
      const value = modalInput.value.trim();
      modalOverlay.classList.remove('show');
      cleanup();
      resolve(value || null);
    };
    
    const handleCancel = () => {
      modalOverlay.classList.remove('show');
      cleanup();
      resolve(null);
    };
    
    const handleKeydown = (e) => {
      if (e.key === 'Enter') handleOk();
      if (e.key === 'Escape') handleCancel();
    };
    
    const cleanup = () => {
      document.getElementById('modal-ok').removeEventListener('click', handleOk);
      document.getElementById('modal-cancel').removeEventListener('click', handleCancel);
      modalInput.removeEventListener('keydown', handleKeydown);
    };
    
    document.getElementById('modal-ok').addEventListener('click', handleOk);
    document.getElementById('modal-cancel').addEventListener('click', handleCancel);
    modalInput.addEventListener('keydown', handleKeydown);
  });
}


document.querySelectorAll('.icon-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    document.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`tab-${tabId}`)?.classList.add('active');
    
    if (tabId === 'autoexec') {
      loadAutoExecList();
    }
  });
});


function initDirectories() {
  [OXYGEN_DIR, SCRIPTS_DIR, AUTOEXEC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  
  
  const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.lua') || f.endsWith('.txt'));
  if (files.length === 0) {
    fs.writeFileSync(path.join(SCRIPTS_DIR, 'Script.lua'), 'print("Hello World!")');
  }
}

function isAutoExec(name) {
  const filePath = path.join(AUTOEXEC_DIR, name);
  return fs.existsSync(filePath);
}

function renderFileTree() {
  const items = [];
  
  function scanDir(dirPath, depth = 0) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath);
    
    const folders = [];
    const files = [];
    
    entries.forEach(name => {
      if (name.startsWith('.')) return;
      const fullPath = path.join(dirPath, name);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isDirectory()) {
          folders.push({ name, path: fullPath });
        } else if (name.endsWith('.lua') || name.endsWith('.txt')) {
          files.push({ name, path: fullPath });
        }
      } catch {}
    });
    
    folders.forEach(folder => {
      items.push({ type: 'folder', name: folder.name, path: folder.path, depth });
      scanDir(folder.path, depth + 1);
    });
    
    files.forEach(file => {
      items.push({ type: 'file', name: file.name, path: file.path, depth });
    });
  }
  
  scanDir(SCRIPTS_DIR);
  
  let html = '';
  let openFolders = JSON.parse(localStorage.getItem('openFolders') || '[]');
  
  items.forEach(item => {
    const indent = item.depth * 16;
    const isOpen = openFolders.includes(item.path);
    const activeTab = tabs.find(t => t.id === activeTabId);
    const isActive = activeTab && activeTab.path === item.path;
    const isAutoExecFile = item.type === 'file' && isAutoExec(item.name);
    
    if (item.type === 'folder') {
      html += `
        <div class="folder-item" style="padding-left: ${indent}px">
          <div class="folder-header${isOpen ? ' open' : ''}" data-path="${item.path}" draggable="true">
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>${item.name}</span>
          </div>
        </div>
      `;
    } else {
      const parentPath = path.dirname(item.path);
      const parentIsOpen = parentPath === SCRIPTS_DIR || openFolders.includes(parentPath);
      if (!parentIsOpen && parentPath !== SCRIPTS_DIR) return;
      
      html += `
        <div class="file-item${isActive ? ' active' : ''}${isAutoExecFile ? ' autoexec' : ''}" data-path="${item.path}" style="padding-left: ${indent + 20}px" draggable="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
          <span>${item.name}</span>
        </div>
      `;
    }
  });
  
  
  html += `<div class="file-tree-dropzone" data-path="${SCRIPTS_DIR}"></div>`;
  
  fileTree.innerHTML = html || '<div style="padding: 12px; color: var(--text-muted); font-size: 12px;">No files yet</div>';
  
  
  document.querySelectorAll('.folder-header').forEach(header => {
    header.addEventListener('click', () => {
      const folderPath = header.dataset.path;
      header.classList.toggle('open');
      
      let openFolders = JSON.parse(localStorage.getItem('openFolders') || '[]');
      if (header.classList.contains('open')) {
        if (!openFolders.includes(folderPath)) openFolders.push(folderPath);
      } else {
        openFolders = openFolders.filter(f => f !== folderPath);
      }
      localStorage.setItem('openFolders', JSON.stringify(openFolders));
      renderFileTree();
    });
    
    header.addEventListener('contextmenu', (e) => showContextMenu(e, header.dataset.path, 'folder'));
    
    
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', header.dataset.path);
      e.dataTransfer.effectAllowed = 'move';
      header.classList.add('dragging');
    });
    
    header.addEventListener('dragend', () => {
      header.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    
    
    header.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      header.classList.add('drag-over');
    });
    
    header.addEventListener('dragleave', () => {
      header.classList.remove('drag-over');
    });
    
    header.addEventListener('drop', (e) => {
      e.preventDefault();
      header.classList.remove('drag-over');
      const sourcePath = e.dataTransfer.getData('text/plain');
      const targetFolder = header.dataset.path;
      moveFileOrFolder(sourcePath, targetFolder);
    });
  });
  
  
  document.querySelectorAll('.file-item').forEach(item => {
    item.addEventListener('click', () => openFile(item.dataset.path));
    item.addEventListener('contextmenu', (e) => showContextMenu(e, item.dataset.path, 'file'));
    
    
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.dataset.path);
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
  });
  
  
  const rootDropzone = document.querySelector('.file-tree-dropzone');
  if (rootDropzone) {
    rootDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      rootDropzone.classList.add('drag-over');
    });
    
    rootDropzone.addEventListener('dragleave', () => {
      rootDropzone.classList.remove('drag-over');
    });
    
    rootDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      rootDropzone.classList.remove('drag-over');
      const sourcePath = e.dataTransfer.getData('text/plain');
      moveFileOrFolder(sourcePath, SCRIPTS_DIR);
    });
  }
}


function moveFileOrFolder(sourcePath, targetFolder) {
  if (!sourcePath || !targetFolder) return;
  if (sourcePath === targetFolder) return;
  
  
  if (targetFolder.startsWith(sourcePath + path.sep)) {
    showToast('Cannot move folder into itself', 'error');
    return;
  }
  
  const fileName = path.basename(sourcePath);
  const newPath = path.join(targetFolder, fileName);
  
  if (sourcePath === newPath) return;
  
  if (fs.existsSync(newPath)) {
    showToast('A file with that name already exists', 'error');
    return;
  }
  
  try {
    fs.renameSync(sourcePath, newPath);
    
    
    tabs.forEach(tab => {
      if (tab.path === sourcePath) {
        tab.path = newPath;
      } else if (tab.path && tab.path.startsWith(sourcePath + path.sep)) {
        tab.path = tab.path.replace(sourcePath, newPath);
      }
    });
    
    renderFileTree();
    renderTabs();
    showToast(`Moved ${fileName}`, 'success');
  } catch (err) {
    showToast('Failed to move: ' + err.message, 'error');
  }
}

function openFile(filePath) {
  const existingTab = tabs.find(t => t.path === filePath);
  if (existingTab) {
    switchTab(existingTab.id);
    return;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const name = path.basename(filePath);
    createTab(name, content, filePath);
  } catch (err) {
    showToast('Failed to open file', 'error');
  }
}


function createTab(name = 'Untitled', content = '-- New script', filePath = null) {
  const id = 'tab_' + Date.now();
  
  const tab = {
    id,
    name,
    content,
    path: filePath,
    modified: false
  };
  
  tabs.push(tab);
  renderTabs();
  createEditorForTab(tab);
  switchTab(id);
  
  return tab;
}

function renderTabs() {
  tabsContainer.innerHTML = tabs.map(tab => `
    <div class="tab${tab.id === activeTabId ? ' active' : ''}${tab.modified ? ' modified' : ''}" data-id="${tab.id}">
      <span class="tab-name">${tab.name.length > 15 ? tab.name.substring(0, 12) + '...' : tab.name}</span>
      <div class="tab-close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </div>
    </div>
  `).join('');
  
  document.querySelectorAll('.tab').forEach(tabEl => {
    tabEl.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close')) {
        switchTab(tabEl.dataset.id);
      }
    });
    
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tabEl.dataset.id);
    });
  });
}

function createEditorForTab(tab) {
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-wrapper';
  wrapper.id = `editor-${tab.id}`;
  
  const monacoContainer = document.createElement('div');
  monacoContainer.className = 'monaco-container';
  monacoContainer.id = `monaco-${tab.id}`;
  wrapper.appendChild(monacoContainer);
  
  editorContainer.appendChild(wrapper);
  
  
  if (monacoReady && typeof monaco !== 'undefined') {
    const editor = monaco.editor.create(monacoContainer, {
      value: tab.content || '-- New script',
      language: 'luau',
      theme: 'oxygen-dark',
      automaticLayout: true,
      autoIndent: 'full',
      formatOnType: true,
      contextmenu: false,
      lineNumbers: 'on',
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'off',
      matchBrackets: 'always',
      autoClosingBrackets: 'languageDefined',
      fontFamily: "'Fira Code', 'SF Mono', 'Monaco', 'Menlo', monospace",
      fontLigatures: true,
      fontSize: 15,
      lineHeight: 22,
      glyphMargin: false,
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 8,
      padding: { top: 12, bottom: 12 },
      cursorStyle: 'line',
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'phase',
      cursorSurroundingLines: 15,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: 'none',
      renderWhitespace: 'none',
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      stickyScroll: { enabled: false },
      scrollbar: {
        verticalScrollbarSize: 0,
        horizontalScrollbarSize: 0,
        useShadows: false
      }
    });
    
    editors[tab.id] = editor;
    
    
    editor.onDidChangeModelContent(() => {
      const currentTab = tabs.find(t => t.id === tab.id);
      if (currentTab) {
        currentTab.content = editor.getValue();
        currentTab.modified = true;
        renderTabs();
      }
      
      
      clearTimeout(editor._saveTimeout);
      editor._saveTimeout = setTimeout(() => {
        const t = tabs.find(t => t.id === tab.id);
        if (t && t.path) saveTab(t);
      }, 2000);
    });
    
    
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveCurrentTab();
    });
    
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      executeCurrentScript();
    });
    
    
    editor.addCommand(monaco.KeyCode.F1, () => {});
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => {});
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {});
    
    
    setTimeout(() => editor.layout(), 0);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        try {
          if (monaco.editor.remeasureFonts) monaco.editor.remeasureFonts();
          editor.layout();
        } catch (_) {}
      });
    }
  }
}

function switchTab(id) {
  activeTabId = id;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.id === id));
  document.querySelectorAll('.editor-wrapper').forEach(e => e.classList.toggle('active', e.id === `editor-${id}`));
  renderFileTree();
  
  
  if (editors[id]) {
    setTimeout(() => editors[id].layout(), 10);
  }
}

function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;
  
  const tab = tabs[index];
  
  if (tab.modified && tab.path) {
    saveTab(tab);
  }
  
  
  if (editors[id]) {
    editors[id].dispose();
    delete editors[id];
  }
  
  tabs.splice(index, 1);
  document.getElementById(`editor-${id}`)?.remove();
  
  if (tabs.length > 0) {
    if (activeTabId === id) {
      switchTab(tabs[Math.max(0, index - 1)].id);
    }
  } else {
    activeTabId = null;
  }
  
  renderTabs();
}

async function saveTab(tab) {
  
  if (editors[tab.id]) {
    tab.content = editors[tab.id].getValue();
  }
  
  if (!tab.path) {
    const name = await showModal('Enter file name', tab.name);
    if (!name) return;
    
    const fileName = name.endsWith('.lua') ? name : name + '.lua';
    tab.path = path.join(SCRIPTS_DIR, fileName);
    tab.name = fileName;
  }
  
  try {
    fs.writeFileSync(tab.path, tab.content);
    tab.modified = false;
    renderTabs();
    renderFileTree();
  } catch (err) {
    showToast('Failed to save: ' + err.message, 'error');
  }
}

function saveCurrentTab() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) saveTab(tab);
}


function highlightLua(code) {
  const keywords = ['local', 'function', 'end', 'if', 'then', 'else', 'elseif', 'for', 'while', 'do', 'repeat', 'until', 'return', 'break', 'in', 'and', 'or', 'not', 'true', 'false', 'nil'];
  const builtins = ['print', 'pairs', 'ipairs', 'tonumber', 'tostring', 'type', 'require', 'wait', 'spawn', 'delay', 'game', 'workspace', 'script', 'Instance', 'Vector3', 'CFrame', 'Color3', 'UDim2', 'Enum', 'task', 'typeof', 'pcall', 'xpcall', 'error', 'warn', 'tick', 'time', 'loadstring'];
  
  let h = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  h = h.replace(/(--\[\[[\s\S]*?\]\])/g, '<span class="comment">$1</span>');
  h = h.replace(/(--.*$)/gm, '<span class="comment">$1</span>');
  h = h.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="string">$1</span>');
  h = h.replace(/('(?:[^'\\]|\\.)*')/g, '<span class="string">$1</span>');
  h = h.replace(/(\[\[[\s\S]*?\]\])/g, '<span class="string">$1</span>');
  h = h.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');
  
  keywords.forEach(kw => {
    h = h.replace(new RegExp(`\\b(${kw})\\b`, 'g'), '<span class="keyword">$1</span>');
  });
  
  builtins.forEach(bi => {
    h = h.replace(new RegExp(`\\b(${bi})\\b`, 'g'), '<span class="function">$1</span>');
  });
  
  return h;
}

function updateHighlighting(textarea, codeEl) {
  codeEl.innerHTML = highlightLua(textarea.value);
}

function updateLineNumbers(container, content) {
  const lines = content.split('\n').length;
  container.innerHTML = Array.from({ length: lines }, (_, i) => `<span>${i + 1}</span>`).join('');
}


function showContextMenu(e, targetPath, type) {
  e.preventDefault();
  contextTarget = { path: targetPath, type };
  
  const isFile = type === 'file';
  const fileName = path.basename(targetPath);
  const isAutoExecFile = isFile && isAutoExec(fileName);
  
  let menuHtml = '';
  
  if (isFile) {
    menuHtml += `<div class="context-item" data-action="open">Open</div>`;
    menuHtml += `<div class="context-separator"></div>`;
    menuHtml += `<div class="context-item" data-action="autoexec">${isAutoExecFile ? 'Remove from Auto-Execute' : 'Add to Auto-Execute'}</div>`;
    menuHtml += `<div class="context-separator"></div>`;
  }
  
  menuHtml += `<div class="context-item" data-action="rename">Rename</div>`;
  menuHtml += `<div class="context-item danger" data-action="delete">Delete</div>`;
  
  contextMenu.innerHTML = menuHtml;
  contextMenu.style.left = `${e.pageX}px`;
  contextMenu.style.top = `${e.pageY}px`;
  contextMenu.classList.add('show');
  
  document.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      if (action === 'open') openFile(contextTarget.path);
      if (action === 'rename') renameItem(contextTarget.path);
      if (action === 'delete') deleteItem(contextTarget.path, contextTarget.type);
      if (action === 'autoexec') toggleAutoExec(contextTarget.path);
      contextMenu.classList.remove('show');
    });
  });
}

document.addEventListener('click', () => contextMenu.classList.remove('show'));

async function renameItem(itemPath) {
  const oldName = path.basename(itemPath);
  const newName = await showModal('Enter new name', oldName);
  if (!newName || newName === oldName) return;
  
  const newPath = path.join(path.dirname(itemPath), newName);
  
  try {
    fs.renameSync(itemPath, newPath);
    
    const tab = tabs.find(t => t.path === itemPath);
    if (tab) {
      tab.path = newPath;
      tab.name = newName;
      renderTabs();
    }
    
    
    const autoExecPath = path.join(AUTOEXEC_DIR, oldName);
    if (fs.existsSync(autoExecPath)) {
      fs.renameSync(autoExecPath, path.join(AUTOEXEC_DIR, newName));
    }
    
    renderFileTree();
    showToast('Renamed!', 'success');
  } catch (err) {
    showToast('Error renaming: ' + err.message, 'error');
  }
}

function deleteItem(itemPath, type) {
  const name = path.basename(itemPath);
  
  try {
    const stats = fs.statSync(itemPath);
    if (stats.isDirectory()) {
      fs.rmSync(itemPath, { recursive: true });
    } else {
      fs.unlinkSync(itemPath);
      
      
      const autoExecPath = path.join(AUTOEXEC_DIR, name);
      if (fs.existsSync(autoExecPath)) {
        fs.unlinkSync(autoExecPath);
      }
    }
    
    const tab = tabs.find(t => t.path === itemPath);
    if (tab) closeTab(tab.id);
    
    renderFileTree();
    showToast('Deleted!', 'success');
  } catch (err) {
    showToast('Error deleting: ' + err.message, 'error');
  }
}


function toggleAutoExec(filePath) {
  const fileName = path.basename(filePath);
  const autoExecPath = path.join(AUTOEXEC_DIR, fileName);
  
  try {
    if (fs.existsSync(autoExecPath)) {
      
      fs.unlinkSync(autoExecPath);
      showToast('Removed from Auto-Execute', 'success');
    } else {
      
      const content = fs.readFileSync(filePath, 'utf-8');
      fs.writeFileSync(autoExecPath, content);
      showToast('Added to Auto-Execute', 'success');
    }
    
    renderFileTree();
    loadAutoExecList();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

function loadAutoExecList() {
  const listEl = document.getElementById('autoexec-list');
  
  try {
    if (!fs.existsSync(AUTOEXEC_DIR)) {
      listEl.innerHTML = '<div class="autoexec-placeholder">No auto-execute scripts</div>';
      return;
    }
    
    const files = fs.readdirSync(AUTOEXEC_DIR).filter(f => f.endsWith('.lua') || f.endsWith('.txt'));
    
    if (files.length === 0) {
      listEl.innerHTML = '<div class="autoexec-placeholder">No auto-execute scripts</div>';
      return;
    }
    
    listEl.innerHTML = files.map(name => `
      <div class="autoexec-item" data-name="${name}">
        <div class="autoexec-name">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
          ${name}
        </div>
        <button class="autoexec-remove" data-name="${name}">Remove</button>
      </div>
    `).join('');
    
    document.querySelectorAll('.autoexec-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = btn.dataset.name;
        const autoExecPath = path.join(AUTOEXEC_DIR, name);
        try {
          fs.unlinkSync(autoExecPath);
          showToast('Removed from Auto-Execute', 'success');
          renderFileTree();
          loadAutoExecList();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = '<div class="autoexec-placeholder">Error loading scripts</div>';
  }
}


document.getElementById('new-file-btn')?.addEventListener('click', async () => {
  const name = await showModal('Enter file name', 'NewScript.lua');
  if (!name) return;
  
  const fileName = name.endsWith('.lua') ? name : name + '.lua';
  const filePath = path.join(SCRIPTS_DIR, fileName);
  
  if (fs.existsSync(filePath)) {
    showToast('File already exists!', 'error');
    return;
  }
  
  try {
    fs.writeFileSync(filePath, '-- New script\n');
    renderFileTree();
    openFile(filePath);
    showToast('File created!', 'success');
  } catch (err) {
    showToast('Error creating file: ' + err.message, 'error');
  }
});

document.getElementById('new-folder-btn')?.addEventListener('click', async () => {
  const name = await showModal('Enter folder name', 'NewFolder');
  if (!name) return;
  
  const folderPath = path.join(SCRIPTS_DIR, name);
  
  if (fs.existsSync(folderPath)) {
    showToast('Folder already exists!', 'error');
    return;
  }
  
  try {
    fs.mkdirSync(folderPath);
    renderFileTree();
    showToast('Folder created!', 'success');
  } catch (err) {
    showToast('Error creating folder: ' + err.message, 'error');
  }
});

document.getElementById('add-tab-btn')?.addEventListener('click', () => {
  createTab();
});


async function executeCurrentScript() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) {
    showToast('No script open!', 'error');
    return;
  }
  
  
  const script = editors[tab.id] ? editors[tab.id].getValue() : tab.content;
  
  setStatus('Executing...', 'connecting');
  
  try {
    const result = await ipcRenderer.invoke('execute-script', {
      script: script,
      port: selectedPort
    });
    
    if (result.success) {
      showToast('Script executed!', 'success');
      setStatus('Connected', 'online');
      
    } else {
      showToast(`Error: ${result.error}`, 'error');
      setStatus('Disconnected', 'offline');
      
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    setStatus('Disconnected', 'offline');
    
  }
  
  setTimeout(updatePortSelector, 1000);
}

document.getElementById('execute-btn')?.addEventListener('click', executeCurrentScript);


document.getElementById('open-roblox-btn')?.addEventListener('click', async () => {
  showToast('Opening Roblox...');
  try {
    await ipcRenderer.invoke('open-roblox');
    showToast('Roblox opened!', 'success');
  } catch (err) {
    showToast('Failed to open Roblox', 'error');
  }
});


async function checkPort(port) {
  try {
    const result = await ipcRenderer.invoke('check-port', port);
    return result.status === 'online';
  } catch {
    return false;
  }
}

async function updatePortSelector() {
  const ports = EXECUTOR_PORTS[currentExecutor];
  let html = '';
  let onlineCount = 0;
  let firstOnlinePort = null;
  
  for (let p = ports.start; p <= ports.end; p++) {
    const isOnline = await checkPort(p);
    portStatuses[p] = isOnline;
    if (isOnline) {
      onlineCount++;
      if (!firstOnlinePort) firstOnlinePort = p;
    }
    
    const isSelected = selectedPort === p;
    const statusText = isOnline ? '●' : '○';
    html += `<option value="${p}" class="${isOnline ? 'online' : 'offline'}"${isSelected ? ' selected' : ''}>${statusText} ${p}</option>`;
  }
  
  portSelector.innerHTML = html;
  
  
  if (!selectedPort && firstOnlinePort) {
    selectedPort = firstOnlinePort;
    portSelector.value = firstOnlinePort;
  } else if (selectedPort) {
    portSelector.value = selectedPort;
  }
  
  if (onlineCount > 0) {
    setStatus('Connected', 'online');
  } else {
    setStatus('Disconnected', 'offline');
  }
}

portSelector?.addEventListener('change', () => {
  selectedPort = parseInt(portSelector.value);
  showToast(`Port ${selectedPort} selected`);
});

executorSelect?.addEventListener('change', async () => {
  currentExecutor = executorSelect.value;
  await ipcRenderer.invoke('set-executor', currentExecutor);
  selectedPort = null;
  await updatePortSelector();
  showToast(`Switched to ${currentExecutor}`);
});

function setStatus(text, state) {
  statusText.textContent = text;
  statusDot.className = 'status-dot';
  if (state === 'offline') statusDot.classList.add('offline');
}


const consoleOutput = document.getElementById('console-output');
let logCounts = { error: 0, warning: 0, info: 0 };

function updateLogStats() {
  document.getElementById('stat-errors').innerHTML = `<i class='bx bx-error-circle'></i> ${logCounts.error}`;
  document.getElementById('stat-warnings').innerHTML = `<i class='bx bx-error'></i> ${logCounts.warning}`;
  document.getElementById('stat-info').innerHTML = `<i class='bx bx-info-circle'></i> ${logCounts.info}`;
}

function addLog(message, type = 'info') {
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry log-${type}`;
  logEntry.textContent = message;
  consoleOutput.appendChild(logEntry);
  
  
  if (type === 'error') logCounts.error++;
  else if (type === 'warning') logCounts.warning++;
  else logCounts.info++;
  updateLogStats();
  
  
  setTimeout(() => {
    logEntry.classList.add('show');
  }, 10);
  
  
  requestAnimationFrame(() => {
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  });
  
  
  while (consoleOutput.children.length > 1000) {
    consoleOutput.removeChild(consoleOutput.firstChild);
  }
}

function parseLogType(logLine) {
  const lowerLine = logLine.toLowerCase();
  if (lowerLine.includes('error') || lowerLine.includes('[error]')) return 'error';
  if (lowerLine.includes('warning') || lowerLine.includes('[warn]') || lowerLine.includes('warn')) return 'warning';
  if (lowerLine.includes('success') || lowerLine.includes('loaded') || lowerLine.includes('connected')) return 'success';
  if (lowerLine.includes('debug') || lowerLine.includes('[debug]')) return 'debug';
  return 'info';
}

function parseLogMessage(logLine) {
  
  const parts = logLine.split('] ');
  if (parts.length > 1) {
    return parts.slice(1).join('] ').trim();
  }
  return logLine.trim();
}

async function startLogWatcher() {
  const result = await ipcRenderer.invoke('start-log-watcher');
  if (result.success) {
    addLog('Log Reader started', 'success');
  } else {
    addLog('No Roblox log files found', 'warning');
  }
}


ipcRenderer.on('log-update', (_, logLine) => {
  if (logLine && logLine.trim()) {
    const type = parseLogType(logLine);
    const message = parseLogMessage(logLine);
    addLog(message, type);
  }
});


document.getElementById('clear-console')?.addEventListener('click', () => {
  consoleOutput.innerHTML = '';
  logCounts = { error: 0, warning: 0, info: 0 };
  updateLogStats();
  addLog('Console cleared', 'info');
});

document.getElementById('copy-console')?.addEventListener('click', () => {
  const text = Array.from(consoleOutput.querySelectorAll('.log-entry'))
    .map(el => el.textContent).join('\n');
  navigator.clipboard.writeText(text);
  showToast('Console copied!', 'success');
});


document.getElementById('console-input')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const input = e.target;
    const script = input.value.trim();
    if (script) {
      addLog(`> ${script}`, 'debug');
      try {
        const result = await ipcRenderer.invoke('execute-script', { script, port: selectedPort });
        if (result.success) {
          addLog('Script executed', 'success');
        } else {
          addLog(`Error: ${result.error || 'Failed to execute'}`, 'error');
        }
      } catch (err) {
        addLog(`Error: ${err.message}`, 'error');
      }
      input.value = '';
    }
  }
});


window.addEventListener('load', () => {
  startLogWatcher();
});


let searchTimeout;
document.getElementById('scripthub-search')?.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => searchScripts(e.target.value), 500);
});

function getScriptImage(script) {
  return script.image || script.gameLogo || 
    (script.game && (script.game.imageUrl || script.game.imgurl || script.game.image));
}

async function searchScripts(query) {
  if (query.length < 2) return;
  
  const resultsContainer = document.getElementById('scripthub-results');
  resultsContainer.innerHTML = '<div class="scripthub-placeholder">Searching...</div>';
  
  try {
    const scripts = await ipcRenderer.invoke('fetch-scripts', query);
    
    if (scripts.length === 0) {
      resultsContainer.innerHTML = '<div class="scripthub-placeholder">No results found</div>';
      return;
    }
    
    resultsContainer.innerHTML = scripts.map((s, i) => {
      const img = getScriptImage(s);
      const gameName = s.game?.name || s.game?.title || 'Universal';
      const hasKey = s.keySystem || s.key;
      const isVerified = s.user?.verified || s.owner?.verified;
      const desc = s.description || s.features || '';
      
      return `
        <div class="script-card" data-index="${i}">
          <div class="script-card-overlay">
            <button class="script-overlay-btn execute" data-index="${i}">Execute</button>
            <button class="script-overlay-btn load" data-index="${i}">Load to Editor</button>
          </div>
          <div class="script-card-image ${img ? '' : 'script-card-no-image'}" 
               style="${img ? `background-image: url('${img}')` : ''}">
            ${!img ? '🎮' : ''}
          </div>
          <div class="script-card-content">
            <div class="script-card-title">${s.title || 'Untitled'}</div>
            <div class="script-card-game">${gameName}</div>
            ${desc ? `<div class="script-card-desc">${desc}</div>` : ''}
            <div class="script-card-meta">
              ${hasKey ? '<span class="script-badge key">Key</span>' : ''}
              ${isVerified ? '<span class="script-badge verified">✓</span>' : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    
    window.hubScripts = scripts;
    
    
    document.querySelectorAll('.script-overlay-btn.execute').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const script = window.hubScripts[parseInt(btn.dataset.index)];
        await executeHubScriptDirect(script);
      });
    });
    
    document.querySelectorAll('.script-overlay-btn.load').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const script = window.hubScripts[parseInt(btn.dataset.index)];
        await addHubScriptToTab(script);
      });
    });
    
  } catch (err) {
    resultsContainer.innerHTML = `<div class="scripthub-placeholder" style="color: var(--accent-red);">Error: ${err.message}</div>`;
  }
}

async function getScriptContent(script) {
  let content = script.script;
  if (!content && script.rawScript) {
    content = await ipcRenderer.invoke('fetch-script-content', script.rawScript);
  }
  if (!content && script._id) {
    content = await ipcRenderer.invoke('fetch-script-by-id', script._id);
  }
  return content;
}

async function executeHubScriptDirect(script) {
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = 'Loading...';
  btn.disabled = true;
  
  try {
    const content = await getScriptContent(script);
    
    if (!content) {
      showToast('Failed to load script content', 'error');
      return;
    }
    
    setStatus('Executing...', 'connecting');
    
    const result = await ipcRenderer.invoke('execute-script', {
      script: content,
      port: selectedPort
    });
    
    if (result.success) {
      showToast('Script executed!', 'success');
      setStatus('Connected', 'online');
      
    } else {
      showToast(`Error: ${result.error}`, 'error');
      setStatus('Disconnected', 'offline');
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
    setStatus('Disconnected', 'offline');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function addHubScriptToTab(script) {
  const btn = event.target;
  const originalText = btn.textContent;
  btn.textContent = 'Loading...';
  btn.disabled = true;
  
  try {
    const content = await getScriptContent(script);
    
    if (!content) {
      showToast('Failed to load script content', 'error');
      return;
    }
    
    
    createTab(script.title || 'Hub Script', content);
    showToast('Script added to new tab!', 'success');
    
    
    document.querySelector('[data-tab="editor"]')?.click();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}


function initMonaco() {
  return new Promise((resolve) => {
    if (!window.amdRequire) {
      console.error('Monaco AMD loader not found');
      resolve();
      return;
    }
    
    amdRequire(['vs/editor/editor.main', 'vs/basic-languages/lua/lua'], function(_, luaBasics) {
      console.log('Monaco modules loaded');
      
      
      if (!monaco.languages.getLanguages().some(l => l.id === 'lua')) {
        monaco.languages.register({ id: 'lua' });
      }
      
      
      if (!monaco.languages.getLanguages().some(l => l.id === 'luau')) {
        monaco.languages.register({ id: 'luau', aliases: ['Luau', 'luau'] });
      }
      
      
      if (luaBasics && luaBasics.language) {
        monaco.languages.setMonarchTokensProvider('lua', luaBasics.language);
        monaco.languages.setMonarchTokensProvider('luau', luaBasics.language);
      }
      
      
      const luaGlobals = [
        'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
        'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then',
        'true', 'until', 'while', 'assert', 'collectgarbage', 'dofile', 'error',
        'getmetatable', 'ipairs', 'load', 'loadfile', 'next', 'pairs', 'pcall',
        'print', 'rawequal', 'rawget', 'rawlen', 'rawset', 'select', 'setmetatable',
        'tonumber', 'tostring', 'type', 'xpcall', 'warn', 'coroutine', 'string',
        'table', 'math', 'os', 'debug', 'utf8', 'bit32', 'typeof', 'getfenv',
        'setfenv', 'shared', 'script', 'require', 'spawn', 'delay', 'tick', 'time',
        'game', 'workspace', 'Workspace', 'Players', 'ReplicatedStorage', 'ServerStorage',
        'StarterGui', 'StarterPack', 'StarterPlayer', 'Lighting', 'RunService',
        'UserInputService', 'HttpService', 'TweenService', 'TweenInfo', 'CollectionService',
        'MarketplaceService', 'TeleportService', 'PathfindingService', 'Debris',
        'SoundService', 'TextChatService', 'Instance', 'Vector2', 'Vector3', 'CFrame',
        'Color3', 'BrickColor', 'UDim', 'UDim2', 'Enum', 'Ray', 'Region3', 'Rect',
        'NumberRange', 'NumberSequence', 'ColorSequence', 'PhysicalProperties', 'task', 'wait'
      ];
      
      
      const provideCompletions = {
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endLineNumber: position.lineNumber,
            endColumn: word.endColumn
          };
          
          const suggestions = luaGlobals.map(kw => ({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: kw,
            range
          }));
          return { suggestions };
        }
      };
      
      monaco.languages.registerCompletionItemProvider('lua', provideCompletions);
      monaco.languages.registerCompletionItemProvider('luau', provideCompletions);
      
      
      monaco.editor.defineTheme('oxygen-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
          { token: 'string', foreground: '98c379' },
          { token: 'number', foreground: 'd19a66' },
          { token: 'keyword', foreground: 'c678dd' },
          { token: 'keyword.control', foreground: 'c678dd' },
          { token: 'operator', foreground: '56b6c2' },
          { token: 'delimiter', foreground: '7a7a95' },
          { token: 'variable.predefined', foreground: 'e06c75' },
          { token: 'identifier', foreground: 'abb2bf' },
          { token: 'type', foreground: 'e5c07b' },
          { token: 'function', foreground: '61afef' },
          { token: 'predefined', foreground: '61afef' },
        ],
        colors: {
          'editor.background': '#06060a',
          'editor.foreground': '#abb2bf',
          'editor.lineHighlightBackground': '#0e0e16',
          'editor.selectionBackground': '#3e445180',
          'editor.inactiveSelectionBackground': '#3e445140',
          'editorCursor.foreground': '#6366f1',
          'editorLineNumber.foreground': '#3a3a4a',
          'editorLineNumber.activeForeground': '#6366f1',
          'scrollbar.shadow': '#00000000',
          'scrollbarSlider.background': '#6366f120',
          'scrollbarSlider.hoverBackground': '#6366f140',
          'scrollbarSlider.activeBackground': '#6366f160',
          'focusBorder': '#00000000',
          'contrastBorder': '#00000000',
          'editorBracketMatch.background': '#6366f130',
          'editorBracketMatch.border': '#6366f150',
        }
      });
      
      monacoReady = true;
      resolve();
    });
  });
}


const DEFAULT_SETTINGS = {
  accentColor: '#6366f1',
  alwaysOnTop: false,
  launchOnStartup: true
};

function initSettings() {
  const accentColorPicker = document.getElementById('accent-color-picker');
  const alwaysOnTopToggle = document.getElementById('always-on-top');
  const launchOnStartupToggle = document.getElementById('launch-on-startup');
  const openScriptsBtn = document.getElementById('open-scripts-folder');
  const openAutoexecBtn = document.getElementById('open-autoexec-folder');
  const resetBtn = document.getElementById('reset-settings');
  
  
  const savedAccent = localStorage.getItem('accentColor') || DEFAULT_SETTINGS.accentColor;
  const savedOnTop = localStorage.getItem('alwaysOnTop') === 'true';
  
  const savedStartup = localStorage.getItem('launchOnStartup') !== null 
    ? localStorage.getItem('launchOnStartup') === 'true' 
    : DEFAULT_SETTINGS.launchOnStartup;
  
  if (accentColorPicker) {
    accentColorPicker.value = savedAccent;
    applyAccentColor(savedAccent);
  }
  
  if (alwaysOnTopToggle) {
    alwaysOnTopToggle.checked = savedOnTop;
    if (savedOnTop) {
      ipcRenderer.send('set-always-on-top', true);
    }
  }
  
  if (launchOnStartupToggle) {
    launchOnStartupToggle.checked = savedStartup;
  }
  
  
  accentColorPicker?.addEventListener('input', (e) => {
    const color = e.target.value;
    applyAccentColor(color);
    localStorage.setItem('accentColor', color);
  });
  
  
  alwaysOnTopToggle?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    ipcRenderer.send('set-always-on-top', enabled);
    localStorage.setItem('alwaysOnTop', enabled);
    showToast(enabled ? 'Always on top enabled' : 'Always on top disabled');
  });
  
  
  launchOnStartupToggle?.addEventListener('change', (e) => {
    localStorage.setItem('launchOnStartup', e.target.checked);
    showToast('Startup runtime toggled');
  });
  
  
  openScriptsBtn?.addEventListener('click', () => {
    ipcRenderer.send('open-folder', SCRIPTS_DIR);
  });
  
  openAutoexecBtn?.addEventListener('click', () => {
    ipcRenderer.send('open-folder', AUTOEXEC_DIR);
  });
  
  
  resetBtn?.addEventListener('click', () => {
    if (confirm('Reset all settings to defaults?')) {
      
      localStorage.setItem('accentColor', DEFAULT_SETTINGS.accentColor);
      if (accentColorPicker) accentColorPicker.value = DEFAULT_SETTINGS.accentColor;
      applyAccentColor(DEFAULT_SETTINGS.accentColor);
      
      
      localStorage.setItem('alwaysOnTop', DEFAULT_SETTINGS.alwaysOnTop);
      if (alwaysOnTopToggle) alwaysOnTopToggle.checked = DEFAULT_SETTINGS.alwaysOnTop;
      ipcRenderer.send('set-always-on-top', DEFAULT_SETTINGS.alwaysOnTop);
      
      
      localStorage.setItem('launchOnStartup', DEFAULT_SETTINGS.launchOnStartup);
      if (launchOnStartupToggle) launchOnStartupToggle.checked = DEFAULT_SETTINGS.launchOnStartup;
      
      showToast('Settings reset to defaults');
    }
  });
}

function applyAccentColor(color) {
  document.documentElement.style.setProperty('--accent-purple', color);
  
  
  Object.values(editors).forEach(editor => {
    if (editor && typeof monaco !== 'undefined') {
      monaco.editor.defineTheme('oxygen-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
          { token: 'string', foreground: '98c379' },
          { token: 'number', foreground: 'd19a66' },
          { token: 'keyword', foreground: 'c678dd' },
          { token: 'keyword.control', foreground: 'c678dd' },
          { token: 'operator', foreground: '56b6c2' },
          { token: 'delimiter', foreground: '7a7a95' },
          { token: 'variable.predefined', foreground: 'e06c75' },
          { token: 'identifier', foreground: 'abb2bf' },
          { token: 'type', foreground: 'e5c07b' },
          { token: 'function', foreground: '61afef' },
          { token: 'predefined', foreground: '61afef' },
        ],
        colors: {
          'editor.background': '#06060a',
          'editor.foreground': '#abb2bf',
          'editor.lineHighlightBackground': '#0e0e16',
          'editor.selectionBackground': '#3e445180',
          'editor.inactiveSelectionBackground': '#3e445140',
          'editorCursor.foreground': color,
          'editorLineNumber.foreground': '#3a3a4a',
          'editorLineNumber.activeForeground': color,
          'scrollbar.shadow': '#00000000',
          'scrollbarSlider.background': color + '20',
          'scrollbarSlider.hoverBackground': color + '40',
          'scrollbarSlider.activeBackground': color + '60',
          'focusBorder': '#00000000',
          'contrastBorder': '#00000000',
          'editorBracketMatch.background': color + '30',
          'editorBracketMatch.border': color + '50',
        }
      });
    }
  });
}


function setupGlobalShortcuts() {
  document.addEventListener('keydown', (e) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdKey = isMac ? e.metaKey : e.ctrlKey;
    
    
    if (cmdKey && e.key === 'w') {
      e.preventDefault();
      e.stopPropagation();
      if (activeTabId && tabs.length > 0) {
        closeTab(activeTabId);
      }
      return false;
    }
    
    
    if (cmdKey && e.key === 't') {
      e.preventDefault();
      createTab();
      return false;
    }
    
    
    if (cmdKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const tabIndex = parseInt(e.key) - 1;
      if (tabs[tabIndex]) {
        switchTab(tabs[tabIndex].id);
      }
      return false;
    }
    
    
    if (cmdKey && e.key === 's') {
      e.preventDefault();
      saveCurrentTab();
      return false;
    }
  }, true); 
}


async function init() {
  initDirectories();
  setupGlobalShortcuts();
  initSettings();
  
  
  await initMonaco();
  
  renderFileTree();
  loadAutoExecList();
  
  
  const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith('.lua') || f.endsWith('.txt'));
  if (files.length > 0) {
    openFile(path.join(SCRIPTS_DIR, files[0]));
  } else {
    createTab();
  }
  
  
  const savedExecutor = await ipcRenderer.invoke('get-executor');
  if (savedExecutor) {
    currentExecutor = savedExecutor;
    if (executorSelect) executorSelect.value = currentExecutor;
  }
  
  await updatePortSelector();
  setInterval(updatePortSelector, 10000);
}

init();