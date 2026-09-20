import { Series } from '../Series';

export class Barstate {
    private _live: boolean = false;

    public isconfirmedOverride?: boolean;
    public isrealtimeOverride?: boolean;
    public islastOverride?: boolean;
    public ishistoryOverride?: boolean;
    public isnewOverride?: boolean;

    constructor(private context: any) {}
    public setLive() {
        this._live = true;
    }
    public get isnew() {
        if (this.isnewOverride !== undefined) {
            return this.isnewOverride;
        }
        return !this._live;
    }

    public get islast() {
        if (this.islastOverride !== undefined) {
            return this.islastOverride;
        }
        return this.context.idx === this.context.length - 1;
    }

    public get isfirst() {
        return this.context.idx === 0;
    }

    public get ishistory() {
        if (this.ishistoryOverride !== undefined) {
            return this.ishistoryOverride;
        }
        // Use context.length (total bar count) instead of incrementally-built
        // context.data.close.data.length, which only has bars 0..idx during
        // execution and would always equal idx+1 (making ishistory always false).
        return this.context.idx < this.context.length - 1;
    }

    public get isrealtime() {
        if (this.isrealtimeOverride !== undefined) {
            return this.isrealtimeOverride;
        }
        // Use context.length for same reason as ishistory above.
        return this.context.idx === this.context.length - 1;
    }

    public get isconfirmed() {
        if (this.isconfirmedOverride !== undefined) {
            return this.isconfirmedOverride;
        }
        // Check if the CURRENT bar (not the last bar) has closed.
        // Historical bars are always confirmed; only the live bar is unconfirmed.
        const ct = this.context.data?.closeTime;
        if (ct?.data && Array.isArray(ct.data)) {
            const closeTime = ct.data[this.context.idx];
            return closeTime <= Date.now();
        }
        if (ct?.buffer) {
            const closeTime = ct.buffer[this.context.idx];
            return closeTime <= Date.now();
        }
        if (typeof ct?.get === 'function') {
            const closeTime = ct.get(0);
            return closeTime <= Date.now();
        }
        return true;
    }

    public get islastconfirmedhistory() {
        // True on exactly ONE bar: the last confirmed historical bar.
        // Per Pine Script docs: "Returns true if script is executing on the
        // dataset's last bar when market is closed, or on the bar immediately
        // preceding the real-time bar if market is open."
        //
        // Uses context.length (total bar count, set before iteration) instead
        // of the incrementally-built context.data arrays, which only contain
        // bars 0..idx during execution and would falsely return true on every bar.
        const idx = this.context.idx;
        const totalBars = this.context.length;

        if (idx === totalBars - 1) {
            // Last bar in the dataset — true only if market is closed
            // (i.e., this bar's close time is in the past → it's confirmed)
            const ct = this.context.data?.closeTime;
            const closeTime = ct?.data ? ct.data[idx] : ct?.buffer ? ct.buffer[idx] : ct?.get ? ct.get(0) : Date.now();
            return closeTime <= Date.now();
        }

        if (idx === totalBars - 2) {
            // Second-to-last bar — true if the last bar is a live/realtime bar
            // (i.e., the last bar's close time is still in the future).
            // Read from context.marketData (full raw candle array, available
            // before iteration starts) to peek at the last bar's close time.
            const lastCloseTime = this.context.marketData?.[totalBars - 1]?.closeTime;
            if (lastCloseTime !== undefined) {
                return lastCloseTime > Date.now();
            }
            return false;
        }

        return false;
    }
}
