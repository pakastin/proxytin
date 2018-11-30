const Server = require('./server.js');

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
    if (id != null && typeof id === 'object') {
      return this.proxyTo(modulePath, null, id);
    }
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
