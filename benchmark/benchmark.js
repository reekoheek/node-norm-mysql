const query = require('../test/_lib/query')();
const createManager = require('../test/_lib/manager');
const NString = require('node-norm/schemas/nstring');
const debug = require('debug')('node-norm-mysql:test:benchmark');

const TX_SIZE = 10000;
const BUFFER_SIZE = 1000;

(async () => {
  await query('DROP TABLE IF EXISTS foo');
  await query(`
    CREATE TABLE foo (
      id INT AUTO_INCREMENT,
      foo VARCHAR(100),
      bar VARCHAR(100),
      PRIMARY KEY (id)
    )
  `);

  const manager = createManager({
    schemas: [
      {
        name: 'foo',
        fields: [
          new NString('foo'),
          new NString('bar'),
        ],
      },
    ],
  });

  const stime = new Date();
  try {
    await manager.runSession(async session => {
      let i = 0;
      const query = session.factory('foo');

      while (i++ < TX_SIZE) {
        query.insert({ foo: i, bar: i });

        // await session.factory('foo').insert({ foo: i, bar: i }).save();

        if (i !== 0 && i % BUFFER_SIZE === 0) {
          debug('saving', i);
          await query.save();
          debug('flushing', i);
          await session.flush();
          debug('flushed', i);
        }
      }

      if (query.rows.length) {
        debug('saving');
        await query.save();
        debug('flushing');
      }
    });
  } finally {
    const delta = (new Date() - stime) / 1000;
    debug('Time %f', delta);
    debug('TPS  %f', TX_SIZE / delta);
    await manager.end();

    await query('DROP TABLE IF EXISTS foo');
  }
})();
