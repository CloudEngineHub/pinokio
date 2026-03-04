const fs = require('fs')
const path = require('path')

const ARCH_BY_ENUM = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
}

const ELF_MACHINE_AARCH64 = 183

const resolveArch = (context) => {
  if (typeof context.arch === 'string') {
    return context.arch.toLowerCase()
  }

  if (typeof context.arch === 'number') {
    const mapped = ARCH_BY_ENUM[context.arch]
    if (mapped) {
      return mapped
    }
  }

  if (typeof context.appOutDir === 'string' && /arm64/i.test(context.appOutDir)) {
    return 'arm64'
  }

  return ''
}

const ensureAarch64Elf = (filePath, label) => {
  const data = fs.readFileSync(filePath)

  if (data.length < 20) {
    throw new Error(`[linux-arm64-native-fix] ${label} is too small to be an ELF binary: ${filePath}`)
  }

  if (!(data[0] === 0x7f && data[1] === 0x45 && data[2] === 0x4c && data[3] === 0x46)) {
    throw new Error(`[linux-arm64-native-fix] ${label} is not an ELF binary: ${filePath}`)
  }

  const isLittleEndian = data[5] !== 2
  const machine = isLittleEndian ? data.readUInt16LE(18) : data.readUInt16BE(18)

  if (machine !== ELF_MACHINE_AARCH64) {
    throw new Error(`[linux-arm64-native-fix] ${label} is not aarch64 (e_machine=${machine}): ${filePath}`)
  }
}

const copyWithValidation = (source, destination, label) => {
  if (!fs.existsSync(source)) {
    throw new Error(`[linux-arm64-native-fix] Missing ${label} source file: ${source}`)
  }

  ensureAarch64Elf(source, `${label} source`)

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)

  ensureAarch64Elf(destination, `${label} destination`)
  console.log(`[linux-arm64-native-fix] Patched ${label}: ${destination}`)
}

const existingDirectories = (candidates) => candidates.filter((candidate) => fs.existsSync(candidate))

module.exports = async (context) => {
  if (context.electronPlatformName !== 'linux') {
    return
  }

  const arch = resolveArch(context)
  if (arch !== 'arm64') {
    return
  }

  const unpackedRoot = path.join(context.appOutDir, 'resources', 'app.asar.unpacked')

  const ptyBases = existingDirectories([
    path.join(unpackedRoot, 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch'),
    path.join(unpackedRoot, 'node_modules', 'pinokiod', 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch')
  ])

  if (ptyBases.length === 0) {
    throw new Error('[linux-arm64-native-fix] Could not find @homebridge/node-pty-prebuilt-multiarch in app.asar.unpacked')
  }

  for (const ptyBase of ptyBases) {
    const source = path.join(ptyBase, 'prebuilds', 'linux-arm64', 'node.abi131.node')
    const destination = path.join(ptyBase, 'build', 'Release', 'pty.node')
    copyWithValidation(source, destination, 'node-pty')
  }

  const watcherBases = existingDirectories([
    path.join(unpackedRoot, 'node_modules', '@parcel', 'watcher'),
    path.join(unpackedRoot, 'node_modules', 'pinokiod', 'node_modules', '@parcel', 'watcher')
  ])

  if (watcherBases.length === 0) {
    throw new Error('[linux-arm64-native-fix] Could not find @parcel/watcher in app.asar.unpacked')
  }

  for (const watcherBase of watcherBases) {
    const source = path.join(path.dirname(watcherBase), 'watcher-linux-arm64-glibc', 'watcher.node')
    const destination = path.join(watcherBase, 'build', 'Release', 'watcher.node')
    copyWithValidation(source, destination, 'parcel-watcher')
  }
}
