import { Bar, ColumnarBufferPayload } from './types.js';

/**
 * High-performance struct-of-arrays (SOA) binary storage for OHLCV market data.
 * Packs time, open, high, low, close, volume into 64-byte aligned Float64Array buffers,
 * enabling O(1) (<1ms) transfers across Web Worker boundaries with zero heap churn.
 */
export class ColumnarBarTable {
  private readonly _underlyingBuffer?: ArrayBuffer;
  private readonly _stride?: number;

  constructor(
    public readonly length: number,
    public readonly time: Float64Array,
    public readonly open: Float64Array,
    public readonly high: Float64Array,
    public readonly low: Float64Array,
    public readonly close: Float64Array,
    public readonly volume: Float64Array,
    underlyingBuffer?: ArrayBuffer,
    stride?: number,
  ) {
    this._underlyingBuffer = underlyingBuffer;
    this._stride = stride;
  }

  /**
   * Pre-allocates a continuous, 64-byte aligned single ArrayBuffer storing all 6 columns.
   * Stride is aligned to multiples of 8 float64 elements (64 bytes).
   */
  public static allocate(length: number): ColumnarBarTable {
    if (length < 0) {
      throw new RangeError(`ColumnarBarTable length cannot be negative: ${length}`);
    }
    // 64-byte alignment: 8 Float64 numbers = 64 bytes
    const stride = length === 0 ? 0 : Math.max(8, Math.ceil(length / 8) * 8);
    const byteLength = stride * 6 * Float64Array.BYTES_PER_ELEMENT;
    const buffer = new ArrayBuffer(byteLength);

    const time = new Float64Array(buffer, 0 * stride * 8, length);
    const open = new Float64Array(buffer, 1 * stride * 8, length);
    const high = new Float64Array(buffer, 2 * stride * 8, length);
    const low = new Float64Array(buffer, 3 * stride * 8, length);
    const close = new Float64Array(buffer, 4 * stride * 8, length);
    const volume = new Float64Array(buffer, 5 * stride * 8, length);

    return new ColumnarBarTable(
      length,
      time,
      open,
      high,
      low,
      close,
      volume,
      buffer,
      stride,
    );
  }

  /**
   * Constructs a continuous ColumnarBarTable from an array of Bar objects.
   */
  public static fromBars(bars: readonly Bar[]): ColumnarBarTable {
    const count = bars.length;
    const table = ColumnarBarTable.allocate(count);

    const time = table.time;
    const open = table.open;
    const high = table.high;
    const low = table.low;
    const close = table.close;
    const volume = table.volume;

    for (let i = 0; i < count; i++) {
      const b = bars[i];
      time[i] = b.time;
      open[i] = b.open;
      high[i] = b.high;
      low[i] = b.low;
      close[i] = b.close;
      volume[i] = b.volume;
    }

    return table;
  }

  /**
   * Constructs a ColumnarBarTable from discrete Float64Array instances.
   */
  public static fromArrays(
    time: Float64Array,
    open: Float64Array,
    high: Float64Array,
    low: Float64Array,
    close: Float64Array,
    volume: Float64Array,
  ): ColumnarBarTable {
    const len = time.length;
    if (
      open.length !== len ||
      high.length !== len ||
      low.length !== len ||
      close.length !== len ||
      volume.length !== len
    ) {
      throw new Error(
        `Column length mismatch: time=${len}, open=${open.length}, high=${high.length}, low=${low.length}, close=${close.length}, volume=${volume.length}`,
      );
    }
    return new ColumnarBarTable(len, time, open, high, low, close, volume);
  }

