const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const zlib = require('zlib');
const { spawn, exec } = require('child_process');
const https = require('https');

let chokidar = null; 

let mainWindow;
let currentExecutor = 'MacSploit';
let logWatcher = null;
let currentLogPath = null;
let filePosition = 0;
let checkLogInterval = null;


const OXYGEN_DIR = path.join(os.homedir(), 'Oxygen');
const SCRIPTS_DIR = path.join(OXYGEN_DIR, 'Scripts');
const AUTOEXEC_DIR = path.join(OXYGEN_DIR, 'AutoExec');

const EXECUTOR_PORTS = {
  MacSploit: { start: 5553, end: 5563 },
  Opiumware: { start: 8392, end: 8397 },
  Hydrogen: { start: 6969, end: 6969 }
};

function ensureDirectories() {
  [OXYGEN_DIR, SCRIPTS_DIR, AUTOEXEC_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function createWindow() {
  ensureDirectories();
  
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 18 },
    backgroundColor: '#09090f',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
  
  
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.key.toLowerCase() === 'w') {
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  
  
  
  

  
  
  
  
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });


ipcMain.on('minimize-window', () => mainWindow?.minimize());
ipcMain.on('maximize-window', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('close-window', () => mainWindow?.close());


ipcMain.on('set-always-on-top', (_, enabled) => {
  mainWindow?.setAlwaysOnTop(enabled);
});


ipcMain.on('open-folder', (_, folderPath) => {
  shell.openPath(folderPath);
});


ipcMain.handle('get-scripts-dir', () => SCRIPTS_DIR);
ipcMain.handle('get-autoexec-dir', () => AUTOEXEC_DIR);


ipcMain.handle('show-input-dialog', async (_, { title, label, defaultValue }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: title || 'Enter name',
    defaultPath: defaultValue || 'Untitled',
    buttonLabel: 'OK',
    properties: ['showOverwriteConfirmation']
  });
  
  if (result.canceled) return null;
  return path.basename(result.filePath);
});

ipcMain.handle('show-prompt', async (_, { title, message, defaultValue }) => {
  
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancel', 'OK'],
    title: title || 'Input',
    message: message || 'Enter value:',
    detail: `Default: ${defaultValue || ''}`,
  });
  
  if (response === 0) return null;
  return defaultValue; 
});

ipcMain.handle('show-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: SCRIPTS_DIR
  });
  
  if (result.canceled) return null;
  return result.filePaths[0];
});


ipcMain.handle('open-roblox', async () => {
  try {
    if (process.platform === 'darwin') {
      exec('open -a "Roblox"', (err) => {
        if (err) {
          exec('open ~/Applications/Roblox.app || open /Applications/Roblox.app', () => {});
        }
      });
    } else if (process.platform === 'win32') {
      exec('start roblox://');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});


ipcMain.handle('get-executor', () => currentExecutor);
ipcMain.handle('set-executor', (_, value) => {
  if (['MacSploit', 'Opiumware', 'Hydrogen'].includes(value)) {
    currentExecutor = value;
    return { success: true };
  }
  return { success: false };
});


ipcMain.handle('check-port', async (_, port) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve({ port, status: 'online' });
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve({ port, status: 'offline' });
    });
    socket.once('error', () => {
      socket.destroy();
      resolve({ port, status: 'offline' });
    });
    try {
      socket.connect({ host: '127.0.0.1', port });
    } catch {
      resolve({ port, status: 'offline' });
    }
  });
});


ipcMain.handle('execute-script', async (_, { script, port }) => {
  try {
    if (currentExecutor === 'MacSploit') {
      return await executeMacSploit(script, port);
    } else if (currentExecutor === 'Opiumware') {
      return await executeOpiumware(script, port);
    } else if (currentExecutor === 'Hydrogen') {
      return await executeHydrogen(script);
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

async function executeMacSploit(script, port) {
  const ports = EXECUTOR_PORTS.MacSploit;
  let serverPort = port || null;
  
  if (!serverPort) {
    for (let p = ports.start; p <= ports.end; p++) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection({ host: '127.0.0.1', port: p }, () => {
            serverPort = p;
            socket.destroy();
            resolve();
          });
          socket.on('error', reject);
          socket.setTimeout(500, () => reject(new Error('Timeout')));
        });
        if (serverPort) break;
      } catch {}
    }
  }

  if (!serverPort) throw new Error('No MacSploit instance found');

  return new Promise((resolve, reject) => {
    const header = Buffer.alloc(16, 0);
    header.writeUInt32LE(Buffer.byteLength(script) + 1, 8);
    
    const socket = net.createConnection({ host: '127.0.0.1', port: serverPort }, () => {
      socket.write(Buffer.concat([header, Buffer.from(script), Buffer.from([0])]));
      socket.end();
      resolve({ success: true, port: serverPort });
    });
    
    socket.on('error', (err) => reject(err));
    socket.setTimeout(3000);
  });
}

async function executeOpiumware(script, port) {
  const ports = EXECUTOR_PORTS.Opiumware;
  let stream = null;
  let connectedPort = port || null;

  if (!connectedPort) {
    for (let p = ports.start; p <= ports.end; p++) {
      try {
        stream = await new Promise((resolve, reject) => {
          const socket = net.createConnection({ host: '127.0.0.1', port: p }, () => resolve(socket));
          socket.on('error', reject);
          socket.setTimeout(1000, () => reject(new Error('Timeout')));
        });
        connectedPort = p;
        break;
      } catch {}
    }
  }

  if (!stream) throw new Error('No Opiumware instance found');

  const prefixedScript = 'OpiumwareScript ' + script;
  
  return new Promise((resolve, reject) => {
    zlib.deflate(Buffer.from(prefixedScript, 'utf8'), (err, compressed) => {
      if (err) return reject(err);
      stream.write(compressed, (writeErr) => {
        if (writeErr) return reject(writeErr);
        stream.end();
        resolve({ success: true, port: connectedPort });
      });
    });
  });
}

