import crypto from "crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: "spki",
    format: "der",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "der",
  },
});

export function getLoginPublicKey() {
  return {
    salt: publicKey.toString("base64"),
  };
}

export function decryptLoginPassword(encryptedPassword = "") {
  const encryptedBuffer = Buffer.from(String(encryptedPassword), "base64");
  const decryptedBuffer = crypto.privateDecrypt(
    {
      key: privateKey,
      format: "der",
      type: "pkcs8",
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    encryptedBuffer
  );

  return decryptedBuffer.toString("utf8");
}