  /**
   * Reconstitutes a ColumnarBarTable from a transferred binary payload.
   */
  public static fromPayload(payload: ColumnarBufferPayload): ColumnarBarTable {
    const { length, stride, buffer } = payload;
    if (length === 0) {
      return ColumnarBarTable.allocate(0);
    }
    const time = new Float64Array(buffer, 0 * stride * 8, length);
    const open = new Float64Array(buffer, 1 * stride * 8, length);
    const high = new Float64Array(buffer, 2 * stride * 8, length);
    const low = new Float64Array(buffer, 3 * stride * 8, length);
    const close = new Float64Array(buffer, 4 * stride * 8, length);
    const volume = new Float64Array(buffer, 5 * stride * 8, length);

    return new ColumnarBarTable(
      length,
      time,
      open,
      high,
      low,
      close,
      volume,
      buffer,
      stride,
    );
  }

  /**
   * Serializes table into a continuous binary payload ready for zero-copy postMessage transfer.
   */
  public toPayload(): ColumnarBufferPayload {
    const isRootAligned =
      this._underlyingBuffer &&
      this._stride !== undefined &&
      this.time.byteOffset === 0 &&
      this.open.byteOffset === this._stride * 8 &&
      this.high.byteOffset === 2 * this._stride * 8 &&
      this.low.byteOffset === 3 * this._stride * 8 &&
      this.close.byteOffset === 4 * this._stride * 8 &&
      this.volume.byteOffset === 5 * this._stride * 8;

    if (isRootAligned && this._underlyingBuffer && this._stride !== undefined) {
      return {
        length: this.length,
        stride: this._stride,
        buffer: this._underlyingBuffer,
      };
    }

    // If sliced or backed by disjoint arrays, consolidate into a fresh continuous buffer
    const continuous = this.clone();
    return {
      length: continuous.length,
      stride: continuous._stride!,
      buffer: continuous._underlyingBuffer!,
    };
  }

  /**
   * ArrayBuffer instances to pass in postMessage transferList for zero-copy IPC.
   */
  public get transferables(): Transferable[] {
    const payload = this.toPayload();
    return [payload.buffer];
  }

  /**
   * Total bytes allocated across underlying typed arrays.
   */
  public get byteLength(): number {
    if (this._underlyingBuffer) {
      return this._underlyingBuffer.byteLength;
    }
    return this.length * 6 * Float64Array.BYTES_PER_ELEMENT;
  }

  /**
   * Checks if any underlying buffer is detached.
   */
  public get isDetached(): boolean {
    if (this._underlyingBuffer) {
      return this._underlyingBuffer.byteLength === 0 && this.length > 0;
    }
    return (
      (this.time.buffer.byteLength === 0 ||
        this.open.buffer.byteLength === 0 ||
        this.high.buffer.byteLength === 0 ||
        this.low.buffer.byteLength === 0 ||
        this.close.buffer.byteLength === 0 ||
        this.volume.buffer.byteLength === 0) &&
      this.length > 0
    );
  }

  /**
   * True if all columns share a continuous underlying ArrayBuffer.
   */
  public get isContinuous(): boolean {
    return (
      this._underlyingBuffer !== undefined &&
      this.time.buffer === this._underlyingBuffer &&
      this.open.buffer === this._underlyingBuffer &&
      this.high.buffer === this._underlyingBuffer &&
      this.low.buffer === this._underlyingBuffer &&
      this.close.buffer === this._underlyingBuffer &&
      this.volume.buffer === this._underlyingBuffer
    );
  }

  /**
   * Reads a single bar at index. Avoid in hot loops; read directly from columns instead.
   */
  public getBar(index: number): Bar {
    if (index < 0 || index >= this.length) {
      throw new RangeError(`Index out of range [0, ${this.length}): ${index}`);
    }
    return {
      time: this.time[index],
      open: this.open[index],
      high: this.high[index],
      low: this.low[index],
      close: this.close[index],
      volume: this.volume[index],
    };
  }

  /**
   * Overwrites bar values at index.
   */
  public setBar(index: number, bar: Bar): void {
    if (index < 0 || index >= this.length) {
      throw new RangeError(`Index out of range [0, ${this.length}): ${index}`);
    }
    this.time[index] = bar.time;
    this.open[index] = bar.open;
    this.high[index] = bar.high;
    this.low[index] = bar.low;
    this.close[index] = bar.close;
    this.volume[index] = bar.volume;
  }

