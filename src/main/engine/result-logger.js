const store = require('../data/store');

class ResultLogger {
  constructor() {
    this.executionId = null;
    this.accountId = null;
    this.results = [];
    this.startTime = null;
  }

  start(accountId) {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    this.accountId = accountId || '';
    this.executionId = `exec-${this.accountId}-${ts}`;
    this.results = [];
    this.startTime = now;
  }

  addResult(result) {
    this.results.push({
      ...result,
      timestamp: new Date().toISOString(),
    });
  }

  save() {
    const log = {
      executionId: this.executionId,
      accountId: this.accountId,
      timestamp: this.startTime.toISOString(),
      completedAt: new Date().toISOString(),
      results: this.results,
    };
    store.saveExecutionLog(log);
    return log;
  }

  getLog() {
    return {
      executionId: this.executionId,
      accountId: this.accountId,
      timestamp: this.startTime ? this.startTime.toISOString() : null,
      results: this.results,
    };
  }
}

module.exports = ResultLogger;
