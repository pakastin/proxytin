# proxytin
Proxy with on-demand server launching

## Installation
```
npm i proxytin
```

## Create a client server
```
a.js
```

```js
const express = require('express');
const { listen } = require('proxytin');

const app = express();

app.get('/', (req, res, next) => {
  res.send('Hello from a');
});

listen(app, (err, port) => {
  if (err) {
    throw new Error(err);
  }
  console.log(`Listening to ${port}`);
});
```

## Create a proxy server
```
proxy.js
```

```js
const { proxyTo } = require('proxytin');

const express = require('express');
const app = express();

app.get('/a', proxyTo('./a.js'));

app.listen(80);
```
