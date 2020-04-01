const assert = require('assert');
const query = require('../_lib/query')();
const createManager = require('../_lib/manager');

describe('complex query', () => {
  beforeEach(async () => {
    await query('DROP TABLE IF EXISTS test');
    await query(`
      CREATE TABLE test (
        id INT AUTO_INCREMENT,
        foo VARCHAR(100),
        bar VARCHAR(100),
        foo2 VARCHAR(100),
        bar2 VARCHAR(100),
        PRIMARY KEY (id)
      )
    `);
    await query('INSERT INTO test (foo,bar,foo2,bar2) VALUES (?,?,?,?)', ['pre1', 'pre2', 'pre2', 'pre4']);
    await query('INSERT INTO test (foo,bar,foo2,bar2) VALUES (?,?,?,?)', ['pre3', 'pre4', 'pre2', 'pre4']);
    await query('INSERT INTO test (foo,bar,foo2,bar2) VALUES (?,?,?,?)', ['pre5', 'pre6', 'pre2', 'pre4']);
  });

  afterEach(async () => {
    await query('DROP TABLE test');
  });

  it('!or only', async () => {
    const manager = createManager();

    try {
      await manager.runSession(async session => {
        const data = await session.factory('test', {
          '!or': [
            { foo: 'pre1' },
            { bar: 'pre4' },
            { bar: 'pre6' },
          ],
        }).all();

        assert.strictEqual(data.length, 3);
      });
    } finally {
      await manager.end();
    }
  });

  it('complex query or and', async () => {
    const manager = createManager();

    try {
      await manager.runSession(async session => {
        const data = await session.factory('test', {
          '!or': [
            { foo: 'pre1', bar2: 'pre4' },
            { bar: 'pre4', foo2: 'pre2' },
          ],
        }).all();

        assert.strictEqual(data.length, 2);
      });
    } finally {
      await manager.end();
    }
  });

  it('complex query or with normal query and', async () => {
    const manager = createManager();

    try {
      await manager.runSession(async session => {
        const data = await session.factory('test', {
          foo: 'pre1',
          '!or': [
            { foo: 'pre1', bar2: 'pre4' },
            { bar: 'pre4', foo2: 'pre2' },
          ],
        }).all();

        assert.strictEqual(data.length, 1);
      });
    } finally {
      await manager.end();
    }
  });
});