  /**
   * Returns a zero-copy view of the bar range [start, end).
   */
  public slice(start: number = 0, end: number = this.length): ColumnarBarTable {
    const clampedStart = Math.max(0, Math.min(start, this.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, this.length));
    const newLen = clampedEnd - clampedStart;

    return new ColumnarBarTable(
      newLen,
      this.time.subarray(clampedStart, clampedEnd),
      this.open.subarray(clampedStart, clampedEnd),
      this.high.subarray(clampedStart, clampedEnd),
      this.low.subarray(clampedStart, clampedEnd),
      this.close.subarray(clampedStart, clampedEnd),
      this.volume.subarray(clampedStart, clampedEnd),
      this._underlyingBuffer,
      this._stride,
    );
  }

  /**
   * Allocates a new continuous buffer containing the copied slice [start, end).
   */
  public copySlice(start: number = 0, end: number = this.length): ColumnarBarTable {
    const clampedStart = Math.max(0, Math.min(start, this.length));
    const clampedEnd = Math.max(clampedStart, Math.min(end, this.length));
    const newLen = clampedEnd - clampedStart;

    const copy = ColumnarBarTable.allocate(newLen);
    copy.time.set(this.time.subarray(clampedStart, clampedEnd));
    copy.open.set(this.open.subarray(clampedStart, clampedEnd));
    copy.high.set(this.high.subarray(clampedStart, clampedEnd));
    copy.low.set(this.low.subarray(clampedStart, clampedEnd));
    copy.close.set(this.close.subarray(clampedStart, clampedEnd));
    copy.volume.set(this.volume.subarray(clampedStart, clampedEnd));
    return copy;
  }

  /**
   * Deep copies the table into a fresh continuous ArrayBuffer.
   */
  public clone(): ColumnarBarTable {
    return this.copySlice(0, this.length);
  }

  /**
   * Appends another ColumnarBarTable to this one, returning a new continuous table.
   */
  public append(other: ColumnarBarTable): ColumnarBarTable {
    const totalLen = this.length + other.length;
    const result = ColumnarBarTable.allocate(totalLen);

    result.time.set(this.time, 0);
    result.time.set(other.time, this.length);

    result.open.set(this.open, 0);
    result.open.set(other.open, this.length);

    result.high.set(this.high, 0);
    result.high.set(other.high, this.length);

    result.low.set(this.low, 0);
    result.low.set(other.low, this.length);

    result.close.set(this.close, 0);
    result.close.set(other.close, this.length);

    result.volume.set(this.volume, 0);
    result.volume.set(other.volume, this.length);

    return result;
  }

  /**
   * Converts typed array data into boxed Bar array. Use only for UI export/debugging.
   */
  public toBars(): Bar[] {
    const bars: Bar[] = new Array(this.length);
    const time = this.time;
    const open = this.open;
    const high = this.high;
    const low = this.low;
    const close = this.close;
    const volume = this.volume;

    for (let i = 0; i < this.length; i++) {
      bars[i] = {
        time: time[i],
        open: open[i],
        high: high[i],
        low: low[i],
        close: close[i],
        volume: volume[i],
      };
    }
    return bars;
  }

  /**
   * Uses ArrayBuffer.prototype.transfer if supported, or structured clone fallback.
   */
  public transfer(): ColumnarBarTable {
    if (this._underlyingBuffer && typeof this._underlyingBuffer.transfer === 'function') {
      const transferredBuffer: ArrayBuffer = this._underlyingBuffer.transfer();
      return ColumnarBarTable.fromPayload({
        length: this.length,
        stride: this._stride!,
        buffer: transferredBuffer,
      });
    }
    return this.clone();
  }
}