async function executeHydrogen(script) {
  const fetch = require('node-fetch');
  const port = 6969;
  
  const res = await fetch(`http://127.0.0.1:${port}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: script,
    timeout: 5000
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { success: true, port };
}


let autoExecWatcher = null;

ipcMain.handle('get-autoexec-scripts', () => {
  try {
    if (!fs.existsSync(AUTOEXEC_DIR)) return [];
    return fs.readdirSync(AUTOEXEC_DIR)
      .filter(f => f.endsWith('.lua') || f.endsWith('.txt'))
      .map(name => ({
        name,
        path: path.join(AUTOEXEC_DIR, name),
        content: fs.readFileSync(path.join(AUTOEXEC_DIR, name), 'utf-8')
      }));
  } catch {
    return [];
  }
});

ipcMain.handle('add-to-autoexec', async (_, { name, content }) => {
  try {
    const filePath = path.join(AUTOEXEC_DIR, name);
    fs.writeFileSync(filePath, content);
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('remove-from-autoexec', async (_, name) => {
  try {
    const filePath = path.join(AUTOEXEC_DIR, name);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('is-autoexec', (_, name) => {
  const filePath = path.join(AUTOEXEC_DIR, name);
  return fs.existsSync(filePath);
});


function findLatestLogFile() {
  const logsDir = path.join(os.homedir(), 'Library', 'Logs', 'Roblox');
  try {
    const files = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({
        path: path.join(logsDir, f),
        mtime: fs.statSync(path.join(logsDir, f)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);
    
    return files.length > 0 ? files[0].path : null;
  } catch (err) {
    console.error('Error finding log files:', err);
    return null;
  }
}

async function switchToNewLogFile() {
  
  if (!chokidar) {
    chokidar = await import('chokidar');
  }
  
  const newLogPath = findLatestLogFile();
  
  if (!newLogPath) {
    console.log('No log file found');
    return;
  }
  
  if (newLogPath !== currentLogPath) {
    console.log(`Switching to new log file: ${newLogPath}`);
    
    filePosition = 0;
    
    if (logWatcher) {
      logWatcher.close();
    }
    
    currentLogPath = newLogPath;
    
    
    try {
      const content = fs.readFileSync(currentLogPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim() !== '');
      filePosition = content.length;
      
      lines.forEach(line => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('log-update', line);
        }
      });
    } catch (err) {
      console.error('Error reading initial log content:', err);
    }
    
    
    logWatcher = chokidar.watch(currentLogPath, {
      persistent: true,
      ignoreInitial: true
    });
    
    logWatcher.on('change', () => {
      try {
        const stats = fs.statSync(currentLogPath);
        if (stats.size < filePosition) {
          filePosition = 0;
        }
        
        const stream = fs.createReadStream(currentLogPath, {
          encoding: 'utf8',
          start: filePosition
        });
        
        let remaining = '';
        stream.on('data', (data) => {
          const lines = (remaining + data).split('\n');
          remaining = lines.pop();
          
          lines.filter(line => line.trim() !== '').forEach(line => {
            try {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('log-update', line);
              }
            } catch (err) {
              console.error('Error sending log update:', err);
            }
          });
        });
        
        stream.on('end', () => {
          filePosition = stats.size;
        });
        
        stream.on('error', (err) => {
          console.error('Error reading log file:', err);
        });
      } catch (err) {
        console.error('Error handling log change:', err);
      }
    });
    
    logWatcher.on('error', (err) => {
      console.error('Log watcher error:', err);
    });
  }
}

async function logStart() {
  await switchToNewLogFile();
  
  
  checkLogInterval = setInterval(() => {
    switchToNewLogFile();
  }, 5000);
  
  return { success: true, path: currentLogPath };
}

function logEnd() {
  if (logWatcher) {
    logWatcher.close();
    logWatcher = null;
  }
  if (checkLogInterval) {
    clearInterval(checkLogInterval);
    checkLogInterval = null;
  }
}

ipcMain.handle('start-log-watcher', async () => {
  return logStart();
});

ipcMain.handle('stop-log-watcher', () => {
  logEnd();
  return { success: true };
});


ipcMain.handle('fetch-scripts', async (_, query) => {
  const fetch = require('node-fetch');
  
  try {
    const res = await fetch(`https://rscripts.net/api/v2/scripts?q=${encodeURIComponent(query)}&page=1&orderBy=date`);
    const data = await res.json();
    if (data.scripts) {
      return data.scripts.slice(0, 20);
    }
    return [];
  } catch (e) {
    console.error('Rscripts fetch error:', e);
    return [];
  }
});

ipcMain.handle('fetch-script-content', async (_, url) => {
  const fetch = require('node-fetch');
  try {
    const res = await fetch(url);
    return await res.text();
  } catch {
    return null;
  }
});

ipcMain.handle('fetch-script-by-id', async (_, id) => {
  const fetch = require('node-fetch');
  try {
    const res = await fetch(`https://rscripts.net/api/v2/script?id=${id}`);
    const data = await res.json();
    if (data.script && data.script[0]) {
      return data.script[0].script || null;
    }
    return null;
  } catch {
    return null;
  }
});
