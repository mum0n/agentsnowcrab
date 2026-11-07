const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  const url = process.env.VITE_DEV_SERVER_URL || `file://${path.join(__dirname, '..', 'dist', 'index.html')}`;
  win.loadURL(url);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
