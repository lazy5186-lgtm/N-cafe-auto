const https = require('https');
const http = require('http');

function getPublicIP() {
  return new Promise((resolve) => {
    const services = [
      { url: 'https://api.ipify.org?format=json', parse: (data) => JSON.parse(data).ip },
      { url: 'https://httpbin.org/ip', parse: (data) => JSON.parse(data).origin },
      { url: 'http://ip-api.com/json', parse: (data) => JSON.parse(data).query, useHttp: true },
    ];

    let resolved = false;

    function tryService(index) {
      if (index >= services.length || resolved) {
        if (!resolved) resolve(null);
        return;
      }

      const service = services[index];
      const client = service.useHttp ? http : https;

      const req = client.get(service.url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (resolved) return;
          try {
            const ip = service.parse(data);
            if (ip) {
              resolved = true;
              resolve(ip.trim());
            } else {
              tryService(index + 1);
            }
          } catch (e) {
            tryService(index + 1);
          }
        });
      });

      req.on('error', () => {
        if (!resolved) tryService(index + 1);
      });

      req.on('timeout', () => {
        req.destroy();
        if (!resolved) tryService(index + 1);
      });
    }

    tryService(0);
  });
}

module.exports = { getPublicIP };
