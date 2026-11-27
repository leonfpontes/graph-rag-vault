// The two web APIs the codec uses. Node and every browser have them; declared here because the
// package compiles without DOM or Node types, so nothing else from either side slips in.
declare class TextEncoder {
  encode(input?: string): Uint8Array
}
declare class TextDecoder {
  decode(input?: Uint8Array): string
}
