import { createHash, generateKeyPairSync, randomBytes, sign } from 'crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();
const b64url = (data: Uint8Array) => Buffer.from(data).toString('base64url');
const bytes = (data: Buffer) => new Uint8Array(data);
type CBOR = Parameters<typeof isoCBOR.encode>[0];

/**
 * Autenticador de mentira para os testes: faz, em software, o que o celular/computador faz numa
 * passkey de verdade (par de chaves P-256, authenticatorData, assinatura). Sem navegador.
 */
export class FakeAuthenticator {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly credentialId = randomBytes(16);
  /** Contador de assinaturas; dá para voltar atrás e simular uma credencial clonada. */
  counter = 0;
  private userHandle?: string;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {}

  get id(): string {
    return b64url(this.credentialId);
  }

  /** Resposta do navigator.credentials.create() para as opções de cadastro. */
  register(options: { challenge: string; user: { id: string } }, origin = this.origin) {
    this.userHandle = options.user.id;
    const attestationObject = isoCBOR.encode(
      new Map<string, CBOR>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', bytes(this.authData(true))],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge, origin)),
        attestationObject: b64url(attestationObject),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /** Resposta do navigator.credentials.get() para as opções de login. */
  login(options: { challenge: string }, origin = this.origin) {
    this.counter += 1;
    const authenticatorData = this.authData(false);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin);
    const signature = sign(
      'sha256',
      Buffer.concat([authenticatorData, sha256(clientDataJSON)]),
      this.keys.privateKey,
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
        userHandle: this.userHandle,
      },
    };
  }

  private clientData(type: string, challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** rpIdHash | flags (presença + verificação do usuário [+ credencial]) | contador [| credencial] */
  private authData(withCredential: boolean): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    const flags = 0x01 | 0x04 | (withCredential ? 0x40 : 0);
    const parts = [sha256(this.rpId), Buffer.from([flags]), counter];
    if (withCredential) {
      const { x, y } = this.keys.publicKey.export({ format: 'jwk' });
      const coseKey = isoCBOR.encode(
        new Map<number, CBOR>([
          [1, 2], // kty: EC2
          [3, -7], // alg: ES256
          [-1, 1], // crv: P-256
          [-2, bytes(Buffer.from(x!, 'base64url'))],
          [-3, bytes(Buffer.from(y!, 'base64url'))],
        ]),
      );
      const length = Buffer.alloc(2);
      length.writeUInt16BE(this.credentialId.length);
      parts.push(Buffer.alloc(16), length, this.credentialId, Buffer.from(coseKey));
    }
    return Buffer.concat(parts);
  }
}
