/**
 * Standard OHLCV bar representation.
 */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Binary wire format for zero-copy transferable columnar data.
 */
export interface ColumnarBufferPayload {
  length: number;
  stride: number;
  buffer: ArrayBuffer;
}
