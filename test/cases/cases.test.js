const assert = require('assert');
const query = require('../_lib/query')();
const createManager = require('../_lib/manager');

describe('cases', () => {
  beforeEach(async () => {
    await query('DROP TABLE IF EXISTS foo');
    await query(`
      CREATE TABLE foo (
        id INT AUTO_INCREMENT,
        foo VARCHAR(100),
        bar VARCHAR(100),
        PRIMARY KEY (id)
      )
    `);
    await query('INSERT INTO foo (foo) VALUES (?), (?)', ['pre1', 'pre2']);
    await query('INSERT INTO foo (foo) VALUES (?), (?)', ['pre3', 'pre4']);
    await query('INSERT INTO foo (foo) VALUES (?), (?)', ['pre5', 'pre6']);
  });

  afterEach(async () => {
    await query('DROP TABLE foo');
  });

  it('create new record', async () => {
    const manager = createManager();

    try {
      await manager.runSession(async session => {
        const { affected, rows } = await session.factory('foo')
          .insert({ foo: 'bar' })
          .insert({ bar: 'baz' })
          .save();
        assert.strictEqual(affected, 2);
        assert.strictEqual(rows.length, 2);
      });

      const { results } = await query('SELECT * from foo');
      assert.strictEqual(results.length, 8);
    } finally {
      await manager.end();
    }
  });

  it('rollback if error', async () => {
    const manager = createManager();

    try {
      try {
        await manager.runSession(async session => {
          const { affected, rows } = await session.factory('foo')
            .insert({ foo: 'bar' })
            .save();

          assert.strictEqual(affected, 1);
          assert.strictEqual(rows.length, 1);

          throw new Error('Ouch');
        });
      } catch (err) {
        if (err.message !== 'Ouch') {
          throw err;
        }
      }

      const { results } = await query('SELECT * from foo');
      assert.strictEqual(results.length, 6);
    } finally {
      await manager.end();
    }
  });

  it('read record', async () => {
    const manager = createManager();
    try {
      await manager.runSession(async session => {
        const foos = await session.factory('foo').all();
        assert.strictEqual(foos.length, 6);
      });
    } finally {
      await manager.end();
    }
  });

  it('update record', async () => {
    const manager = createManager();
    try {
      await manager.runSession(async session => {
        const { affected } = await session.factory('foo', 2).set({ foo: 'bar' }).save();
        assert.strictEqual(affected, 1);
      });

      const { results } = await query('SELECT * FROM foo WHERE id = 2');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].foo, 'bar');
    } finally {
      await manager.end();
    }
  });

  it('delete record', async () => {
    const manager = createManager();
    try {
      await manager.runSession(async session => {
        await session.factory('foo').delete();
      });

      const { results } = await query('SELECT * FROM foo');
      assert.strictEqual(results.length, 0);
    } finally {
      await manager.end();
    }
  });

  it('count record', async () => {
    const manager = createManager();
    try {
      await manager.runSession(async session => {
        const count = await session.factory('foo').count();
        assert.strictEqual(count, 6);
      });
    } finally {
      await manager.end();
    }
  });

  it('check limit and offset', async () => {
    const manager = createManager();
    try {
      await manager.runSession(async session => {
        const data = await session.factory('foo').limit(1).skip(3).all();
        assert.strictEqual(data.length, 1);
      });
    } finally {
      await manager.end();
    }
  });

  it('check  offset without limit', async () => {
    const manager = createManager();
    try {
      await manager.runSession(async session => {
        const data = await session.factory('foo').skip(3).all();
        assert.strictEqual(data.length, 3);
      });
    } finally {
      await manager.end();
    }
  });
  it('check  without offset without limit', async () => {
    const manager = createManager();
    try {
      await manager.runSession(async session => {
        const data = await session.factory('foo').all();
        assert.strictEqual(data.length, 6);
      });
    } finally {
      await manager.end();
    }
  });
});
