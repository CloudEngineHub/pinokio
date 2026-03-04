module.exports = async (context) => {
  const chmodHandler = require('./chmod')
  const wrapLinuxLauncher = require('./wrap-linux-launcher')
  const patchLinuxArm64Natives = require('./patch-linux-arm64-natives')

  await chmodHandler(context)
  await wrapLinuxLauncher(context)
  await patchLinuxArm64Natives(context)
}
