const http = require('http');
const cp = require('child_process');

const agent = new http.Agent({ keepAlive: true });

class Server {
  constructor (modulePath, settings = {}) {
    this._modulePath = modulePath;
    this._settings = settings;
    this._starting = false;
    this._closing = false;
    this._connected = false;
    this._connections = 0;
  }
  close () {
    this._closing = true;

    if (!this._connections) {
      process.exit();
    }
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
      const timeout = setTimeout(() => {
        this._starting = false;
        this._connected = false;

        reject(new Error('Timeout'));
      }, 60 * 1000);

      const { env = {} } = this._settings;

      this.child = cp.fork(this._modulePath, {
        env: {
          ...process.env,
          ...env
        }
      });

      this.child.on('message', (data) => {
        if (!data || typeof data !== 'object') {
          return;
        }
        const { port, error } = data;

        if (error) {
          this._starting = false;
          this._connected = false;

          clearTimeout(timeout);

          return reject(new Error(error));
        }

        if (port) {
          this.port = port;

          if (!this._connected) {
            this._starting = false;

            resolve(this.port);
          }

          this._connected = true;
          clearTimeout(timeout);
        }
      });

      const onClose = () => {
        if (!this._connected) {
          clearTimeout(timeout);

          reject(new Error('Closed'));
        }
        this._starting = false;
        this._connected = false;
      };

      this.child.on('close', onClose);
    });
  }
  async proxyTo (req, res, next) {
    this.done = false;
    this._connections++;

    const port = await this.getPort();

    if (!port) {
      return res.sendStatus(500);
    }

    const { url } = req;

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
      path: url
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);

      proxyRes.on('data', (chunk) => {
        res.write(chunk);
      });

      proxyRes.on('end', () => {
        if (!this.done) {
          this._connections--;
          res.end();

          if (this._closing) {
            process.exit();
          }
        }
        this.done = true;
      });
    });

    proxyReq.on('error', () => {
      if (!this.done) {
        this._connections--;

        res.sendStatus(500);

        if (this._closing) {
          process.exit();
        }
      }
      this.done = true;
    });

    req.on('data', (chunk) => {
      proxyReq.write(chunk);
    });

    req.on('end', () => {
      proxyReq.end();
    });
  }
}

const servers = {};

module.exports = {
  listen (app, cb) {
    const server = app.listen(0, (error) => {
      if (error) {
        process.send({
          error
        });
        return cb && cb(error);
      }
      const { port } = server.address();

      process.send({
        port
      });

      cb && cb(null, port);
    });
  },
  getPort (modulePath, id) {
    const fullId = id ? `${modulePath}_${id}` : modulePath;

    const server = servers[fullId] || (servers[fullId] = new Server(modulePath));

    return server.getPort();
  },
  start (modulePath, id) {
    const fullId = id ? `${modulePath}_${id}` : modulePath;

    const server = servers[fullId] || (servers[fullId] = new Server(modulePath));

    server.start();
  },
  proxyTo (modulePath, id, settings) {
    return (req, res, next) => {
      const fullId = id ? `${modulePath}_${id}` : modulePath;

      const server = servers[fullId] || (servers[fullId] = new Server(modulePath, settings));
      server.proxyTo(req, res, next);
    };
  },
  middleware (cb) {
    return (req, res, next) => {
      const end = res.end;

      res.end = () => {
        end.call(res);

        cb && cb();
      };

      next();
    };
  },
  close (modulePath, id) {
    const fullId = id ? `${modulePath}_${id}` : modulePath;

    const server = servers[fullId] || (servers[fullId] = new Server(modulePath));
    delete servers[fullId];

    server.close();
  },
  Server
};
