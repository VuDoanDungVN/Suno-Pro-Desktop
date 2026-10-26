const { contextBridge, ipcRenderer, webUtils } = require('electron');

// contextBridge freezes the exposed object below, so a page script can
// never reassign `electronAPI.selectFile` itself to short-circuit the
// real file dialog for a one-off "already have this path" case (e.g.
// feeding a YouTube download into the existing Import pipeline) — any
// such reassignment is silently dropped. `document` IS shared across the
// isolated (this file) and main (page/app bundle) worlds though, so a
// plain dataset attribute on <html> works as the hand-off instead:
// primeNextFileDialog() sets it, selectFile() consumes+clears it if
// present and otherwise behaves exactly as before (real dialog).
function takePrimedFilePath() {
  const el = document.documentElement;
  const primed = el.dataset.sunoPrimedFilePath;
  if (primed) delete el.dataset.sunoPrimedFilePath;
  return primed || '';
}

contextBridge.exposeInMainWorld('electronAPI', {
  selectFile: () => {
    const primed = takePrimedFilePath();
    if (primed) return Promise.resolve(primed);
    return ipcRenderer.invoke('select-file');
  },
  primeNextFileDialog: (filePath) => {
    document.documentElement.dataset.sunoPrimedFilePath = filePath;
  },
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  saveFile: () => ipcRenderer.invoke('save-file'),
  saveMp3: () => ipcRenderer.invoke('save-mp3'),
  debugLog: (line) => ipcRenderer.invoke('debug-log', line).catch(() => undefined),
  saveJson: () => ipcRenderer.invoke('save-json'),
  openJson: () => ipcRenderer.invoke('open-json'),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  readAudioFile: (filePath) => ipcRenderer.invoke('read-audio-file', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // License activation
  getMacAddress: () => ipcRenderer.invoke('get-mac-address'),
  activationLoad: () => ipcRenderer.invoke('activation-load'),
  activationSave: (payload) => ipcRenderer.invoke('activation-save', payload),
  trialStatus: () => ipcRenderer.invoke('trial-status'),
  trialStart: () => ipcRenderer.invoke('trial-start'),

  // Suno upload (user's own session: cookie header / __session / eyJ token)
  sunoSessionLoad: () => ipcRenderer.invoke('suno-session-load'),
  sunoSessionSave: (session) => ipcRenderer.invoke('suno-session-save', session),
  sunoVerify: (session) => ipcRenderer.invoke('suno-verify', session),
  sunoUpload: (payload) => ipcRenderer.invoke('suno-upload', payload),
  sunoNotify: (payload) => ipcRenderer.invoke('suno-notify', payload),
  onSunoUploadProgress: (callback) => {
    const listener = (_event, msg) => callback(msg);
    ipcRenderer.on('suno-upload-progress', listener);
    return () => ipcRenderer.removeListener('suno-upload-progress', listener);
  },

  // Suno download — public link → resolve info + fetch audio bytes (WAV made in renderer)
  sunoDownloadResolve: (link) => ipcRenderer.invoke('suno-download-resolve', link),
  sunoDownloadPrepare: (payload) => ipcRenderer.invoke('suno-download-prepare', payload),
  sunoDownloadDecrypt: (payload) => ipcRenderer.invoke('suno-download-decrypt', payload),
  sunoSplitAssemble: (payload) => ipcRenderer.invoke('suno-split-assemble', payload),
  sunoSplitInspect: (payload) => ipcRenderer.invoke('suno-split-inspect', payload),
  sunoSplitExport: (payload) => ipcRenderer.invoke('suno-split-export', payload),
  sunoSplitWriteParts: (payload) => ipcRenderer.invoke('suno-split-write-parts', payload),
  sunoSplitSaveManifest: (payload) => ipcRenderer.invoke('suno-split-save-manifest', payload),
  sunoSplitList: () => ipcRenderer.invoke('suno-split-list'),
  sunoSplitLoad: (key) => ipcRenderer.invoke('suno-split-load', key),
  sunoSplitReadPart: (payload) => ipcRenderer.invoke('suno-split-read-part', payload),
  sunoSplitClear: (key) => ipcRenderer.invoke('suno-split-clear', key),
  sunoDownloadSave: (filename) => ipcRenderer.invoke('suno-download-save', filename),
  sunoDownloadBytes: (audioUrl) => ipcRenderer.invoke('suno-download-bytes', audioUrl),

  // Suno connect — in-app login window, session is captured automatically
  sunoConnect: () => ipcRenderer.invoke('suno-connect'),
  sunoConnectClose: () => ipcRenderer.invoke('suno-connect-close'),
  sunoOpenBrowser: () => ipcRenderer.invoke('suno-open-browser'),
  sunoAutoFromBrowser: (payload) => ipcRenderer.invoke('suno-auto-from-browser', payload),
  sunoListProfiles: (browser) => ipcRenderer.invoke('suno-list-profiles', browser),
  sunoOpenLoginBrowser: (payload) => ipcRenderer.invoke('suno-open-login-browser', payload),
  onSunoConnectResult: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('suno-connect-result', listener);
    return () => ipcRenderer.removeListener('suno-connect-result', listener);
  },
  
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  resizeWindowToContent: (height) => ipcRenderer.invoke('window-resize-to-content', height),

  // YouTube download (feeds the result into the existing Suno Split-Studio
  // import pipeline — see dist/index.html's importFileAsIfPicked)
  youtubeResolve: (link) => ipcRenderer.invoke('youtube-resolve', link),
  youtubeDownload: (payload) => ipcRenderer.invoke('youtube-download', payload),
  youtubeCancel: () => ipcRenderer.invoke('youtube-cancel'),
  onYoutubeDownloadProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('youtube-download-progress', listener);
    return () => ipcRenderer.removeListener('youtube-download-progress', listener);
  }
});
