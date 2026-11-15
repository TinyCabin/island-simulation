import { RULES } from '../config.js';

export class TimeManager {
  constructor({
    intervalSeconds = RULES.snapshotIntervalSeconds,
    maxSnapshots = RULES.maxSnapshots,
  } = {}) {
    this.intervalSeconds = intervalSeconds;
    this.maxSnapshots = maxSnapshots;
    this.history = [];
    this.cursor = -1;
  }

  get length() {
    return this.history.length;
  }

  get isAtHead() {
    return this.cursor === this.history.length - 1;
  }

  recordIfDue(originator) {
    const last = this.history[this.history.length - 1];
    if (!last || originator.simTime - last.simTime >= this.intervalSeconds - 1e-6) {
      this.#push(originator.createMemento());
    }
  }

  capture(originator) {
    const memento = originator.createMemento();
    const last = this.history[this.history.length - 1];
    if (last && memento.simTime - last.simTime < this.intervalSeconds * 0.5) {
      this.history[this.history.length - 1] = memento;
      this.cursor = this.history.length - 1;
    } else {
      this.#push(memento);
    }
  }

  seek(index) {
    this.cursor = Math.min(this.history.length - 1, Math.max(0, index));
    return this.history[this.cursor];
  }

  branchFromCursor() {
    if (!this.isAtHead) this.history.length = this.cursor + 1;
  }

  #push(memento) {
    this.history.push(memento);
    if (this.history.length > this.maxSnapshots) this.history.shift();
    this.cursor = this.history.length - 1;
  }
}