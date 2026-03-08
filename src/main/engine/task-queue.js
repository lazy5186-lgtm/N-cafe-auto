const { EventEmitter } = require('events');

class TaskQueue extends EventEmitter {
  constructor() {
    super();
    this.tasks = [];
    this.currentIndex = 0;
    this.state = 'idle'; // idle, running, paused, stopped
    this._pauseResolve = null;
  }

  setTasks(tasks) {
    this.tasks = tasks;
    this.currentIndex = 0;
    this.state = 'idle';
  }

  get progress() {
    return {
      current: this.currentIndex,
      total: this.tasks.length,
      state: this.state,
      percent: this.tasks.length > 0 ? Math.round((this.currentIndex / this.tasks.length) * 100) : 0,
    };
  }

  pause() {
    if (this.state === 'running') {
      this.state = 'paused';
      this.emit('paused');
    }
  }

  resume() {
    if (this.state === 'paused') {
      this.state = 'running';
      if (this._pauseResolve) {
        this._pauseResolve();
        this._pauseResolve = null;
      }
      this.emit('resumed');
    }
  }

  stop() {
    this.state = 'stopped';
    if (this._pauseResolve) {
      this._pauseResolve();
      this._pauseResolve = null;
    }
    this.emit('stopped');
  }

  async waitIfPaused() {
    if (this.state === 'paused') {
      await new Promise(resolve => {
        this._pauseResolve = resolve;
      });
    }
    return this.state !== 'stopped';
  }

  async run(executor) {
    this.state = 'running';
    this.emit('started');

    for (this.currentIndex = 0; this.currentIndex < this.tasks.length; this.currentIndex++) {
      if (this.state === 'stopped') break;

      const canContinue = await this.waitIfPaused();
      if (!canContinue) break;

      const task = this.tasks[this.currentIndex];
      this.emit('progress', this.progress);

      try {
        const result = await executor(task, this.currentIndex);
        this.emit('taskComplete', { index: this.currentIndex, task, result });
      } catch (e) {
        this.emit('taskError', { index: this.currentIndex, task, error: e.message });
      }
    }

    this.state = this.state === 'stopped' ? 'stopped' : 'idle';
    this.emit('complete', this.progress);
  }
}

module.exports = TaskQueue;
