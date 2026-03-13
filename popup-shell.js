const path = require('path')
const windowStateKeeper = require('electron-window-state')
const { BrowserWindow, WebContentsView, session } = require('electron')

const parseUrl = (value, base) => {
  try {
    return new URL(value, base)
  } catch (_) {
    return null
  }
}

const isHttpUrl = (value) => {
  return Boolean(value && (value.protocol === 'http:' || value.protocol === 'https:'))
}

const getFeatureDimension = (params, key, fallback) => {
  const value = parseInt(params.get(key), 10)
  return Number.isFinite(value) ? value : fallback
}

module.exports = ({
  contentPreloadPath = path.join(__dirname, 'preload.js'),
  toolbarHtmlPath = path.join(__dirname, 'popup-toolbar.html'),
  toolbarHeight = 46,
  installForceDestroyOnClose
} = {}) => {
  const buildPopupContentWebPreferences = (overrides = {}) => {
    const next = (overrides && typeof overrides === 'object') ? { ...overrides } : {}
    return {
      ...next,
      session: session.defaultSession,
      webSecurity: false,
      spellcheck: false,
      nativeWindowOpen: true,
      contextIsolation: false,
      nodeIntegrationInSubFrames: true,
      enableRemoteModule: false,
      experimentalFeatures: true,
      preload: contentPreloadPath
    }
  }

  const isPinokioWindowUrl = (value, rootUrl) => {
    const rootParsed = parseUrl(rootUrl)
    const target = parseUrl(value, rootParsed ? rootParsed.origin : undefined)
    if (!rootParsed || !isHttpUrl(target)) {
      return false
    }
    return target.origin === rootParsed.origin
  }

  const resolveTargetUrl = ({ url, openerWebContents, rootUrl } = {}) => {
    const openerUrl = (() => {
      try {
        return openerWebContents && !openerWebContents.isDestroyed()
          ? openerWebContents.getURL()
          : (rootUrl || '')
      } catch (_) {
        return rootUrl || ''
      }
    })()
    const target = parseUrl(url, openerUrl || (rootUrl || undefined))
    return isHttpUrl(target) ? target.href : ''
  }

  const buildRegularWindowOptions = ({ x, y, width, height, overlay } = {}) => {
    const options = {
      x,
      y,
      width: width || 1000,
      height: height || 800,
      minWidth: 190,
      parent: null,
      titleBarStyle: 'hidden',
      webPreferences: buildPopupContentWebPreferences()
    }
    if (overlay) {
      options.titleBarOverlay = overlay
    }
    return options
  }

  const createRegularWindow = ({ x, y, width, height, overlay } = {}) => {
    const win = new BrowserWindow(buildRegularWindowOptions({ x, y, width, height, overlay }))
    installForceDestroyOnClose(win)
    return win
  }

  const layoutPopupShell = (shellState) => {
    if (!shellState || !shellState.win || shellState.win.isDestroyed()) {
      return
    }
    const bounds = shellState.win.getContentBounds()
    const width = Math.max(bounds.width || 0, 0)
    const height = Math.max(bounds.height || 0, 0)
    shellState.toolbarView.setBounds({
      x: 0,
      y: 0,
      width,
      height: toolbarHeight
    })
    shellState.contentView.setBounds({
      x: 0,
      y: toolbarHeight,
      width,
      height: Math.max(height - toolbarHeight, 0)
    })
  }

  const buildPopupShellState = (shellState) => {
    const target = shellState && shellState.contentView ? shellState.contentView.webContents : null
    let url = ''
    let title = ''
    try {
      if (target && !target.isDestroyed()) {
        url = target.getURL() || ''
        title = target.getTitle() || ''
      }
    } catch (_) {
    }
    return {
      url,
      title: title || url || 'Pinokio'
    }
  }

  const sendPopupShellState = (shellState) => {
    if (!shellState || !shellState.toolbarView || !shellState.contentView) {
      return
    }
    const toolbarContents = shellState.toolbarView.webContents
    if (!toolbarContents || toolbarContents.isDestroyed()) {
      return
    }
    const state = buildPopupShellState(shellState)
    toolbarContents.send('pinokio:popup-shell-state', state)
    if (shellState.win && !shellState.win.isDestroyed()) {
      shellState.win.setTitle(state.title)
    }
  }

  const createPopupShellWindow = ({
    x,
    y,
    width,
    height,
    adoptedWebContents = null,
    contentWebPreferences = {},
    initialUrl = ''
  } = {}) => {
    const win = new BrowserWindow({
      frame: true,
      x,
      y,
      width: width || 1000,
      height: height || 800,
      minWidth: 190,
      backgroundColor: '#ffffff'
    })
    installForceDestroyOnClose(win)

    const toolbarView = new WebContentsView({
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        spellcheck: false,
        backgroundThrottling: false
      }
    })
    const contentView = adoptedWebContents
      ? new WebContentsView({ webContents: adoptedWebContents })
      : new WebContentsView({
          webPreferences: buildPopupContentWebPreferences(contentWebPreferences)
        })

    const shellState = {
      win,
      toolbarView,
      contentView
    }

    win.contentView.addChildView(contentView)
    win.contentView.addChildView(toolbarView)
    layoutPopupShell(shellState)

    const syncShellState = () => {
      layoutPopupShell(shellState)
      sendPopupShellState(shellState)
    }
    const focusContent = () => {
      if (contentView.webContents && !contentView.webContents.isDestroyed()) {
        contentView.webContents.focus()
      }
    }

    toolbarView.webContents.on('did-finish-load', () => {
      sendPopupShellState(shellState)
    })
    contentView.webContents.on('did-finish-load', () => {
      syncShellState()
      focusContent()
    })
    contentView.webContents.on('did-navigate', syncShellState)
    contentView.webContents.on('did-navigate-in-page', syncShellState)
    contentView.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      sendPopupShellState(shellState)
    })
    win.on('focus', focusContent)
    win.on('resize', syncShellState)

    toolbarView.webContents.loadFile(toolbarHtmlPath).catch((error) => {
      console.error('[pinokio][popup-shell] failed to load toolbar', error)
    })
    if (initialUrl) {
      contentView.webContents.loadURL(initialUrl).catch((error) => {
        console.error('[pinokio][popup-shell] failed to load content url', { initialUrl, error })
      })
    }
    return shellState
  }

  const allowPermissions = (targetSession) => {
    if (!targetSession) {
      return
    }
    targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(true)
    })
  }

  const createPopupWindowState = () => {
    if (typeof windowStateKeeper !== 'function') {
      return {
        x: undefined,
        y: undefined,
        width: 1000,
        height: 800,
        manage: () => {}
      }
    }
    return windowStateKeeper({
//    file: "index.json",
      defaultWidth: 1000,
      defaultHeight: 800
    })
  }

  const createPopupResponse = ({ params, width, height, x, y } = {}) => {
    return {
      action: 'allow',
      outlivesOpener: true,
      createWindow: (options = {}) => {
        const shellState = createPopupShellWindow({
          width: getFeatureDimension(params, 'width', width),
          height: getFeatureDimension(params, 'height', height),
          x: x + 30,
          y: y + 30,
          adoptedWebContents: options.webContents || null,
          contentWebPreferences: options.webPreferences || {}
        })
        return shellState.contentView.webContents
      }
    }
  }

  const openExternalWindow = ({ url, windowState } = {}) => {
    const nextWindowState = windowState || createPopupWindowState()
    const shellState = createPopupShellWindow({
      x: nextWindowState.x,
      y: nextWindowState.y,
      width: nextWindowState.width,
      height: nextWindowState.height,
      initialUrl: url
    })
    const win = shellState.win
    allowPermissions(shellState.contentView.webContents.session)
    win.focus()
    nextWindowState.manage(win)
    return win
  }

  return {
    createPopupResponse,
    isPinokioWindowUrl,
    resolveTargetUrl,
    openExternalWindow
  }
}
