const { BrowserWindow } = require('electron')

const installedSessions = new WeakSet()
const getterNameToField = (getterName) => {
  const raw = String(getterName || '').slice(3)
  if (!raw) {
    return ''
  }
  const headNormalized = raw.replace(/^[A-Z]{2,}(?=[A-Z][a-z]|$)/, (match) => match.toLowerCase())
  return headNormalized.charAt(0).toLowerCase() + headNormalized.slice(1)
}

const serializeNativeGetters = (nativeObject) => {
  const payload = {}
  if (!nativeObject || typeof nativeObject !== 'object') return payload
  const prototype = Object.getPrototypeOf(nativeObject) || {}
  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (!/^get[A-Z]/.test(key)) continue
    const getter = nativeObject[key]
    if (typeof getter !== 'function' || getter.length !== 0) continue
    try {
      const value = getter.call(nativeObject)
      if (value === undefined || typeof value === 'function') continue
      JSON.stringify(value)
      const field = getterNameToField(key)
      if (!field) continue
      payload[field] = value
    } catch (_) {
    }
  }
  return payload
}

const installWillDownloadEventBridge = ({ webSession }) => {
  if (!webSession || installedSessions.has(webSession)) {
    return
  }
  installedSessions.add(webSession)
  webSession.on('will-download', (event, item, sourceWebContents) => {
    try {
      let targetWebContents = (sourceWebContents && !sourceWebContents.isDestroyed())
        ? sourceWebContents
        : null
      if (!targetWebContents) {
        const focusedWindow = BrowserWindow.getFocusedWindow()
        const focusedWebContents = focusedWindow && focusedWindow.webContents
        if (
          focusedWebContents &&
          !focusedWebContents.isDestroyed() &&
          focusedWebContents.session === webSession
        ) {
          targetWebContents = focusedWebContents
        } else {
          const fallbackWindow = BrowserWindow.getAllWindows().find((win) => {
            return (
              win &&
              win.webContents &&
              !win.webContents.isDestroyed() &&
              win.webContents.session === webSession
            )
          })
          targetWebContents = fallbackWindow ? fallbackWindow.webContents : null
        }
      }
      if (!targetWebContents) return
      if (event && typeof event.preventDefault === 'function') {
        event.preventDefault()
      }
      const frameUrl = (sourceWebContents && !sourceWebContents.isDestroyed())
        ? (sourceWebContents.getURL() || '')
        : ''
      targetWebContents.send('pinokio:event', {
        event: 'electron:session:will-download',
        payload: serializeNativeGetters(item),
        context: { frameUrl }
      })
    } catch (_) {}
  })
}

module.exports = {
  installWillDownloadEventBridge
}
