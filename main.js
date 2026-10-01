// main.js — نقطة تشغيل تطبيق سطح المكتب (Electron)
// يشغّل نفس واجهة النظام لكن كبرنامج مستقل بدون فتح أي متصفح

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: 'عيادة أسنان د/ حسام عبدالحكيم عوض الشاهين',
    icon: path.join(__dirname, 'app-icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#f4f6fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));

  // فتح روابط واتساب/خارجية في المتصفح الافتراضي بدل نافذة جديدة داخل التطبيق
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
