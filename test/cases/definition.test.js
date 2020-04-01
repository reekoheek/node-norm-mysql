const assert = require('assert');
const query = require('../_lib/query')();
const createManager = require('../_lib/manager');
const NString = require('node-norm/schemas/nstring');
const NInteger = require('node-norm/schemas/ninteger');
const NDouble = require('node-norm/schemas/ndouble');
const NBoolean = require('node-norm/schemas/nboolean');
const NDatetime = require('node-norm/schemas/ndatetime');
const NMap = require('node-norm/schemas/nmap');
const NList = require('node-norm/schemas/nlist');
const NBig = require('node-norm/schemas/nbig');

class Foo extends NString {}

describe('definition', () => {
  it('check whether defined', async () => {
    const schemas = [
      {
        name: 'foo',
        fields: [
          new NString('fstr'),
          new NInteger('fint'),
          new NDouble('fdbl'),
          new NBoolean('fbol'),
          new NDatetime('fdt'),
          new NMap('fmap'),
          new NList('flst'),
          new NBig('fbig'),
          new Foo('ffoo'),
          new NString('fcustomtype').set('mysql.ddl.type', 'VARCHAR(25)'),
          new NInteger('fextra').set('mysql.ddl.override', 'INT NOT NULL DEFAULT 0'),
        ],
      },
    ];

    const manager = createManager({ schemas });

    try {
      await query('DROP TABLE IF EXISTS foo');

      await manager.runSession(async session => {
        assert.strictEqual(await session.factory('foo').defined(), false);

        await session.factory('foo').define();

        assert.strictEqual(await session.factory('foo').defined(), true);

        await session.factory('foo').undefine();

        assert.strictEqual(await session.factory('foo').defined(), false);
      });
    } finally {
      await query('DROP TABLE IF EXISTS foo');
      await manager.end();
    }
  });

  it('rollback if define caught error', async () => {
    const schemas = [
      {
        name: 'foo',
        fields: [
          new NString('foo'),
        ],
      },
      {
        name: 'bar',
        fields: [
          new NString('bar'),
        ],
      },
    ];

    const manager = createManager({ schemas });

    try {
      await query('DROP TABLE IF EXISTS foo');
      await query('DROP TABLE IF EXISTS bar');
      await query(`
        CREATE TABLE foo (
          id INT AUTO_INCREMENT,
          foo VARCHAR(100),
          PRIMARY KEY (id)
        )
      `);

      await query(`
        CREATE TABLE bar (
          id INT AUTO_INCREMENT,
          bar VARCHAR(100),
          PRIMARY KEY (id)
        )
      `);

      try {
        await manager.runSession(async session => {
          const { affected, rows } = await session.factory('foo')
            .insert({ foo: 'bar' })
            .save();

          assert.strictEqual(affected, 1);
          assert.strictEqual(rows.length, 1);

          await session.factory('bar').define();
        });
      } catch (err) {
        // noop
      }

      const { results } = await query('SELECT * from foo');
      assert.strictEqual(results.length, 0);
    } finally {
      await query('DROP TABLE IF EXISTS foo');
      await query('DROP TABLE IF EXISTS bar');
      await manager.end();
    }
  });

  it('rollback if undefine caught error', async () => {
    const schemas = [
      {
        name: 'foo',
        fields: [
          new NString('foo'),
        ],
      },
      {
        name: 'bar',
        fields: [
          new NString('bar'),
        ],
      },
    ];

    const manager = createManager({ schemas });

    try {
      await query('DROP TABLE IF EXISTS foo');
      await query('DROP TABLE IF EXISTS bar');
      await query(`
        CREATE TABLE foo (
          id INT AUTO_INCREMENT,
          foo VARCHAR(100),
          PRIMARY KEY (id)
        )
      `);

      try {
        await manager.runSession(async session => {
          const { affected, rows } = await session.factory('foo')
            .insert({ foo: 'bar' })
            .save();

          assert.strictEqual(affected, 1);
          assert.strictEqual(rows.length, 1);

          await session.factory('bar').undefine();
        });
      } catch (err) {
        // noop
      }

      const { results } = await query('SELECT * from foo');
      assert.strictEqual(results.length, 0);
    } finally {
      await query('DROP TABLE IF EXISTS foo');
      await query('DROP TABLE IF EXISTS bar');
      await manager.end();
    }
  });
});
