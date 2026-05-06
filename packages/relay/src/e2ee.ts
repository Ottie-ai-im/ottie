export { createClientChannel, createDaemonChannel, EncryptedChannel } from "./encrypted-channel.js";
export type { Transport, EncryptedChannelEvents } from "./encrypted-channel.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportSecretKey,
  importSecretKey,
  deriveSharedKey,
  encrypt,
  decrypt,
} from "./crypto.js";
export type { KeyPair, SharedKey } from "./crypto.js";
