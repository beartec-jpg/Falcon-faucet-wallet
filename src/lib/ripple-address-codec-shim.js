'use strict'

/**
 * CJS facade for the webpack alias of `ripple-address-codec`.
 *
 * `ripple-keypairs` (CJS) does `require('ripple-address-codec').encodeSeed`.
 * Aliasing that package at an ESM-only TS module leaves encodeSeed undefined
 * (`(0 , i.encodeSeed) is not a function`) so classic XRP keys never generate.
 */
const loaded = require('./classic-address')
const api =
  loaded && typeof loaded.encodeSeed === 'function'
    ? loaded
    : loaded && loaded.default && typeof loaded.default.encodeSeed === 'function'
      ? loaded.default
      : loaded

module.exports = api
if (api && typeof api === 'object') {
  module.exports.encodeSeed = api.encodeSeed
  module.exports.decodeSeed = api.decodeSeed
  module.exports.encodeAccountID = api.encodeAccountID
  module.exports.decodeAccountID = api.decodeAccountID
  module.exports.encodeNodePublic = api.encodeNodePublic
  module.exports.decodeNodePublic = api.decodeNodePublic
  module.exports.encodeAccountPublic = api.encodeAccountPublic
  module.exports.decodeAccountPublic = api.decodeAccountPublic
  module.exports.encodeXAddress = api.encodeXAddress
  module.exports.decodeXAddress = api.decodeXAddress
  module.exports.classicAddressToXAddress = api.classicAddressToXAddress
  module.exports.xAddressToClassicAddress = api.xAddressToClassicAddress
  module.exports.isValidClassicAddress = api.isValidClassicAddress
  module.exports.isValidXAddress = api.isValidXAddress
  module.exports.isClassicAddress = api.isClassicAddress
  module.exports.encodeAddress = api.encodeAddress
  module.exports.decodeAddress = api.decodeAddress
  module.exports.codec = api.codec
  module.exports.CLASSIC_ADDRESS_RE = api.CLASSIC_ADDRESS_RE
  module.exports.default = api
  module.exports.__esModule = true
}
