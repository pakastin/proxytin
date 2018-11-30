const http = require('http');
const cp = require('child_process');
const agent = new http.Agent({ keepAlive: true });

module.exports = class Server {
  constructor (modulePath, settings = {}) {
    this._modulePath = modulePath;
    this._settings = settings;

    this._starting = false;
    this._connected = false;
    this._closing = false;

    this._connections = 0;
  }
  getPort () {
    if (this._connected) {
      return Promise.resolve(this.port);
    }
    return this.start();
  }
  start () {
    if (this._connected || this._starting) {
      return Promise.resolve();
    }
    this._starting = true;

    return new Promise((resolve, reject) => {
      const { env, cwd, timeout = 60 * 1000 } = this._settings;

      const timeoutId = setTimeout(() => {
        this._starting = false;
        this._connected = false;

        reject(new Error('Timeout'));
      }, timeout);

      const settings = {};

      settings.env = {
        ...process.env
      };

      if (env) {
        settings.env = {
          ...settings.env,
          env
        };
      }

      if (cwd) {
        settings.cwd = cwd;
        settings.env.PATH = cwd + ':' + settings.env.PATH;
      }

      settings.silent = true;

      this.child = cp.fork(this._modulePath, settings);

      this.child.stdout.pipe(process.stdout);
      this.child.stderr.pipe(process.stderr);

      this.child.on('message', (data) => {
        if (!data || typeof data !== 'object') {
          return;
        }
        const { port, error } = data;

        if (error) {
          this._starting = false;
          this._connected = false;

          clearTimeout(timeoutId);

          return reject(new Error(error));
        }

        if (port) {
          this.port = port;

          if (!this._connected) {
            this._starting = false;

            resolve(this.port);
          }

          this._connected = true;
          clearTimeout(timeoutId);
        }
      });

      const onClose = () => {
        if (!this._connected) {
          clearTimeout(timeoutId);

          reject(new Error('Closed'));
        }
        this._starting = false;
        this._connected = false;
      };

      this.child.on('close', onClose);
    });
  }
  async proxyTo (req, res, next) {
    let done = false;

    const port = await this.getPort().catch(err => console.error(new Error(err)));

    if (!port) {
      return res.sendStatus(500);
    }

    const { url } = req;

    this._connections++;

    const proxyReq = http.request({
      ...req,
      agent,
      headers: {
        ...req.headers,
        'X-Forwarded-Host': req.hostname,
        'X-Forwarded-For': req.ips.concat(req.ip).join(', '),
        'X-Forwarded-Proto': req.protocol
      },
      host: 'localhost',
      port,
      path: url,
      timeout: 60000
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);

      proxyRes.on('error', (err) => {
        console.error(new Error(err));
        if (!done) {
          this._connections--;

          res.sendStatus(500);

          if (this._closing) {
            process.exit();
          }
        }
        done = true;
      });

      proxyRes.on('data', (chunk) => {
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        if (!done) {
          this._connections--;
          res.end();

          if (this._closing) {
            process.exit();
          }
        }
        done = true;
      });
    });

    req.on('error', (err) => {
      console.error(new Error(err));
      if (!done) {
        this._connections--;
        res.end();

        if (this._closing) {
          process.exit();
        }
      }
      done = true;
      proxyReq.abort();
    });

    req.on('data', (chunk) => {
      proxyReq.write(chunk);
    });

    req.on('end', () => {
      proxyReq.end();
    });
  }
  close () {
    this._closing = true;

    if (!this._connections) {
      process.exit();
    }
  }
};
