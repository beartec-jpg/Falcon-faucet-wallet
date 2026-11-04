'use strict'

/**
 * CJS facade for the webpack alias of `ripple-address-codec`.
 *
 * ripple-keypairs (CJS) does `require('ripple-address-codec').encodeSeed(...)`.
 * Binding those names at load time is undefined when the ESM module is still
 * evaluating (`(0 , i.encodeSeed) is not a function`). Look them up on each call.
 */
function load() {
  const loaded = require('./classic-address')
  if (loaded && typeof loaded.encodeSeed === 'function') return loaded
  if (loaded && loaded.default && typeof loaded.default.encodeSeed === 'function') {
    return loaded.default
  }
  return loaded
}

function bind(name) {
  const fn = function () {
    const api = load()
    const impl = api && api[name]
    if (typeof impl !== 'function') {
      throw new Error(`ripple-address-codec shim: ${name} is not a function`)
    }
    return impl.apply(api, arguments)
  }
  Object.defineProperty(fn, 'name', { value: name })
  return fn
}

exports.encodeSeed = bind('encodeSeed')
exports.decodeSeed = bind('decodeSeed')
exports.encodeAccountID = bind('encodeAccountID')
exports.decodeAccountID = bind('decodeAccountID')
exports.encodeNodePublic = bind('encodeNodePublic')
exports.decodeNodePublic = bind('decodeNodePublic')
exports.encodeAccountPublic = bind('encodeAccountPublic')
exports.decodeAccountPublic = bind('decodeAccountPublic')
exports.encodeXAddress = bind('encodeXAddress')
exports.decodeXAddress = bind('decodeXAddress')
exports.classicAddressToXAddress = bind('classicAddressToXAddress')
exports.xAddressToClassicAddress = bind('xAddressToClassicAddress')
exports.isValidClassicAddress = function (address) {
  const api = load()
  if (typeof api.isValidClassicAddress === 'function') return api.isValidClassicAddress(address)
  if (typeof api.isClassicAddress === 'function') return api.isClassicAddress(address)
  return false
}
exports.isValidXAddress = bind('isValidXAddress')
exports.isClassicAddress = bind('isClassicAddress')
exports.encodeAddress = bind('encodeAddress')
exports.decodeAddress = bind('decodeAddress')
Object.defineProperty(exports, 'codec', {
  enumerable: true,
  get() {
    const api = load()
    return api && api.codec
  },
})
Object.defineProperty(exports, 'CLASSIC_ADDRESS_RE', {
  enumerable: true,
  get() {
    const api = load()
    return api && api.CLASSIC_ADDRESS_RE
  },
})
exports.default = exports
exports.__esModule = true
